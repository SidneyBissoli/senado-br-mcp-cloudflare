import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { l0Get, l0Set, _resetStore, MAX_L0_ENTRIES } from "../../src/cache/l0-memory.js";

describe("L0 in-memory cache", () => {
  beforeEach(() => {
    _resetStore();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns undefined for missing key", () => {
    expect(l0Get("nonexistent")).toBeUndefined();
  });

  it("stores and retrieves a value", () => {
    l0Set("key1", { data: 42 }, 60);
    expect(l0Get("key1")).toEqual({ data: 42 });
  });

  it("expires entries after TTL", () => {
    l0Set("key1", "value", 10);
    expect(l0Get("key1")).toBe("value");

    vi.advanceTimersByTime(11_000);
    expect(l0Get("key1")).toBeUndefined();
  });

  it("does not expire before TTL", () => {
    l0Set("key1", "value", 10);
    vi.advanceTimersByTime(9_000);
    expect(l0Get("key1")).toBe("value");
  });

  it("evicts oldest entry when at capacity", () => {
    for (let i = 0; i < MAX_L0_ENTRIES; i++) {
      l0Set(`key-${i}`, i, 60);
    }
    // All entries present
    expect(l0Get(`key-0`)).toBe(0);

    // Adding one more should evict key-0 (first inserted)
    l0Set("overflow", "new", 60);
    expect(l0Get("key-0")).toBeUndefined();
    expect(l0Get("overflow")).toBe("new");
    expect(l0Get(`key-1`)).toBe(1);
  });

  it("overwrites existing key", () => {
    l0Set("key1", "old", 60);
    l0Set("key1", "new", 60);
    expect(l0Get("key1")).toBe("new");
  });

  it("handles different value types", () => {
    l0Set("str", "hello", 60);
    l0Set("num", 123, 60);
    l0Set("arr", [1, 2], 60);
    l0Set("obj", { a: 1 }, 60);

    expect(l0Get("str")).toBe("hello");
    expect(l0Get("num")).toBe(123);
    expect(l0Get("arr")).toEqual([1, 2]);
    expect(l0Get("obj")).toEqual({ a: 1 });
  });
});
