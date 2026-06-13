import { describe, it, expect } from "vitest";
import { parseSenadorResumo, parseSenadorDetalhe, extractParlamentares, parseVotoSenador, parseLicenca, parseComissaoMembro, parseCargoSenador } from "../../src/tools/senadores.js";

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

describe("parseVotoSenador", () => {
  const votacao = {
    codigoSessao: 64512,
    codigoSessaoVotacao: 7244,
    dataSessao: "2024-03-12T00:00:00",
    identificacao: "PL 123/2024",
    descricaoVotacao: "Votação nominal do PL 123/2024",
    resultadoVotacao: "Aprovado",
    votos: [
      { codigoParlamentar: 5672, descricaoVotoParlamentar: "Sim" },
      { codigoParlamentar: 9999, descricaoVotoParlamentar: "Não" },
    ],
  };

  it("extracts the senator's own vote", () => {
    const result = parseVotoSenador(votacao, 5672);
    expect(result.codigoVotacao).toBe(7244);
    expect(result.data).toBe("2024-03-12");
    expect(result.materia).toBe("PL 123/2024");
    expect(result.voto).toBe("Sim");
    expect(result.resultado).toBe("Aprovado");
  });

  it("returns empty voto when the senator is not in the roll call", () => {
    const result = parseVotoSenador(votacao, 1234);
    expect(result.voto).toBe("");
    expect(result.materia).toBe("PL 123/2024");
  });

  it("builds materia from sigla/numero/ano when identificacao is missing", () => {
    const result = parseVotoSenador(
      { sigla: "PEC", numero: "45", ano: 2019, votos: [] },
      1,
    );
    expect(result.materia).toBe("PEC 45/2019");
  });
});

describe("parseLicenca", () => {
  it("parses a licença entry", () => {
    const result = parseLicenca({
      Codigo: "24703",
      DataInicio: "2025-10-20",
      DataFim: "2025-11-19",
      DescricaoFinalidade: "Licença particular",
    });
    expect(result.codigo).toBe(24703);
    expect(result.dataInicio).toBe("2025-10-20");
    expect(result.descricao).toBe("Licença particular");
  });
});

describe("parseComissaoMembro", () => {
  it("parses a committee membership", () => {
    const result = parseComissaoMembro({
      IdentificacaoComissao: {
        CodigoComissao: "2040",
        SiglaComissao: "CRA",
        NomeComissao: "Comissão de Agricultura",
        SiglaCasaComissao: "SF",
      },
      DescricaoParticipacao: "Titular",
      DataInicio: "2023-03-01",
    });
    expect(result.codigo).toBe(2040);
    expect(result.sigla).toBe("CRA");
    expect(result.participacao).toBe("Titular");
    expect(result.dataFim).toBeNull();
  });
});

describe("parseCargoSenador", () => {
  it("parses a committee position", () => {
    const result = parseCargoSenador({
      IdentificacaoComissao: { SiglaComissao: "FPE", NomeComissao: "Frente Parlamentar", SiglaCasaComissao: "SF" },
      DescricaoCargo: "Presidente",
      DataInicio: "2023-04-01",
      DataFim: "2025-01-31",
    });
    expect(result.comissao).toBe("FPE");
    expect(result.cargo).toBe("Presidente");
    expect(result.dataFim).toBe("2025-01-31");
  });
});
