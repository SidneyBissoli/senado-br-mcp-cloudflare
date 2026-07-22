/**
 * Shared Anthropic Messages API client for the eval harness (runner + judge).
 *
 * Plain fetch (no SDK dependency, mirroring evals/run.ts), with bounded
 * exponential backoff + jitter on 408/429/5xx/529/network errors, honoring
 * Retry-After. Fatal conditions (bad key, no credits, malformed request)
 * throw FatalApiError so callers abort the whole batch instead of grinding
 * through doomed requests.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const API_URL = "https://api.anthropic.com/v1/messages";
export const API_VERSION = "2023-06-01";

const MAX_RETRIES = 5;
const REQUEST_TIMEOUT_MS = 300_000;

/** Whole-batch-is-doomed conditions (401/403/400 — auth, billing, harness bug). */
export class FatalApiError extends Error {}

/** One request kept failing transiently after all retries. */
export class TransientExhaustedError extends Error {}

export interface ApiContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  server_name?: string;
  input?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

export interface ApiResponse {
  content: ApiContentBlock[];
  stop_reason: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

/** Minimal .env loader (KEY=VALUE lines) — only fills vars not already set. */
export function loadDotEnv(repoRoot: string): void {
  const envPath = join(repoRoot, ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || line.trimStart().startsWith("#")) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

function classifyStatus(status: number): "retryable" | "fatal" | "other" {
  if (status === 408 || status === 429 || status >= 500) return "retryable";
  // 400 is either a billing wall or a harness bug; 401/403 are auth — all stop the batch.
  if (status === 400 || status === 401 || status === 403) return "fatal";
  return "other";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One Messages API POST with retries. `betas` adds an anthropic-beta header. */
export async function postMessages(
  body: unknown,
  apiKey: string,
  label: string,
  opts: { betas?: string[] } = {},
): Promise<ApiResponse> {
  let lastMessage = "";
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let res: Response | null = null;
    let networkError: string | null = null;
    try {
      res = await fetch(API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": API_VERSION,
          ...(opts.betas?.length ? { "anthropic-beta": opts.betas.join(",") } : {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      networkError = (e as Error).message || "unknown network error";
    } finally {
      clearTimeout(timer);
    }

    if (res?.ok) return (await res.json()) as ApiResponse;

    let retryAfterMs: number | null = null;
    if (res) {
      const text = await res.text().catch(() => "");
      lastMessage = `HTTP ${res.status}: ${text.slice(0, 300)}`;
      const kind = classifyStatus(res.status);
      if (kind === "fatal") throw new FatalApiError(`${label}: ${lastMessage}`);
      if (kind === "other") throw new TransientExhaustedError(`${label}: ${lastMessage}`);
      const ra = Number(res.headers.get("retry-after"));
      if (Number.isFinite(ra) && ra > 0) retryAfterMs = ra * 1000;
    } else {
      lastMessage = `network: ${networkError}`;
    }

    if (attempt === MAX_RETRIES) break;
    const backoff = retryAfterMs ?? Math.min(60_000, 1000 * 2 ** attempt);
    const jitter = Math.floor(Math.random() * 500);
    console.error(`    retry ${attempt + 1}/${MAX_RETRIES} in ${backoff + jitter}ms (${lastMessage})`);
    await sleep(backoff + jitter);
  }
  throw new TransientExhaustedError(`${label}: retries exhausted — ${lastMessage}`);
}
