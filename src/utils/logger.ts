/** Structured JSON logging — picked up by CF Logpush / wrangler tail. */

type LogFields = Record<string, unknown>;

function emit(
  level: "info" | "warn" | "error",
  msg: string,
  fields?: LogFields,
): void {
  const entry = { level, msg, ts: new Date().toISOString(), ...fields };
  const json = JSON.stringify(entry);
  if (level === "error") console.error(json);
  else if (level === "warn") console.warn(json);
  else console.log(json);
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
