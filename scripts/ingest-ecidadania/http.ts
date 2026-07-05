/**
 * Polite HTTP helpers for the off-Worker ingestion job (§8 step 2/3).
 *
 * IMPLEMENTAÇÃO VIA `curl` (não Node/undici): a partir de 04/07/2026 o e-Cidadania passou a RECUSAR
 * as conexões do cliente HTTP do Node (undici) — todo fetch falha com `UND_ERR_CONNECT_TIMEOUT`,
 * enquanto o `curl`, do MESMO runner/IP, conecta e recebe 200 (provado pelo workflow de probe). É o
 * "aperto de mão" TLS do Node sendo barrado por um middlebox/WAF na frente do portal; forçar IPv4 não
 * resolveu. Como o curl passa, a ingestão faz o fetch via `curl` (child_process). Mantém a MESMA
 * interface pública (`getText`/`getJson`/`sleep`/`HttpError`) para não tocar nos chamadores.
 *
 * Continua sendo um cliente cortês: timeout por request, retries com backoff+jitter em falhas
 * transientes (erro de conexão do curl e HTTP 429/5xx), e delay controlado pelo chamador entre requests.
 */

import { execFile } from "node:child_process";
import { readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

/** Monotonic-ish counter for unique temp file names (scripts may use process state freely). */
let tmpCounter = 0;

/**
 * One curl request. Writes the body to a temp file (`-o`) and prints the HTTP status (`-w`) to stdout,
 * so a binary/large body (the 33 MB Arquimedes CSV) never goes through the stdout buffer. Returns the
 * status + body Buffer. A curl NON-ZERO exit (connect/TLS/timeout — no HTTP response) throws a
 * retryable HttpError; an HTTP response is classified by the caller.
 */
async function curlOnce(url: string, opts: GetOpts): Promise<{ code: number; body: Buffer }> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const tmp = join(tmpdir(), `ingest-${process.pid}-${tmpCounter++}.tmp`);
  const args = [
    "-sS",
    "--max-time", String(Math.ceil(timeoutMs / 1000)),
    "-A", USER_AGENT,
    "-H", `Accept: ${opts.accept ?? "*/*"}`,
    ...(opts.xhr ? ["-H", "X-Requested-With: XMLHttpRequest"] : []),
    "-o", tmp,
    "-w", "%{http_code}",
    url,
  ];
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        "curl",
        args,
        { encoding: "utf8", timeout: timeoutMs + 5000, maxBuffer: 1024 * 1024 },
        (err, out, stderr) => {
          if (err) {
            // curl exited non-zero (connect refused/reset, TLS, timeout, DNS…) — no HTTP response.
            reject(new HttpError(`curl failed for ${url}: ${String(stderr || err.message).slice(0, 300)}`, undefined, true));
          } else {
            resolve(out);
          }
        },
      );
    });
    const code = parseInt(stdout.trim(), 10) || 0;
    const body = await readFile(tmp);
    return { code, body };
  } finally {
    try {
      await unlink(tmp);
    } catch {
      /* temp file may not exist if curl failed before writing — ignore */
    }
  }
}

/** curl with retry/backoff. Returns the body Buffer on the final successful attempt. */
async function fetchWithRetry(url: string, opts: GetOpts): Promise<Buffer> {
  const retries = opts.retries ?? DEFAULT_RETRIES;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const { code, body } = await curlOnce(url, opts);
      // 429 / 5xx are transient — retry; other non-2xx/3xx are fatal.
      if (code === 429 || code >= 500) {
        throw new HttpError(`HTTP ${code} for ${url}`, code, true);
      }
      if (code < 200 || code >= 400) {
        throw new HttpError(`HTTP ${code} for ${url}`, code, false);
      }
      return body;
    } catch (e) {
      lastErr = e;
      const retryable = e instanceof HttpError ? e.retryable : true; // unknown errors are retryable
      if (!retryable || attempt === retries) break;
      const backoff = Math.min(8000, 500 * 2 ** attempt) + Math.floor(Math.random() * 400);
      await sleep(backoff);
    }
  }
  throw lastErr instanceof Error ? lastErr : new HttpError(String(lastErr));
}

export async function getText(url: string, opts: GetOpts = {}): Promise<string> {
  const body = await fetchWithRetry(url, { accept: "text/html", ...opts });
  // Some Senate feeds (the Arquimedes CSV) are served as application/octet-stream but encoded in
  // windows-1252; decode explicitly when the caller knows the charset — otherwise accents get mangled.
  const text = opts.charset ? new TextDecoder(opts.charset).decode(body) : body.toString("utf8");
  if (!opts.allowEmpty && !text.trim()) throw new HttpError(`Empty response body for ${url}`);
  return text;
}

export async function getJson<T = unknown>(url: string, opts: GetOpts = {}): Promise<T> {
  const text = await getText(url, { accept: "application/json", ...opts });
  return JSON.parse(text) as T;
}
