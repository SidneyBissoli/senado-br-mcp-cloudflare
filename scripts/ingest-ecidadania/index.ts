/**
 * e-Cidadania full-corpus ingestion job (§8 step 5) — runs OFF-Worker (scheduled GitHub Action).
 *
 * Pipeline:
 *   1. Crawl pesquisamateria?p=1..N (HTML listing — the only full-coverage source). Track
 *      crawl-completeness: every page 1..lastPage must parse with ZERO unrecovered failures.
 *   2. Derive status from /processo (tramitando=S) — aberta ⟺ matter in tramitação (§4); not scraped.
 *   3. Normalize each consultation to the canonical ConsultaResumo (shared buildConsultaResumo) and
 *      hash it with the shared contentHash, so the off-Worker writer and the in-Worker Cron agree.
 *   4. Decide whether to write (two guards):
 *        - PRIMARY: crawl-completeness. An incomplete crawl (or an incomplete /processo status
 *          universe) writes ONLY an 'erro' run row — never a shrunken corpus.
 *        - CATASTROPHIC FLOOR: even a complete crawl is rejected (classifyRun at ECIDADANIA_CORPUS_MIN_PCT,
 *          default 80%) if it returns far fewer rows than the last good corpus — guards against a
 *          degraded page fooling findLastPage. Override a genuine large shrink with --force / INGEST_FORCE=1.
 *   5. Emit out.sql (upsert + append-on-change history + run row, mirroring SQL.upsert/SQL.history),
 *      applied by the Action via `wrangler d1 execute senado-ecidadania --remote --file=out.sql`.
 *
 * Exit code: 0 when the run is 'ok', 1 otherwise (the Action still applies out.sql via if: always(),
 * so the 'erro'/'anomalo' run row is recorded even though the job is marked failed for visibility).
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getText, sleep } from "./http.js";
import { parseConsultaListingPage, findLastPage, type ListingItem } from "./listing.js";
import { buildTramitandoSet, deriveStatus } from "./status.js";
import { ECIDADANIA_BASE, buildConsultaResumo, type ConsultaResumo } from "../../src/scraper/ecidadania.js";
import { contentHash, planEntitySync, type SyncRecord } from "../../src/scraper/pipeline.js";
import { classifyRun, parseAnomalyMinPct } from "../../src/scraper/anomaly.js";
import { readExistingMeta, readPayloads, readAllPayloads, readLastGoodRows } from "./d1.js";
import { selectRestatus, buildRestatusRecords } from "./restatus.js";
import { generateLoadSql, generateRunOnlySql } from "./sql.js";
import { fetchConsultaDetalheCorpus } from "./detalhe.js";

const SENADO_BASE_URL = process.env.SENADO_BASE_URL || "https://legis.senado.leg.br/dadosabertos";
const PAGE_DELAY_MS = Number(process.env.INGEST_PAGE_DELAY_MS) || 400;
const DETAIL_DELAY_MS = Number(process.env.INGEST_CONSULTAS_DETAIL_DELAY_MS) || 250;
const MAX_PAGES = 1000; // safety cap against a runaway pagination value
const OUT_PATH = join(dirname(fileURLToPath(import.meta.url)), "out.sql");

/**
 * Enrich crawled consultas with detail-only `autoria`/`relator` (agentes públicos — name kept).
 * These are IMMUTABLE, so we only fetch the detail page for rows NOT yet enriched (a stored payload
 * that already carries the `autoria` key is preserved); after the first backfill only new consultas
 * are fetched. Detail fetch failures fall back to preserved/null and are logged (never silenced).
 */
async function enrichConsulta(
  it: ListingItem,
  status: string,
  existing: Map<number, string>,
): Promise<ConsultaResumo> {
  const id = it.codigoMateria;
  const prev = existing.get(id);
  let autoria: string | null = null;
  let relator: string | null = null;
  let enriched = false;
  if (prev) {
    const p = JSON.parse(prev) as Partial<ConsultaResumo>;
    if ("autoria" in p) {
      autoria = p.autoria ?? null;
      relator = p.relator ?? null;
      enriched = true;
    }
  }
  if (!enriched) {
    try {
      const d = await fetchConsultaDetalheCorpus(id);
      autoria = d.autoria;
      relator = d.relator;
    } catch (e) {
      console.error(`[consultas][detalhe][gap] id=${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await sleep(DETAIL_DELAY_MS);
  }
  return buildConsultaResumo({
    id,
    materia: it.identificacao ?? undefined,
    ementa: it.ementa ?? undefined,
    votosSim: it.votosSim,
    votosNao: it.votosNao,
    autoria,
    relator,
    status,
  });
}

interface CrawlResult {
  items: ListingItem[];
  lastPage: number;
  failedPages: number[];
  complete: boolean;
}

/** Crawl every listing page, deduping by codigoMateria; complete ⟺ no page failed. */
async function crawlAllPages(): Promise<CrawlResult> {
  const byId = new Map<number, ListingItem>();
  const failedPages: number[] = [];

  const firstHtml = await getText(`${ECIDADANIA_BASE}/pesquisamateria?p=1`);
  let lastPage = Math.min(findLastPage(firstHtml), MAX_PAGES);
  for (const it of parseConsultaListingPage(firstHtml)) byId.set(it.codigoMateria, it);

  for (let p = 2; p <= lastPage; p++) {
    try {
      const html = await getText(`${ECIDADANIA_BASE}/pesquisamateria?p=${p}`);
      const parsed = parseConsultaListingPage(html);
      if (parsed.length === 0) failedPages.push(p); // an empty interior page is a degraded page
      for (const it of parsed) byId.set(it.codigoMateria, it);
    } catch {
      failedPages.push(p);
    }
    await sleep(PAGE_DELAY_MS);
  }

  return { items: [...byId.values()], lastPage, failedPages, complete: failedPages.length === 0 };
}

/** Distinct siglas present in the corpus (leading token of "PL 5064/2023"). */
function siglasFrom(items: ListingItem[]): string[] {
  const set = new Set<string>();
  for (const it of items) {
    const m = it.identificacao?.match(/^([A-Za-zÀ-ÿ]+)/);
    if (m) set.add(m[1].toUpperCase());
  }
  return [...set];
}

async function main(): Promise<void> {
  const now = new Date().toISOString();
  const force = process.env.INGEST_FORCE === "1" || process.argv.includes("--force");
  const corpusMinPct = parseAnomalyMinPct(process.env.ECIDADANIA_CORPUS_MIN_PCT, 80);

  // 1. Crawl.
  const crawl = await crawlAllPages();
  console.log(`[crawl] lastPage=${crawl.lastPage} items=${crawl.items.length} failedPages=${crawl.failedPages.length}`);

  if (!crawl.complete) {
    const err = `crawl incompleto: ${crawl.failedPages.length} pagina(s) falharam: ${crawl.failedPages.slice(0, 20).join(",")}`;
    console.error(`[gate] ${err} — corpus NÃO será sobrescrito`);
    writeFileSync(OUT_PATH, generateRunOnlySql(now, "erro", crawl.items.length, err));
    process.exit(1);
  }

  // 2. Status from /processo (tramitando=S). An incomplete status universe is a failed run.
  const siglas = siglasFrom(crawl.items);
  let tramitando: Set<number>;
  try {
    tramitando = await buildTramitandoSet(SENADO_BASE_URL, siglas);
  } catch (e) {
    const err = `status universe incompleto: ${e instanceof Error ? e.message : String(e)}`;
    console.error(`[gate] ${err} — corpus NÃO será sobrescrito`);
    writeFileSync(OUT_PATH, generateRunOnlySql(now, "erro", crawl.items.length, err));
    process.exit(1);
  }

  // 3. Normalize + hash (canonical ConsultaResumo via shared builder; metrica_principal = totalVotos).
  //    v2: enrich with detail-only autoria/relator, preserving already-enriched rows (immutable).
  const existingPayloads = readAllPayloads("consultas");
  const records: SyncRecord[] = [];
  let consultasEnriched = 0;
  for (const it of crawl.items) {
    const prev = existingPayloads.get(it.codigoMateria);
    if (!prev || !prev.includes('"autoria"')) consultasEnriched++;
    const cr = await enrichConsulta(it, deriveStatus(tramitando, it.codigoMateria), existingPayloads);
    const payloadJson = JSON.stringify(cr);
    records.push({
      entityId: cr.id,
      sourceUrl: cr.url,
      payloadJson,
      status: cr.status,
      metrica: cr.totalVotos,
      comissao: null,
      contentHash: contentHash(payloadJson),
    });
  }
  console.log(`[consultas][enrich] detalhe buscado p/ ${consultasEnriched} consulta(s) não enriquecida(s)`);

  const abertas = records.filter((r) => r.status === "aberta").length;
  const encerradas = records.length - abertas;
  const has164804 = records.some((r) => r.entityId === 164804);
  console.log(`[normalize] total=${records.length} abertas=${abertas} encerradas=${encerradas} tramitando=${tramitando.size} id164804=${has164804}`);

  // 4. Catastrophic floor (after the completeness gate). force → only the rows>0 check applies.
  const lastGoodRows = readLastGoodRows();
  const verdict = classifyRun(
    { rowsScraped: records.length, lastGoodRows: force ? null : lastGoodRows, error: undefined },
    corpusMinPct,
  );
  if (verdict !== "ok") {
    const err = `catastrophic floor: ${records.length} linhas vs último bom ${lastGoodRows} (< ${corpusMinPct}%); use --force se a redução for legítima`;
    console.error(`[gate] verdict=${verdict} — ${err} — corpus NÃO será sobrescrito`);
    writeFileSync(OUT_PATH, generateRunOnlySql(now, verdict, records.length, err));
    process.exit(1);
  }

  // 5. Linger re-status (§2): for stored rows NOT in this crawl, flip status by /processo membership
  // (a matter that left tramitação → encerrada; never flip on mere listing-absence). The crawled rows
  // were already restated above (their status came from deriveStatus). Only runs on a complete crawl,
  // which is guaranteed here (the completeness gate already passed).
  const existingMeta = readExistingMeta();
  const crawledIds = new Set(records.map((r) => r.entityId));
  const flips = selectRestatus(existingMeta, crawledIds, tramitando);
  const restatusRecords = buildRestatusRecords(flips, readPayloads(flips.map((f) => f.id)));
  const flippedEncerrada = restatusRecords.filter((r) => r.status === "encerrada").length;
  console.log(`[restatus] ${restatusRecords.length} linhas re-statusadas (${flippedEncerrada} → encerrada)`);

  // 6. Diff history vs existing hashes (reuse planEntitySync) and emit the load SQL. The run row's
  // rows_scraped stays the CRAWLED count (the floor baseline); re-statused rows are extra upserts.
  const existingHashes = new Map(existingMeta.map((r) => [r.id, r.content_hash]));
  const allRecords = [...records, ...restatusRecords];
  const { annotated, rowsChanged } = planEntitySync(allRecords, existingHashes);
  writeFileSync(OUT_PATH, generateLoadSql(annotated, now, records.length, rowsChanged));
  console.log(`[load] wrote ${OUT_PATH}: ${allRecords.length} upserts (${records.length} crawled + ${restatusRecords.length} re-status), ${rowsChanged} changed (history), 1 ok run row`);
  process.exit(0);
}

main().catch((e) => {
  // Last-resort guard: record the failure so the Action's apply step can persist a run row.
  const err = e instanceof Error ? e.message : String(e);
  console.error(`[fatal] ${err}`);
  try {
    writeFileSync(OUT_PATH, generateRunOnlySql(new Date().toISOString(), "erro", 0, `fatal: ${err}`));
  } catch {
    /* nothing more we can do */
  }
  process.exit(1);
});
