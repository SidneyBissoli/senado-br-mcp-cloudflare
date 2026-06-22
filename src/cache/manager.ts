/**
 * Cache orchestrator: L0 (memory) → L1 (Cache API) → miss → fetch upstream.
 * L2 (KV) is used only for rare, low-write items (see specific tool impls).
 *
 * Entries are persisted wrapped in a CacheEnvelope that carries `fetchedAt` — the ISO
 * timestamp of the upstream extraction — so provenance (Vetor A) can report a faithful
 * `retrieved_at` even when a response is served from cache (the level-1 vs level-2
 * differentiator). `cachedFetchWithMeta` exposes that timestamp + a `fromCache` flag;
 * `cachedFetch` stays data-only for the tools that don't need it. Reads are backward
 * compatible: a non-enveloped (legacy/in-flight) entry is treated as the raw value.
 */

import { l0Get, l0Set } from "./l0-memory.js";
import { l1Get, l1Set } from "./l1-cache-api.js";
import type { CacheCategory } from "../types.js";
import { logger } from "../utils/logger.js";
import { incr } from "../metrics.js";
import { recordFetch } from "../observability/call-context.js";

/** Compute a stable hash for cache keying. */
export async function hashParams(params: Record<string, unknown>): Promise<string> {
  const sorted = JSON.stringify(params, Object.keys(params).sort());
  const data = new TextEncoder().encode(sorted);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const arr = new Uint8Array(hash);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Stored shape: wraps the cached value with the upstream-fetch timestamp. */
interface CacheEnvelope<T> {
  _provMeta: { fetchedAt: string };
  v: T;
}

function isEnvelope<T>(x: unknown): x is CacheEnvelope<T> {
  return (
    typeof x === "object" &&
    x !== null &&
    !Array.isArray(x) &&
    "_provMeta" in x &&
    "v" in x &&
    typeof (x as CacheEnvelope<T>)._provMeta?.fetchedAt === "string"
  );
}

/** Result of a cache-through fetch including provenance-relevant metadata. */
export interface CachedMeta<T> {
  value: T;
  /** ISO-8601 of the upstream extraction, preserved through the cache layers. */
  fetchedAt: string;
  /** true if served from L0/L1; false on a miss (live upstream fetch). */
  fromCache: boolean;
}

/**
 * Multi-layer cache-through fetch, returning the value plus the upstream-fetch timestamp
 * and a cache-hit flag. On a miss, `fetchedAt` is stamped at the moment the fetcher resolves
 * and persisted alongside the value; on a hit it is read back from the envelope. Legacy
 * (non-enveloped) cache entries fall back to the current time, marked `fromCache: true`.
 *
 * Designed for graceful degradation: if hashing or cache operations fail, falls through
 * to the fetcher so the tool still works.
 */
async function runCachedFetch<T>(
  toolName: string,
  params: Record<string, unknown>,
  category: CacheCategory,
  fetcher: () => Promise<T>,
): Promise<CachedMeta<T>> {
  let paramsHash: string;
  try {
    paramsHash = await hashParams(params);
  } catch {
    // crypto.subtle failure (unlikely but possible in some runtimes) — skip cache
    const value = await fetcher();
    return { value, fetchedAt: new Date().toISOString(), fromCache: false };
  }

  const cacheKey = `${toolName}:${paramsHash}`;
  incr("toolCalls");

  // L0: in-memory
  const l0 = l0Get<unknown>(cacheKey);
  if (l0 !== undefined) {
    incr("cacheL0Hits");
    logger.info("cache_hit", { tool: toolName, layer: "L0" });
    if (isEnvelope<T>(l0)) return { value: l0.v, fetchedAt: l0._provMeta.fetchedAt, fromCache: true };
    return { value: l0 as T, fetchedAt: new Date().toISOString(), fromCache: true };
  }

  // L1: Cache API
  const l1 = await l1Get(toolName, paramsHash);
  if (l1 !== undefined) {
    try {
      const parsed = JSON.parse(l1) as unknown;
      l0Set(cacheKey, parsed, category.l0Ttl);
      incr("cacheL1Hits");
      logger.info("cache_hit", { tool: toolName, layer: "L1" });
      if (isEnvelope<T>(parsed)) {
        return { value: parsed.v, fetchedAt: parsed._provMeta.fetchedAt, fromCache: true };
      }
      return { value: parsed as T, fetchedAt: new Date().toISOString(), fromCache: true };
    } catch {
      // corrupted cache entry, fall through
    }
  }

  // Miss: fetch upstream and stamp the extraction time.
  incr("cacheMisses");
  logger.info("cache_miss", { tool: toolName });
  const value = await fetcher();
  const fetchedAt = new Date().toISOString();
  const envelope: CacheEnvelope<T> = { _provMeta: { fetchedAt }, v: value };

  // Populate caches — failures here are non-fatal
  try {
    const serialized = JSON.stringify(envelope);
    l0Set(cacheKey, envelope, category.l0Ttl);
    await l1Set(toolName, paramsHash, serialized, category.l1Ttl);
  } catch {
    // Serialization or L1 put failure — result is still valid
  }

  return { value, fetchedAt, fromCache: false };
}

/**
 * Public entry point. Records the cache outcome of this call into the per-call
 * observability accumulator (single point, so cache hits/misses are counted exactly
 * once regardless of which return path `runCachedFetch` took — see call-context.ts).
 */
export async function cachedFetchWithMeta<T>(
  toolName: string,
  params: Record<string, unknown>,
  category: CacheCategory,
  fetcher: () => Promise<T>,
): Promise<CachedMeta<T>> {
  const result = await runCachedFetch<T>(toolName, params, category, fetcher);
  recordFetch(result.fromCache);
  return result;
}

/**
 * Data-only cache-through fetch. Thin wrapper over `cachedFetchWithMeta` — keeps the
 * return shape the 19 existing tool call sites rely on. Use `cachedFetchWithMeta` when
 * you need the upstream `fetchedAt` (provenance) or the `fromCache` flag.
 */
export async function cachedFetch<T>(
  toolName: string,
  params: Record<string, unknown>,
  category: CacheCategory,
  fetcher: () => Promise<T>,
): Promise<T> {
  return (await cachedFetchWithMeta<T>(toolName, params, category, fetcher)).value;
}
