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
    // Raw `campo` is no longer exposed to the model; only the human label is.
    expect(out.campo).toBeUndefined();
    expect(out.distribuicao).toMatchObject({ n: 3, soma: 450, minimo: 50, maximo: 300, media: 150, mediana: 100 });
    expect(out.top[0].valor).toBe(300);
    expect(out.top[0].fornecedor).toBe("POSTO A");
    expect(out.bottom[0].valor).toBe(50);
    expect(out.aviso).toMatch(/1 de 4 registros sem valor informado foram excluídos/);
    // Aviso must not leak raw field names.
    expect(out.aviso).not.toMatch(/'valor'|numérico/);
    // Human label for the analyzed column, so the response never surfaces the raw field name.
    expect(out.campoAnalisado).toBe("valor da transação");
  });

  it("transacoes with agruparPor=fornecedor: groups ranked by summed valor desc, sum reconciles", () => {
    const out = estatisticasSuprimento(transacoes, { tipo: "transacoes", agruparPor: "fornecedor", topN: 10 }) as any;
    expect(out.campoAnalisado).toBe("valor da transação");
    expect(out.agrupadoPor).toBeUndefined();
    expect(out.agrupadoPorRotulo).toBe("fornecedor");
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
    expect(out.campoAnalisado).toBe("valor executado (gasto)");
    expect(out.distribuicao.soma).toBe(450);
    expect(out.top[0].valor).toBe(300);
  });

  it("empenhos campo=valorConcedido switches the accessor", () => {
    const out = estatisticasSuprimento(empenhos, { tipo: "empenhos", campo: "valorConcedido", topN: 10 }) as any;
    expect(out.campoAnalisado).toBe("valor concedido (autorizado)");
    expect(out.distribuicao.soma).toBe(490);
    expect(out.top[0].valor).toBe(310);
  });

  const atos = [
    { codigo_suprido: "S1", codigoAtoConcessao: "00012024", data: "2024-01-10", elementoDespesa: "E1", regimeEspecial: "N", valorTotalTransacoes: 100, valorTotalEmpenhos: 120 },
    { codigo_suprido: "S2", codigoAtoConcessao: "00022024", data: "2024-02-10", elementoDespesa: "E1", regimeEspecial: "N", valorTotalTransacoes: 300, valorTotalEmpenhos: 310 },
    { codigo_suprido: "S3", codigoAtoConcessao: "00032024", data: "2024-03-10", elementoDespesa: "E2", regimeEspecial: "S", valorTotalTransacoes: 50, valorTotalEmpenhos: 60 },
  ];

  it("identifies ranking entries by the citable act code; regime is plain text, not a raw flag", () => {
    const out = estatisticasSuprimento(atos, { tipo: "atos-concessao", topN: 10 }) as any;
    // Top by valorTotalTransacoes = S2 (300).
    expect(out.top[0]).toMatchObject({ codigoAtoConcessao: "00022024", codigoInternoSuprido: "S2", valor: 300 });
    // Renamed away from the raw internal snake_case field.
    expect(out.top[0].codigo_suprido).toBeUndefined();
    // `regimeEspecial: "N"` becomes plain words; the raw flag key is gone.
    expect(out.top[0].regime).toBe("regime comum");
    expect(out.top[0].regimeEspecial).toBeUndefined();
    expect(out.campoAnalisado).toBe("total gasto no cartão");
    // Without a name map, `suprido` is present but null (graceful).
    expect(out.top[0].suprido).toBeNull();
  });

  it("enriches atos-concessao entries with the beneficiary NAME from the registry map", () => {
    const nomePorCodigo = new Map([["S1", "ANA MEIRELLES"], ["S2", "BRUNO COSTA"]]);
    const out = estatisticasSuprimento(atos, { tipo: "atos-concessao", topN: 10, nomePorCodigo }) as any;
    // Top is S2 (300) → now identifiable by name, not just the internal code.
    expect(out.top[0].suprido).toBe("BRUNO COSTA");
    expect(out.top[0].codigoInternoSuprido).toBe("S2");
  });

  it("agruparPor=suprido ranks beneficiaries by name (atos-concessao only)", () => {
    const nomePorCodigo = new Map([["S1", "ANA MEIRELLES"], ["S2", "BRUNO COSTA"], ["S3", "ANA MEIRELLES"]]);
    // S1 (100) + S3 (50) are the same person "ANA MEIRELLES" (150); S2 "BRUNO COSTA" (300).
    const out = estatisticasSuprimento(atos, { tipo: "atos-concessao", agruparPor: "suprido", topN: 10, nomePorCodigo }) as any;
    expect(out.agrupadoPorRotulo).toBe("suprido");
    expect(out.grupos[0].grupo).toBe("BRUNO COSTA"); // 300 = biggest
    expect(out.grupos[0].soma).toBe(300);
    const ana = out.grupos.find((g: any) => g.grupo === "ANA MEIRELLES");
    expect(ana.soma).toBe(150); // 100 + 50 merged by name
  });

  it("atos-concessao default campo is valorTotalTransacoes; agruparPor=elementoDespesa", () => {
    const out = estatisticasSuprimento(atos, { tipo: "atos-concessao", agruparPor: "elementoDespesa", topN: 10 }) as any;
    expect(out.campoAnalisado).toBe("total gasto no cartão");
    expect(out.agrupadoPor).toBeUndefined();
    expect(out.agrupadoPorRotulo).toBe("elemento de despesa");
    expect(out.grupos[0].grupo).toBe("E1");
    expect(out.grupos[0].soma).toBe(400);
    expect(out.grupos[1].grupo).toBe("E2");
    expect(out.grupos[1].soma).toBe(50);
  });

  it("invalid campo for tipo falls back to default with a plain-language aviso (no raw field names)", () => {
    const out = estatisticasSuprimento(empenhos, { tipo: "empenhos", campo: "valorTotalTransacoes", topN: 10 }) as any;
    expect(out.campo).toBeUndefined();
    expect(out.campoAnalisado).toBe("valor executado (gasto)");
    expect(out.aviso).toMatch(/a estatística usa: valor executado \(gasto\)/);
    // The aviso must not transcribe raw field/param names to the user.
    expect(out.aviso).not.toMatch(/valorTotalTransacoes|valorExecutado|tipo=|campo '/);
    expect(out.distribuicao.soma).toBe(450);
  });

  it("invalid agruparPor for tipo is ignored with a plain-language aviso (no raw param names)", () => {
    const out = estatisticasSuprimento(transacoes, { tipo: "transacoes", agruparPor: "descricao", topN: 10 }) as any;
    expect(out.grupos).toBeUndefined();
    expect(out.distribuicao).toBeDefined();
    expect(out.aviso).toMatch(/O agrupamento solicitado não se aplica/);
    expect(out.aviso).not.toMatch(/agruparPor|'descricao'|tipo=/);
  });
});
