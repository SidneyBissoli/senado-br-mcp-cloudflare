/**
 * Structured JSON logging — picked up by CF Logpush / wrangler tail.
 *
 * Every level writes to stderr (`console.error`). On the Worker this is
 * indistinguishable from stdout for log capture, but in the npm/stdio channel
 * (`src/cli.ts`) stdout is the JSON-RPC protocol stream — any stray byte there
 * corrupts the transport. Keeping all logs on stderr makes the same logger safe
 * in both runtimes. The `level` field in the payload preserves the distinction
 * for downstream filtering.
 */

type LogFields = Record<string, unknown>;

function emit(
  level: "info" | "warn" | "error",
  msg: string,
  fields?: LogFields,
): void {
  const entry = { level, msg, ts: new Date().toISOString(), ...fields };
  console.error(JSON.stringify(entry));
}

export const logger = {
  info: (msg: string, fields?: LogFields) => emit("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => emit("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => emit("error", msg, fields),
};

/** Backward-compat wrapper — delegates to logger.info. */
export function log(
  context: string,
  tool: string,
  status: number,
  latencyMs: number,
  retries: number,
  cacheHit?: "L0" | "L1" | "L2" | "MISS",
): void {
  logger.info("upstream", { ctx: context, tool, status, ms: latencyMs, retries, cache: cacheHit ?? "N/A" });
}
