import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatDateYMD,
  resolveComissaoCodigo,
  buildRequerimentosCpiResult,
  REQUERIMENTOS_CPI_AVISO_VAZIO,
} from "../../src/tools/comissoes.js";
import { digArrayRoot } from "../../src/utils/upstream-parse.js";
import { safeInt, toBool, normalizeText } from "../../src/utils/validation.js";

describe("listar_comissoes mista (BUG-029)", () => {
  // No DescricaoTipoColegiado is "mista"; the mistas are identified by "Mista" in the name.
  it("selects committees with 'Mista' in the name", () => {
    const cols = [
      { sigla: "CMO", nome: "Comissão Mista de Planos, Orçamentos Públicos e Fiscalização" },
      { sigla: "CCAI", nome: "Comissão Mista de Controle das Atividades de Inteligência" },
      { sigla: "CCJ", nome: "Comissão de Constituição, Justiça e Cidadania" },
    ];
    const mistas = cols.filter((c) => normalizeText(c.nome).includes("mista"));
    expect(mistas.map((c) => c.sigla)).toEqual(["CMO", "CCAI"]);
  });
});

describe("distribuicao relatoria aggregation (BUG-031)", () => {
  // Upstream emits one row per (parlamentar, unidade); aggregate by CodigoParlamentar.
  it("aggregates duplicate CodigoParlamentar and strips the honorific", () => {
    const rows = [
      { CodigoParlamentar: "5783", Parlamentar: "Senadora Zenaide Maia", Quantidade: "2" },
      { CodigoParlamentar: "5783", Parlamentar: "Senadora Zenaide Maia", Quantidade: "1" },
      { CodigoParlamentar: "5385", Parlamentar: "Senador Irajá", Quantidade: "1" },
    ];
    const acc = new Map<string, any>();
    for (const x of rows) {
      const codigo = parseInt(x.CodigoParlamentar) || null;
      const key = String(codigo);
      const qtd = parseInt(x.Quantidade);
      if (acc.has(key)) acc.get(key).quantidade += qtd;
      else acc.set(key, { codigo, nome: x.Parlamentar.replace(/^Senador(a)?\s+/i, "").trim(), quantidade: qtd });
    }
    const agg = [...acc.values()];
    expect(agg).toHaveLength(2);
    expect(agg[0]).toEqual({ codigo: 5783, nome: "Zenaide Maia", quantidade: 3 });
    expect(agg[1].nome).toBe("Irajá");
  });
});

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

describe("requerimentos_cpi aviso (OBS-7 / pendência #3)", () => {
  // Upstream frequently returns an empty body even for active CPIs, and there is no clean
  // alternative source in the API. When the list is empty we attach an explicit `aviso`
  // so an empty result is not read as "the CPI has no requerimentos".
  it("attaches aviso when the list is empty", () => {
    const r = buildRequerimentosCpiResult("CPIPED", 0, []);
    expect(r.count).toBe(0);
    expect(r.requerimentos).toEqual([]);
    expect(r.aviso).toBe(REQUERIMENTOS_CPI_AVISO_VAZIO);
    expect(r.siglaCpi).toBe("CPIPED");
    expect(r.pagina).toBe(0);
  });

  it("omits aviso when there are requerimentos", () => {
    const r = buildRequerimentosCpiResult("CPIVD", 1, [{ numero: "REQ 1/2026" }]);
    expect(r.count).toBe(1);
    expect(r.aviso).toBeUndefined();
    expect(r.pagina).toBe(1);
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
