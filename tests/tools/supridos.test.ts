import { describe, it, expect } from "vitest";
import { suprimentoValor, estatisticasSuprimento, TIPOS_COM_VALOR, CAMPOS_POR_TIPO } from "../../src/tools/supridos.js";

describe("suprimentoValor", () => {
  it("reads a numeric value straight", () => {
    expect(suprimentoValor({ valor: 123.45 }, "valor")).toBe(123.45);
  });
  it("coerces a numeric string", () => {
    expect(suprimentoValor({ valor: "200" }, "valor")).toBe(200);
  });
  it("returns NaN for null (excluded from stats)", () => {
    expect(Number.isNaN(suprimentoValor({ valor: null }, "valor"))).toBe(true);
  });
  it("returns NaN for a missing/non-numeric field", () => {
    expect(Number.isNaN(suprimentoValor({ valor: "abc" }, "valor"))).toBe(true);
    expect(Number.isNaN(suprimentoValor({}, "valor"))).toBe(true);
  });
  it("reads the requested column, not others", () => {
    const r = { valorConcedido: 10, valorExecutado: 7 };
    expect(suprimentoValor(r, "valorExecutado")).toBe(7);
    expect(suprimentoValor(r, "valorConcedido")).toBe(10);
  });
});

describe("config", () => {
  it("exposes the tipos that carry a value column", () => {
    expect(TIPOS_COM_VALOR).toEqual(["transacoes", "empenhos", "atos-concessao"]);
  });
  it("defaults campo per tipo per the handoff", () => {
    expect(CAMPOS_POR_TIPO.transacoes.default).toBe("valor");
    expect(CAMPOS_POR_TIPO.empenhos.default).toBe("valorExecutado");
    expect(CAMPOS_POR_TIPO["atos-concessao"].default).toBe("valorTotalTransacoes");
  });
});

describe("estatisticasSuprimento", () => {
  const transacoes = [
    { fornecedor: "POSTO A", rubricas: "COMBUSTIVEL", tipo: "T1", valor: 100 },
    { fornecedor: "POSTO A", rubricas: "COMBUSTIVEL", tipo: "T1", valor: 300 },
    { fornecedor: "MERCADO B", rubricas: "MATERIAL", tipo: "T2", valor: 50 },
    { fornecedor: "MERCADO B", rubricas: "MATERIAL", tipo: "T2", valor: null }, // excluído
  ];

  it("transacoes without agruparPor: distribution over `valor`, nulls excluded, + top/bottom", () => {
    const out = estatisticasSuprimento(transacoes, { tipo: "transacoes", topN: 10 }) as any;
    expect(out.campo).toBe("valor");
    expect(out.distribuicao).toMatchObject({ n: 3, soma: 450, minimo: 50, maximo: 300, media: 150, mediana: 100 });
    expect(out.top[0].valor).toBe(300);
    expect(out.top[0].fornecedor).toBe("POSTO A");
    expect(out.bottom[0].valor).toBe(50);
    expect(out.aviso).toMatch(/1 de 4 registros sem valor numérico em 'valor' foram excluídos/);
  });

  it("transacoes with agruparPor=fornecedor: groups ranked by summed valor desc, sum reconciles", () => {
    const out = estatisticasSuprimento(transacoes, { tipo: "transacoes", agruparPor: "fornecedor", topN: 10 }) as any;
    expect(out.campo).toBe("valor");
    expect(out.agrupadoPor).toBe("fornecedor");
    expect(out.grupos[0].grupo).toBe("POSTO A");
    expect(out.grupos[0].soma).toBe(400);
    expect(out.grupos[1].grupo).toBe("MERCADO B");
    expect(out.grupos[1].soma).toBe(50); // null row excluded
  });

  const empenhos = [
    { rubrica: "R1", descricao: "D1", numero: "1", valorConcedido: 120, valorExecutado: 100 },
    { rubrica: "R1", descricao: "D1", numero: "2", valorConcedido: 310, valorExecutado: 300 },
    { rubrica: "R2", descricao: "D2", numero: "3", valorConcedido: 60, valorExecutado: 50 },
  ];

  it("empenhos default campo is valorExecutado", () => {
    const out = estatisticasSuprimento(empenhos, { tipo: "empenhos", topN: 10 }) as any;
    expect(out.campo).toBe("valorExecutado");
    expect(out.distribuicao.soma).toBe(450);
    expect(out.top[0].valor).toBe(300);
  });

  it("empenhos campo=valorConcedido switches the accessor", () => {
    const out = estatisticasSuprimento(empenhos, { tipo: "empenhos", campo: "valorConcedido", topN: 10 }) as any;
    expect(out.campo).toBe("valorConcedido");
    expect(out.distribuicao.soma).toBe(490);
    expect(out.top[0].valor).toBe(310);
  });

  const atos = [
    { codigo_suprido: "S1", elementoDespesa: "E1", regimeEspecial: "N", valorTotalTransacoes: 100, valorTotalEmpenhos: 120 },
    { codigo_suprido: "S2", elementoDespesa: "E1", regimeEspecial: "N", valorTotalTransacoes: 300, valorTotalEmpenhos: 310 },
    { codigo_suprido: "S3", elementoDespesa: "E2", regimeEspecial: "S", valorTotalTransacoes: 50, valorTotalEmpenhos: 60 },
  ];

  it("atos-concessao default campo is valorTotalTransacoes; agruparPor=elementoDespesa", () => {
    const out = estatisticasSuprimento(atos, { tipo: "atos-concessao", agruparPor: "elementoDespesa", topN: 10 }) as any;
    expect(out.campo).toBe("valorTotalTransacoes");
    expect(out.agrupadoPor).toBe("elementoDespesa");
    expect(out.grupos[0].grupo).toBe("E1");
    expect(out.grupos[0].soma).toBe(400);
    expect(out.grupos[1].grupo).toBe("E2");
    expect(out.grupos[1].soma).toBe(50);
  });

  it("invalid campo for tipo falls back to default with aviso", () => {
    const out = estatisticasSuprimento(empenhos, { tipo: "empenhos", campo: "valorTotalTransacoes", topN: 10 }) as any;
    expect(out.campo).toBe("valorExecutado");
    expect(out.aviso).toMatch(/campo 'valorTotalTransacoes' não se aplica a tipo=empenhos/);
    expect(out.distribuicao.soma).toBe(450);
  });

  it("invalid agruparPor for tipo is ignored with aviso (falls to no-group shape)", () => {
    const out = estatisticasSuprimento(transacoes, { tipo: "transacoes", agruparPor: "descricao", topN: 10 }) as any;
    expect(out.grupos).toBeUndefined();
    expect(out.distribuicao).toBeDefined();
    expect(out.aviso).toMatch(/agruparPor 'descricao' não se aplica a tipo=transacoes/);
  });
});
