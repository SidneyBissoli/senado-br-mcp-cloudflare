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
import { log } from "../utils/logger.js";

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

/**
 * Fetch from the Senado API upstream.
 * @param path - Relative path (e.g., "/senador/lista/atual")
 * @param params - Query parameters
 * @param baseUrl - Override base URL (from env)
 */
export async function upstreamFetch(
  path: string,
  params: Record<string, string> = {},
  baseUrl?: string,
): Promise<unknown> {
  const base = baseUrl || SENADO_BASE_URL_DEFAULT;

  // Build URL with sorted query params
  const url = new URL(`${base}${path}.json`);
  const sortedKeys = Object.keys(params).sort();
  for (const key of sortedKeys) {
    if (params[key] !== undefined && params[key] !== "") {
      url.searchParams.set(key, params[key]);
    }
  }

  const startTime = Date.now();
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    // Check global rate limit
    if (!globalBucket.tryConsume()) {
      throw new UpstreamError(
        "Taxa de requisições excedida. Tente novamente em alguns segundos.",
        429,
        true,
      );
    }

    // Check concurrency limit
    if (inFlight >= MAX_CONCURRENT) {
      throw new UpstreamError(
        "Muitas requisições simultâneas ao upstream. Tente novamente em breve.",
        503,
        true,
      );
    }

    // Check remaining time budget
    const elapsed = Date.now() - startTime;
    const remaining = UPSTREAM_TIMEOUT_MS - elapsed;
    if (remaining <= 0) break;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), remaining);

    inFlight++;
    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "senado-br-mcp/2.0.0",
        },
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (response.status === 429 || response.status === 503) {
        lastError = new UpstreamError(
          `Upstream retornou ${response.status}`,
          response.status,
          true,
        );
        if (attempt < MAX_RETRIES) {
          const backoff = Math.min(1000 * Math.pow(2, attempt), 4000);
          const jitter = Math.random() * 500;
          await sleep(backoff + jitter);
          continue;
        }
        break;
      }

      if (!response.ok) {
        throw new UpstreamError(
          `Upstream retornou HTTP ${response.status}`,
          response.status,
          false,
        );
      }

      // Check response size via Content-Length header
      const contentLength = response.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_SIZE) {
        throw new UpstreamError(
          "Resposta upstream excede o limite de 2 MB",
          413,
          false,
        );
      }

      const text = await response.text();
      if (text.length > MAX_RESPONSE_SIZE) {
        throw new UpstreamError(
          "Resposta upstream excede o limite de 2 MB",
          413,
          false,
        );
      }

      const latency = Date.now() - startTime;
      log("upstream", path, response.status, latency, attempt);

      try {
        return JSON.parse(text);
      } catch {
        // If the API returns non-JSON despite .json suffix, try without suffix
        throw new UpstreamError(
          "Resposta upstream não é JSON válido",
          502,
          false,
        );
      }
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof UpstreamError) throw err;
      if ((err as Error).name === "AbortError") {
        lastError = new UpstreamError("Timeout na requisição upstream (10s)", 504, true);
        break;
      }
      lastError = err as Error;
      if (attempt < MAX_RETRIES) {
        const backoff = Math.min(1000 * Math.pow(2, attempt), 4000);
        await sleep(backoff + Math.random() * 500);
        continue;
      }
    } finally {
      inFlight--;
    }
  }

  throw lastError || new UpstreamError("Falha ao acessar upstream após retries", 502, true);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
