/**
 * Contract v1.3 `derived` across the whole class of server computations (3.19.0).
 *
 * Until 3.18.5 only the `estatisticas` modes said they were computed; every other aggregate the
 * server builds (CEAPS `valorTotal` and the por-senador/por-tipo/por-mes/por-fornecedor modes,
 * the budget por-ano/por-grupo/… sums, the payroll `bruto`, the plenary tally counted from
 * nominal votes, the e-Cidadania percentages and rankings, the estimated idea date…) went out
 * looking like the source's own number. The repo does not mock fetch, so each tool decides its
 * block in an exported pure function and these tests drive those functions: the note where the
 * server computed, and NO `derived` where the number is the source's.
 */
import { describe, it, expect } from "vitest";
import {
  provenanceFor,
  provenanceEcidadania,
  provenanceArquimedesVotos,
  provenanceFooter,
  resultWithProvenance,
  derivado,
  derivadoSe,
  derivadoDeEstatisticas,
  NOTA_DERIVACAO_ESTATISTICAS,
  NOTA_DERIVACAO_SOMAS,
  NOTA_DERIVACAO_BRUTO,
  NOTA_DERIVACAO_PLACAR,
  NOTA_DERIVACAO_PLACAR_COMISSAO,
  NOTA_DERIVACAO_PERCENTUAIS,
  NOTA_DERIVACAO_RANKING_ECIDADANIA,
  NOTA_DERIVACAO_DATA_ESTIMADA,
  NOTA_DERIVACAO_LEGISLATURA,
  NOTA_DERIVACAO_LEGISLATURA_PADRAO,
  NOTA_DERIVACAO_SUBORDINADAS,
  type Provenance,
} from "../../src/utils/provenance.js";
import { provenanceDaExecucao } from "../../src/tools/orcamento-senado.js";
import { provenanceDoCeaps } from "../../src/tools/senadores-admin.js";
import {
  provenanceDaRemuneracao,
  provenanceDasHorasExtras,
  provenanceServidoresSubordinadas,
} from "../../src/tools/servidores.js";
import { provenanceDaVotacao, parseVotacaoItem } from "../../src/tools/votacoes.js";
import {
  parseVotacaoComissao,
  placarDaComissao,
  provenanceDaVotacaoComissao,
} from "../../src/tools/votacao-comissao.js";
import { provenanceDaDistribuicao } from "../../src/tools/comissoes.js";
import { provenanceDaLegislatura } from "../../src/tools/referencia.js";
import {
  NOTA_DERIVACAO_ANALISE_CONSULTAS,
  provenanceDasConsultas,
  provenanceDaAnaliseDeConsultas,
  provenanceDasIdeias,
  provenanceDosVotosHistoricos,
  provenanceSugestaoEnquete,
} from "../../src/tools/ecidadania.js";

const adm = (): Provenance =>
  provenanceFor("SENADO_ADM", "https://adm", "/api/v1/x", { dataset_id: "x", retrieved_at: "2026-10-15T12:00:00Z" });
const legis = (): Provenance =>
  provenanceFor("SENADO_LEGIS", "https://legis", "/votacao", { retrieved_at: "2026-10-15T12:00:00Z" });

const marcado = (p: Provenance, nota: string) => {
  expect(p.derived).toBe(true);
  expect(p.derivation_note).toBe(nota);
};
const limpo = (p: Provenance) => {
  const sc = resultWithProvenance({ ok: true }, p).structuredContent.provenance as Record<string, unknown>;
  expect(sc).not.toHaveProperty("derived");
  expect(sc).not.toHaveProperty("derivation_note");
};

describe("derivado / derivadoSe: the generic marker", () => {
  it("derivado puts derived + the given note on the wire and in the footer", () => {
    const p = derivado(adm(), NOTA_DERIVACAO_SOMAS);
    const sc = resultWithProvenance({ ok: true }, p).structuredContent.provenance as Record<string, unknown>;
    expect(sc.derived).toBe(true);
    expect(sc.derivation_note).toBe(NOTA_DERIVACAO_SOMAS);
    expect(provenanceFooter(p)).toContain(NOTA_DERIVACAO_SOMAS);
  });

  it("derivadoSe(false) returns the block untouched", () => {
    const p = adm();
    expect(derivadoSe(p, false, NOTA_DERIVACAO_SOMAS)).toBe(p);
    limpo(derivadoSe(p, false, NOTA_DERIVACAO_SOMAS));
  });

  it("derivadoDeEstatisticas is derivado with the statistics note (unchanged)", () => {
    marcado(derivadoDeEstatisticas(adm()), NOTA_DERIVACAO_ESTATISTICAS);
  });

  it("every note is a distinct, readable sentence (no raw field names)", () => {
    const notas = [
      NOTA_DERIVACAO_SOMAS, NOTA_DERIVACAO_BRUTO, NOTA_DERIVACAO_PLACAR, NOTA_DERIVACAO_PLACAR_COMISSAO,
      NOTA_DERIVACAO_PERCENTUAIS, NOTA_DERIVACAO_RANKING_ECIDADANIA, NOTA_DERIVACAO_DATA_ESTIMADA,
      NOTA_DERIVACAO_LEGISLATURA, NOTA_DERIVACAO_LEGISLATURA_PADRAO, NOTA_DERIVACAO_SUBORDINADAS,
    ];
    expect(new Set(notas).size).toBe(notas.length);
    for (const n of notas) expect(n).not.toMatch(/[a-z][A-Z]|`|_/);
  });
});

describe("administrative aggregates (adm API)", () => {
  it("execução orçamentária: every aggregate mode (por-ano is the default) is derived; detalhe is not", () => {
    for (const modo of ["por-ano", "por-acao", "por-grupo", "por-fonte", "por-origem"]) {
      marcado(provenanceDaExecucao(adm(), modo), NOTA_DERIVACAO_SOMAS);
    }
    limpo(provenanceDaExecucao(adm(), "detalhe"));
  });

  it("CEAPS outside estatisticas is always derived: valorTotal is the server's sum in every mode", () => {
    marcado(provenanceDoCeaps(adm()), NOTA_DERIVACAO_SOMAS);
  });

  it("remunerações: detalhe names the bruto sum; resumo (default) names the group sums AND the bruto", () => {
    marcado(provenanceDaRemuneracao(adm(), "detalhe"), NOTA_DERIVACAO_BRUTO);
    const r = provenanceDaRemuneracao(adm(), "resumo");
    expect(r.derived).toBe(true);
    expect(r.derivation_note).toContain(NOTA_DERIVACAO_SOMAS);
    expect(r.derivation_note).toContain(NOTA_DERIVACAO_BRUTO);
  });

  it("horas extras outside estatisticas: valorTotal is the server's sum", () => {
    marcado(provenanceDasHorasExtras(adm()), NOTA_DERIVACAO_SOMAS);
  });

  it("servidores sob uma unidade: derived on top of field_sources, which survive", () => {
    const p = provenanceServidoresSubordinadas(adm(), "ativos", false);
    marcado(p, NOTA_DERIVACAO_SUBORDINADAS);
    expect(p.field_sources).toHaveLength(2);
  });
});

describe("plenary tally: derived only when counted from nominal votes", () => {
  const votos = [
    { siglaVotoParlamentar: "Sim" }, { siglaVotoParlamentar: "Sim" }, { siglaVotoParlamentar: "Não" },
  ];

  it("source totals are copied and do not mark the block", () => {
    const v = parseVotacaoItem({ totalVotosSim: 50, totalVotosNao: 10, totalVotosAbstencao: 1, votos }, true);
    expect(v.placarComputado).toBeUndefined();
    limpo(provenanceDaVotacao(legis(), [v]));
  });

  it("an open roll call (null totals, votos present) is counted and marks the block", () => {
    const v = parseVotacaoItem({ totalVotosSim: null, totalVotosNao: null, totalVotosAbstencao: null, votos }, true);
    expect(v.placarComputado).toBe(true);
    marcado(provenanceDaVotacao(legis(), [v]), NOTA_DERIVACAO_PLACAR);
  });

  it("a list marks the block when ANY item was counted", () => {
    marcado(provenanceDaVotacao(legis(), [{}, { placarComputado: true }]), NOTA_DERIVACAO_PLACAR);
    limpo(provenanceDaVotacao(legis(), [{}, {}]));
  });
});

describe("committee tally: the source's totals win; recount only when absent", () => {
  // Measured live on 15/10/2026 at the CCJ: 395 votes, all with TotalVotos*; 5 differ from the
  // recount (repeated nominal list; an "A" vote the source does not count as abstention).
  const votoDuplicado = (q: string) => ({ CodigoParlamentar: "1", NomeParlamentar: "X", QualidadeVoto: q });

  it("copies TotalVotosSim/Nao/Abstencao even when the nominal list says otherwise", () => {
    const r = parseVotacaoComissao({
      Votacao: {
        CodigoVotacao: "28922",
        TotalVotosSim: "12",
        TotalVotosNao: "13",
        TotalVotosAbstencao: "0",
        Votos: { Voto: [votoDuplicado("S"), votoDuplicado("S"), votoDuplicado("N"), votoDuplicado("A")] },
      },
    });
    expect([r.totalSim, r.totalNao, r.totalAbstencao]).toEqual([12, 13, 0]);
    expect(r.placarComputado).toBeUndefined();
    limpo(provenanceDaVotacaoComissao(legis(), [r]));
  });

  it("counts from the votes only when all three totals are missing, and says so", () => {
    const r = parseVotacaoComissao({ Votacao: { Votos: { Voto: [votoDuplicado("S"), votoDuplicado("N")] } } });
    expect([r.totalSim, r.totalNao, r.totalAbstencao]).toEqual([1, 1, 0]);
    expect(r.placarComputado).toBe(true);
    marcado(provenanceDaVotacaoComissao(legis(), [r]), NOTA_DERIVACAO_PLACAR_COMISSAO);
  });

  it("placarDaComissao: a partial publication still counts as the source's (missing ones = 0)", () => {
    expect(placarDaComissao({ TotalVotosSim: "7" }, { sim: 9, nao: 9, abstencao: 9 })).toEqual({
      totalSim: 7,
      totalNao: 0,
      totalAbstencao: 0,
    });
  });
});

describe("legislative aggregates", () => {
  it("distribuição de matérias: relatoria sums Quantidade per parlamentar (derived); autoria is the source's", () => {
    marcado(provenanceDaDistribuicao(legis(), "relatoria"), NOTA_DERIVACAO_SOMAS);
    limpo(provenanceDaDistribuicao(legis(), "autoria"));
  });

  it("legislatura atual: the period is always computed; the fallback says the number is assumed", () => {
    const comNumero = [{ Mandato: { PrimeiraLegislaturaDoMandato: { NumeroLegislatura: "57" } } }];
    marcado(provenanceDaLegislatura(legis(), comNumero), NOTA_DERIVACAO_LEGISLATURA);
    marcado(provenanceDaLegislatura(legis(), []), NOTA_DERIVACAO_LEGISLATURA_PADRAO);
  });
});

describe("e-Cidadania", () => {
  const ec = () => provenanceEcidadania("/principalmateria", { dataset_id: "consultas", retrieved_at: "2026-10-15T12:00:00Z" });

  it("consultas (list and detail) carry server-computed percentages", () => {
    marcado(provenanceDasConsultas(ec()), NOTA_DERIVACAO_PERCENTUAIS);
  });

  it("the analysis names both the ranking metric and the percentages", () => {
    marcado(provenanceDaAnaliseDeConsultas(ec()), NOTA_DERIVACAO_ANALISE_CONSULTAS);
    expect(NOTA_DERIVACAO_ANALISE_CONSULTAS).toContain(NOTA_DERIVACAO_RANKING_ECIDADANIA);
    expect(NOTA_DERIVACAO_ANALISE_CONSULTAS).toContain(NOTA_DERIVACAO_PERCENTUAIS);
  });

  it("the poll suggestion is derived on top of its two corpus sub-sources", () => {
    const p = provenanceSugestaoEnquete({ lastScrapedAt: "2026-10-15T10:00:00Z" }, { lastScrapedAt: "2026-10-14T10:00:00Z" });
    marcado(p, NOTA_DERIVACAO_ANALISE_CONSULTAS);
    expect(p.field_sources).toHaveLength(2);
  });

  it("ideias: derived when some idea carries the estimated creation date, not otherwise", () => {
    marcado(provenanceDasIdeias(ec(), [{ dataCriacaoEstimada: "2026-01-01" }]), NOTA_DERIVACAO_DATA_ESTIMADA);
    limpo(provenanceDasIdeias(ec(), [{ dataCriacaoEstimada: null }]));
    limpo(provenanceDasIdeias(ec(), []));
  });

  it("the historical archive: national totals are summed from the per-UF rows", () => {
    marcado(provenanceDosVotosHistoricos(provenanceArquimedesVotos({})), NOTA_DERIVACAO_SOMAS);
  });
});
