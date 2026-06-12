import { describe, it, expect } from "vitest";
import { parseLegislacaoResumo, parseLegislacaoDetalhe } from "../../src/tools/legislacao.js";

describe("parseLegislacaoResumo", () => {
  it("parses a PascalCase legislation result", () => {
    const l = {
      Codigo: "9999",
      TipoNorma: "LEI",
      Numero: "14133",
      Ano: "2021",
      Data: "2021-04-01",
      Ementa: "Lei de Licitações e Contratos Administrativos.",
      Situacao: "Vigente",
      UrlTexto: "https://example.com/lei/14133",
    };
    const result = parseLegislacaoResumo(l);
    expect(result.codigo).toBe("9999");
    expect(result.tipo).toBe("LEI");
    expect(result.numero).toBe("14133");
    expect(result.ano).toBe("2021");
    expect(result.ementa).toBe("Lei de Licitações e Contratos Administrativos.");
    expect(result.situacao).toBe("Vigente");
    expect(result.url).toBe("https://example.com/lei/14133");
  });

  it("parses camelCase fields", () => {
    const l = {
      codigo: 8888,
      tipoNorma: "DEC",
      numero: 1000,
      ano: 2020,
      ementa: "Decreto...",
    };
    const result = parseLegislacaoResumo(l);
    expect(result.codigo).toBe(8888);
    expect(result.tipo).toBe("DEC");
  });

  it("returns nulls for empty object", () => {
    const result = parseLegislacaoResumo({});
    expect(result.codigo).toBeNull();
    expect(result.tipo).toBeNull();
    expect(result.ementa).toBeNull();
    expect(result.url).toBeNull();
  });
});

describe("parseLegislacaoDetalhe", () => {
  it("parses a full legislation detail", () => {
    const l = {
      Codigo: "9999",
      TipoNorma: "LEI",
      DescricaoTipoNorma: "Lei Ordinária",
      Numero: "14133",
      Ano: "2021",
      Data: "2021-04-01",
      Ementa: "Lei de Licitações.",
      Indexacao: "licitação; contratos; administração",
      Situacao: "Vigente",
      UrlTexto: "https://example.com/lei/14133",
      Origem: "Poder Legislativo",
      Observacao: "Revoga a Lei 8.666/93",
    };
    const result = parseLegislacaoDetalhe(l);
    expect(result.codigo).toBe("9999");
    expect(result.descricaoTipo).toBe("Lei Ordinária");
    expect(result.indexacao).toBe("licitação; contratos; administração");
    expect(result.origem).toBe("Poder Legislativo");
    expect(result.observacao).toBe("Revoga a Lei 8.666/93");
  });

  it("returns nulls for empty object", () => {
    const result = parseLegislacaoDetalhe({});
    expect(result.codigo).toBeNull();
    expect(result.descricaoTipo).toBeNull();
    expect(result.indexacao).toBeNull();
    expect(result.origem).toBeNull();
    expect(result.observacao).toBeNull();
  });
});
