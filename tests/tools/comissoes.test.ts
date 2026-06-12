import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatDateYMD, resolveComissaoCodigo } from "../../src/tools/comissoes.js";

// Mock the cache and upstream modules
vi.mock("../../src/cache/manager.js", () => ({
  cachedFetch: vi.fn(),
}));

vi.mock("../../src/throttle/upstream.js", () => ({
  upstreamFetch: vi.fn(),
}));

import { cachedFetch } from "../../src/cache/manager.js";

describe("formatDateYMD", () => {
  it("formats date as YYYYMMDD", () => {
    const d = new Date(2024, 2, 15); // March 15
    expect(formatDateYMD(d)).toBe("20240315");
  });

  it("zero-pads month and day", () => {
    const d = new Date(2024, 0, 5); // Jan 5
    expect(formatDateYMD(d)).toBe("20240105");
  });

  it("handles December 31", () => {
    const d = new Date(2024, 11, 31);
    expect(formatDateYMD(d)).toBe("20241231");
  });

  it("handles first day of year", () => {
    const d = new Date(2024, 0, 1);
    expect(formatDateYMD(d)).toBe("20240101");
  });
});

describe("resolveComissaoCodigo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves sigla to numeric code", async () => {
    vi.mocked(cachedFetch).mockResolvedValue({
      ListaColegiados: {
        Colegiados: {
          Colegiado: [
            { Sigla: "CCJ", Codigo: "47" },
            { Sigla: "CAE", Codigo: "55" },
          ],
        },
      },
    });
    const code = await resolveComissaoCodigo("CCJ", "https://base");
    expect(code).toBe(47);
  });

  it("is case-insensitive", async () => {
    vi.mocked(cachedFetch).mockResolvedValue({
      ListaColegiados: {
        Colegiados: {
          Colegiado: [{ Sigla: "CCJ", Codigo: "47" }],
        },
      },
    });
    const code = await resolveComissaoCodigo("ccj", "https://base");
    expect(code).toBe(47);
  });

  it("returns null for unknown sigla", async () => {
    vi.mocked(cachedFetch).mockResolvedValue({
      ListaColegiados: {
        Colegiados: {
          Colegiado: [{ Sigla: "CCJ", Codigo: "47" }],
        },
      },
    });
    const code = await resolveComissaoCodigo("XYZ", "https://base");
    expect(code).toBeNull();
  });

  it("handles single colegiado (not array)", async () => {
    vi.mocked(cachedFetch).mockResolvedValue({
      ListaColegiados: {
        Colegiados: {
          Colegiado: { Sigla: "CAE", Codigo: "55" },
        },
      },
    });
    const code = await resolveComissaoCodigo("CAE", "https://base");
    expect(code).toBe(55);
  });
});
