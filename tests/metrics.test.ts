import { describe, it, expect, beforeEach } from "vitest";
import { incr, getMetrics, _resetMetrics } from "../src/metrics.js";

describe("metrics", () => {
  beforeEach(() => {
    _resetMetrics();
  });

  it("all counters start at 0", () => {
    const m = getMetrics();
    expect(m.requests).toBe(0);
    expect(m.errors).toBe(0);
    expect(m.authFailures).toBe(0);
    expect(m.cacheL0Hits).toBe(0);
    expect(m.cacheL1Hits).toBe(0);
    expect(m.cacheMisses).toBe(0);
    expect(m.upstreamCalls).toBe(0);
    expect(m.upstreamErrors).toBe(0);
    expect(m.upstreamRetries).toBe(0);
    expect(m.toolCalls).toBe(0);
    expect(m.toolErrors).toBe(0);
  });

  it("incr increments counter by 1 by default", () => {
    incr("requests");
    expect(getMetrics().requests).toBe(1);
  });

  it("incr increments counter by custom amount", () => {
    incr("upstreamRetries", 5);
    expect(getMetrics().upstreamRetries).toBe(5);
  });

  it("multiple increments accumulate", () => {
    incr("toolCalls");
    incr("toolCalls");
    incr("toolCalls");
    expect(getMetrics().toolCalls).toBe(3);
  });

  it("getMetrics returns snapshot with ts field", () => {
    const m = getMetrics();
    expect(m).toHaveProperty("ts");
    expect(typeof m.ts).toBe("string");
    // ISO date format
    expect(() => new Date(m.ts)).not.toThrow();
  });

  it("getMetrics returns a copy (not a reference)", () => {
    incr("requests");
    const m1 = getMetrics();
    incr("requests");
    const m2 = getMetrics();
    expect(m1.requests).toBe(1);
    expect(m2.requests).toBe(2);
  });

  it("_resetMetrics zeroes all counters", () => {
    incr("requests", 10);
    incr("errors", 5);
    incr("cacheL0Hits", 3);
    _resetMetrics();
    const m = getMetrics();
    expect(m.requests).toBe(0);
    expect(m.errors).toBe(0);
    expect(m.cacheL0Hits).toBe(0);
  });

  it("independent counters do not affect each other", () => {
    incr("cacheL0Hits", 10);
    incr("cacheMisses", 3);
    expect(getMetrics().cacheL0Hits).toBe(10);
    expect(getMetrics().cacheMisses).toBe(3);
    expect(getMetrics().cacheL1Hits).toBe(0);
  });
});
