/** Structured logging — minimal, no PII. */

export function log(
  context: string,
  tool: string,
  status: number,
  latencyMs: number,
  retries: number,
  cacheHit?: "L0" | "L1" | "L2" | "MISS",
): void {
  console.log(
    JSON.stringify({
      ctx: context,
      tool,
      status,
      ms: latencyMs,
      retries,
      cache: cacheHit ?? "N/A",
      ts: new Date().toISOString(),
    }),
  );
}
