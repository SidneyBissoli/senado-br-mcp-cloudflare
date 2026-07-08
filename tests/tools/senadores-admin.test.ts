import { describe, it, expect } from "vitest";
import { filtrarCeaps, agregarCeaps, parseCeapsItem, valorCeaps, estatisticasCeaps } from "../../src/tools/senadores-admin.js";
import { unwrapAdmEnvelope } from "../../src/utils/upstream-parse.js";

describe("senadores_admin envelope (BUG-036)", () => {
  // auxilio-moradia / escritorios wrap the payload in {statusCode,msg,data}; escritorios
  // records nest parlamentar/setor. The tool treated the envelope as a single record.
  it("unwraps auxilio-moradia and maps the flat fields", () => {
    const response = {
      statusCode: 200,
      msg: "ok",
      data: [{ nomeParlamentar: "ALAN RICK", estadoEleito: "AC", partidoEleito: "REPUBLICANOS", auxilioMoradia: "N", imovelFuncional: "S" }],
    };
    const senadores = unwrapAdmEnvelope(response) as any[];
    const mapped = senadores.map((s: any) => ({
      nome: s.nomeParlamentar || "",
      uf: s.estadoEleito || null,
      partido: s.partidoEleito || null,
      auxilioMoradia: s.auxilioMoradia || null,
      imovelFuncional: s.imovelFuncional || null,
    }));
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toEqual({ nome: "ALAN RICK", uf: "AC", partido: "REPUBLICANOS", auxilioMoradia: "N", imovelFuncional: "S" });
  });

  it("unwraps escritorios and maps the nested parlamentar/setor", () => {
    const response = {
      statusCode: 200,
      msg: "ok",
      data: [{
        parlamentar: { nome: "ALAN RICK", partido: null, estado: "AC" },
        setor: { nome: "Escritório de Apoio nº 1", telefone: null, endereco: "RUA BOM DESTINO, 90. RIO BRANCO, AC." },
      }],
    };
    const escritorios = (unwrapAdmEnvelope(response) as any[]).map((e: any) => ({
      senador: e.parlamentar?.nome || "",
      uf: e.parlamentar?.estado || null,
      partido: e.parlamentar?.partido || null,
      setor: e.setor?.nome || null,
      endereco: e.setor?.endereco || null,
      telefone: e.setor?.telefone || null,
    }));
    expect(escritorios[0].senador).toBe("ALAN RICK");
    expect(escritorios[0].uf).toBe("AC");
    expect(escritorios[0].setor).toBe("Escritório de Apoio nº 1");
    expect(escritorios[0].endereco).toContain("RUA BOM DESTINO");
  });
});

const DESPESAS = [
  { id: 1, mes: 7, codSenador: 5953, nomeSenador: "FABIANO CONTARATO", tipoDespesa: "Locomoção, hospedagem, alimentação", cpfCnpj: "17.895.646/0001-87", fornecedor: "UBER DO BRASIL", data: "2025-07-21", detalhamento: "Transporte", valorReembolsado: 50.02 },
  { id: 2, mes: 7, codSenador: 5953, nomeSenador: "FABIANO CONTARATO", tipoDespesa: "Divulgação da atividade parlamentar", cpfCnpj: "11.111.111/0001-11", fornecedor: "GRAFICA ABC", data: "2025-07-22", detalhamento: "Impressos", valorReembolsado: 1000 },
  { id: 3, mes: 8, codSenador: 1234, nomeSenador: "OUTRO SENADOR", tipoDespesa: "Locomoção, hospedagem, alimentação", cpfCnpj: "17.895.646/0001-87", fornecedor: "UBER DO BRASIL", data: "2025-08-01", detalhamento: "Transporte", valorReembolsado: 75.5 },
];

describe("filtrarCeaps", () => {
  it("filters by month", () => {
    expect(filtrarCeaps(DESPESAS, { mes: 7 })).toHaveLength(2);
  });

  it("filters by senator code", () => {
    expect(filtrarCeaps(DESPESAS, { codSenador: 1234 })).toHaveLength(1);
  });

  it("filters by senator name with accent-insensitive partial match", () => {
    expect(filtrarCeaps(DESPESAS, { nomeSenador: "contarato" })).toHaveLength(2);
  });

  it("filters by expense type and supplier", () => {
    expect(filtrarCeaps(DESPESAS, { tipoDespesa: "locomoção" })).toHaveLength(2);
    expect(filtrarCeaps(DESPESAS, { fornecedor: "uber" })).toHaveLength(2);
  });

  it("combines filters", () => {
    expect(filtrarCeaps(DESPESAS, { fornecedor: "uber", mes: 8 })).toHaveLength(1);
  });

  it("returns all when no filters", () => {
    expect(filtrarCeaps(DESPESAS, {})).toHaveLength(3);
  });
});

describe("agregarCeaps", () => {
  it("aggregates by senator with totals sorted desc", () => {
    const result = agregarCeaps(DESPESAS, (d) => d.codSenador, (d) => ({ senador: d.nomeSenador }));
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ chave: 5953, senador: "FABIANO CONTARATO", total: 1050.02, despesas: 2 });
    expect(result[1]).toMatchObject({ chave: 1234, total: 75.5, despesas: 1 });
  });

  it("aggregates by expense type", () => {
    const result = agregarCeaps(DESPESAS, (d) => d.tipoDespesa);
    const locomocao = result.find((r) => String(r.chave).startsWith("Locomoção"));
    expect(locomocao?.total).toBe(125.52);
    expect(locomocao?.despesas).toBe(2);
  });

  it("ignores non-numeric values", () => {
    const result = agregarCeaps([{ codSenador: 1, valorReembolsado: "x" }], (d) => d.codSenador);
    expect(result[0].total).toBe(0);
    expect(result[0].despesas).toBe(1);
  });
});

describe("parseCeapsItem", () => {
  it("trims a raw item to the detail shape", () => {
    const result = parseCeapsItem(DESPESAS[0]);
    expect(result).toEqual({
      mes: 7,
      data: "2025-07-21",
      senador: "FABIANO CONTARATO",
      codSenador: 5953,
      tipoDespesa: "Locomoção, hospedagem, alimentação",
      fornecedor: "UBER DO BRASIL",
      cnpjCpf: "17.895.646/0001-87",
      detalhamento: "Transporte",
      valor: 50.02,
    });
  });
});

describe("valorCeaps", () => {
  it("returns a numeric value as-is", () => {
    expect(valorCeaps({ valorReembolsado: 50.02 })).toBe(50.02);
  });

  it("parses a pt-BR string vintage", () => {
    expect(valorCeaps({ valorReembolsado: "1.050,02" })).toBe(1050.02);
  });

  it("yields 0 for garbage/missing", () => {
    expect(valorCeaps({ valorReembolsado: "x" })).toBe(0);
    expect(valorCeaps({})).toBe(0);
  });
});

describe("estatisticasCeaps", () => {
  it("crunches the distribution over individual expenses without agruparPor", () => {
    const r = estatisticasCeaps(DESPESAS, { topN: 10 }) as any;
    // valores: [50.02, 1000, 75.5] → soma 1125.52, min 50.02, max 1000, mediana 75.5
    expect(r.distribuicao.n).toBe(3);
    expect(r.distribuicao.soma).toBe(1125.52);
    expect(r.distribuicao.minimo).toBe(50.02);
    expect(r.distribuicao.maximo).toBe(1000);
    expect(r.distribuicao.media).toBe(375.17);
    expect(r.distribuicao.mediana).toBe(75.5);
    // top[0] = the single biggest expense (id 2, 1000), carrying identifiers
    expect(r.top[0]).toMatchObject({ valor: 1000, senador: "FABIANO CONTARATO", tipoDespesa: "Divulgação da atividade parlamentar" });
    expect(r.bottom[0]).toMatchObject({ valor: 50.02, senador: "FABIANO CONTARATO" });
  });

  it("ranks groups by total spend desc with agruparPor=senador", () => {
    const r = estatisticasCeaps(DESPESAS, { agruparPor: "senador", topN: 10 }) as any;
    expect(r.agrupadoPor).toBe("senador");
    expect(r.totalGrupos).toBe(2);
    // grupos[0] = biggest spender (FABIANO: 50.02 + 1000 = 1050.02, n=2)
    expect(r.grupos[0]).toMatchObject({ grupo: "FABIANO CONTARATO", n: 2, soma: 1050.02 });
    expect(r.grupos[1]).toMatchObject({ grupo: "OUTRO SENADOR", n: 1, soma: 75.5 });
    // sum reconciles with the ungrouped total
    expect(r.grupos[0].soma + r.grupos[1].soma).toBe(1125.52);
    // no per-group top/bottom (kept lean via topN:0)
    expect(r.grupos[0]).not.toHaveProperty("top");
  });

  it("groups by month", () => {
    const r = estatisticasCeaps(DESPESAS, { agruparPor: "mes", topN: 10 }) as any;
    // mes 7 = 50.02 + 1000 = 1050.02 (biggest), mes 8 = 75.5
    expect(r.grupos[0]).toMatchObject({ grupo: "7", n: 2, soma: 1050.02 });
    expect(r.grupos[1]).toMatchObject({ grupo: "8", n: 1, soma: 75.5 });
  });
});
