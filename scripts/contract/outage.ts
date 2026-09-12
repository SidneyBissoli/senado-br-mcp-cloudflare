/**
 * Telling an upstream outage apart from upstream shape drift, for the
 * nightly contract tier.
 *
 * Why this is its own module and not part of `refresh-fixtures.ts`: the
 * refresher reads `process.argv` and writes files, so it only type-checks
 * under `scripts/tsconfig.json`. A unit test importing it would drag it into
 * the root program, which is compiled with `@cloudflare/workers-types` — and
 * did, producing an error on a line nobody had touched. Everything here is
 * pure and safe under both configs.
 *
 * Why the distinction matters: on the nights of 02, 04, 08 and 11/09/2026
 * every one of the 66 specs timed out against BOTH Senado hosts — `0 ok` —
 * and the job walked the whole manifest until its 30 min ceiling cut it. The
 * portfolio panel then reported "a fonte mudou". It had not. A drift detector
 * that raises a false alarm on an outage is a detector that stops being read.
 *
 * The cause, measured on 12/09/2026: the Senado drops packets from some
 * source addresses. 20 runners fired at the same instant; 18 connected, 2 got
 * no TCP answer at all from every Senado address, with our User-Agent and
 * with a plain curl one alike, while fetching a control site in under 60 ms.
 * A job that draws a blocked address loses the whole night, which is why the
 * cure is a fresh runner and why this module has to be able to say, in the
 * log, that drift was never measured.
 */

import { UpstreamError } from "../../src/throttle/upstream.js";
import { MissingDependencyError } from "./manifest.js";

/** Exit code meaning "upstream unreachable — drift was NOT measured". */
export const EXIT_UPSTREAM_UNREACHABLE = 3;

/**
 * How many captures in a row may fail at the transport level, with nothing
 * captured yet, before the upstream is called unreachable.
 *
 * Why 5: a failing spec costs ~36 s (3 attempts against a 10 s budget plus
 * 2 s + 4 s of backoff), so the breaker spends ~3 min before giving up — past
 * any single flaky endpoint, well inside the job ceiling. A healthy full run
 * takes 86-116 s; the bad nights took 1800 s.
 */
export const DEFAULT_TRANSPORT_STREAK_LIMIT = 5;

/**
 * How a failed capture should be read.
 *
 * - `transport`: the upstream never answered (DNS, TCP, TLS, abort, budget).
 * - `dependency`: the spec could not even be attempted because an earlier
 *   capture is missing. Says nothing about reachability either way.
 * - `other`: a response DID arrive and was rejected — an HTTP status, a body
 *   over the size guard, an empty body, a body that is not JSON. Shape-shaped.
 *
 * Only `transport` feeds the breaker; only `ok` and `other` clear it;
 * `dependency` leaves it untouched. Status alone cannot carry this — 502 is
 * used both for a real Bad Gateway and for a body that failed to parse — so
 * it rides on `UpstreamError.transport`.
 */
export type FailureKind = "transport" | "dependency" | "other";

export function classifyFailure(err: unknown): FailureKind {
  if (err instanceof MissingDependencyError) return "dependency";
  if (err instanceof UpstreamError && err.transport) return "transport";
  return "other";
}

/**
 * The breaker's decision. Only fires while nothing has been captured: once
 * the Senado has answered even one spec it is reachable, and a later run of
 * failures is about those endpoints, not about the connection.
 */
export function breakerTripped(
  captured: number,
  transportStreak: number,
  limit: number = DEFAULT_TRANSPORT_STREAK_LIMIT,
): boolean {
  return captured === 0 && transportStreak >= limit;
}
