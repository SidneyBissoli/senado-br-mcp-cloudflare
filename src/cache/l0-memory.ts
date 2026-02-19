/** L0 — In-memory isolate cache with TTL. Zero external operations. */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

const MAX_ENTRIES = 500;

export function l0Get<T>(key: string): T | undefined {
  const entry = store.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return undefined;
  }
  return entry.value as T;
}

export function l0Set<T>(key: string, value: T, ttlSeconds: number): void {
  // Evict oldest entries if at capacity
  if (store.size >= MAX_ENTRIES) {
    const firstKey = store.keys().next().value;
    if (firstKey !== undefined) store.delete(firstKey);
  }
  store.set(key, {
    value,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
}
