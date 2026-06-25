/**
 * Offline tests for the pure retry/classification core (evals/retry.ts).
 * No network — just the status→kind mapping and backoff math that decide whether the
 * runner retries a failure or treats it as fatal. These are what keep an infra dropout
 * from being mis-scored as a wrong tool pick.
 */

import { describe, it, expect } from "vitest";
import {
  classifyApiError,
  backoffMs,
  parseRetryAfter,
  isFatalInfra,
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
} from "../../evals/retry.js";

describe("classifyApiError", () => {
  it("treats 429 as a retryable rate_limit", () => {
    expect(classifyApiError(429, "rate_limit_error")).toEqual({ kind: "rate_limit", retryable: true });
  });

  it("treats 529 as a retryable overloaded", () => {
    expect(classifyApiError(529, "overloaded")).toEqual({ kind: "overloaded", retryable: true });
  });

  it("treats 5xx as a retryable server error", () => {
    expect(classifyApiError(500, "")).toEqual({ kind: "server", retryable: true });
    expect(classifyApiError(503, "")).toEqual({ kind: "server", retryable: true });
  });

  it("treats 401/403 as fatal auth", () => {
    expect(classifyApiError(401, "invalid x-api-key")).toEqual({ kind: "auth", retryable: false });
    expect(classifyApiError(403, "forbidden")).toEqual({ kind: "auth", retryable: false });
  });

  it("treats a 400 credit-balance error as fatal billing", () => {
    const body = '{"error":{"message":"Your credit balance is too low to access the Anthropic API."}}';
    expect(classifyApiError(400, body)).toEqual({ kind: "billing", retryable: false });
  });

  it("matching is case-insensitive", () => {
    expect(classifyApiError(400, "CREDIT BALANCE too low").kind).toBe("billing");
  });

  it("treats other 400s as non-retryable other (not billing)", () => {
    expect(classifyApiError(400, "messages: invalid request")).toEqual({ kind: "other", retryable: false });
  });
});

describe("isFatalInfra", () => {
  it("is true only for auth and billing", () => {
    expect(isFatalInfra("auth")).toBe(true);
    expect(isFatalInfra("billing")).toBe(true);
    expect(isFatalInfra("rate_limit")).toBe(false);
    expect(isFatalInfra("server")).toBe(false);
    expect(isFatalInfra("network")).toBe(false);
    expect(isFatalInfra("other")).toBe(false);
  });
});

describe("backoffMs", () => {
  it("grows exponentially from the base when no Retry-After is given", () => {
    expect(backoffMs(0)).toBe(BASE_BACKOFF_MS);
    expect(backoffMs(1)).toBe(BASE_BACKOFF_MS * 2);
    expect(backoffMs(2)).toBe(BASE_BACKOFF_MS * 4);
  });

  it("caps the exponential backoff at MAX_BACKOFF_MS", () => {
    expect(backoffMs(20)).toBe(MAX_BACKOFF_MS);
  });

  it("honors a Retry-After hint over the exponential schedule", () => {
    expect(backoffMs(0, 7)).toBe(7_000);
  });

  it("caps the Retry-After hint at MAX_BACKOFF_MS", () => {
    expect(backoffMs(0, 120)).toBe(MAX_BACKOFF_MS);
  });

  it("ignores a non-positive or non-finite Retry-After hint", () => {
    expect(backoffMs(1, 0)).toBe(BASE_BACKOFF_MS * 2);
    expect(backoffMs(1, -5)).toBe(BASE_BACKOFF_MS * 2);
    expect(backoffMs(1, NaN)).toBe(BASE_BACKOFF_MS * 2);
  });
});

describe("parseRetryAfter", () => {
  it("parses an integer-seconds header", () => {
    expect(parseRetryAfter("30")).toBe(30);
    expect(parseRetryAfter("  5 ")).toBe(5);
  });

  it("returns undefined for missing or non-numeric values", () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter("")).toBeUndefined();
    expect(parseRetryAfter("Wed, 21 Oct 2026 07:28:00 GMT")).toBeUndefined();
  });
});
