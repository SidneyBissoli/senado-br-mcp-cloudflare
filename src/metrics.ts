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

/**
 * Per-tool call/error tallies for the current isolate. This is a live smoke test
 * of the instrumentation path (visible at /metrics) — it resets when the isolate
 * recycles, so it is NOT the durable measurement. Decision-grade tool-call data
 * lives in Analytics Engine, queried via SQL.
 */
const perTool: Record<string, { calls: number; errors: number }> = {};

export function incrTool(name: string, isError: boolean): void {
  const entry = (perTool[name] ??= { calls: 0, errors: 0 });
  entry.calls += 1;
  if (isError) entry.errors += 1;
}

export function getMetrics() {
  return { ...counters, perTool: { ...perTool }, ts: new Date().toISOString() };
}

/** Reset all counters — test-only. */
export function _resetMetrics(): void {
  for (const k of Object.keys(counters) as MetricName[]) counters[k] = 0;
  for (const k of Object.keys(perTool)) delete perTool[k];
}
