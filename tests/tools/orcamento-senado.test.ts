import { describe, it, expect } from "vitest";
import { parseValorBR, parseDespesa, parseReceita, agregarDespesas, estatisticasExecucao } from "../../src/tools/orcamento-senado.js";

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

describe("estatisticasExecucao", () => {
  const despesas = [
    parseDespesa({ "exercício_financeiro_lan_ef": 2025, acao_codigo: "A", acao_nome: "AÇÃO A", grupo_despesa_nome: "PESSOAL", fonte_nome: "F1", valor_pago: "100,00", valor_total_empenhado: "120,00" }),
    parseDespesa({ "exercício_financeiro_lan_ef": 2025, acao_codigo: "B", acao_nome: "AÇÃO B", grupo_despesa_nome: "PESSOAL", fonte_nome: "F2", valor_pago: "300,00", valor_total_empenhado: "310,00" }),
    parseDespesa({ "exercício_financeiro_lan_ef": 2024, acao_codigo: "C", acao_nome: "AÇÃO C", grupo_despesa_nome: "INVESTIMENTOS", fonte_nome: "F1", valor_pago: "50,00", valor_total_empenhado: "60,00" }),
  ];
  const receitas = [
    parseReceita({ ano: 2025, mes: 1, origem_cod_desc: "13 - PATRIMONIAL", especie_cod_desc: "E1", receita_arrecadada: 200 }),
    parseReceita({ ano: 2025, mes: 2, origem_cod_desc: "13 - PATRIMONIAL", especie_cod_desc: "E2", receita_arrecadada: 800 }),
    parseReceita({ ano: 2025, mes: 3, origem_cod_desc: "16 - SERVIÇOS", especie_cod_desc: "E3", receita_arrecadada: 400 }),
  ];

  it("despesas without agruparPor: distribution over `pago` by default + top", () => {
    const out = estatisticasExecucao(despesas, { tipo: "despesas", topN: 10 }) as any;
    expect(out.campo).toBe("pago");
    expect(out.distribuicao).toMatchObject({ n: 3, soma: 450, minimo: 50, maximo: 300, media: 150, mediana: 100 });
    expect(out.top[0].valor).toBe(300);
    expect(out.top[0].acao).toBe("B - AÇÃO B");
    expect(out.bottom[0].valor).toBe(50);
    expect(out.aviso).toBeUndefined();
  });

  it("despesas with agruparPor=grupo: groups ranked by summed pago desc, sum reconciles", () => {
    const out = estatisticasExecucao(despesas, { tipo: "despesas", agruparPor: "grupo", topN: 10 }) as any;
    expect(out.campo).toBe("pago");
    expect(out.agrupadoPor).toBe("grupo");
    expect(out.grupos[0].grupo).toBe("PESSOAL");
    expect(out.grupos[0].soma).toBe(400);
    expect(out.grupos[1].grupo).toBe("INVESTIMENTOS");
    expect(out.grupos[1].soma).toBe(50);
  });

  it("campo=empenhado switches the accessor", () => {
    const out = estatisticasExecucao(despesas, { tipo: "despesas", campo: "empenhado", topN: 10 }) as any;
    expect(out.campo).toBe("empenhado");
    expect(out.distribuicao.soma).toBe(490);
    expect(out.top[0].valor).toBe(310);
  });

  it("receitas with agruparPor=origem over arrecadada", () => {
    const out = estatisticasExecucao(receitas, { tipo: "receitas", agruparPor: "origem", topN: 10 }) as any;
    expect(out.campo).toBe("arrecadada");
    expect(out.grupos[0].grupo).toBe("13 - PATRIMONIAL");
    expect(out.grupos[0].soma).toBe(1000);
    expect(out.grupos[1].grupo).toBe("16 - SERVIÇOS");
    expect(out.grupos[1].soma).toBe(400);
  });

  it("invalid campo for tipo falls back to default with aviso", () => {
    const out = estatisticasExecucao(receitas, { tipo: "receitas", campo: "pago", topN: 10 }) as any;
    expect(out.campo).toBe("arrecadada");
    expect(out.aviso).toMatch(/campo 'pago' não se aplica a tipo=receitas/);
    expect(out.distribuicao.soma).toBe(1400);
  });

  it("invalid agruparPor for tipo is ignored with aviso (falls to no-group shape)", () => {
    const out = estatisticasExecucao(despesas, { tipo: "despesas", agruparPor: "origem", topN: 10 }) as any;
    expect(out.grupos).toBeUndefined();
    expect(out.distribuicao).toBeDefined();
    expect(out.aviso).toMatch(/agruparPor 'origem' não se aplica a tipo=despesas/);
  });
});
