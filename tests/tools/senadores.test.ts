import { describe, it, expect } from "vitest";
import { parseSenadorResumo, parseSenadorDetalhe, extractParlamentares } from "../../src/tools/senadores.js";

describe("parseSenadorResumo", () => {
  it("parses full parlamentar object", () => {
    const parlamentar = {
      IdentificacaoParlamentar: {
        CodigoParlamentar: "5012",
        NomeParlamentar: "Flávio Arns",
        NomeCompletoParlamentar: "Flávio Arns de Oliveira",
        SiglaPartidoParlamentar: "PSB",
        UfParlamentar: "PR",
        UrlFotoParlamentar: "https://example.com/foto.jpg",
      },
      Mandato: {
        Partido: { SiglaPartido: "PSB" },
        UfParlamentar: "PR",
      },
    };
    const result = parseSenadorResumo(parlamentar);
    expect(result.codigo).toBe(5012);
    expect(result.nome).toBe("Flávio Arns");
    expect(result.nomeCompleto).toBe("Flávio Arns de Oliveira");
    expect(result.partido).toBe("PSB");
    expect(result.uf).toBe("PR");
    expect(result.foto).toBe("https://example.com/foto.jpg");
    expect(result.emExercicio).toBe(true);
  });

  it("handles suplente (not in exercise)", () => {
    const parlamentar = {
      IdentificacaoParlamentar: {
        CodigoParlamentar: "1000",
        NomeParlamentar: "Suplente",
      },
      DescricaoParticipacao: "Suplente",
      Mandato: {},
    };
    const result = parseSenadorResumo(parlamentar);
    expect(result.emExercicio).toBe(false);
  });

  it("handles entry with DataFim (no longer serving)", () => {
    const parlamentar = {
      IdentificacaoParlamentar: {
        CodigoParlamentar: "2000",
        NomeParlamentar: "Ex-Senador",
      },
      DataFim: "2023-06-01",
      Mandato: {},
    };
    const result = parseSenadorResumo(parlamentar);
    expect(result.emExercicio).toBe(false);
  });

  it("falls back to IdentificacaoParlamentar fields when Mandato is empty", () => {
    const parlamentar = {
      IdentificacaoParlamentar: {
        CodigoParlamentar: "3000",
        NomeParlamentar: "Teste",
        SiglaPartidoParlamentar: "PT",
        UfParlamentar: "SP",
      },
      Mandato: {},
    };
    const result = parseSenadorResumo(parlamentar);
    expect(result.partido).toBe("PT");
    expect(result.uf).toBe("SP");
  });

  it("defaults codigo to 0 when missing", () => {
    const result = parseSenadorResumo({});
    expect(result.codigo).toBe(0);
  });
});

describe("parseSenadorDetalhe", () => {
  it("parses full detail object", () => {
    const dados = {
      Parlamentar: {
        IdentificacaoParlamentar: {
          CodigoParlamentar: "5012",
          NomeParlamentar: "Flávio",
          NomeCompletoParlamentar: "Flávio Arns",
          SexoParlamentar: "Masculino",
          SiglaPartidoParlamentar: "PSB",
          UfParlamentar: "PR",
          UrlFotoParlamentar: "https://photo.jpg",
          EmailParlamentar: "flavio@senado.leg.br",
        },
        DadosBasicosParlamentar: {
          NomeCivilParlamentar: "Flávio Arns de Oliveira",
          DataNascimento: "1950-01-01",
          Naturalidade: "Curitiba",
          UfNaturalidade: "PR",
        },
        Mandatos: {
          Mandato: [
            {
              PrimeiraLegislaturaDoMandato: { NumeroLegislatura: "57" },
              UfParlamentar: "PR",
              DescricaoParticipacao: "Titular",
              DataInicio: "2023-02-01",
            },
          ],
        },
      },
    };
    const result = parseSenadorDetalhe(dados);
    expect(result.codigo).toBe(5012);
    expect(result.nome).toBe("Flávio");
    expect(result.nomeCompleto).toBe("Flávio Arns");
    expect(result.nomeCivil).toBe("Flávio Arns de Oliveira");
    expect(result.sexo).toBe("Masculino");
    expect(result.dataNascimento).toBe("1950-01-01");
    expect(result.partido).toBe("PSB");
    expect(result.uf).toBe("PR");
    expect(result.email).toBe("flavio@senado.leg.br");
    expect(result.mandatos).toHaveLength(1);
    expect(result.mandatos[0].legislatura).toBe(57);
  });

  it("handles missing nested fields gracefully", () => {
    const result = parseSenadorDetalhe({});
    expect(result.codigo).toBe(0);
    expect(result.nome).toBe("");
    expect(result.nomeCivil).toBeNull();
    expect(result.mandatos).toEqual([]);
  });

  it("wraps single mandato in array", () => {
    const dados = {
      Parlamentar: {
        IdentificacaoParlamentar: { CodigoParlamentar: "100" },
        DadosBasicosParlamentar: {},
        Mandatos: {
          Mandato: { PrimeiraLegislaturaDoMandato: { NumeroLegislatura: "56" }, UfParlamentar: "SP" },
        },
      },
    };
    const result = parseSenadorDetalhe(dados);
    expect(result.mandatos).toHaveLength(1);
    expect(result.mandatos[0].legislatura).toBe(56);
  });
});

describe("extractParlamentares (senadores module)", () => {
  it("extracts from ListaParlamentarEmExercicio", () => {
    const response = {
      ListaParlamentarEmExercicio: {
        Parlamentares: {
          Parlamentar: [{ IdentificacaoParlamentar: { NomeParlamentar: "A" } }],
        },
      },
    };
    expect(extractParlamentares(response)).toHaveLength(1);
  });

  it("returns empty for missing data", () => {
    expect(extractParlamentares({})).toEqual([]);
  });
});

describe("name search with diacritics normalization", () => {
  // Tests the normalization approach used by the search tool
  function normalize(s: string): string {
    return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  it("matches name without accents", () => {
    const name = "Flávio Arns";
    expect(normalize(name).includes(normalize("flavio"))).toBe(true);
  });

  it("matches accented search against accented name", () => {
    const name = "Flávio Arns";
    expect(normalize(name).includes(normalize("Flávio"))).toBe(true);
  });

  it("matches José without accent", () => {
    const name = "José Serra";
    expect(normalize(name).includes(normalize("jose"))).toBe(true);
  });

  it("is case-insensitive", () => {
    const name = "ROGÉRIO CARVALHO";
    expect(normalize(name).includes(normalize("rogério"))).toBe(true);
    expect(normalize(name).includes(normalize("ROGERIO"))).toBe(true);
  });
});
