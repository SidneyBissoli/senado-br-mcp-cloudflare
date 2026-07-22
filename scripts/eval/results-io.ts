/**
 * Shared NDJSON result-file helpers for eval:judge and eval:report.
 *
 * The runner appends lines (resume mode can re-run infra-failed combos), so a
 * file may hold more than one line per (perguntaId, modelo, run) — consumers
 * always keep the LAST occurrence per combo via `dedupeLines`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

interface ComboKeyed {
  perguntaId: string;
  modelo: string;
  run: number;
}

/** Parse an NDJSON file, tolerating a torn trailing line from an interrupted run. */
export function loadLines<T>(path: string): T[] {
  const out: T[] = [];
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    try {
      out.push(JSON.parse(raw) as T);
    } catch {
      console.warn(`warning: skipping unparseable NDJSON line in ${path}`);
    }
  }
  return out;
}

/** Keep only the LAST line per (perguntaId, modelo, run), preserving order of last occurrence. */
export function dedupeLines<T extends ComboKeyed>(lines: T[]): T[] {
  const byKey = new Map<string, T>();
  for (const line of lines) {
    byKey.set(`${line.perguntaId}|${line.modelo}|${line.run}`, line);
  }
  return [...byKey.values()];
}

/**
 * Most recent NDJSON in `resultsDir` (by mtime): raw runner output when
 * `judged` is false (excludes `_julgado`), judged output when true.
 */
export function latestNdjson(resultsDir: string, judged: boolean): string | null {
  if (!existsSync(resultsDir)) return null;
  const candidates = readdirSync(resultsDir)
    .filter((f) => f.endsWith(".ndjson") && f.endsWith("_julgado.ndjson") === judged)
    .map((f) => join(resultsDir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] ?? null;
}

/** "…/2026-07-22_9d63822[_julgado].ndjson" -> "2026-07-22_9d63822". */
export function baseNameOf(ndjsonPath: string): string {
  return basename(ndjsonPath).replace(/(_julgado)?\.ndjson$/, "");
}

/** Resolve the input file: explicit `--input <path>` wins, else the latest in resultsDir. */
export function resolveInputPath(argv: string[], resultsDir: string, judged: boolean): string {
  const i = argv.indexOf("--input");
  if (i !== -1) {
    const p = argv[i + 1];
    if (!p || !existsSync(p)) throw new Error(`--input: file not found: ${p ?? "(missing)"}`);
    return p;
  }
  const latest = latestNdjson(resultsDir, judged);
  if (!latest) {
    throw new Error(
      `no ${judged ? "judged (_julgado)" : "runner"} NDJSON found in ${resultsDir} — ` +
        `run ${judged ? "npm run eval:judge" : "npm run eval:dry / npm run eval"} first`,
    );
  }
  return latest;
}
