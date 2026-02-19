/** Token bucket rate limiter — in-memory, per-isolate. */

export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly maxTokens: number,
    private readonly refillRate: number, // tokens per second
  ) {
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  tryConsume(count = 1): boolean {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;
  }
}

/** Global rate limiter: max 8 req/s to upstream, burst up to 12. */
export const globalBucket = new TokenBucket(12, 8);

/** Per-client rate limiters keyed by client identity hash. */
const clientBuckets = new Map<string, TokenBucket>();
const MAX_CLIENT_BUCKETS = 200;

export function getClientBucket(clientId: string): TokenBucket {
  let bucket = clientBuckets.get(clientId);
  if (!bucket) {
    // Evict oldest if at capacity
    if (clientBuckets.size >= MAX_CLIENT_BUCKETS) {
      const firstKey = clientBuckets.keys().next().value;
      if (firstKey !== undefined) clientBuckets.delete(firstKey);
    }
    bucket = new TokenBucket(5, 2); // 2 req/s per client, burst 5
    clientBuckets.set(clientId, bucket);
  }
  return bucket;
}
