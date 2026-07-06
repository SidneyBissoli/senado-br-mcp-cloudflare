import { describe, it, expect } from "vitest";
import { parseLegislacaoResumo, parseLegislacaoDetalhe } from "../../src/tools/legislacao.js";
import { digArrayRoot } from "../../src/utils/upstream-parse.js";

describe("parseLegislacaoResumo (BUG-021)", () => {
  // Real shape from ListaDocumento.documentos.documento[] (lowercase, DD/MM dates).
  it("parses a real lowercase legislation list item", () => {
    const l = {
      id: "33382036",
      tipo: "LEI-n",
      descricao: "Lei Numerada",
      numero: "14133",
      norma: "LEI-14133-2021-04-01",
      normaNome: "Lei nº 14.133 de 01/04/2021",
      ementa: "Lei de Licitações e Contratos Administrativos.",
      dataassinatura: "01/04/2021",
      anoassinatura: "2021",
      apelido: "LEI-14133-2021-04-01 , Lei de Licitações e Contratos (2021)",
    };
    const result = parseLegislacaoResumo(l);
    expect(result.codigo).toBe("33382036");
    expect(result.tipo).toBe("LEI-n");
    expect(result.descricaoTipo).toBe("Lei Numerada");
    expect(result.numero).toBe("14133");
    expect(result.ano).toBe("2021");
    expect(result.data).toBe("2021-04-01"); // DD/MM/AAAA -> ISO
    expect(result.norma).toBe("Lei nº 14.133 de 01/04/2021");
    expect(result.ementa).toBe("Lei de Licitações e Contratos Administrativos.");
  });

  it("resolves the list at the real dump root", () => {
    const response = { ListaDocumento: { documentos: { documento: [{ id: "1", tipo: "LEI-n" }] } } };
    const normas = digArrayRoot(response, [["ListaDocumento", "documentos", "documento"]], "t").map(parseLegislacaoResumo);
    expect(normas).toHaveLength(1);
    expect(normas[0].codigo).toBe("1");
  });

  it("returns nulls for empty object", () => {
    const result = parseLegislacaoResumo({});
    expect(result.codigo).toBeNull();
    expect(result.tipo).toBeNull();
    expect(result.ementa).toBeNull();
  });
});

describe("parseLegislacaoDetalhe (BUG-022)", () => {
  // Real shape from DetalheDocumento.documentos.documento[0] (identificacao nested).
  it("parses a real detail with nested identificacao and indexacao.frase[]", () => {
    const doc = {
      id: "33382036",
      identificacao: {
        tipo: "LEI-n",
        descricao: "Lei Numerada",
        numero: "14133",
        norma: "LEI-14133-2021-04-01",
        normaNome: "Lei nº 14.133 de 01/04/2021",
        dataassinatura: "01/04/2021",
        apelido: "LEI-14133-2021-04-01",
        urlDocumento: "https://normas.leg.br/?urn=urn:lex:br:federal:lei:2021-04-01;14133",
      },
      ementa: "Lei de Licitações e Contratos Administrativos.",
      indexacao: { frase: [" PROCESSO , LICITAÇÃO .", " CONTRATO ADMINISTRATIVO ."] },
    };
    const result = parseLegislacaoDetalhe(doc);
    expect(result.codigo).toBe("33382036");
    expect(result.tipo).toBe("LEI-n");
    expect(result.descricaoTipo).toBe("Lei Numerada");
    expect(result.numero).toBe("14133");
    expect(result.ano).toBe("2021");
    expect(result.data).toBe("2021-04-01");
    expect(result.norma).toBe("Lei nº 14.133 de 01/04/2021");
    expect(result.ementa).toBe("Lei de Licitações e Contratos Administrativos.");
    expect(result.indexacao).toBe("PROCESSO , LICITAÇÃO . CONTRATO ADMINISTRATIVO ."); // frase[] joined + collapsed
    expect(result.url).toBe("https://normas.leg.br/?urn=urn:lex:br:federal:lei:2021-04-01;14133");
  });

  it("returns nulls for empty object", () => {
    const result = parseLegislacaoDetalhe({});
    expect(result.codigo).toBeNull();
    expect(result.descricaoTipo).toBeNull();
    expect(result.indexacao).toBeNull();
    expect(result.url).toBeNull();
  });
});
