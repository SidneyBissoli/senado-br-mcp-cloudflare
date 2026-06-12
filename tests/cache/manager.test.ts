import { describe, it, expect, vi, beforeEach } from "vitest";
import { hashParams, cachedFetch } from "../../src/cache/manager.js";
import * as l0 from "../../src/cache/l0-memory.js";
import * as l1 from "../../src/cache/l1-cache-api.js";
import { CACHE_DYNAMIC } from "../../src/types.js";

vi.mock("../../src/cache/l1-cache-api.js", () => ({
  l1Get: vi.fn(),
  l1Set: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/metrics.js", () => ({
  incr: vi.fn(),
}));

describe("hashParams", () => {
  it("returns a hex string", async () => {
    const hash = await hashParams({ a: 1 });
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it("produces consistent results for same input", async () => {
    const h1 = await hashParams({ x: "hello", y: 42 });
    const h2 = await hashParams({ x: "hello", y: 42 });
    expect(h1).toBe(h2);
  });

  it("is order-independent (sorted keys)", async () => {
    const h1 = await hashParams({ b: 2, a: 1 });
    const h2 = await hashParams({ a: 1, b: 2 });
    expect(h1).toBe(h2);
  });

  it("different params produce different hashes", async () => {
    const h1 = await hashParams({ a: 1 });
    const h2 = await hashParams({ a: 2 });
    expect(h1).not.toBe(h2);
  });
});

describe("cachedFetch", () => {
  beforeEach(() => {
    l0._resetStore();
    vi.clearAllMocks();
    vi.mocked(l1.l1Get).mockResolvedValue(undefined);
    vi.mocked(l1.l1Set).mockResolvedValue(undefined);
  });

  it("calls fetcher on complete miss and populates both caches", async () => {
    const fetcher = vi.fn().mockResolvedValue({ data: "fresh" });
    const result = await cachedFetch("test_tool", { key: "val" }, CACHE_DYNAMIC, fetcher);

    expect(result).toEqual({ data: "fresh" });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(l1.l1Set).toHaveBeenCalledOnce();
  });

  it("returns L0 hit without calling L1 or fetcher", async () => {
    // Pre-populate L0
    const paramsHash = await hashParams({ key: "val" });
    l0.l0Set(`test_l0:${paramsHash}`, { data: "l0-cached" }, 60);

    const fetcher = vi.fn();
    const result = await cachedFetch("test_l0", { key: "val" }, CACHE_DYNAMIC, fetcher);

    expect(result).toEqual({ data: "l0-cached" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(l1.l1Get).not.toHaveBeenCalled();
  });

  it("returns L1 hit when L0 misses, populates L0", async () => {
    vi.mocked(l1.l1Get).mockResolvedValue(JSON.stringify({ data: "l1-cached" }));
    const fetcher = vi.fn();

    const result = await cachedFetch("test_l1", { key: "val" }, CACHE_DYNAMIC, fetcher);

    expect(result).toEqual({ data: "l1-cached" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(l1.l1Get).toHaveBeenCalledOnce();
  });

  it("falls through corrupted L1 to fetcher", async () => {
    vi.mocked(l1.l1Get).mockResolvedValue("not valid json{{{");
    const fetcher = vi.fn().mockResolvedValue({ data: "fresh" });

    const result = await cachedFetch("test_corrupt", { key: "val" }, CACHE_DYNAMIC, fetcher);

    expect(result).toEqual({ data: "fresh" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
