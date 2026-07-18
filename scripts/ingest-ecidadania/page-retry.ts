/**
 * Per-page fetch+parse with retry — hardening from the 2026-07-18 incident (2 isolated pages out
 * of 1145 killed the ideias run). `getText` already retries TRANSPORT failures (connect errors,
 * 429/5xx) with short backoff; this layer adds a second chance at the PAGE level, with a long flat
 * pause, for the two failure modes the crawl loops see:
 *   - getText exhausting its retries (a portal hiccup a longer wait can outlive), and
 *   - HTTP 200 whose HTML parses to ZERO items (degraded page — previously failed on first sight).
 * It also carries the failure REASON in the thrown error, which the crawl loops used to swallow.
 */

import { getText, sleep } from "./http.js";

const PAGE_ATTEMPTS = 3;
/** Deliberately long and flat: we are waiting out a portal hiccup, not hammering it. */
const PAGE_RETRY_DELAY_MS = Number(process.env.INGEST_PAGE_RETRY_DELAY_MS) || 5000;

export interface ParsedPage<T> {
  html: string;
  items: T[];
}

export interface FetchParsedPageOpts {
  /** Zero parsed items is a valid result (first page of a bucket that may be legitimately empty). */
  allowEmpty?: boolean;
  attempts?: number;
  retryDelayMs?: number;
  /** Test seams. */
  fetchText?: (url: string) => Promise<string>;
  sleepFn?: (ms: number) => Promise<void>;
}

/**
 * Fetch a listing page and parse it, retrying when the fetch throws or the parse yields zero
 * items (unless `allowEmpty`). After the last attempt, throws with the last failure reason.
 */
export async function fetchParsedPage<T>(
  url: string,
  parse: (html: string) => T[],
  opts: FetchParsedPageOpts = {},
): Promise<ParsedPage<T>> {
  const attempts = opts.attempts ?? PAGE_ATTEMPTS;
  const retryDelayMs = opts.retryDelayMs ?? PAGE_RETRY_DELAY_MS;
  const fetchText = opts.fetchText ?? getText;
  const sleepFn = opts.sleepFn ?? sleep;

  let lastReason = "sem tentativas";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const html = await fetchText(url);
      const items = parse(html);
      if (items.length > 0 || opts.allowEmpty) return { html, items };
      lastReason = `HTML degradado: 0 itens parseados (len=${html.length})`;
    } catch (e) {
      lastReason = e instanceof Error ? e.message : String(e);
    }
    if (attempt < attempts) await sleepFn(retryDelayMs);
  }
  throw new Error(`${lastReason} — após ${attempts} tentativa(s)`);
}

/** One line per failed page, at failure time, so the run log says WHY (the gate only says WHICH). */
export function logPageFailure(entidade: string, pageLabel: string, e: unknown): void {
  const reason = e instanceof Error ? e.message : String(e);
  console.error(`[${entidade}][page] ${pageLabel} falhou: ${reason}`);
}
