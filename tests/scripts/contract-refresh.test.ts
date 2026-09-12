/**
 * Unit tests for the nightly fixture refresher's outage handling
 * (`scripts/contract/refresh-fixtures.ts`). No network: the classifier and
 * the breaker are pure functions, exported precisely so they can be tested
 * directly (repo convention).
 *
 * What is pinned here is the distinction the nightly tier lives or dies by.
 * On 02, 04, 08 and 11/09/2026 every one of the 66 specs timed out, the job
 * walked the manifest until the 30 min ceiling cut it, and the portfolio
 * panel reported "a fonte mudou" — a false alarm on the detector whose only
 * purpose is to catch real upstream drift.
 */

import { describe, it, expect } from "vitest";
import { UpstreamError } from "../../src/throttle/upstream.js";
import { MissingDependencyError } from "../../scripts/contract/manifest.js";
import {
  classifyFailure,
  breakerTripped,
  DEFAULT_TRANSPORT_STREAK_LIMIT,
  EXIT_UPSTREAM_UNREACHABLE,
} from "../../scripts/contract/outage.js";

describe("classifyFailure", () => {
  it("reads an aborted request as transport", () => {
    const err = new UpstreamError("[/x] Timeout na requisição upstream (10s)", 504, true, true);
    expect(classifyFailure(err)).toBe("transport");
  });

  it("reads a network error as transport", () => {
    const err = new UpstreamError("[/x] Erro de rede: ECONNREFUSED", 502, true, true);
    expect(classifyFailure(err)).toBe("transport");
  });

  it("does NOT read an HTTP status as transport", () => {
    const err = new UpstreamError("[/x] Upstream retornou HTTP 404", 404, false);
    expect(classifyFailure(err)).toBe("other");
  });

  it("does NOT read a non-JSON body as transport, even though its status is 502", () => {
    // This is the case status alone cannot separate: a body arrived and
    // failed to parse, which is shape-shaped and belongs to the contract
    // tier, yet it carries the same 502 as a real network failure.
    const err = new UpstreamError("[/x] Resposta upstream não é JSON válido", 502, false);
    expect(classifyFailure(err)).toBe("other");
  });

  it("does NOT read an empty body as transport", () => {
    const err = new UpstreamError("[/x] Resposta upstream vazia", 502, true);
    expect(classifyFailure(err)).toBe("other");
  });

  it("reads a missing dependency as its own kind", () => {
    expect(classifyFailure(new MissingDependencyError("senador-lista-atual"))).toBe("dependency");
  });

  it("reads an unknown error as other", () => {
    expect(classifyFailure(new Error("boom"))).toBe("other");
    expect(classifyFailure("boom")).toBe("other");
  });
});

describe("breakerTripped", () => {
  it("stays open until the streak reaches the limit", () => {
    expect(breakerTripped(0, 4, 5)).toBe(false);
    expect(breakerTripped(0, 5, 5)).toBe(true);
    expect(breakerTripped(0, 66, 5)).toBe(true);
  });

  it("never trips once something has been captured", () => {
    // The whole point of the `captured === 0` condition: if the Senado
    // answered even once, it is reachable, and a later run of failures is
    // about those endpoints, not about the connection.
    expect(breakerTripped(1, 100, 5)).toBe(false);
  });

  it("defaults to the documented streak limit", () => {
    expect(DEFAULT_TRANSPORT_STREAK_LIMIT).toBe(5);
    expect(breakerTripped(0, DEFAULT_TRANSPORT_STREAK_LIMIT)).toBe(true);
    expect(breakerTripped(0, DEFAULT_TRANSPORT_STREAK_LIMIT - 1)).toBe(false);
  });
});

describe("MissingDependencyError", () => {
  it("names the capture it was waiting on", () => {
    const err = new MissingDependencyError("senador-lista-atual");
    expect(err.dependsOn).toBe("senador-lista-atual");
    expect(err.name).toBe("MissingDependencyError");
    expect(err).toBeInstanceOf(Error);
  });
});

describe("exit code", () => {
  it("keeps the unreachable code distinct from the generic failure", () => {
    // The workflow branches on this: 3 means "drift was not measured",
    // 1 means "captures failed for reasons that are not the connection".
    expect(EXIT_UPSTREAM_UNREACHABLE).toBe(3);
    expect(EXIT_UPSTREAM_UNREACHABLE).not.toBe(1);
  });
});
