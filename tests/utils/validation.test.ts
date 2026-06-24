import { describe, it, expect, vi } from "vitest";
import { toolError, toolResult, buildParams, dig, ensureArray } from "../../src/utils/validation.js";

vi.mock("../../src/metrics.js", () => ({
  incr: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("toolError", () => {
  it("returns error structure with message", () => {
    const result = toolError("something broke");
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.error).toBe("something broke");
    expect(parsed.retryable).toBe(false);
  });

  it("marks retryable when specified", () => {
    const result = toolError("rate limited", true);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.retryable).toBe(true);
  });

  it("content type is text", () => {
    const result = toolError("fail");
    expect(result.content[0].type).toBe("text");
  });

  it("includes an actionable hint that differs by retryability", () => {
    const transient = JSON.parse(toolError("oops", true).content[0].text);
    const permanent = JSON.parse(toolError("oops", false).content[0].text);
    expect(typeof transient.hint).toBe("string");
    expect(transient.hint.length).toBeGreaterThan(0);
    expect(transient.hint).not.toBe(permanent.hint);
    expect(transient.hint).toMatch(/repita|segundos/i);
  });

  it("honors an explicit hint override", () => {
    const parsed = JSON.parse(toolError("oops", false, "dica custom").content[0].text);
    expect(parsed.hint).toBe("dica custom");
  });

  it("mirrors the payload in structuredContent for deterministic parsing", () => {
    const result = toolError("broke", true) as unknown as {
      structuredContent: Record<string, unknown>;
      content: { text: string }[];
    };
    expect(result.structuredContent).toEqual(JSON.parse(result.content[0].text));
    expect(result.structuredContent).toMatchObject({ error: "broke", retryable: true });
    expect(result.structuredContent.hint).toBeTruthy();
  });
});

describe("toolResult", () => {
  it("wraps data as pretty JSON", () => {
    const data = { foo: 1, bar: "baz" };
    const result = toolResult(data);
    expect((result as any).isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual(data);
  });

  it("handles arrays", () => {
    const result = toolResult([1, 2, 3]);
    expect(JSON.parse(result.content[0].text)).toEqual([1, 2, 3]);
  });

  it("handles null", () => {
    const result = toolResult(null);
    expect(JSON.parse(result.content[0].text)).toBeNull();
  });

  it("content type is text", () => {
    const result = toolResult({ x: 1 });
    expect(result.content[0].type).toBe("text");
  });
});

describe("buildParams", () => {
  it("converts values to strings", () => {
    expect(buildParams({ a: 1, b: "two" })).toEqual({ a: "1", b: "two" });
  });

  it("omits undefined values", () => {
    expect(buildParams({ a: 1, b: undefined })).toEqual({ a: "1" });
  });

  it("omits null values", () => {
    expect(buildParams({ a: "x", b: null })).toEqual({ a: "x" });
  });

  it("omits empty strings", () => {
    expect(buildParams({ a: "x", b: "" })).toEqual({ a: "x" });
  });

  it("keeps falsy but valid values like 0 and false", () => {
    expect(buildParams({ a: 0, b: false })).toEqual({ a: "0", b: "false" });
  });

  it("returns empty object for all-undefined input", () => {
    expect(buildParams({ a: undefined, b: null, c: "" })).toEqual({});
  });
});

describe("dig", () => {
  it("traverses nested objects", () => {
    const obj = { a: { b: { c: 42 } } };
    expect(dig(obj, "a", "b", "c")).toBe(42);
  });

  it("returns undefined for missing keys", () => {
    expect(dig({ a: 1 }, "b")).toBeUndefined();
  });

  it("returns undefined for null in chain", () => {
    expect(dig({ a: null }, "a", "b")).toBeUndefined();
  });

  it("returns undefined for non-object in chain", () => {
    expect(dig({ a: 42 }, "a", "b")).toBeUndefined();
  });

  it("returns root with no keys", () => {
    const obj = { a: 1 };
    expect(dig(obj)).toEqual({ a: 1 });
  });

  it("handles undefined root", () => {
    expect(dig(undefined, "a")).toBeUndefined();
  });

  it("handles null root", () => {
    expect(dig(null, "a")).toBeUndefined();
  });
});

describe("ensureArray", () => {
  it("wraps a single value in an array", () => {
    expect(ensureArray(42)).toEqual([42]);
  });

  it("passes through an existing array", () => {
    expect(ensureArray([1, 2])).toEqual([1, 2]);
  });

  it("returns empty array for undefined", () => {
    expect(ensureArray(undefined)).toEqual([]);
  });

  it("returns empty array for null", () => {
    expect(ensureArray(null)).toEqual([]);
  });
});
