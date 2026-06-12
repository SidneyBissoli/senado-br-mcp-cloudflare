import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { TokenBucket, getClientBucket } from "../../src/throttle/token-bucket.js";

describe("TokenBucket", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with full tokens", () => {
    const bucket = new TokenBucket(10, 5);
    // Should be able to consume up to maxTokens
    for (let i = 0; i < 10; i++) {
      expect(bucket.tryConsume()).toBe(true);
    }
    expect(bucket.tryConsume()).toBe(false);
  });

  it("rejects when empty", () => {
    const bucket = new TokenBucket(1, 1);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });

  it("refills over time", () => {
    const bucket = new TokenBucket(5, 2); // 2 tokens/sec
    // Drain all
    for (let i = 0; i < 5; i++) bucket.tryConsume();
    expect(bucket.tryConsume()).toBe(false);

    // Advance 1 second -> 2 tokens refilled
    vi.advanceTimersByTime(1000);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });

  it("does not exceed maxTokens on refill", () => {
    const bucket = new TokenBucket(3, 10); // 10/sec but max 3
    // Wait a long time
    vi.advanceTimersByTime(10_000);
    // Should only have 3 tokens max
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });

  it("consumes multiple tokens at once", () => {
    const bucket = new TokenBucket(10, 5);
    expect(bucket.tryConsume(5)).toBe(true);
    expect(bucket.tryConsume(5)).toBe(true);
    expect(bucket.tryConsume(1)).toBe(false);
  });

  it("rejects if count exceeds available", () => {
    const bucket = new TokenBucket(3, 1);
    expect(bucket.tryConsume(4)).toBe(false);
  });

  it("partial refill works correctly", () => {
    const bucket = new TokenBucket(10, 2); // 2/sec
    for (let i = 0; i < 10; i++) bucket.tryConsume();

    // Advance 500ms -> 1 token
    vi.advanceTimersByTime(500);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });
});

describe("getClientBucket", () => {
  it("returns same bucket for same clientId", () => {
    const b1 = getClientBucket("client-a");
    const b2 = getClientBucket("client-a");
    expect(b1).toBe(b2);
  });

  it("returns different buckets for different clientIds", () => {
    const b1 = getClientBucket("client-x");
    const b2 = getClientBucket("client-y");
    expect(b1).not.toBe(b2);
  });
});
