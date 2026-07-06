import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatDateYMD, resolveComissaoCodigo } from "../../src/tools/comissoes.js";
import { digArrayRoot } from "../../src/utils/upstream-parse.js";
import { safeInt } from "../../src/utils/validation.js";

describe("obter_comissao membros (BUG-030)", () => {
  // With ?ativas=S the endpoint answers under ComposicaoAtivaComissaoSf; the item carries
  // CodigoMembro/NomeMembro (was read as CodigoParlamentar under UltimaComposicao... -> empty).
  it("resolves members at the ComposicaoAtivaComissaoSf root and maps CodigoMembro", () => {
    const response = {
      ComposicaoAtivaComissaoSf: {
        ComposicaoComissao: {
          Membros: {
            Membro: [
              { NomeMembro: "Alan Rick", CodigoMembro: "5672", TipoVaga: "Suplente", IndicadorVagaAtiva: "Sim", DataInicioMembroVaga: "2026-04-07" },
            ],
          },
        },
      },
    };
    const membros = digArrayRoot(
      response,
      [["ComposicaoAtivaComissaoSf", "ComposicaoComissao", "Membros", "Membro"]],
      "t",
    ).map((m: any) => ({
      codigo: safeInt(m.CodigoMembro || m.CodigoParlamentar) || null,
      nome: m.NomeMembro || "",
      tipoVaga: m.TipoVaga || null,
      ativo: m.IndicadorVagaAtiva === "Sim",
      dataInicio: m.DataInicioMembroVaga || null,
    }));
    expect(membros).toHaveLength(1);
    expect(membros[0].codigo).toBe(5672);
    expect(membros[0].nome).toBe("Alan Rick");
    expect(membros[0].tipoVaga).toBe("Suplente");
    expect(membros[0].ativo).toBe(true);
  });
});

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
