/**
 * Cache orchestrator: L0 (memory) → L1 (Cache API) → miss → fetch upstream.
 * L2 (KV) is used only for rare, low-write items (see specific tool impls).
 */

import { l0Get, l0Set } from "./l0-memory.js";
import { l1Get, l1Set } from "./l1-cache-api.js";
import type { CacheCategory } from "../types.js";

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
 */
export async function cachedFetch<T>(
  toolName: string,
  params: Record<string, unknown>,
  category: CacheCategory,
  fetcher: () => Promise<T>,
): Promise<T> {
  const paramsHash = await hashParams(params);
  const cacheKey = `${toolName}:${paramsHash}`;

  // L0: in-memory
  const l0 = l0Get<T>(cacheKey);
  if (l0 !== undefined) return l0;

  // L1: Cache API
  const l1 = await l1Get(toolName, paramsHash);
  if (l1 !== undefined) {
    try {
      const parsed = JSON.parse(l1) as T;
      l0Set(cacheKey, parsed, category.l0Ttl);
      return parsed;
    } catch {
      // corrupted cache entry, fall through
    }
  }

  // Miss: fetch upstream
  const result = await fetcher();

  // Populate caches
  const serialized = JSON.stringify(result);
  l0Set(cacheKey, result, category.l0Ttl);
  await l1Set(toolName, paramsHash, serialized, category.l1Ttl);

  return result;
}
