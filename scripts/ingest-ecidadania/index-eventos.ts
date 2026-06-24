/**
 * e-Cidadania EVENTOS full-corpus ingestion job — runs OFF-Worker (scheduled GitHub Action).
 *
 * Mirrors the consultas job (`index.ts`) but for `entidade='eventos'`, with two differences:
 *   - source is the `principalaudiencia?p=N` HTML listing (parseEventoListingPage);
 *   - status comes straight from the listing block (no `/processo` bridge), so there is no
 *     status-universe gate and no linger re-status (events never leave the listing; they just
 *     flip agendado→encerrado, which the next crawl picks up).
 *
 * Guards kept identical: crawl-completeness (every page 1..lastPage parses) + catastrophic floor
 * (classifyRun at ECIDADANIA_CORPUS_MIN_PCT vs the last good 'eventos' corpus). Emits out-eventos.sql.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getText, sleep } from "./http.js";
import { parseEventoListingPage, findLastPageEventos, type EventoListingItem } from "./eventos-listing.js";
import { ECIDADANIA_BASE, buildEventoResumo } from "../../src/scraper/ecidadania.js";
import { contentHash, planEntitySync, type SyncRecord } from "../../src/scraper/pipeline.js";
import { classifyRun, parseAnomalyMinPct } from "../../src/scraper/anomaly.js";
import { readExistingMeta, readLastGoodRows } from "./d1.js";
import { generateLoadSql, generateRunOnlySql } from "./sql.js";

const ENTIDADE = "eventos";
const PAGE_DELAY_MS = Number(process.env.INGEST_EVENTOS_PAGE_DELAY_MS) || Number(process.env.INGEST_PAGE_DELAY_MS) || 400;
const MAX_PAGES = 500;
const OUT_PATH = join(dirname(fileURLToPath(import.meta.url)), "out-eventos.sql");

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

async function main(): Promise<void> {
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const force = process.env.INGEST_FORCE === "1" || process.argv.includes("--force");
  const corpusMinPct = parseAnomalyMinPct(process.env.ECIDADANIA_CORPUS_MIN_PCT, 80);

  const crawl = await crawlAllPages(nowDate);
  console.log(`[eventos][crawl] lastPage=${crawl.lastPage} items=${crawl.items.length} failedPages=${crawl.failedPages.length}`);

  if (!crawl.complete) {
    const err = `crawl incompleto: ${crawl.failedPages.length} pagina(s): ${crawl.failedPages.slice(0, 20).join(",")}`;
    console.error(`[eventos][gate] ${err} — corpus NÃO será sobrescrito`);
    writeFileSync(OUT_PATH, generateRunOnlySql(now, "erro", crawl.items.length, err, ENTIDADE));
    process.exit(1);
  }

  const records: SyncRecord[] = crawl.items.map((it) => {
    const ev = buildEventoResumo(it);
    const payloadJson = JSON.stringify(ev);
    return {
      entityId: ev.id,
      sourceUrl: ev.url,
      payloadJson,
      status: ev.status,
      metrica: ev.comentarios,
      comissao: ev.comissao,
      contentHash: contentHash(payloadJson),
    };
  });

  const verdict = classifyRun(
    { rowsScraped: records.length, lastGoodRows: force ? null : readLastGoodRows(ENTIDADE), error: undefined },
    corpusMinPct,
  );
  if (verdict !== "ok") {
    const err = `catastrophic floor: ${records.length} linhas (< ${corpusMinPct}% do último bom); use --force se legítimo`;
    console.error(`[eventos][gate] verdict=${verdict} — ${err}`);
    writeFileSync(OUT_PATH, generateRunOnlySql(now, verdict, records.length, err, ENTIDADE));
    process.exit(1);
  }

  const existingHashes = new Map(readExistingMeta(ENTIDADE).map((r) => [r.id, r.content_hash]));
  const { annotated, rowsChanged } = planEntitySync(records, existingHashes);
  writeFileSync(OUT_PATH, generateLoadSql(annotated, now, records.length, rowsChanged, ENTIDADE));
  console.log(`[eventos][load] wrote ${OUT_PATH}: ${records.length} upserts, ${rowsChanged} changed, 1 ok run row`);
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
