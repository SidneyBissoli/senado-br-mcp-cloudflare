import { describe, it, expect } from "vitest";
import { parseContrato, parseTerceirizado, matchesFiltro, matchesFiltroCampo } from "../../src/tools/contratacoes.js";

describe("parseContrato", () => {
  it("parses a snake_case contract item", () => {
    const result = parseContrato({
      id: 8082,
      numero: "2025/0042",
      numero_formatado: "CT 42/2025",
      objeto: "Prestação de serviços de limpeza",
      empresa: { nome: "EMPRESA X LTDA", cpf_cnpj: "07.319.675/0001-47" },
      licitacao: { numero: "19/2024" },
      sub_especie: { descricao: "Contrato de Serviço" },
      data_assinatura: "2025-01-10",
      data_inicio_vigencia: "2025-02-01",
      data_fim_vigencia: "2026-01-31",
      ind_mao_de_obra: "S",
    });
    expect(result.id).toBe(8082);
    expect(result.numero).toBe("CT 42/2025");
    expect(result.empresa).toEqual({ nome: "EMPRESA X LTDA", cnpj: "07.319.675/0001-47" });
    expect(result.licitacao).toBe("19/2024");
    expect(result.subEspecie).toBe("Contrato de Serviço");
    expect(result.vigencia).toEqual({ inicio: "2025-02-01", fim: "2026-01-31" });
    expect(result.maoDeObra).toBe(true);
  });

  it("handles empty input", () => {
    const result = parseContrato({});
    expect(result.id).toBeNull();
    expect(result.empresa).toBeNull();
    expect(result.maoDeObra).toBe(false);
  });
});

describe("parseTerceirizado", () => {
  it("parses an outsourced collaborator", () => {
    const result = parseTerceirizado({
      nome: "FULANO DA SILVA",
      cpf: "***123456**",
      situacao: "ATIVO",
      empresa: { nome: "TERCEIRIZADA Y" },
      lotacao: "SEGRAF",
      numeroContrato: "CT 10/2023",
    });
    expect(result.nome).toBe("FULANO DA SILVA");
    expect(result.empresa).toBe("TERCEIRIZADA Y");
    expect(result.lotacao).toBe("SEGRAF");
  });
});

describe("matchesFiltro", () => {
  it("matches case- and accent-insensitively", () => {
    expect(matchesFiltro("Serviços de Informática", "INFORMATICA")).toBe(true);
    expect(matchesFiltro("LIMPEZA E CONSERVAÇÃO", "conservacao")).toBe(true);
  });

  it("returns false for non-strings and non-matches", () => {
    expect(matchesFiltro(123, "1")).toBe(false);
    expect(matchesFiltro("abc", "xyz")).toBe(false);
  });
});

describe("matchesFiltroCampo (BUG-004/035)", () => {
  // lotacao is {sigla,nome}; cargo is {nome}. String matcher over the object never matches.
  it("matches against a {sigla,nome} lotacao by sigla or nome", () => {
    const lotacao = { sigla: "SEGRAF", nome: "Secretaria de Editoração e Publicações" };
    expect(matchesFiltroCampo(lotacao, "SEGRAF")).toBe(true);
    expect(matchesFiltroCampo(lotacao, "editoracao")).toBe(true); // accent-insensitive
    expect(matchesFiltroCampo(lotacao, "infraestrutura")).toBe(false);
  });

  it("matches against a {nome} cargo", () => {
    expect(matchesFiltroCampo({ nome: "ADVOGADO" }, "advogado")).toBe(true);
  });

  it("still matches plain strings and rejects null/other", () => {
    expect(matchesFiltroCampo("SINFRA", "sinfra")).toBe(true);
    expect(matchesFiltroCampo(null, "x")).toBe(false);
    expect(matchesFiltroCampo({ outro: "SEGRAF" }, "SEGRAF")).toBe(false);
  });
});
