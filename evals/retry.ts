/**
 * Pure retry/error-classification core for the eval runner. No network, no I/O —
 * so the offline unit tests (tests/evals/retry.test.ts) can exercise it directly.
 *
 * The runner sends each fixture to the Anthropic Messages API. Two failure classes must be
 * told apart, because the original runner conflated them with a *wrong tool pick*:
 *   - transient infra (429 rate-limit, 529 overloaded, 5xx, network) → worth retrying;
 *   - fatal infra (401 auth, 400 "credit balance too low") → retrying never helps, so the
 *     whole run should fail fast with a clear remedy instead of hammering the API.
 * Neither class is an accuracy signal: a fixture that never reached the model was not
 * "answered wrong". classifyApiError() is what lets the runner keep that distinction.
 */

export type ErrorKind =
  | "rate_limit" // 429 — exceeded tokens/min; back off and retry
  | "overloaded" // 529 — Anthropic capacity; back off and retry
  | "server" // 5xx — transient upstream error; retry
  | "network" // fetch threw (DNS/TCP/TLS/abort); retry
  | "auth" // 401/403 — invalid/again-rejected key; fatal, abort the run
  | "billing" // 400 credit balance too low; fatal, abort the run
  | "other"; // anything else (e.g. malformed request); not retryable

export class EvalApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly kind: ErrorKind,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "EvalApiError";
  }
}

/** Fatal infra kinds short-circuit the whole run — every fixture would hit the same wall. */
export function isFatalInfra(kind: ErrorKind): boolean {
  return kind === "auth" || kind === "billing";
}

/**
 * Classify an Anthropic API HTTP error from its status + response body into a kind and
 * whether retrying could plausibly succeed. Pure; the body is only inspected to tell a
 * 400 billing error ("credit balance is too low") from other 400s.
 */
export function classifyApiError(status: number, body: string): { kind: ErrorKind; retryable: boolean } {
  const lower = (body || "").toLowerCase();
  if (status === 429) return { kind: "rate_limit", retryable: true };
  if (status === 529) return { kind: "overloaded", retryable: true };
  if (status === 401 || status === 403) return { kind: "auth", retryable: false };
  if (status === 400 && (lower.includes("credit balance") || lower.includes("plans & billing"))) {
    return { kind: "billing", retryable: false };
  }
  if (status >= 500) return { kind: "server", retryable: true };
  return { kind: "other", retryable: false };
}

export const BASE_BACKOFF_MS = 2_000;
export const MAX_BACKOFF_MS = 30_000;
export const MAX_RETRIES = 5;

/**
 * Base backoff (ms) before the given 0-based retry attempt. Honors a Retry-After hint
 * (seconds) from the API when present — important for 429, where the rate-limit window
 * must roll over before the next try can succeed. Caller adds jitter; kept pure so the
 * unit test can assert exact values.
 */
export function backoffMs(attempt: number, retryAfterSeconds?: number): number {
  if (retryAfterSeconds !== undefined && Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(Math.ceil(retryAfterSeconds * 1000), MAX_BACKOFF_MS);
  }
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS);
}

/** Parse a `Retry-After` header (integer seconds form only) into seconds, or undefined. */
export function parseRetryAfter(headerValue: string | null): number | undefined {
  if (!headerValue) return undefined;
  const secs = parseInt(headerValue.trim(), 10);
  return Number.isFinite(secs) && secs >= 0 ? secs : undefined;
}
