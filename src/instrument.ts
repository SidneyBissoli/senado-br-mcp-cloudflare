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
 * Privacy: only the tool name, a coarse ok/error status, cache-outcome counts, and
 * aggregable request context (country, AS organization, owner's self-use marker) are
 * recorded. No user query content, tool parameters, IP, or PII ever reach Analytics
 * Engine.
 *
 * Request context (blobs 4–6): hosted AI-platform connectors egress from the
 * platform's own servers (e.g. Anthropic in the US), so country/AS is the only way
 * to tell that traffic apart in aggregate — and the owner's own use through such a
 * connector is only identifiable via the secret header his MCP clients send
 * (SELF_HEADER, value = the SELF_MARKER Wrangler secret).
 */

// Loosely typed to match the group modules' `server.tool(name, desc, shape, cb)`
// callback. The real signature comes from the MCP SDK; we only need to invoke it
// and inspect the `isError` flag on its result.
type ToolCallback = (...args: unknown[]) => Promise<unknown> | unknown;

import { incr, incrTool } from "./metrics.js";
import { callCache, cacheClass, type CallCacheStats } from "./observability/call-context.js";

/** Header the owner's MCP clients send (value = the SELF_MARKER secret). */
export const SELF_HEADER = "x-mcp-self";

/** Per-request context, computed once in the Worker's fetch handler. */
export interface RequestTag {
  self: boolean;
  country: string;
  asOrg: string;
}

/** Extracts country/AS from request.cf and matches the self-use secret header. */
export function tagRequest(request: Request, selfSecret?: string): RequestTag {
  const cf = (request as { cf?: IncomingRequestCfProperties }).cf;
  return {
    self: !!selfSecret && request.headers.get(SELF_HEADER) === selfSecret,
    country: typeof cf?.country === "string" ? cf.country : "",
    asOrg: typeof cf?.asOrganization === "string" ? cf.asOrganization : "",
  };
}

export function instrumentTool(
  name: string,
  cb: ToolCallback,
  analytics?: AnalyticsEngineDataset,
  tag?: RequestTag,
): ToolCallback {
  return async (...args: unknown[]) => {
    incr("toolCalls");
    let isError = false;
    // Per-call store the cache layer increments per upstream fetch (see call-context.ts).
    const stats: CallCacheStats = { fetches: 0, hits: 0 };
    try {
      const result = await callCache.run(stats, () => cb(...args));
      isError =
        typeof result === "object" && result !== null && (result as { isError?: unknown }).isError === true;
      return result;
    } catch (e) {
      // A thrown error is also a failed tool call — record it, then rethrow so the
      // SDK still produces the normal error response.
      isError = true;
      throw e;
    } finally {
      recordToolCall(name, isError, stats, analytics, tag);
    }
  };
}

function recordToolCall(
  name: string,
  isError: boolean,
  stats: CallCacheStats,
  analytics?: AnalyticsEngineDataset,
  tag?: RequestTag,
): void {
  incrTool(name, isError);
  if (!analytics) return;
  try {
    analytics.writeDataPoint({
      // Low-cardinality index → cheap GROUP BY in SQL. The tool name only.
      indexes: [name],
      // blob1 = tool name (for GROUP BY without relying on the index), blob2 = outcome,
      // blob3 = cache class of the call (cached | live | partial | none),
      // blob4 = "self" when the owner's secret header matched, blob5 = country,
      // blob6 = AS organization (request.cf) — same positions in every portfolio MCP.
      blobs: [
        name,
        isError ? "error" : "ok",
        cacheClass(stats),
        tag?.self ? "self" : "",
        tag?.country ?? "",
        tag?.asOrg ?? "",
      ],
      // double1 = error flag (error rate via avg); double2 = upstream fetches in the call;
      // double3 = how many were cache hits (fetch-level cache-hit ratio via sum/sum).
      doubles: [isError ? 1 : 0, stats.fetches, stats.hits],
    });
  } catch {
    // Swallow: a telemetry failure must never break or slow a tool response.
  }
}
