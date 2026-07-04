/**
 * Polite HTTP helpers for the off-Worker ingestion job (§8 step 2/3).
 *
 * This job runs in a GitHub Action against public Senate endpoints, so it must be a courteous
 * client: a per-request timeout, bounded retries with exponential backoff + jitter on transient
 * failures (network errors and 429/5xx), and a caller-controlled delay between requests. It does
 * NOT reuse the Worker's `upstreamFetch` (token bucket, subrequest budget, 5 MB guard) because
 * that is tuned for the request/Cron path inside Workers, not a long unattended crawl.
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 4;
const USER_AGENT = "senado-br-mcp-ingest/1.0 (+https://github.com/SidneyBissoli/senado-br-mcp-cloudflare)";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpError extends Error {
  constructor(message: string, readonly status?: number, readonly retryable = false) {
    super(message);
    this.name = "HttpError";
  }
}

interface GetOpts {
  accept?: string;
  /** Decode the body with this charset (e.g. "windows-1252") instead of the default UTF-8. */
  charset?: string;
  timeoutMs?: number;
  retries?: number;
  /** Send the XHR header the e-Cidadania `ajax*` fragment endpoints expect. */
  xhr?: boolean;
  /** Treat an empty body as a valid (empty) result instead of an error (AJAX fragments of 0 comments). */
  allowEmpty?: boolean;
}

/** Fetch with retry/backoff. Returns the raw Response on the final successful attempt. */
async function fetchWithRetry(url: string, opts: GetOpts): Promise<Response> {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastErr: unknown;

  const headers: Record<string, string> = { Accept: opts.accept ?? "*/*", "User-Agent": USER_AGENT };
  if (opts.xhr) headers["X-Requested-With"] = "XMLHttpRequest";
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(timeoutMs),
      });
      // 429 / 5xx are transient — retry; other non-2xx are fatal.
      if (resp.status === 429 || resp.status >= 500) {
        throw new HttpError(`HTTP ${resp.status} for ${url}`, resp.status, true);
      }
      if (!resp.ok) {
        throw new HttpError(`HTTP ${resp.status} for ${url}`, resp.status, false);
      }
      return resp;
    } catch (e) {
      lastErr = e;
      const retryable = e instanceof HttpError ? e.retryable : true; // network/timeout errors are retryable
      if (!retryable || attempt === retries) break;
      const backoff = Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 400);
      await sleep(backoff);
    }
  }
  throw lastErr instanceof Error ? lastErr : new HttpError(String(lastErr));
}

export async function getText(url: string, opts: GetOpts = {}): Promise<string> {
  const resp = await fetchWithRetry(url, { accept: "text/html", ...opts });
  // resp.text() assumes UTF-8 when the response carries no charset. Some Senate feeds (the
  // Arquimedes CSV) are served as application/octet-stream but encoded in windows-1252, so
  // decode explicitly when the caller knows the charset — otherwise accents get mangled.
  const text = opts.charset
    ? new TextDecoder(opts.charset).decode(await resp.arrayBuffer())
    : await resp.text();
  if (!opts.allowEmpty && !text.trim()) throw new HttpError(`Empty response body for ${url}`);
  return text;
}

export async function getJson<T = unknown>(url: string, opts: GetOpts = {}): Promise<T> {
  const resp = await fetchWithRetry(url, { accept: "application/json", ...opts });
  return (await resp.json()) as T;
}
