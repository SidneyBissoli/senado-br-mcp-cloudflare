/**
 * Per-tool-call cache accumulator (Vetor B — cache-vs-live signal).
 *
 * `cachedFetchWithMeta` (bottom of the stack) knows whether each upstream fetch was
 * served from cache, but the instrumentation wrapper (top of the stack) only sees the
 * final MCP result. This AsyncLocalStorage bridges them without polluting the response
 * or touching the 19 tool call sites: `instrumentTool` runs the callback inside a fresh
 * store, the cache layer increments it per fetch, and the wrapper reads it back to derive
 * the analytics datapoint. Concurrency-safe (one store per async context) and entirely
 * off the critical path — a missing store is a no-op.
 *
 * Records counts only (no PII): how many upstream fetches a call made and how many came
 * from cache. See docs/observability-queries.md.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export interface CallCacheStats {
  fetches: number;
  hits: number;
}

export const callCache = new AsyncLocalStorage<CallCacheStats>();

/** Record one cache-through fetch outcome into the current call's store, if any. */
export function recordFetch(fromCache: boolean): void {
  const s = callCache.getStore();
  if (!s) return;
  s.fetches += 1;
  if (fromCache) s.hits += 1;
}

/** Derive the categorical cache class for a finished call (blob3 in Analytics Engine). */
export function cacheClass(stats: CallCacheStats): "none" | "cached" | "live" | "partial" {
  if (stats.fetches === 0) return "none";
  if (stats.hits === stats.fetches) return "cached";
  if (stats.hits === 0) return "live";
  return "partial";
}
