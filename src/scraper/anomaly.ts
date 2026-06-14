/**
 * Scrape-run anomaly classification (P2).
 *
 * A Cron scrape run must never overwrite the good `ecidadania_current` rows with a bad batch
 * (e.g. the portal returned an error page, or a markup change made the parser yield far fewer
 * rows than usual). The Cron pipeline (step 3) calls classifyRun() and, on anything other than
 * "ok", logs to ecidadania_scrape_runs and preserves the last good state instead of upserting.
 */

export type RunStatus = "ok" | "anomalo" | "erro";

export interface RunStats {
  /** Rows the scrape produced this run. */
  rowsScraped: number;
  /** rows_scraped of the most recent "ok" run for this entity, or null if none yet. */
  lastGoodRows: number | null;
  /** Truthy if the scrape threw. */
  error?: unknown;
}

/**
 * Classify a run:
 *   - "erro"    — the scrape threw.
 *   - "anomalo" — zero rows, or fewer than `minPct`% of the last good run's rows.
 *   - "ok"      — otherwise.
 *
 * The "< minPct% of last good" guard only applies once there is a baseline (lastGoodRows > 0),
 * so the very first run (or after a reset) is accepted as long as it returned > 0 rows.
 */
export function classifyRun(stats: RunStats, minPct = 50): RunStatus {
  if (stats.error) return "erro";
  if (stats.rowsScraped <= 0) return "anomalo";
  if (stats.lastGoodRows && stats.lastGoodRows > 0) {
    const ratio = (stats.rowsScraped / stats.lastGoodRows) * 100;
    if (ratio < minPct) return "anomalo";
  }
  return "ok";
}

/** Parse ECIDADANIA_ANOMALY_MIN_PCT (string env var) into a 0–100 number; fallback 50. */
export function parseAnomalyMinPct(raw: string | undefined, fallback = 50): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : fallback;
}
