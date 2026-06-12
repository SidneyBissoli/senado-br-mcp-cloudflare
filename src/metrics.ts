/** In-memory counters accumulated per isolate lifetime. */

const counters = {
  requests: 0,
  errors: 0,
  authFailures: 0,
  cacheL0Hits: 0,
  cacheL1Hits: 0,
  cacheMisses: 0,
  upstreamCalls: 0,
  upstreamErrors: 0,
  upstreamRetries: 0,
  toolCalls: 0,
  toolErrors: 0,
};

type MetricName = keyof typeof counters;

export function incr(name: MetricName, n = 1): void {
  counters[name] += n;
}

export function getMetrics() {
  return { ...counters, ts: new Date().toISOString() };
}

/** Reset all counters — test-only. */
export function _resetMetrics(): void {
  for (const k of Object.keys(counters) as MetricName[]) counters[k] = 0;
}
