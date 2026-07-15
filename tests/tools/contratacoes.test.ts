import { describe, it, expect } from "vitest";
import { parseContrato, parseTerceirizado, matchesFiltro, matchesFiltroCampo, podarLicitacao, ordenarEPaginar } from "../../src/tools/contratacoes.js";

describe("podarLicitacao (OBS-20)", () => {
  it("drops the circular parent licitacao from each detalhamento", () => {
    const raw = {
      id: 1, numero: "19/2018", objeto: "Vigilância",
      detalhamentos: [
        { id: 10, tipo: "ata", descricao: "x", licitacao: { id: 1, numero: "19/2018", objeto: "Vigilância", detalhamentos: [] } },
        { id: 11, tipo: "ata", descricao: "y", licitacao: { id: 1 } },
      ],
    };
    const out = podarLicitacao(raw);
    expect(out.id).toBe(1);
    expect(out.detalhamentos).toHaveLength(2);
    expect(out.detalhamentos[0]).toEqual({ id: 10, tipo: "ata", descricao: "x" });
    expect("licitacao" in out.detalhamentos[1]).toBe(false);
  });

  it("passes through records without detalhamentos", () => {
    expect(podarLicitacao({ id: 2, numero: "5/2020" })).toEqual({ id: 2, numero: "5/2020" });
    expect(podarLicitacao(null)).toBeNull();
  });
});

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

describe("senado_contratos local filters (BUG-003/033)", () => {
  // Filters now run in-Worker over the full base (upstream is case-sensitive + 400s on maoDeObra).
  const base = [
    parseContrato({ id: 1, objeto: "Serviço de Vigilância armada", empresa: { nome: "SEG LTDA", cpf_cnpj: "11.222.333/0001-00" }, ind_mao_de_obra: true, data_assinatura: "2025-01-10" }),
    parseContrato({ id: 2, objeto: "vigilância eletrônica", empresa: { nome: "X" }, ind_mao_de_obra: false, data_assinatura: "2024-06-01" }),
    parseContrato({ id: 3, objeto: "Limpeza e conservação", empresa: { nome: "Y" }, ind_mao_de_obra: true, data_assinatura: "2025-03-03" }),
  ];

  it("matches objeto case/accent-insensitively (BUG-003)", () => {
    expect(base.filter((c) => matchesFiltro(c.objeto, "vigilancia")).length).toBe(2); // both "Vigilância" and "vigilância"
  });

  it("filters maoDeObra as a boolean (BUG-033)", () => {
    expect(base.filter((c) => c.maoDeObra === true).length).toBe(2);
    expect(base.filter((c) => c.maoDeObra === false).length).toBe(1);
  });

  it("filters cnpj by digits and ano by data_assinatura prefix", () => {
    const alvo = "11222333000100";
    expect(base.filter((c) => (c.empresa?.cnpj || "").replace(/\D/g, "") === alvo).length).toBe(1);
    expect(base.filter((c) => String(c.dataAssinatura || "").startsWith("2025")).length).toBe(2);
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

describe("ordenarEPaginar (achado #2 / P63)", () => {
  // Upstream lists come id-ascending (oldest first); desc must put the most recent first.
  const lista = [1, 2, 3, 4, 5];

  it("desc reverses so the most recent (last upstream) come first", () => {
    expect(ordenarEPaginar(lista, "desc", 0, 3)).toEqual([5, 4, 3]);
  });

  it("asc preserves the upstream order", () => {
    expect(ordenarEPaginar(lista, "asc", 0, 3)).toEqual([1, 2, 3]);
  });

  it("offset paginates after ordering, in both directions", () => {
    expect(ordenarEPaginar(lista, "desc", 2, 2)).toEqual([3, 2]);
    expect(ordenarEPaginar(lista, "asc", 3, 10)).toEqual([4, 5]);
  });

  it("offset beyond the list yields empty; input is not mutated", () => {
    expect(ordenarEPaginar(lista, "desc", 99, 5)).toEqual([]);
    expect(lista).toEqual([1, 2, 3, 4, 5]);
  });
});
