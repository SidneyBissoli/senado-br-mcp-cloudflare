/**
 * Cache orchestrator: L0 (memory) → L1 (Cache API) → miss → fetch upstream.
 * L2 (KV) is used only for rare, low-write items (see specific tool impls).
 */

import { l0Get, l0Set } from "./l0-memory.js";
import { l1Get, l1Set } from "./l1-cache-api.js";
import type { CacheCategory } from "../types.js";
import { logger } from "../utils/logger.js";
import { incr } from "../metrics.js";

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

/**
 * Multi-layer cache-through fetch.
 * Returns cached data if available, otherwise calls `fetcher` and caches the result.
 *
 * Designed for graceful degradation: if hashing or cache operations fail,
 * falls through to the fetcher so the tool still works.
 */
export async function cachedFetch<T>(
  toolName: string,
  params: Record<string, unknown>,
  category: CacheCategory,
  fetcher: () => Promise<T>,
): Promise<T> {
  let paramsHash: string;
  try {
    paramsHash = await hashParams(params);
  } catch {
    // crypto.subtle failure (unlikely but possible in some runtimes) — skip cache
    return fetcher();
  }

  const cacheKey = `${toolName}:${paramsHash}`;
  incr("toolCalls");

  // L0: in-memory
  const l0 = l0Get<T>(cacheKey);
  if (l0 !== undefined) {
    incr("cacheL0Hits");
    logger.info("cache_hit", { tool: toolName, layer: "L0" });
    return l0;
  }

  // L1: Cache API
  const l1 = await l1Get(toolName, paramsHash);
  if (l1 !== undefined) {
    try {
      const parsed = JSON.parse(l1) as T;
      l0Set(cacheKey, parsed, category.l0Ttl);
      incr("cacheL1Hits");
      logger.info("cache_hit", { tool: toolName, layer: "L1" });
      return parsed;
    } catch {
      // corrupted cache entry, fall through
    }
  }

  // Miss: fetch upstream
  incr("cacheMisses");
  logger.info("cache_miss", { tool: toolName });
  const result = await fetcher();

  // Populate caches — failures here are non-fatal
  try {
    const serialized = JSON.stringify(result);
    l0Set(cacheKey, result, category.l0Ttl);
    await l1Set(toolName, paramsHash, serialized, category.l1Ttl);
  } catch {
    // Serialization or L1 put failure — result is still valid
  }

  return result;
}
