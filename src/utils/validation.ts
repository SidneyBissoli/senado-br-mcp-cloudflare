/** Shared validation helpers and response builders. */

import { incr } from "../metrics.js";
import { logger } from "./logger.js";

export function toolError(message: string, isRetryable = false) {
  incr("toolErrors");
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message, retryable: isRetryable }) }],
    isError: true,
  };
}

/**
 * Build a toolError from any caught value, preserving UpstreamError's retryable flag.
 * Avoids the repetitive `e instanceof Error ? e.message : "..."` pattern.
 * Note: does NOT call incr("toolErrors") directly — toolError() handles that.
 */
export function errorFrom(e: unknown, fallbackMessage: string) {
  const message = e instanceof Error ? e.message : fallbackMessage;
  const retryable = e instanceof Error && "retryable" in e && typeof (e as any).retryable === "boolean"
    ? (e as any).retryable
    : false;
  logger.error("tool_error", { message, retryable });
  return toolError(message, retryable);
}

export function toolResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

/** NaN-safe parseInt. Returns `fallback` (default 0) for null/undefined/NaN. */
export function safeInt(value: unknown, fallback = 0): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = typeof value === "number" ? Math.trunc(value) : parseInt(String(value), 10);
  return Number.isNaN(n) ? fallback : n;
}

/** Build query params from an object, omitting undefined/null values. */
export function buildParams(obj: Record<string, unknown>): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null && value !== "") {
      params[key] = String(value);
    }
  }
  return params;
}

/** Safe deep access into nested API response objects. */
export function dig(obj: unknown, ...keys: string[]): unknown {
  let current = obj;
  for (const key of keys) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Ensure a value is an array (wraps single objects). */
export function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}
