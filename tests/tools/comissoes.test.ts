import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatDateYMD, resolveComissaoCodigo } from "../../src/tools/comissoes.js";
import { digArrayRoot } from "../../src/utils/upstream-parse.js";
import { safeInt, toBool } from "../../src/utils/validation.js";

describe("reuniao_comissao (BUG-014/BUG-015)", () => {
  // Real reuniao 14786 (CCJ): realizada/secreta come as strings "true"/"false"; pauta item
  // identification/ementa/relatoria live under item.nome/item.doma/item.siglaRelatorio.
  it("coerces string booleans realizada/secreta (BUG-015)", () => {
    // Upstream sends "true"/"false" strings; strict === true/=== "S" yielded false.
    const realizada = (v: unknown) => toBool(v) || v === "S";
    expect(realizada("true")).toBe(true);
    expect(realizada("false")).toBe(false);
    expect(realizada("S")).toBe(true); // legacy path preserved
  });

  it("maps pauta item fields from nome/doma/siglaRelatorio (BUG-014)", () => {
    const i = {
      nome: "PL 3085/2026",
      siglaRelatorio: "Pela aprova\u00e7\u00e3o com emendas",
      resultado: { descricao: "Aprovado com emendas", texto: "Aprovado o Projeto..." },
      doma: { ementa: "Regulamenta o regime de relev\u00e2ncia...", autoria: "Senador Davi Alcolumbre (UNI\u00c3O/AP)", idProcesso: "9064334" },
    };
    const mapped = {
      identificacao: i.nome || (i as any).nomeFormatadoComOrdem || (i as any).descricao || null,
      ementa: i.doma?.ementa || (i as any).ementa || null,
      autoria: i.doma?.autoria || null,
      relatoria: i.siglaRelatorio || (i as any).relatorio || null,
      resultado:
        (i.resultado && typeof i.resultado === "object" ? i.resultado.descricao : i.resultado) ||
        (i as any).descricaoResultado || null,
      codigoMateria: safeInt(i.doma?.idProcesso) || null,
    };
    expect(mapped.identificacao).toBe("PL 3085/2026");
    expect(mapped.ementa).toContain("Regulamenta");
    expect(mapped.autoria).toContain("Davi Alcolumbre");
    expect(mapped.relatoria).toBe("Pela aprova\u00e7\u00e3o com emendas");
    expect(mapped.resultado).toBe("Aprovado com emendas"); // object -> descricao string
    expect(mapped.codigoMateria).toBe(9064334);
  });
});

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
