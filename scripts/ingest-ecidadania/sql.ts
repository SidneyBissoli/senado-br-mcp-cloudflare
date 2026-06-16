/**
 * SQL generation for the off-Worker corpus load (§8 step 5).
 *
 * Emits a single .sql file applied with `wrangler d1 execute senado-ecidadania --remote --file=…`.
 * The statements MIRROR `SQL.upsert` / `SQL.history` / the scrape-runs insert in
 * `src/scraper/pipeline.ts` (same columns, same conflict target) so the off-Worker writer and the
 * in-Worker Cron stay byte-compatible. We reuse the `SyncRecord` shape and `contentHash` from the
 * pipeline rather than re-deriving them, keeping the content hash identical across both writers.
 */

import type { SyncRecord } from "../../src/scraper/pipeline.js";

const ENTIDADE = "consultas";

/** Render a JS value as a SQLite literal. Strings are single-quoted with '' escaping. */
export function sqlValue(v: string | number | null): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  return `'${v.replace(/'/g, "''")}'`;
}

function upsertStmt(rec: SyncRecord, now: string): string {
  const cols = [ENTIDADE, rec.entityId, now, rec.contentHash, rec.sourceUrl, rec.payloadJson, rec.status, rec.metrica, rec.comissao];
  return (
    "INSERT INTO ecidadania_current (entidade, entity_id, scraped_at, content_hash, source_url, payload_json, status, metrica_principal, comissao) VALUES (" +
    cols.map(sqlValue).join(", ") +
    ") ON CONFLICT(entidade, entity_id) DO UPDATE SET " +
    "scraped_at=excluded.scraped_at, content_hash=excluded.content_hash, source_url=excluded.source_url, " +
    "payload_json=excluded.payload_json, status=excluded.status, metrica_principal=excluded.metrica_principal, comissao=excluded.comissao;"
  );
}

function historyStmt(rec: SyncRecord, now: string): string {
  const cols = [ENTIDADE, rec.entityId, now, rec.contentHash, rec.payloadJson];
  return (
    "INSERT OR IGNORE INTO ecidadania_history (entidade, entity_id, scraped_at, content_hash, payload_json) VALUES (" +
    cols.map(sqlValue).join(", ") +
    ");"
  );
}

/** A scrape-runs row (mirrors SQL.run). Used for both write and no-write outcomes. */
export function runRowStmt(now: string, status: string, rowsScraped: number, rowsChanged: number, error: string | null): string {
  const cols = [now, ENTIDADE, status, rowsScraped, rowsChanged, error];
  return (
    "INSERT INTO ecidadania_scrape_runs (run_at, entidade, status, rows_scraped, rows_changed, error) VALUES (" +
    cols.map(sqlValue).join(", ") +
    ");"
  );
}

/**
 * Full load script for a healthy ('ok') run: all upserts, append-on-change history for changed rows,
 * and the run row last. No explicit BEGIN/COMMIT — D1 rejects SQL transaction control, and
 * `wrangler d1 execute --file` already runs the whole file atomically server-side (on failure the DB
 * returns to its original state), so this is all-or-nothing without it. The run row is last so it is
 * only recorded if every upsert/history statement applied. Upserts are idempotent (ON CONFLICT DO
 * UPDATE), so a retry after a failed apply is safe.
 *
 * `rowsScraped` is the CRAWLED count (the open-set size that the catastrophic floor compares against),
 * passed explicitly because `annotated` also includes re-statused rows (§2) that were not crawled and
 * must not inflate the run's rows_scraped baseline.
 */
export function generateLoadSql(
  annotated: Array<{ rec: SyncRecord; changed: boolean }>,
  now: string,
  rowsScraped: number,
  rowsChanged: number,
): string {
  const lines: string[] = [];
  for (const { rec, changed } of annotated) {
    lines.push(upsertStmt(rec, now));
    if (changed) lines.push(historyStmt(rec, now));
  }
  lines.push(runRowStmt(now, "ok", rowsScraped, rowsChanged, null));
  return lines.join("\n") + "\n";
}

/** No-write script: only the run row, recording why the corpus was NOT overwritten. */
export function generateRunOnlySql(now: string, status: string, rowsScraped: number, error: string | null): string {
  return runRowStmt(now, status, rowsScraped, 0, error) + "\n";
}
