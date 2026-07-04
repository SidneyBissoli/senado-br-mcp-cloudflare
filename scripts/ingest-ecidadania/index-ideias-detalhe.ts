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
import { buildIdeiaResumo, type IdeiaResumo } from "../../src/scraper/ecidadania.js";
import { contentHash, planEntitySync, type SyncRecord } from "../../src/scraper/pipeline.js";
import { readCurrentRange, readDetalheCursor, type CurrentPayloadRow } from "./d1.js";
import { generateDetalheLoadSqlBatches, cursorUpsertStmt } from "./sql.js";
import { fetchIdeiaDetalheCorpus } from "./detalhe.js";

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

/** Rebuild an IdeiaResumo preserving listing fields from the stored payload + fresh (or preserved) detail. */
function rebuild(row: CurrentPayloadRow, detail: { dataPublicacao: string | null; autorUf: string | null; descricao: string | null; plConvertido: string | null } | null): SyncRecord {
  const prev = JSON.parse(row.payload_json) as Partial<IdeiaResumo>;
  const ideia = buildIdeiaResumo({
    id: row.id,
    titulo: prev.titulo,
    apoios: prev.apoios,
    status: prev.status,
    // detail fresco quando obtido; senão preserva o que já havia (não zera)
    dataPublicacao: detail ? detail.dataPublicacao : prev.dataPublicacao ?? null,
    autorUf: detail ? detail.autorUf : prev.autorUf ?? null,
    descricao: detail ? detail.descricao : prev.descricao ?? null,
    plConvertido: detail ? detail.plConvertido : prev.plConvertido ?? null,
  });
  const payloadJson = JSON.stringify(ideia);
  return {
    entityId: ideia.id,
    sourceUrl: ideia.url,
    payloadJson,
    status: ideia.status,
    metrica: ideia.apoios,
    comissao: null,
    contentHash: contentHash(payloadJson),
  };
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

  const records: SyncRecord[] = [];
  let fetched = 0;
  let gaps = 0;
  let lastId = afterId;
  for (const row of rows) {
    let detail = null;
    try {
      detail = await fetchIdeiaDetalheCorpus(row.id);
      fetched++;
    } catch (e) {
      gaps++;
      console.error(`[ideias-detalhe][gap] id=${row.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await sleep(DETAIL_DELAY_MS);
    records.push(rebuild(row, detail));
    lastId = row.id;
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
    `[ideias-detalhe] processadas ${rows.length} (detalhe ok=${fetched} gaps=${gaps}), ${rowsChanged} alteradas; ` +
      `cursor→${nextCursor}; ${files.length} arquivo(s)`,
  );
  process.exit(0);
}

main().catch((e) => {
  const err = e instanceof Error ? e.message : String(e);
  console.error(`[ideias-detalhe][fatal] ${err}`);
  process.exit(1);
});
