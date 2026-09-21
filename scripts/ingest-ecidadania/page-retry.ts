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

/**
 * FIRST CONTACT — page 1 of a listing crawl. Deliberately far more patient than a mid-crawl page.
 *
 * MEASURED on 21/09/2026, when the consultas run died on `pesquisamateria?p=1` with curl (28),
 * "timed out after 30002 ms with 0 bytes received". The portal was simply down for a while: a
 * probe from the SAME box minutes later got HTTP 200 on every endpoint, and a residential IP in
 * Brazil had 200 throughout. Three reasons this page deserves its own budget:
 *
 *   - it is FATAL. If p=1 fails, nothing else in the run can happen and the whole night is lost;
 *     a mid-crawl page only costs its own rows and is recorded as a failed page.
 *   - TIME is the only cure available here. The contract-tests retry cures by landing on a NEW
 *     source address ("waiting does not un-block an address — only a new runner does"), but the
 *     ingest runs on a DEDICATED self-hosted box with a FIXED IP: `gh run rerun` comes back on
 *     the same address. That reasoning does not transfer; waiting is what is left.
 *   - the budget was there and went unused. Total patience was 3 page attempts x ~2.6 min of
 *     getText retries ~= 8 minutes, inside a job allowed 200. It gave up with 96% of its time
 *     unspent.
 *
 * 6 attempts x (up to ~2.6 min of getText retries + 4 min flat pause) rides out roughly half an
 * hour of downtime and still leaves the crawl the bulk of its budget. This costs NOTHING on a
 * healthy day: the pause only ever happens after a failed attempt.
 */
const FIRST_CONTACT_ATTEMPTS = Number(process.env.INGEST_FIRST_CONTACT_ATTEMPTS) || 6;
const FIRST_CONTACT_DELAY_MS = Number(process.env.INGEST_FIRST_CONTACT_DELAY_MS) || 240_000;

/**
 * Retry profile for the fatal page-1 fetch of a listing crawl. Spread into the `fetchParsedPage`
 * options so the caller keeps whatever else it needs (`allowEmpty`, test seams).
 */
export function firstContactOpts(): Pick<FetchParsedPageOpts, "attempts" | "retryDelayMs"> {
  return { attempts: FIRST_CONTACT_ATTEMPTS, retryDelayMs: FIRST_CONTACT_DELAY_MS };
}

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
