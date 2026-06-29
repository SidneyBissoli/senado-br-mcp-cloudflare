/**
 * e-Cidadania CONSULTAS_VOTOS ingestion job — runs OFF-Worker (scheduled GitHub Action).
 *
 * A SEPARATE feature from the live `consultas` corpus: the historical acervo of public-consultation
 * votes, broken down by UF, that only exists as a ~33 MB CSV on the Arquimedes feed (the portal/API
 * expose no equivalent). `STATUS ATUAL` in the CSV is uniformly "Descontinuado", so this is an
 * archival dataset, not a migration of the open consultations.
 *
 * Pipeline: download the CSV → RFC-4180 parse (embedded newlines!) → aggregate one record per matéria
 * summing VOTO SIM/NÃO and keeping votosPorUf → guards → batched out-consultas-votos-NNN.sql.
 *
 * Guards: CSV-sanity (header present + >0 data rows; parseVotosCsv throws on structural breaks) +
 * catastrophic floor (classifyRun vs the last good 'consultas_votos' corpus). A failed guard writes
 * only a run row — never a shrunken corpus. The contentHash is taken over consultaVotoCore (i.e.
 * WITHOUT the CSV vintage stamp) so a weekly stamp bump on frozen votes never churns history.
 */

import { writeFileSync, readdirSync, unlinkSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getText } from "./http.js";
import { parseVotosCsv, aggregateByMateria } from "./csv.js";
import { buildConsultaVotoResumo, consultaVotoCore } from "../../src/scraper/ecidadania.js";
import { contentHash, planEntitySync, type SyncRecord } from "../../src/scraper/pipeline.js";
import { classifyRun, parseAnomalyMinPct } from "../../src/scraper/anomaly.js";
import { ECIDADANIA_ARQUIMEDES_CSV_URL } from "../../src/utils/provenance.js";
import { readExistingMeta, readLastGoodRows } from "./d1.js";
import { generateLoadSqlBatches, generateRunOnlySql } from "./sql.js";

const ENTIDADE = "consultas_votos";
const CSV_URL = process.env.SENADO_ECIDADANIA_CSV_URL || ECIDADANIA_ARQUIMEDES_CSV_URL;
const DOWNLOAD_TIMEOUT_MS = Number(process.env.INGEST_CSV_TIMEOUT_MS) || 180_000;
const BATCH_SIZE = Number(process.env.INGEST_CONSULTAS_VOTOS_BATCH_SIZE) || 10000;
const OUT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_PREFIX = "out-consultas-votos-";

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

function writeRunOnly(now: string, status: string, rows: number, error: string): void {
  writeFileSync(join(OUT_DIR, `${OUT_PREFIX}001.sql`), generateRunOnlySql(now, status, rows, error, ENTIDADE));
}

async function main(): Promise<void> {
  const now = new Date().toISOString();
  const force = process.env.INGEST_FORCE === "1" || process.argv.includes("--force");
  const corpusMinPct = parseAnomalyMinPct(process.env.ECIDADANIA_CORPUS_MIN_PCT, 80);

  cleanOldOutputs();

  console.log(`[consultas_votos][download] GET ${CSV_URL}`);
  // The Arquimedes feed now does content negotiation and rejects the getText() default
  // Accept: text/html with HTTP 406 for the .csv resource — ask for text/csv explicitly.
  // It is served as application/octet-stream but encoded in windows-1252 (Latin-1), so decode
  // it as such; the default UTF-8 decode mangles the accented header (CÓD. MATÉRIA) and the
  // parser then fails to locate the header row.
  const csv = await getText(CSV_URL, {
    accept: "text/csv, */*",
    charset: "windows-1252",
    timeoutMs: DOWNLOAD_TIMEOUT_MS,
  });
  const { referencePeriod, rows } = parseVotosCsv(csv);
  console.log(`[consultas_votos][parse] referencePeriod=${referencePeriod} dataRows=${rows.length}`);

  if (rows.length === 0) {
    const err = "CSV sem linhas de dados (download truncado ou layout mudou)";
    console.error(`[consultas_votos][gate] ${err} — corpus NÃO será sobrescrito`);
    writeRunOnly(now, "erro", 0, err);
    process.exit(1);
  }

  const aggs = aggregateByMateria(rows);
  console.log(`[consultas_votos][aggregate] matérias=${aggs.length} (de ${rows.length} linhas matéria×UF)`);

  const records: SyncRecord[] = aggs.map((a) => {
    const vp = buildConsultaVotoResumo({
      id: a.id,
      materia: a.materia,
      ementa: a.ementa,
      autoria: a.autoria,
      status: a.status,
      votosSim: a.votosSim,
      votosNao: a.votosNao,
      votosPorUf: a.votosPorUf,
      referencePeriod,
    });
    return {
      entityId: vp.id,
      sourceUrl: CSV_URL,
      payloadJson: JSON.stringify(vp),
      status: vp.status,
      metrica: vp.totalVotos,
      comissao: null,
      // Hash the vote-relevant core only (excludes referencePeriod) — see consultaVotoCore.
      contentHash: contentHash(JSON.stringify(consultaVotoCore(vp))),
    };
  });

  const verdict = classifyRun(
    { rowsScraped: records.length, lastGoodRows: force ? null : readLastGoodRows(ENTIDADE), error: undefined },
    corpusMinPct,
  );
  if (verdict !== "ok") {
    const err = `catastrophic floor: ${records.length} matérias (< ${corpusMinPct}% do último bom); use --force se legítimo`;
    console.error(`[consultas_votos][gate] verdict=${verdict} — ${err}`);
    writeRunOnly(now, verdict, records.length, err);
    process.exit(1);
  }

  const existingHashes = new Map(readExistingMeta(ENTIDADE).map((r) => [r.id, r.content_hash]));
  const { annotated, rowsChanged } = planEntitySync(records, existingHashes);
  const files = generateLoadSqlBatches(annotated, now, records.length, rowsChanged, ENTIDADE, BATCH_SIZE);
  writeBatches(files);
  console.log(`[consultas_votos][load] wrote ${files.length} file(s): ${records.length} upserts, ${rowsChanged} changed, 1 ok run row`);
  process.exit(0);
}

main().catch((e) => {
  const err = e instanceof Error ? e.message : String(e);
  console.error(`[consultas_votos][fatal] ${err}`);
  try {
    cleanOldOutputs();
    writeRunOnly(new Date().toISOString(), "erro", 0, `fatal: ${err}`);
  } catch {
    /* nothing more we can do */
  }
  process.exit(1);
});
