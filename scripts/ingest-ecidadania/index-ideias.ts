/**
 * e-Cidadania IDEIAS full-corpus ingestion job — runs OFF-Worker (scheduled GitHub Action).
 *
 * Mirrors the eventos job (`index-eventos.ts`) for `entidade='ideias'`, with two differences:
 *   - the listing carries NO status, so the crawl runs ONCE PER `situacao` value (GET filter) and
 *     tags every item with the status that bucket maps to (SITUACAO_STATUS in ideias-listing.ts);
 *   - ideias is huge (~150k items → ~300k SQL statements), so the load is emitted as MULTIPLE
 *     out-ideias-NNN.sql files (generateLoadSqlBatches) applied in lexical order, instead of one.
 *
 * Guards kept identical to the other corpora: crawl-completeness (every page of every situacao
 * parses with zero unrecovered failures) + catastrophic floor (classifyRun at
 * ECIDADANIA_CORPUS_MIN_PCT vs the last good 'ideias' corpus). On a failed guard only a run row is
 * written (single out-ideias-001.sql) — the corpus is never shrunk.
 */

import { writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getText, sleep } from "./http.js";
import {
  parseIdeiaListingPage,
  findLastPageIdeias,
  SITUACAO_STATUS,
  type IdeiaListingItem,
} from "./ideias-listing.js";
import { ECIDADANIA_BASE, buildIdeiaResumo } from "../../src/scraper/ecidadania.js";
import { contentHash, planEntitySync, type SyncRecord } from "../../src/scraper/pipeline.js";
import { classifyRun, parseAnomalyMinPct } from "../../src/scraper/anomaly.js";
import { readExistingMeta, readLastGoodRows } from "./d1.js";
import { generateLoadSqlBatches, generateRunOnlySql } from "./sql.js";

const ENTIDADE = "ideias";
const PAGE_DELAY_MS = Number(process.env.INGEST_IDEIAS_PAGE_DELAY_MS) || Number(process.env.INGEST_PAGE_DELAY_MS) || 400;
const MAX_PAGES_PER_SITUACAO = 5000;
const BATCH_SIZE = Number(process.env.INGEST_IDEIAS_BATCH_SIZE) || 10000;
const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_PREFIX = "out-ideias-";

type IdeiaCrawlItem = IdeiaListingItem & { status: string };

interface CrawlResult {
  items: IdeiaCrawlItem[];
  totalPages: number;
  failedPages: string[];
  complete: boolean;
}

/** Crawl every situacao bucket's pages, tagging status; dedupe by id (first bucket wins). */
async function crawlAllSituacoes(): Promise<CrawlResult> {
  const byId = new Map<number, IdeiaCrawlItem>();
  const failedPages: string[] = [];
  let totalPages = 0;

  // Numeric order so dedup (first-seen wins) is deterministic across runs.
  const situacoes = Object.keys(SITUACAO_STATUS).map(Number).sort((a, b) => a - b);
  for (const situacao of situacoes) {
    const status = SITUACAO_STATUS[situacao];
    const base = `${ECIDADANIA_BASE}/pesquisaideia?situacao=${situacao}`;

    let firstHtml: string;
    try {
      firstHtml = await getText(`${base}&p=1`);
    } catch {
      failedPages.push(`s${situacao}:p1`);
      continue;
    }
    totalPages++;
    const lastPage = Math.min(findLastPageIdeias(firstHtml), MAX_PAGES_PER_SITUACAO);
    for (const it of parseIdeiaListingPage(firstHtml)) {
      if (!byId.has(it.id)) byId.set(it.id, { ...it, status });
    }

    for (let p = 2; p <= lastPage; p++) {
      try {
        const html = await getText(`${base}&p=${p}`);
        const parsed = parseIdeiaListingPage(html);
        if (parsed.length === 0) failedPages.push(`s${situacao}:p${p}`); // empty interior page = degraded
        for (const it of parsed) if (!byId.has(it.id)) byId.set(it.id, { ...it, status });
      } catch {
        failedPages.push(`s${situacao}:p${p}`);
      }
      totalPages++;
      await sleep(PAGE_DELAY_MS);
    }
  }

  return { items: [...byId.values()], totalPages, failedPages, complete: failedPages.length === 0 };
}

/** Remove any out-ideias-*.sql from a prior run so a smaller run never re-applies stale files. */
function cleanOldOutputs(): void {
  for (const f of readdirSync(OUT_DIR)) {
    if (f.startsWith(OUT_PREFIX) && f.endsWith(".sql")) unlinkSync(join(OUT_DIR, f));
  }
}

function writeBatches(files: string[]): void {
  files.forEach((content, i) => {
    writeFileSync(join(OUT_DIR, `${OUT_PREFIX}${String(i + 1).padStart(3, "0")}.sql`), content);
  });
}

/** Single run-only file (no-write outcome); reuses the 001 slot the apply loop will pick up. */
function writeRunOnly(now: string, status: string, rows: number, error: string): void {
  writeFileSync(join(OUT_DIR, `${OUT_PREFIX}001.sql`), generateRunOnlySql(now, status, rows, error, ENTIDADE));
}

async function main(): Promise<void> {
  const now = new Date().toISOString();
  const force = process.env.INGEST_FORCE === "1" || process.argv.includes("--force");
  const corpusMinPct = parseAnomalyMinPct(process.env.ECIDADANIA_CORPUS_MIN_PCT, 80);

  cleanOldOutputs();

  const crawl = await crawlAllSituacoes();
  console.log(`[ideias][crawl] totalPages=${crawl.totalPages} items=${crawl.items.length} failedPages=${crawl.failedPages.length}`);

  if (!crawl.complete) {
    const err = `crawl incompleto: ${crawl.failedPages.length} pagina(s): ${crawl.failedPages.slice(0, 20).join(",")}`;
    console.error(`[ideias][gate] ${err} — corpus NÃO será sobrescrito`);
    writeRunOnly(now, "erro", crawl.items.length, err);
    process.exit(1);
  }

  const records: SyncRecord[] = crawl.items.map((it) => {
    const ideia = buildIdeiaResumo({ id: it.id, titulo: it.titulo, apoios: it.apoios, status: it.status });
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
  });

  const byStatus = records.reduce<Record<string, number>>((acc, r) => {
    acc[r.status ?? "?"] = (acc[r.status ?? "?"] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`[ideias][normalize] total=${records.length} ${JSON.stringify(byStatus)}`);

  const verdict = classifyRun(
    { rowsScraped: records.length, lastGoodRows: force ? null : readLastGoodRows(ENTIDADE), error: undefined },
    corpusMinPct,
  );
  if (verdict !== "ok") {
    const err = `catastrophic floor: ${records.length} linhas (< ${corpusMinPct}% do último bom); use --force se legítimo`;
    console.error(`[ideias][gate] verdict=${verdict} — ${err}`);
    writeRunOnly(now, verdict, records.length, err);
    process.exit(1);
  }

  const existingHashes = new Map(readExistingMeta(ENTIDADE).map((r) => [r.id, r.content_hash]));
  const { annotated, rowsChanged } = planEntitySync(records, existingHashes);
  const files = generateLoadSqlBatches(annotated, now, records.length, rowsChanged, ENTIDADE, BATCH_SIZE);
  writeBatches(files);
  console.log(`[ideias][load] wrote ${files.length} file(s): ${records.length} upserts, ${rowsChanged} changed, 1 ok run row`);
  process.exit(0);
}

main().catch((e) => {
  const err = e instanceof Error ? e.message : String(e);
  console.error(`[ideias][fatal] ${err}`);
  try {
    cleanOldOutputs();
    writeRunOnly(new Date().toISOString(), "erro", 0, `fatal: ${err}`);
  } catch {
    /* nothing more we can do */
  }
  process.exit(1);
});
