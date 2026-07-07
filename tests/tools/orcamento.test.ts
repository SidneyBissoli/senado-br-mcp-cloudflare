import { describe, it, expect } from "vitest";
import { parseEmenda, parseOficio } from "../../src/tools/orcamento.js";

describe("parseEmenda", () => {
  // Real shape from ListaLoteEmendas.LotesEmendasOrcamento.LoteEmendasOrcamento[].
  it("parses a real budget amendment batch (LoteEmendasOrcamento)", () => {
    const e = {
      NomeAutorOrcamento: "Abilio Brunini",
      IndicadorAtivo: "N\u00e3o",
      CodigoAutorOrcamento: "4290",
      DataOperacao: "2023-11-29",
      QuantidadeEmendas: "10",
      AnoExecucao: "2024",
      NumeroMateria: "29",
      AnoMateria: "2023",
      SiglaTipoPlOrcamento: "LOA",
      DescricaoTipoPlOrcamento: "Lei Or\u00e7ament\u00e1ria Anual",
    };
    const result = parseEmenda(e);
    expect(result.autor).toBe("Abilio Brunini");
    expect(result.codigoAutor).toBe(4290);
    expect(result.quantidadeEmendas).toBe(10);
    expect(result.anoExecucao).toBe("2024");
    expect(result.materia).toBe("LOA 29/2023");
    expect(result.tipoPl).toBe("Lei Or\u00e7ament\u00e1ria Anual");
    expect(result.dataOperacao).toBe("2023-11-29");
    expect(result.ativo).toBe(false);
  });

  it("maps IndicadorAtivo 'Sim' to ativo true", () => {
    expect(parseEmenda({ IndicadorAtivo: "Sim" }).ativo).toBe(true);
  });

  it("returns nulls/zeros for empty object", () => {
    const result = parseEmenda({});
    expect(result.autor).toBeNull();
    expect(result.codigoAutor).toBeNull();
    expect(result.quantidadeEmendas).toBe(0);
    expect(result.materia).toBeNull();
    expect(result.ativo).toBe(false);
  });
});

describe("parseOficio (BUG-038)", () => {
  // Real shape: {id, tratamento, nome, numeroProtocoloApresentacao, dataInclusao, emendas[]}.
  const oficio = {
    id: 8025,
    tratamento: "Deputado(a)",
    nome: "Castro Neto",
    numeroProtocoloApresentacao: "CD263615128000",
    dataInclusao: "2026-07-06T16:14:05.000+00:00",
    emendas: [
      { numero: "202360040001", ano: "2023", tipo: "RP8", autor: "COM. EDUCACAO", nomeFavorecido: "MUNICIPIO DE JOSE DE FREITAS", cnpjFavorecido: "06554786000175", nomeOrgaoUge: "FNDE", notaEmpenho: "153173152532023NE655329" },
      { numero: "202160040002", ano: "2021", tipo: "RP8", nomeFavorecido: "OUTRO" },
    ],
  };

  it("projects metadata + emenda count by default (no emendas detail)", () => {
    const r = parseOficio(oficio);
    expect(r.id).toBe(8025);
    expect(r.autor).toBe("Deputado(a) Castro Neto");
    expect(r.protocolo).toBe("CD263615128000");
    expect(r.dataInclusao).toBe("2026-07-06"); // time stripped
    expect(r.quantidadeEmendas).toBe(2);
    expect(r.emendas).toBeUndefined();
  });

  it("counts only the given budget year (ano filters emendas)", () => {
    expect(parseOficio(oficio, 2023).quantidadeEmendas).toBe(1);
    expect(parseOficio(oficio, 2021).quantidadeEmendas).toBe(1);
    expect(parseOficio(oficio, 2099).quantidadeEmendas).toBe(0);
  });

  it("includes the execution detail with incluirEmendas (filtered by ano)", () => {
    const r = parseOficio(oficio, 2023, true) as any;
    expect(r.emendas).toHaveLength(1);
    expect(r.emendas[0]).toMatchObject({
      numero: "202360040001", ano: "2023", favorecido: "MUNICIPIO DE JOSE DE FREITAS",
      cnpjFavorecido: "06554786000175", notaEmpenho: "153173152532023NE655329",
    });
  });

  it("returns nulls/zeros for empty object", () => {
    const r = parseOficio({});
    expect(r.id).toBeNull();
    expect(r.autor).toBeNull();
    expect(r.quantidadeEmendas).toBe(0);
  });
});
