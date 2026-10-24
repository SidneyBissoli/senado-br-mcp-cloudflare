/**
 * e-Cidadania IDEIAS detail BACKFILL — resumível (ROADMAP ETAPA 5.5) — runs OFF-Worker (Action).
 *
 * Reabre os campos detail-only de ideias (dataPublicacao/autorUf/descricao/plConvertido, schema v2).
 * O corpus de ideias tem ~113,7k registros; um crawl de detalhe (1 fetch por ideia) NÃO cabe no teto
 * de tempo de uma Action. Por isso é RESUMÍVEL por cursor:
 *
 *   1. Lê o cursor (last_entity_id) de `ecidadania_detalhe_cursor`.
 *   2. Lê um CHUNK de `ecidadania_current` com entity_id > cursor (ordenado). Ao esgotar (fim da
 *      varredura), dá a volta: cursor→0, full_passes++ e recomeça (as ideias imutáveis não mudam, mas
 *      status/plConvertido podem mudar quando uma ideia é convertida — a re-varredura periódica os pega).
 *   3. Para cada ideia do chunk: fetch do detalhe (UF-only, SEM nome do autor), reconstrói o
 *      IdeiaResumo PRESERVANDO os campos de listagem (titulo/apoios/status) do payload atual +
 *      detalhe fresco. Diffa vs. o content_hash → upsert + history-on-change só p/ quem mudou.
 *   4. Grava em LOTES de `LOTE` ideias DURANTE o run (desde 23/10/2026, extensão do PR #143 das
 *      consultas): cada lote sai em `out-ideias-detalhe-lote-NNN.sql`, aplicado na hora pelo
 *      `apply-d1.sh`, com o upsert do cursor na cauda — uma falha no meio não perde o que já foi lido,
 *      e o run seguinte retoma do último lote gravado. O vigia mede CADA lote antes de gravá-lo
 *      (ver lotes.ts). Uma linha `[ideias-detalhe][andamento]` por lote, visível ao vivo na página do job.
 *
 * Falha de fetch de detalhe → preserva o detalhe atual (não zera), loga a lacuna, e o cursor AVANÇA
 * mesmo assim (não trava a varredura). Sem run row 'ok' (não é crawl de corpus; não mexe no baseline).
 * O passo final do workflow só aplica `out-ideias-detalhe-[0-9]*.sql` — a linha de run de falha.
 */

import { writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sleep } from "./http.js";
import type { SyncRecord } from "../../src/scraper/pipeline.js";
import { descreverVigia } from "../../src/scraper/mesclar.js";
import { registroDetalheIdeia, CAMPOS_DETALHE_IDEIA, type DetalheIdeiaLido } from "./ideias-registro.js";
import { criarDisjuntor } from "./breaker.js";
import { readCurrentRange, readDetalheCursor, gravarEAplicarLote, type CurrentPayloadRow } from "./d1.js";
import { cursorUpsertStmt, generateRunOnlySql } from "./sql.js";
import { fetchIdeiaDetalhe, ehRecursoRemovido } from "./detalhe.js";
import { detalheParaCorpus, IdeiaDetalheForaDoMoldeError } from "../../src/scraper/ideia-detalhe.js";
import { fecharLote, LoteReprovadoError, LOTE_PADRAO, type Leitura } from "./lotes.js";
import { descreverAndamento } from "./andamento.js";

const ENTIDADE = "ideias";
const CHUNK = Number(process.env.INGEST_IDEIAS_DETALHE_CHUNK) || 8000;
const DETAIL_DELAY_MS = Number(process.env.INGEST_IDEIAS_DETAIL_DELAY_MS) || 250;
const BATCH_SIZE = Number(process.env.INGEST_IDEIAS_BATCH_SIZE) || 10000;
/** Ideias por lote gravado durante o run. */
const LOTE = Number(process.env.INGEST_IDEIAS_DETALHE_LOTE) || LOTE_PADRAO;
const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_PREFIX = "out-ideias-detalhe-";
/** Lotes aplicados durante o run; o prefixo começa por OUT_PREFIX, então a limpeza cobre os dois. */
const LOTE_PREFIX = `${OUT_PREFIX}lote-`;

function cleanOldOutputs(): void {
  for (const f of readdirSync(OUT_DIR)) {
    if (f.startsWith(OUT_PREFIX) && f.endsWith(".sql")) unlinkSync(join(OUT_DIR, f));
  }
}

/**
 * Linha de run de FALHA — e só de falha.
 *
 * Este job compartilha `entidade` com o crawl do corpus de ideias, e por isso
 * NUNCA grava run row 'ok': ele não é um crawl de corpus e não pode mexer no
 * baseline de freshness (a regra está no cabeçalho de
 * `generateDetalheLoadSqlBatches`, em sql.ts). Essa parte do desenho está certa.
 *
 * O que faltava era o outro lado. Até 21/09/2026 uma falha aqui não deixava
 * rastro NENHUM no D1 — só no log da Action —, enquanto os três irmãos gravam
 * 'erro' em 4 a 6 pontos. A ironia ficou visível no episódio de 20-21/09: das
 * quatro rodadas mortas pelo portal fora, TRÊS eram deste job, o único mudo.
 *
 * Gravar 'erro' é seguro e não reabre a ressalva acima porque os TRÊS leitores
 * da tabela filtram por status='ok' — `pipeline.ts` (baseline de linhas),
 * `store.ts` (freshness) e `d1.ts` (último corpus bom). Linha de erro é
 * invisível para os três: ela informa, não desloca baseline nenhum.
 */
function writeRunOnly(now: string, status: string, rows: number, error: string): void {
  writeFileSync(join(OUT_DIR, `${OUT_PREFIX}001.sql`), generateRunOnlySql(now, status, rows, error, ENTIDADE));
}

/**
 * Rebuild preserving listing fields from the stored payload + the fresh detail, field by field
 * (`registroDetalheIdeia`: an empty reading never wipes a stored value). `removida` (detail answered
 * 410) overrides the stored status — the only status this job writes: an idea retired from the portal
 * leaves every listing, so no listing crawl would ever record it.
 */
function rebuild(row: CurrentPayloadRow, detail: DetalheIdeiaLido | null, removida = false): SyncRecord {
  return registroDetalheIdeia(row.payload_json, row.id, detail, removida);
}

/** Um lote em formação: linhas reconstruídas, leituras cruas (vigia), hashes correntes e o último id. */
interface LoteEmFormacao {
  records: SyncRecord[];
  leituras: Leitura[];
  hashes: Map<number, string>;
  ultimoId: number;
}

function novoLote(): LoteEmFormacao {
  return { records: [], leituras: [], hashes: new Map(), ultimoId: 0 };
}

async function main(): Promise<void> {
  const now = new Date().toISOString();
  cleanOldOutputs();

  const cursor = readDetalheCursor(ENTIDADE);
  let afterId = cursor.lastEntityId;
  let fullPasses = cursor.fullPasses;

  let rows = readCurrentRange(ENTIDADE, afterId, CHUNK);
  if (rows.length === 0 && afterId > 0) {
    // Fim da varredura → dá a volta e processa o começo neste mesmo run.
    console.log(`[ideias-detalhe] fim da passada (cursor=${afterId}); reiniciando do começo`);
    afterId = 0;
    fullPasses += 1;
    rows = readCurrentRange(ENTIDADE, 0, CHUNK);
  }
  console.log(`[ideias-detalhe] cursor=${cursor.lastEntityId} fullPasses=${fullPasses} chunk=${rows.length}, gravado em lotes de ${LOTE}`);

  const disjuntor = criarDisjuntor();
  let fetched = 0;
  let gaps = 0;
  let removidas = 0;
  let naoReconhecidas = 0;
  let processadas = 0;
  let gravadas = 0;
  // Cursor já gravado no D1 (cauda do último lote aplicado); fica em `afterId` até o 1º lote.
  let cursorGravado = afterId;
  const seq = { n: 0 };
  const inicio = Date.now();
  let lote = novoLote();

  // Gravação em LOTES durante o run (23/10/2026, extensão do PR #143 das consultas): o vigia mede as
  // leituras do PRÓPRIO lote antes de gravá-lo — a mesclagem impede que a leitura vazia apague, mas
  // também a esconderia; queda brusca = o leitor deixou de reconhecer a página → este lote não é
  // gravado, os anteriores ficam e o cursor para no fim do último gravado (o resto volta no próximo
  // run, depois do conserto). Cada lote leva o cursor na cauda do seu último arquivo.
  const gravarLote = (): void => {
    if (lote.records.length === 0) return;
    // UMA hora por lote, no histórico E no cursor: a primeira prova em produção (24/10/2026, run
    // 40070838444) gravou as 8 versões com a hora de cada lote mas o cursor com a hora do INÍCIO do
    // run (`now`), e a hora do cursor é o que diz quando ele andou pela última vez.
    const horaDoLote = new Date().toISOString();
    const fechado = fecharLote({
      leituras: lote.leituras,
      campos: CAMPOS_DETALHE_IDEIA,
      records: lote.records,
      hashes: lote.hashes,
      now: horaDoLote,
      entidade: ENTIDADE,
      tailStmt: cursorUpsertStmt(ENTIDADE, lote.ultimoId, fullPasses, horaDoLote),
      maxStmtsPerFile: BATCH_SIZE,
    });
    console.log(`[ideias-detalhe][vigia] lote ${seq.n + 1}: ${descreverVigia(fechado.vigia)}`);
    if (!fechado.vigia.ok) throw new LoteReprovadoError(fechado.vigia, seq.n + 1, cursorGravado);
    gravarEAplicarLote(OUT_DIR, LOTE_PREFIX, fechado.arquivos, seq);
    gravadas += fechado.alteradas;
    cursorGravado = lote.ultimoId;
    lote = novoLote();
    console.log(
      `[ideias-detalhe][andamento] ${descreverAndamento({ rotulo: "detalhe lido", feitos: processadas, total: rows.length, inicioMs: inicio, agoraMs: Date.now(), gravados: gravadas })} · cursor ${cursorGravado}`,
    );
  };

  try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let detail: DetalheIdeiaLido | null = null;
      let removida = false;
      try {
        detail = detalheParaCorpus(await fetchIdeiaDetalhe(row.id));
        fetched++;
        lote.leituras.push({ lido: { ...detail }, guardado: JSON.parse(row.payload_json) as Record<string, unknown> });
        disjuntor.sucesso();
      } catch (e) {
        if (e instanceof IdeiaDetalheForaDoMoldeError) {
          // Página que o leitor não reconhece: nada desta leitura é gravado (o guardado fica), e ela entra
          // no vigia como leitura vazia — muitas assim reprovam o lote.
          naoReconhecidas++;
          lote.leituras.push({ lido: Object.fromEntries(CAMPOS_DETALHE_IDEIA.map((c) => [c, null])), guardado: JSON.parse(row.payload_json) as Record<string, unknown> });
          console.warn(`[ideias-detalhe][fora-do-molde] id=${row.id}: ${e.message}`);
          disjuntor.sucesso();
        } else if (ehRecursoRemovido(e)) {
          // Resposta do portal (410), não falha de transporte: grava `removida`, preserva o resto.
          removida = true;
          removidas++;
          disjuntor.sucesso();
        } else {
          gaps++;
          console.error(`[ideias-detalhe][gap] id=${row.id}: ${e instanceof Error ? e.message : String(e)}`);
          try {
            disjuntor.falha(e, `id=${row.id}`);
          } catch (parada) {
            gravarLote(); // o portal parou: grava o que este lote já leu antes de desistir
            throw parada;
          }
        }
      }
      await sleep(DETAIL_DELAY_MS);
      lote.records.push(rebuild(row, detail, removida));
      lote.hashes.set(row.id, row.content_hash);
      lote.ultimoId = row.id;
      processadas = i + 1;
      if (lote.records.length >= LOTE || i === rows.length - 1) gravarLote();
    }
  } catch (e) {
    if (!(e instanceof LoteReprovadoError)) throw e;
    console.error(`[ideias-detalhe][gate] verdict=anomalo — ${e.message}`);
    writeRunOnly(now, "anomalo", rows.length, e.message);
    process.exit(1);
  }

  console.log(
    `[ideias-detalhe] processadas ${rows.length} (detalhe ok=${fetched} removidas=${removidas} foraDoMolde=${naoReconhecidas} gaps=${gaps}), ` +
      `${gravadas} alteradas em ${seq.n} lote(s) já aplicado(s); cursor→${cursorGravado}`,
  );
  process.exit(0);
}

main().catch((e) => {
  const err = e instanceof Error ? e.message : String(e);
  console.error(`[ideias-detalhe][fatal] ${err}`);
  try {
    // Os lotes já aplicados ficam no D1 (cursor na cauda de cada um); aqui só a linha de erro, que o
    // passo final do workflow aplica. Limpa antes para o nome 001 não colidir com nada.
    cleanOldOutputs();
    writeRunOnly(new Date().toISOString(), "erro", 0, `fatal: ${err}`);
  } catch {
    /* nothing more we can do */
  }
  process.exit(1);
});
