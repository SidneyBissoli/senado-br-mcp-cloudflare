import { describe, it, expect } from "vitest";
import { digObjectRoot } from "../../src/utils/upstream-parse.js";
import { classifyError } from "../../src/call-shape.js";
import { parseSenadorResumo, parseSenadorDetalhe, extractParlamentares, parseVotoSenador, parseLicenca, parseMandato, parseComissaoMembro, parseCargoSenador, matchesPartido, derivarEmExercicio } from "../../src/tools/senadores.js";

describe("matchesPartido (OBS-6)", () => {
  it("matches exact and common short forms", () => {
    expect(matchesPartido("PODEMOS", "PODE")).toBe(true);
    expect(matchesPartido("PODEMOS", "PODEMOS")).toBe(true);
    expect(matchesPartido("PT", "PT")).toBe(true);
    expect(matchesPartido("MDB", "mdb")).toBe(true);
  });
  it("does not over-match short siglas", () => {
    expect(matchesPartido("PPS", "PP")).toBe(false);
    expect(matchesPartido("PL", "PT")).toBe(false);
    expect(matchesPartido(null, "PT")).toBe(false);
    expect(matchesPartido("PT", "")).toBe(false);
  });
});
import { digArrayRoot } from "../../src/utils/upstream-parse.js";

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

  // Até 24/09/2026 o parser devolvia `emExercicio: true` FIXO, e o servidor se
  // contradizia sobre gente real: o código 6358 (Ana Paula Lobato, suplente com
  // exercício encerrado em 30/07/2026) saía `true` aqui e `false` em
  // `senado_senadores_afastados`. O campo agora nasce sem afirmação nenhuma.
  it("nunca afirma emExercicio: o detalhe não carrega exercício", () => {
    expect(parseSenadorDetalhe({}).emExercicio).toBeNull();
    const comMandato = {
      Parlamentar: {
        IdentificacaoParlamentar: { CodigoParlamentar: "6358" },
        DadosBasicosParlamentar: {},
        Mandatos: { Mandato: [{ UfParlamentar: "MA", DescricaoParticipacao: "1º Suplente" }] },
      },
    };
    expect(parseSenadorDetalhe(comMandato).emExercicio).toBeNull();
  });
});

// A ausência que o upstream responde com HTTP 200. O envelope abaixo é a
// resposta LITERAL de /senador/999999.json em 24/09/2026 (200, 304 bytes):
// metadados presentes, nó `Parlamentar` ausente. `fetchSenadorDetalhe` decide
// por esta mesma chamada, então o que se guarda aqui é a decisão dela.
describe("ausência com HTTP 200 no detalhe do senador", () => {
  const CANDIDATOS = [["DetalheParlamentar", "Parlamentar"], ["Parlamentar"]];
  const vazio = {
    DetalheParlamentar: {
      noNamespaceSchemaLocation: "https://legis.senado.leg.br/dadosabertos/dados/DetalheParlamentarv6.xsd",
      Metadados: {
        Versao: "24/09/2026 00:13:24",
        VersaoServico: "6",
        DataVersaoServico: "2021-09-09",
        DescricaoDataSet: "Retorna os detalhes de um Senador informado no parâmetro.",
      },
    },
  };

  it("código inexistente vira erro, nunca um registro montado de defaults", () => {
    expect(() =>
      digObjectRoot(vazio, CANDIDATOS, "senado_obter_senador", {
        notFoundMessage: "Senador com código 999999 não encontrado.",
      }),
    ).toThrow(/não encontrado/);
    // O que o parser faria com o envelope se a borda não barrasse: um senador
    // inteiro, de mentira, com `codigo: 0` e nome vazio.
    expect(parseSenadorDetalhe(vazio.DetalheParlamentar).codigo).toBe(0);
  });

  it("a mensagem cai em `nao_encontrado` na telemetria, não em `outro`", () => {
    expect(classifyError("Senador com código 999999 não encontrado.")).toBe("nao_encontrado");
  });

  it("senador que existe atravessa a mesma borda", () => {
    const real = { DetalheParlamentar: { Parlamentar: { IdentificacaoParlamentar: { CodigoParlamentar: "5672" } } } };
    const dados = digObjectRoot(real, CANDIDATOS, "senado_obter_senador");
    expect(parseSenadorDetalhe(dados).codigo).toBe(5672);
  });
});

// Casos reais capturados de /senador/{codigo}/mandatos em 24/09/2026. A regra
// foi medida contra as duas listas oficiais: 123 senadores, 123 acertos.
describe("derivarEmExercicio", () => {
  const HOJE = "2026-09-24";
  const mandato = (exercicios: unknown) => [{ Exercicios: { Exercicio: exercicios } }];

  it("exercício aberto é exercício em curso (titular 5672 e suplente 5906)", () => {
    expect(derivarEmExercicio(mandato([{ DataInicio: "2023-02-01" }]), HOJE)).toBe(true);
    expect(
      derivarEmExercicio(
        mandato([
          { DataInicio: "2024-12-29" },
          { DataInicio: "2022-05-24", DataFim: "2022-09-21" },
        ]),
        HOJE,
      ),
    ).toBe(true);
  });

  it("todos os exercícios encerrados é fora de exercício (afastada 6358)", () => {
    expect(
      derivarEmExercicio(
        mandato([
          { DataInicio: "2024-02-21", DataFim: "2026-07-30" },
          { DataInicio: "2023-02-02", DataFim: "2024-01-31" },
        ]),
        HOJE,
      ),
    ).toBe(false);
  });

  it("exercício que ainda não começou não conta", () => {
    expect(derivarEmExercicio(mandato([{ DataInicio: "2027-02-01" }]), HOJE)).toBe(false);
  });

  it("o último dia do exercício ainda é exercício (a fronteira é fechada)", () => {
    expect(derivarEmExercicio(mandato([{ DataInicio: "2023-02-01", DataFim: HOJE }]), HOJE)).toBe(true);
  });

  it("sem exercício para ler devolve null, nunca false", () => {
    // mandatos vazios = sub-endpoint indisponível; mandato sem Exercicios = o
    // upstream não publicou o bloco. Nos dois casos não se sabe — e `false`
    // afirmaria que a pessoa está fora de exercício.
    expect(derivarEmExercicio([], HOJE)).toBeNull();
    expect(derivarEmExercicio([{ UfParlamentar: "MA" }], HOJE)).toBeNull();
    expect(derivarEmExercicio(mandato([{ DataFim: "2024-01-31" }]), HOJE)).toBeNull();
  });

  it("aceita o Exercicio único que o upstream manda fora de array", () => {
    expect(derivarEmExercicio(mandato({ DataInicio: "2023-02-01" }), HOJE)).toBe(true);
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

  it("emite o PAR de códigos, não um dos dois", () => {
    // Conserto de 24/09/2026. Esta tool devolvia só o codigoSessaoVotacao e a
    // descrição dela mandava usar senado_obter_votacao com ele — que filtra por
    // codigoSessao e respondia `count: 0`. Medido na produção: 48 de 48 votos de
    // um senador em 2026 vinham com o código de 4 dígitos, ou seja, o caminho
    // documentado quebrava SEMPRE. Emitir os dois faz o `obter_votacao` acertar
    // de primeira, sem varrer janela.
    const result = parseVotoSenador(votacao, 5672);
    expect(result.codigoSessao).toBe(64512);
    expect(result.codigoVotacao).toBe(7244);
    expect(result.codigoSessao).not.toBe(result.codigoVotacao);
  });

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

  // BUG-008: real upstream field is DescricaoTipoAfastamento (was mapped from a
  // non-existent field -> descricao always null).
  it("maps descricao/sigla from the real DescricaoTipoAfastamento (BUG-008)", () => {
    const result = parseLicenca({
      Codigo: "24703",
      DataInicio: "2025-10-20",
      DataFim: "2025-11-19",
      SiglaTipoAfastamento: "LICENCA_ATIVIDADE_PARLAMENTAR",
      DescricaoTipoAfastamento: "Licença para tratar de interesse particular",
    });
    expect(result.descricao).toBe("Licença para tratar de interesse particular");
    expect(result.sigla).toBe("LICENCA_ATIVIDADE_PARLAMENTAR");
  });
});

describe("parseMandato (BUG-007)", () => {
  it("parses a mandate spanning two legislaturas from the /mandatos sub-endpoint", () => {
    const result = parseMandato({
      CodigoMandato: "523",
      UfParlamentar: "RS",
      PrimeiraLegislaturaDoMandato: { NumeroLegislatura: "56", DataInicio: "2019-02-01", DataFim: "2023-01-31" },
      SegundaLegislaturaDoMandato: { NumeroLegislatura: "57", DataInicio: "2023-02-01", DataFim: "2027-01-31" },
      DescricaoParticipacao: "Titular",
    });
    expect(result.legislatura).toBe(56);
    expect(result.uf).toBe("RS");
    expect(result.participacao).toBe("Titular");
    expect(result.dataInicio).toBe("2019-02-01");
    expect(result.dataFim).toBe("2027-01-31"); // ends at the second legislatura
  });

  it("resolves mandates at the real /mandatos root", () => {
    const resp = {
      MandatoParlamentar: { Parlamentar: { Mandatos: { Mandato: [{ UfParlamentar: "RS", PrimeiraLegislaturaDoMandato: { NumeroLegislatura: "57" } }] } } },
    };
    const mandatos = digArrayRoot(resp, [["MandatoParlamentar", "Parlamentar", "Mandatos", "Mandato"]], "t").map(parseMandato);
    expect(mandatos).toHaveLength(1);
    expect(mandatos[0].legislatura).toBe(57);
  });
});

describe("profissoes root (BUG-009)", () => {
  // /profissao responds under the anomalous HistoricoAcademicoParlamentar wrapper.
  it("resolves professions under HistoricoAcademicoParlamentar", () => {
    const resp = {
      HistoricoAcademicoParlamentar: { Parlamentar: { Profissoes: { Profissao: { NomeProfissao: "Metalúrgico" } } } },
    };
    const itens = digArrayRoot(
      resp,
      [["HistoricoAcademicoParlamentar", "Parlamentar", "Profissoes", "Profissao"]],
      "t",
    );
    expect(itens).toHaveLength(1);
    expect((itens[0] as any).NomeProfissao).toBe("Metalúrgico");
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
