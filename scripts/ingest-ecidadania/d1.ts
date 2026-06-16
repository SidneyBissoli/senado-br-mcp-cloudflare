/**
 * D1 reads for the corpus job (§8 step 5), via `wrangler d1 execute --remote --json`.
 *
 * The job must read TWO things from D1 before generating the load SQL:
 *   1. existing (entity_id -> content_hash) for 'consultas' — to diff append-on-change history
 *      (reusing planEntitySync), so unchanged rows are not re-appended.
 *   2. rows_scraped of the last status='ok' corpus run — the baseline for the catastrophic floor.
 *
 * We shell out to wrangler (same auth as the apply step: CLOUDFLARE_API_TOKEN) rather than the D1
 * HTTP API, to keep one tool and one credential across read and write.
 */

import { execSync } from "node:child_process";

const DB_NAME = "senado-ecidadania";

/** Run a read-only query and return the `results` rows. SQL must be static (no untrusted input). */
function queryD1<T = Record<string, unknown>>(sql: string, attempts = 2): T[] {
  // --no-install so npx never tries to fetch wrangler; capture stderr so a failure surfaces the real
  // Cloudflare/wrangler message instead of a bare "Command failed". Retry once for transient API errors.
  const cmd = `npx --no-install wrangler d1 execute ${DB_NAME} --remote --json --command "${sql}"`;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const out = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
      // wrangler --json prints an array of query results; tolerate leading non-JSON log lines.
      const start = out.indexOf("[");
      const parsed = JSON.parse(start >= 0 ? out.slice(start) : out) as Array<{ results?: T[] }>;
      const first = Array.isArray(parsed) ? parsed[0] : undefined;
      return first?.results ?? [];
    } catch (e) {
      lastErr = e;
      const stderr = (e as { stderr?: Buffer | string }).stderr;
      if (stderr) (e as Error).message += `\nwrangler stderr: ${stderr.toString().slice(0, 1000)}`;
    }
  }
  throw lastErr;
}

/** entity_id -> content_hash for all current consultas rows. */
export function readExistingHashes(): Map<number, string> {
  const rows = queryD1<{ entity_id: number; content_hash: string }>(
    "SELECT entity_id, content_hash FROM ecidadania_current WHERE entidade='consultas'",
  );
  return new Map(rows.map((r) => [Number(r.entity_id), String(r.content_hash)]));
}

/** rows_scraped of the most recent status='ok' corpus run, or null if there is no baseline yet. */
export function readLastGoodRows(): number | null {
  const rows = queryD1<{ rows_scraped: number }>(
    "SELECT rows_scraped FROM ecidadania_scrape_runs WHERE entidade='consultas' AND status='ok' ORDER BY id DESC LIMIT 1",
  );
  return rows.length ? Number(rows[0].rows_scraped) : null;
}
