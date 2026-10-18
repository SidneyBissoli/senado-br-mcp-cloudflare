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
 *   4. Emite lotes SQL (out-ideias-detalhe-NNN.sql) e, no fim, o upsert do cursor.
 *
 * Falha de fetch de detalhe → preserva o detalhe atual (não zera), loga a lacuna, e o cursor AVANÇA
 * mesmo assim (não trava a varredura). Sem run row 'ok' (não é crawl de corpus; não mexe no baseline).
 */

import { writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sleep } from "./http.js";
import { planEntitySync, type SyncRecord } from "../../src/scraper/pipeline.js";
import { vigiarCampos, descreverVigia } from "../../src/scraper/mesclar.js";
import { registroDetalheIdeia, CAMPOS_DETALHE_IDEIA, type DetalheIdeiaLido } from "./ideias-registro.js";
import { criarDisjuntor } from "./breaker.js";
import { readCurrentRange, readDetalheCursor, type CurrentPayloadRow } from "./d1.js";
import { generateDetalheLoadSqlBatches, cursorUpsertStmt, generateRunOnlySql } from "./sql.js";
import { fetchIdeiaDetalhe, ehRecursoRemovido } from "./detalhe.js";
import { detalheParaCorpus, IdeiaDetalheForaDoMoldeError } from "../../src/scraper/ideia-detalhe.js";

const ENTIDADE = "ideias";
const CHUNK = Number(process.env.INGEST_IDEIAS_DETALHE_CHUNK) || 8000;
const DETAIL_DELAY_MS = Number(process.env.INGEST_IDEIAS_DETAIL_DELAY_MS) || 250;
const BATCH_SIZE = Number(process.env.INGEST_IDEIAS_BATCH_SIZE) || 10000;
const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_PREFIX = "out-ideias-detalhe-";

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
  console.log(`[ideias-detalhe] cursor=${cursor.lastEntityId} fullPasses=${fullPasses} chunk=${rows.length}`);

  const disjuntor = criarDisjuntor();
  const records: SyncRecord[] = [];
  // Leitura crua × guardado, por id lido com sucesso — a entrada do vigia (o mesclado nunca cai).
  const leituras: Array<{ lido: Record<string, unknown>; guardado: Record<string, unknown> }> = [];
  let fetched = 0;
  let gaps = 0;
  let removidas = 0;
  let naoReconhecidas = 0;
  let lastId = afterId;
  for (const row of rows) {
    let detail: DetalheIdeiaLido | null = null;
    let removida = false;
    try {
      detail = detalheParaCorpus(await fetchIdeiaDetalhe(row.id));
      fetched++;
      leituras.push({ lido: { ...detail }, guardado: JSON.parse(row.payload_json) as Record<string, unknown> });
      disjuntor.sucesso();
    } catch (e) {
      if (e instanceof IdeiaDetalheForaDoMoldeError) {
        // Página que o leitor não reconhece: nada desta leitura é gravado (o guardado fica), e ela entra
        // no vigia como leitura vazia — muitas assim reprovam o run.
        naoReconhecidas++;
        leituras.push({ lido: Object.fromEntries(CAMPOS_DETALHE_IDEIA.map((c) => [c, null])), guardado: JSON.parse(row.payload_json) as Record<string, unknown> });
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
        disjuntor.falha(e, `id=${row.id}`);
      }
    }
    await sleep(DETAIL_DELAY_MS);
    records.push(rebuild(row, detail, removida));
    lastId = row.id;
  }

  // Vigia: a mesclagem impede que a leitura vazia apague, mas também a esconderia. Queda brusca da
  // taxa de leitura de um campo = o leitor deixou de reconhecer a página → nada gravado, cursor parado
  // (o mesmo chunk volta no próximo run, depois do conserto).
  const vigia = vigiarCampos(leituras, CAMPOS_DETALHE_IDEIA);
  console.log(`[ideias-detalhe][vigia] ${descreverVigia(vigia)}`);
  if (!vigia.ok) {
    const err = `taxa de leitura despencou: ${descreverVigia({ ...vigia, campos: vigia.quedas })}`;
    console.error(`[ideias-detalhe][gate] verdict=anomalo — ${err} — nada será gravado, cursor parado`);
    cleanOldOutputs();
    writeRunOnly(now, "anomalo", rows.length, err);
    process.exit(1);
  }

  // Cursor avança para o último id processado (ou fica em `afterId` se o chunk veio vazio).
  const nextCursor = lastId;
  const existingHashes = new Map(rows.map((r) => [r.id, r.content_hash]));
  const { annotated, rowsChanged } = planEntitySync(records, existingHashes);
  const tail = cursorUpsertStmt(ENTIDADE, nextCursor, fullPasses, now);
  const files = generateDetalheLoadSqlBatches(annotated, now, ENTIDADE, tail, BATCH_SIZE);
  files.forEach((content, i) => {
    writeFileSync(join(OUT_DIR, `${OUT_PREFIX}${String(i + 1).padStart(3, "0")}.sql`), content);
  });
  console.log(
    `[ideias-detalhe] processadas ${rows.length} (detalhe ok=${fetched} removidas=${removidas} foraDoMolde=${naoReconhecidas} gaps=${gaps}), ${rowsChanged} alteradas; ` +
      `cursor→${nextCursor}; ${files.length} arquivo(s)`,
  );
  process.exit(0);
}

main().catch((e) => {
  const err = e instanceof Error ? e.message : String(e);
  console.error(`[ideias-detalhe][fatal] ${err}`);
  try {
    // Limpa ANTES de escrever: os lotes parciais do chunk interrompido levam o
    // upsert do cursor na cauda, e aplicá-los faria o cursor avançar sobre itens
    // que nunca foram buscados.
    cleanOldOutputs();
    writeRunOnly(new Date().toISOString(), "erro", 0, `fatal: ${err}`);
  } catch {
    /* nothing more we can do */
  }
  process.exit(1);
});
