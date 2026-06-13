/**
 * Upstream fetch wrapper with:
 * - Global rate limiting (token bucket)
 * - Concurrency limiting (max in-flight)
 * - Retry with bounded exponential backoff + jitter on 429/503
 * - AbortController timeout (10s total)
 * - Response size guard (2 MB)
 */

import { globalBucket } from "./token-bucket.js";
import { UPSTREAM_TIMEOUT_MS, MAX_RESPONSE_SIZE, SENADO_BASE_URL_DEFAULT } from "../types.js";
import { log, logger } from "../utils/logger.js";
import { incr } from "../metrics.js";

const MAX_RETRIES = 2;
const MAX_CONCURRENT = 6;
let inFlight = 0;

export class UpstreamError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export interface UpstreamOptions {
  /** Skip the automatic `.json` suffix (the adm API does not use it). */
  noJsonSuffix?: boolean;
  /** Override the response size guard (bytes). Use for known-large datasets. */
  maxSize?: number;
  /** Return [] instead of throwing on HTTP 404 (APIs that 404 on empty collections). */
  treat404AsEmpty?: boolean;
}

/**
 * Fetch from the Senado API upstream.
 * @param path - Relative path (e.g., "/senador/lista/atual")
 * @param params - Query parameters
 * @param baseUrl - Override base URL (from env)
 * @param options - Per-call behavior overrides
 */
export async function upstreamFetch(
  path: string,
  params: Record<string, string> = {},
  baseUrl?: string,
  options: UpstreamOptions = {},
): Promise<unknown> {
  const base = baseUrl || SENADO_BASE_URL_DEFAULT;
  const maxSize = options.maxSize ?? MAX_RESPONSE_SIZE;

  // Build URL with sorted query params
  const url = new URL(`${base}${path}${options.noJsonSuffix ? "" : ".json"}`);
  const sortedKeys = Object.keys(params).sort();
  for (const key of sortedKeys) {
    if (params[key] !== undefined && params[key] !== "") {
      url.searchParams.set(key, params[key]);
    }
  }

  const startTime = Date.now();
  let lastError: UpstreamError | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Check global rate limit
    if (!globalBucket.tryConsume()) {
      incr("upstreamErrors");
      logger.warn("upstream_rate_limited", { path });
      throw new UpstreamError(
        `[${path}] Taxa de requisições excedida. Tente novamente em alguns segundos.`,
        429,
        true,
      );
    }

    // Check concurrency limit
    if (inFlight >= MAX_CONCURRENT) {
      incr("upstreamErrors");
      logger.warn("upstream_concurrency_limited", { path });
      throw new UpstreamError(
        `[${path}] Muitas requisições simultâneas ao upstream. Tente novamente em breve.`,
        503,
        true,
      );
    }

    // Check remaining time budget
    const elapsed = Date.now() - startTime;
    const remaining = UPSTREAM_TIMEOUT_MS - elapsed;
    if (remaining <= 0) {
      lastError = lastError || new UpstreamError(
        `[${path}] Timeout: orçamento de ${UPSTREAM_TIMEOUT_MS}ms esgotado antes da tentativa ${attempt + 1}`,
        504,
        true,
      );
      break;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remaining);

    inFlight++;
    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "senado-br-mcp/2.1.0",
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.status === 429 || response.status === 503) {
        lastError = new UpstreamError(
          `[${path}] Upstream retornou ${response.status}`,
          response.status,
          true,
        );
        if (attempt < MAX_RETRIES) {
          incr("upstreamRetries");
          logger.warn("upstream_retry", { path, attempt, status: response.status });
          const backoff = Math.min(1000 * Math.pow(2, attempt), 4000);
          const jitter = Math.random() * 500;
          await sleep(backoff + jitter);
          continue;
        }
        break;
      }

      if (response.status === 404 && options.treat404AsEmpty) {
        incr("upstreamCalls");
        log("upstream", path, 404, Date.now() - startTime, attempt);
        return [];
      }

      if (!response.ok) {
        throw new UpstreamError(
          `[${path}] Upstream retornou HTTP ${response.status}`,
          response.status,
          response.status >= 500, // 5xx are retryable, 4xx are not
        );
      }

      // Check response size via Content-Length header
      const contentLength = response.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > maxSize) {
        throw new UpstreamError(
          `[${path}] Resposta upstream excede o limite de ${Math.round(maxSize / 1024 / 1024)} MB`,
          413,
          false,
        );
      }

      const text = await response.text();
      if (text.length > maxSize) {
        throw new UpstreamError(
          `[${path}] Resposta upstream excede o limite de ${Math.round(maxSize / 1024 / 1024)} MB`,
          413,
          false,
        );
      }

      const latency = Date.now() - startTime;
      incr("upstreamCalls");
      log("upstream", path, response.status, latency, attempt);

      if (!text.trim()) {
        throw new UpstreamError(
          `[${path}] Resposta upstream vazia`,
          502,
          true,
        );
      }

      try {
        return JSON.parse(text);
      } catch {
        throw new UpstreamError(
          `[${path}] Resposta upstream não é JSON válido`,
          502,
          false,
        );
      }
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof UpstreamError) throw err;

      // Network-level errors (DNS, TCP, TLS, AbortError)
      const isAbort = (err as Error).name === "AbortError";
      lastError = new UpstreamError(
        isAbort
          ? `[${path}] Timeout na requisição upstream (${UPSTREAM_TIMEOUT_MS / 1000}s)`
          : `[${path}] Erro de rede: ${(err as Error).message || "desconhecido"}`,
        isAbort ? 504 : 502,
        true, // Network errors are always retryable
      );

      if (isAbort) break; // AbortError means time budget is spent
      if (attempt < MAX_RETRIES) {
        incr("upstreamRetries");
        logger.warn("upstream_retry", { path, attempt, message: lastError.message });
        const backoff = Math.min(1000 * Math.pow(2, attempt), 4000);
        await sleep(backoff + Math.random() * 500);
        continue;
      }
    } finally {
      inFlight--;
    }
  }

  const finalError = lastError || new UpstreamError(`[${path}] Falha ao acessar upstream após retries`, 502, true);
  incr("upstreamErrors");
  logger.error("upstream_error", { path, status: finalError.status, message: finalError.message });
  throw finalError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
