/**
 * Per-tool-call instrumentation.
 *
 * Goal: measure *which tool the agent selected* and whether it succeeded, so the
 * later tool-consolidation decision (P1) rests on real usage instead of guesses.
 *
 * Two sinks:
 *  - In-memory per-tool tallies (metrics.ts) — a live smoke test at /metrics for
 *    the current isolate only.
 *  - Analytics Engine — durable, queryable via SQL; the decision-grade signal.
 *
 * Instrumentation is observability, never the critical path: a failure here must
 * not add latency nor alter a tool's response. `writeDataPoint` is synchronous and
 * fire-and-forget in the Workers runtime (returns void, flushed out of band), so
 * there is nothing to await and no need for ctx.waitUntil — a try/catch is the
 * correct and sufficient guard.
 *
 * Privacy: only the tool name and a coarse ok/error status are recorded. No user
 * query content, tool parameters, or PII ever reach Analytics Engine.
 */

// Loosely typed to match the group modules' `server.tool(name, desc, shape, cb)`
// callback. The real signature comes from the MCP SDK; we only need to invoke it
// and inspect the `isError` flag on its result.
type ToolCallback = (...args: unknown[]) => Promise<unknown> | unknown;

import { incr, incrTool } from "./metrics.js";

export function instrumentTool(
  name: string,
  cb: ToolCallback,
  analytics?: AnalyticsEngineDataset,
): ToolCallback {
  return async (...args: unknown[]) => {
    incr("toolCalls");
    let isError = false;
    try {
      const result = await cb(...args);
      isError =
        typeof result === "object" && result !== null && (result as { isError?: unknown }).isError === true;
      return result;
    } catch (e) {
      // A thrown error is also a failed tool call — record it, then rethrow so the
      // SDK still produces the normal error response.
      isError = true;
      throw e;
    } finally {
      recordToolCall(name, isError, analytics);
    }
  };
}

function recordToolCall(name: string, isError: boolean, analytics?: AnalyticsEngineDataset): void {
  incrTool(name, isError);
  if (!analytics) return;
  try {
    analytics.writeDataPoint({
      // Low-cardinality index → cheap GROUP BY in SQL. The tool name only.
      indexes: [name],
      // blob1 = tool name (for GROUP BY without relying on the index), blob2 = outcome.
      blobs: [name, isError ? "error" : "ok"],
      // double1 = error flag, so sumIf/avg gives an error rate per tool.
      doubles: [isError ? 1 : 0],
    });
  } catch {
    // Swallow: a telemetry failure must never break or slow a tool response.
  }
}
