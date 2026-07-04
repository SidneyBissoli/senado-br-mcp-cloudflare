/**
 * e-Cidadania EVENTOS full-corpus ingestion job — runs OFF-Worker (scheduled GitHub Action).
 *
 * v2 (ROADMAP ETAPA 5.5): passou de só-listagem para listagem + DETALHE + AJAX de comentários.
 *   1. Crawl the `principalaudiencia?p=N` HTML listing (ids + provisional listing fields + status).
 *      Guards unchanged: crawl-completeness + catastrophic floor (classifyRun) on the LISTING count.
 *   2. ENRICH each event: fetch the detail page (canonical data/hora + comissaoNomeCompleto/local/
 *      descricao/pauta/convidados/videoUrl) and the AJAX comment fragment (canonical comment count +
 *      the nível-comentário rows). Decisão 👤: re-crawl comments of ALL events every cycle.
 *   3. Emit `out-eventos.sql` (enriched corpus, upsert + history-on-change) and
 *      `out-eventos-comentarios-NNN.sql` batches (nível-comentário, diffed against the stored hashes).
 *
 * Detail/comment fetch failures are best-effort: the event falls back to its listing fields (detail)
 * or the listing comment count (AJAX), and the gap is LOGGED (never silenced). The listing guards
 * still decide whether the corpus is written at all. PRIVACIDADE: comentários guardam só UF (sem nome).
 */

import { writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getText, sleep } from "./http.js";
import { parseEventoListingPage, findLastPageEventos, type EventoListingItem } from "./eventos-listing.js";
import { ECIDADANIA_BASE, buildEventoResumoEnriquecido } from "../../src/scraper/ecidadania.js";
import { contentHash, planEntitySync, type SyncRecord } from "../../src/scraper/pipeline.js";
import { classifyRun, parseAnomalyMinPct } from "../../src/scraper/anomaly.js";
import { readExistingMeta, readLastGoodRows, readComentarioHashes } from "./d1.js";
import { generateLoadSql, generateRunOnlySql, generateComentariosSqlBatches, type ComentarioRecord } from "./sql.js";
import { fetchEventoDetalhe, fetchComentariosAudiencia, toComentarioRecord, planComentariosSync } from "./detalhe.js";

const ENTIDADE = "eventos";
const PAGE_DELAY_MS = Number(process.env.INGEST_EVENTOS_PAGE_DELAY_MS) || Number(process.env.INGEST_PAGE_DELAY_MS) || 400;
const DETAIL_DELAY_MS = Number(process.env.INGEST_EVENTOS_DETAIL_DELAY_MS) || 250;
const MAX_PAGES = 500;
const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(OUT_DIR, "out-eventos.sql");
const COMENT_PREFIX = "out-eventos-comentarios-";

interface CrawlResult {
  items: EventoListingItem[];
  lastPage: number;
  failedPages: number[];
  complete: boolean;
}

async function crawlAllPages(now: Date): Promise<CrawlResult> {
  const byId = new Map<number, EventoListingItem>();
  const failedPages: number[] = [];

  const firstHtml = await getText(`${ECIDADANIA_BASE}/principalaudiencia?p=1`);
  const lastPage = Math.min(findLastPageEventos(firstHtml), MAX_PAGES);
  for (const it of parseEventoListingPage(firstHtml, now)) byId.set(it.id, it);

  for (let p = 2; p <= lastPage; p++) {
    try {
      const html = await getText(`${ECIDADANIA_BASE}/principalaudiencia?p=${p}`);
      const parsed = parseEventoListingPage(html, now);
      if (parsed.length === 0) failedPages.push(p);
      for (const it of parsed) byId.set(it.id, it);
    } catch {
      failedPages.push(p);
    }
    await sleep(PAGE_DELAY_MS);
  }

  return { items: [...byId.values()], lastPage, failedPages, complete: failedPages.length === 0 };
}

/** Remove any out-eventos-comentarios-*.sql from a prior run so a smaller run never re-applies stale files. */
function cleanOldComentarios(): void {
  for (const f of readdirSync(OUT_DIR)) {
    if (f.startsWith(COMENT_PREFIX) && f.endsWith(".sql")) unlinkSync(join(OUT_DIR, f));
  }
}

interface EnrichResult {
  eventoRecords: SyncRecord[];
  comentarioRecords: ComentarioRecord[];
  detailFails: number;
  commentFails: number;
}

/** Fetch detail + AJAX comments for every event; build enriched corpus rows + comment rows. */
async function enrichAll(items: EventoListingItem[]): Promise<EnrichResult> {
  const eventoRecords: SyncRecord[] = [];
  const comentarioRecords: ComentarioRecord[] = [];
  let detailFails = 0;
  let commentFails = 0;

  for (let i = 0; i < items.length; i++) {
    const it = items[i];

    let detalhe = null;
    try {
      detalhe = await fetchEventoDetalhe(it.id);
    } catch (e) {
      detailFails++;
      console.error(`[eventos][detalhe][gap] id=${it.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await sleep(DETAIL_DELAY_MS);

    let comentariosCanon: number | null = null;
    try {
      const cs = await fetchComentariosAudiencia(it.id);
      comentariosCanon = cs.length;
      for (const c of cs) comentarioRecords.push(toComentarioRecord(it.id, c));
    } catch (e) {
      commentFails++;
      console.error(`[eventos][comentarios][gap] id=${it.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await sleep(DETAIL_DELAY_MS);

    const ev = buildEventoResumoEnriquecido({
      id: it.id,
      titulo: it.titulo,
      comissao: it.comissao,
      status: it.status,
      dataListagem: it.data,
      horaListagem: it.hora,
      comentariosListagem: it.comentarios,
      detalhe,
      comentariosCanon,
    });
    const payloadJson = JSON.stringify(ev);
    eventoRecords.push({
      entityId: ev.id,
      sourceUrl: ev.url,
      payloadJson,
      status: ev.status,
      metrica: ev.comentarios,
      comissao: ev.comissao,
      contentHash: contentHash(payloadJson),
    });

    if ((i + 1) % 250 === 0) console.log(`[eventos][enrich] ${i + 1}/${items.length}`);
  }

  return { eventoRecords, comentarioRecords, detailFails, commentFails };
}

async function main(): Promise<void> {
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const force = process.env.INGEST_FORCE === "1" || process.argv.includes("--force");
  const corpusMinPct = parseAnomalyMinPct(process.env.ECIDADANIA_CORPUS_MIN_PCT, 80);

  cleanOldComentarios();

  const crawl = await crawlAllPages(nowDate);
  console.log(`[eventos][crawl] lastPage=${crawl.lastPage} items=${crawl.items.length} failedPages=${crawl.failedPages.length}`);

  if (!crawl.complete) {
    const err = `crawl incompleto: ${crawl.failedPages.length} pagina(s): ${crawl.failedPages.slice(0, 20).join(",")}`;
    console.error(`[eventos][gate] ${err} — corpus NÃO será sobrescrito`);
    writeFileSync(OUT_PATH, generateRunOnlySql(now, "erro", crawl.items.length, err, ENTIDADE));
    process.exit(1);
  }

  // Catastrophic floor on the LISTING count (detail/comment enrichment is best-effort, not a gate).
  const verdict = classifyRun(
    { rowsScraped: crawl.items.length, lastGoodRows: force ? null : readLastGoodRows(ENTIDADE), error: undefined },
    corpusMinPct,
  );
  if (verdict !== "ok") {
    const err = `catastrophic floor: ${crawl.items.length} linhas (< ${corpusMinPct}% do último bom); use --force se legítimo`;
    console.error(`[eventos][gate] verdict=${verdict} — ${err}`);
    writeFileSync(OUT_PATH, generateRunOnlySql(now, verdict, crawl.items.length, err, ENTIDADE));
    process.exit(1);
  }

  const { eventoRecords, comentarioRecords, detailFails, commentFails } = await enrichAll(crawl.items);
  console.log(
    `[eventos][enrich] done: ${eventoRecords.length} eventos, ${comentarioRecords.length} comentários; ` +
      `gaps: detalhe=${detailFails} comentarios=${commentFails}`,
  );

  // Corpus load (rows_scraped = crawled listing count, the floor baseline).
  const existingHashes = new Map(readExistingMeta(ENTIDADE).map((r) => [r.id, r.content_hash]));
  const { annotated, rowsChanged } = planEntitySync(eventoRecords, existingHashes);
  writeFileSync(OUT_PATH, generateLoadSql(annotated, now, crawl.items.length, rowsChanged, ENTIDADE));
  console.log(`[eventos][load] wrote ${OUT_PATH}: ${eventoRecords.length} upserts, ${rowsChanged} changed, 1 ok run row`);

  // Nível-comentário: diff vs stored hashes, emit only changed/new rows (batched).
  const existingComentHashes = readComentarioHashes();
  const { annotated: comentAnnotated, rowsChanged: comentChanged } = planComentariosSync(comentarioRecords, existingComentHashes);
  const comentFiles = generateComentariosSqlBatches(comentAnnotated, now);
  comentFiles.forEach((content, i) => {
    writeFileSync(join(OUT_DIR, `${COMENT_PREFIX}${String(i + 1).padStart(3, "0")}.sql`), content);
  });
  console.log(`[eventos][comentarios] ${comentarioRecords.length} coletados, ${comentChanged} novos/alterados → ${comentFiles.length} arquivo(s)`);
  process.exit(0);
}

main().catch((e) => {
  const err = e instanceof Error ? e.message : String(e);
  console.error(`[eventos][fatal] ${err}`);
  try {
    writeFileSync(OUT_PATH, generateRunOnlySql(new Date().toISOString(), "erro", 0, `fatal: ${err}`, ENTIDADE));
  } catch {
    /* nothing more we can do */
  }
  process.exit(1);
});
