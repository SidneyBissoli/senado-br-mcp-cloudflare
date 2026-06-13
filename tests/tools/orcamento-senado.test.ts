import { describe, it, expect } from "vitest";
import { parseValorBR, parseDespesa, parseReceita, agregarDespesas } from "../../src/tools/orcamento-senado.js";

describe("parseValorBR", () => {
  it("parses Brazilian decimal strings", () => {
    expect(parseValorBR("10800,00")).toBe(10800);
    expect(parseValorBR("1.234.567,89")).toBe(1234567.89);
  });

  it("passes numbers through and zeroes invalid input", () => {
    expect(parseValorBR(42.5)).toBe(42.5);
    expect(parseValorBR("abc")).toBe(0);
    expect(parseValorBR(null)).toBe(0);
  });
});

describe("parseDespesa", () => {
  it("normalizes a despesa item", () => {
    const result = parseDespesa({
      "exercício_financeiro_lan_ef": 2026,
      acao_codigo: "00PW",
      acao_nome: "CONTRIBUICOES REGULARES",
      plano_orcamentario_nome: "CONTRIBUICAO ABEL",
      grupo_despesa_nome: "OUTRAS DESPESAS CORRENTES",
      modalidade_aplicacao_nome: "TRANSFERENCIA",
      fonte_nome: "RECURSOS PRIMARIOS",
      resultado_lei_nome: "PRIMARIO DISCRICIONARIO",
      valor_dotacao_inicial: "10800,00",
      valor_dotacao_atualizada: "10800,00",
      valor_total_empenhado: "5400,50",
      valor_liquidado: "0,00",
      valor_pago: "0,00",
    });
    expect(result.exercicio).toBe(2026);
    expect(result.acao).toBe("00PW - CONTRIBUICOES REGULARES");
    expect(result.dotacaoInicial).toBe(10800);
    expect(result.empenhado).toBe(5400.5);
  });
});

describe("parseReceita", () => {
  it("normalizes a receita item", () => {
    const result = parseReceita({
      ano: "2026",
      mes: "01",
      categoria_economica_cod_desc: "1 - RECEITAS CORRENTES",
      origem_cod_desc: "13 - RECEITA PATRIMONIAL",
      natureza_receita_cod_desc: "13110111 - ALUGUÉIS",
      receita_anual_prevista: 0,
      receita_arrecadada: 2483.6,
    });
    expect(result.ano).toBe(2026);
    expect(result.mes).toBe(1);
    expect(result.arrecadada).toBe(2483.6);
  });
});

describe("agregarDespesas", () => {
  it("sums value columns per key, sorted by dotacaoAtualizada", () => {
    const itens = [
      parseDespesa({ "exercício_financeiro_lan_ef": 2025, grupo_despesa_nome: "PESSOAL", valor_dotacao_inicial: "100,00", valor_dotacao_atualizada: "150,00", valor_total_empenhado: "120,00", valor_liquidado: "110,00", valor_pago: "100,00" }),
      parseDespesa({ "exercício_financeiro_lan_ef": 2025, grupo_despesa_nome: "PESSOAL", valor_dotacao_inicial: "50,00", valor_dotacao_atualizada: "50,00", valor_total_empenhado: "25,00", valor_liquidado: "25,00", valor_pago: "25,00" }),
      parseDespesa({ "exercício_financeiro_lan_ef": 2025, grupo_despesa_nome: "INVESTIMENTOS", valor_dotacao_inicial: "80,00", valor_dotacao_atualizada: "80,00", valor_total_empenhado: "0,00", valor_liquidado: "0,00", valor_pago: "0,00" }),
    ];
    const result = agregarDespesas(itens, (d) => d.grupoDespesa);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ chave: "PESSOAL", dotacaoAtualizada: 200, empenhado: 145, pago: 125 });
    expect(result[1].chave).toBe("INVESTIMENTOS");
  });
});
