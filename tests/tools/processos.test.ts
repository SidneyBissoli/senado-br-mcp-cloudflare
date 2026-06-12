import { describe, it, expect } from "vitest";
import { parseProcessoResumo, parseProcessoDetalhe } from "../../src/tools/processos.js";

describe("parseProcessoResumo", () => {
  it("parses a process search result", () => {
    const p = {
      id: 12345,
      codigoMateria: 151234,
      identificacao: "PL 100/2024",
      ementa: "Dispõe sobre...",
      tipoDocumento: "Projeto de Lei",
      dataApresentacao: "2024-03-15",
      autoria: "Senador Fulano",
      tramitando: "S",
    };
    const result = parseProcessoResumo(p);
    expect(result.id).toBe(12345);
    expect(result.codigoMateria).toBe(151234);
    expect(result.identificacao).toBe("PL 100/2024");
    expect(result.ementa).toBe("Dispõe sobre...");
    expect(result.tramitando).toBe("S");
  });

  it("returns null for missing fields", () => {
    const result = parseProcessoResumo({});
    expect(result.id).toBeNull();
    expect(result.codigoMateria).toBeNull();
    expect(result.ementa).toBeNull();
  });
});

describe("parseProcessoDetalhe", () => {
  it("parses full process detail", () => {
    const p = {
      id: 12345,
      codigoMateria: 151234,
      identificacao: "PL 100/2024",
      sigla: "PL",
      descricaoSigla: "Projeto de Lei",
      numero: 100,
      ano: 2024,
      objetivo: "Dispor sobre...",
      conteudo: { ementa: "Ementa detalhada", tipo: "Ordinário" },
      documento: {
        dataApresentacao: "2024-03-15",
        resumoAutoria: "Senador Fulano",
        indexacao: "educação; saúde",
        url: "https://example.com/doc.pdf",
      },
      tramitando: "S",
    };
    const result = parseProcessoDetalhe(p);
    expect(result.id).toBe(12345);
    expect(result.sigla).toBe("PL");
    expect(result.numero).toBe(100);
    expect(result.ementa).toBe("Ementa detalhada");
    expect(result.dataApresentacao).toBe("2024-03-15");
    expect(result.autoria).toBe("Senador Fulano");
    expect(result.urlDocumento).toBe("https://example.com/doc.pdf");
  });

  it("handles missing nested objects", () => {
    const result = parseProcessoDetalhe({});
    expect(result.ementa).toBeNull();
    expect(result.dataApresentacao).toBeNull();
    expect(result.urlDocumento).toBeNull();
  });
});
