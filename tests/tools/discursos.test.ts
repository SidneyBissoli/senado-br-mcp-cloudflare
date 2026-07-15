import { describe, it, expect } from "vitest";
import {
  parseDiscursoResumo,
  parseDiscursoPlenario,
  buildDiscursosSenadorResult,
  DISCURSOS_SEM_PERIODO_AVISO,
} from "../../src/tools/discursos.js";
import { ensureArray } from "../../src/utils/validation.js";
import { digArrayRoot } from "../../src/utils/upstream-parse.js";

describe("parseDiscursoPlenario (BUG-024)", () => {
  // v4 plenary shape: Data/Resumo/NomeAutor (not DataPronunciamento/TextoResumo/NomeParlamentar).
  it("parses a v4 plenary pronouncement", () => {
    const p = {
      CodigoPronunciamento: "522783",
      Data: "2026-06-15",
      Casa: "Senado Federal",
      TipoUsoPalavra: { Descricao: "Não classificado" },
      Resumo: "Encerramento de Sessão Especial.",
      Indexacao: "ENCERRAMENTO, SESSÃO ESPECIAL.",
      TextoIntegral: "https://www25.senado.leg.br/web/atividade/pronunciamentos/-/p/texto/522783",
      NomeAutor: "Eduardo Girão",
      CodigoParlamentar: "5976",
      Partido: "NOVO",
      UF: "CE",
    };
    const r = parseDiscursoPlenario(p);
    expect(r.codigo).toBe("522783");
    expect(r.data).toBe("2026-06-15");
    expect(r.tipoUsoPalavra).toBe("Não classificado");
    expect(r.nomeParlamentar).toBe("Eduardo Girão");
    expect(r.codigoParlamentar).toBe(5976);
    expect(r.partido).toBe("NOVO");
    expect(r.uf).toBe("CE");
  });

  it("flatMaps Sessoes.Sessao[].Pronunciamentos.Pronunciamento[] from the real root", () => {
    const response = {
      DiscursosSessao: {
        Sessoes: {
          Sessao: [
            {
              CodigoSessao: "1",
              Pronunciamentos: {
                Pronunciamento: [
                  { CodigoPronunciamento: "a", NomeAutor: "X" },
                  { CodigoPronunciamento: "b", NomeAutor: "Y" },
                ],
              },
            },
          ],
        },
      },
    };
    const sessoes = digArrayRoot(response, [["DiscursosSessao", "Sessoes", "Sessao"]], "t");
    const discursos = sessoes.flatMap((s: any) =>
      ensureArray(s?.Pronunciamentos?.Pronunciamento).map(parseDiscursoPlenario),
    );
    expect(discursos).toHaveLength(2);
    expect(discursos.map((d) => d.codigo)).toEqual(["a", "b"]);
  });
});

describe("discursos_senador nomeParlamentar (BUG-025)", () => {
  // The name lives once at Parlamentar.IdentificacaoParlamentar, not per pronunciamento;
  // parseDiscursoResumo alone leaves it null, so the handler injects it.
  it("parseDiscursoResumo leaves nomeParlamentar null for a per-item pronunciamento", () => {
    const item = { CodigoPronunciamento: "522586", DataPronunciamento: "2026-04-01", TextoResumo: "x" };
    expect(parseDiscursoResumo(item).nomeParlamentar).toBeNull();
  });

  it("the response-level name injection populates every item", () => {
    const r = {
      DiscursosParlamentar: {
        Parlamentar: {
          IdentificacaoParlamentar: { NomeParlamentar: "Paulo Paim" },
          Pronunciamentos: {
            Pronunciamento: [
              { CodigoPronunciamento: "1", DataPronunciamento: "2026-04-01" },
              { CodigoPronunciamento: "2", DataPronunciamento: "2026-05-01" },
            ],
          },
        },
      },
    };
    const nome = r.DiscursosParlamentar.Parlamentar.IdentificacaoParlamentar.NomeParlamentar;
    const discursos = ensureArray(r.DiscursosParlamentar.Parlamentar.Pronunciamentos.Pronunciamento)
      .map(parseDiscursoResumo)
      .map((d) => ({ ...d, nomeParlamentar: d.nomeParlamentar ?? nome }));
    expect(discursos).toHaveLength(2);
    expect(discursos.every((d) => d.nomeParlamentar === "Paulo Paim")).toBe(true);
  });
});

describe("buildDiscursosSenadorResult (achado #8)", () => {
  // O upstream /senador/{cod}/discursos limita a resposta aos últimos 30 dias
  // quando o período é omitido; o aviso evita a conclusão errada de "senador
  // sem discursos". Apartes não têm essa janela.
  it("anexa aviso para tipo=discursos sem período", () => {
    const r = buildDiscursosSenadorResult(581, "discursos", [], false);
    expect(r.aviso).toBe(DISCURSOS_SEM_PERIODO_AVISO);
    expect(r.count).toBe(0);
  });

  it("anexa aviso mesmo com resultados (a lista não é o histórico)", () => {
    const r = buildDiscursosSenadorResult(581, "discursos", [{ codigo: "1" }], false);
    expect(r.aviso).toBe(DISCURSOS_SEM_PERIODO_AVISO);
    expect(r.count).toBe(1);
  });

  it("não anexa aviso quando o período foi informado", () => {
    const r = buildDiscursosSenadorResult(581, "discursos", [], true);
    expect(r.aviso).toBeUndefined();
  });

  it("não anexa aviso para tipo=apartes (upstream traz o histórico completo)", () => {
    const r = buildDiscursosSenadorResult(581, "apartes", [], false);
    expect(r.aviso).toBeUndefined();
    expect(r.tipo).toBe("apartes");
  });
});

describe("parseDiscursoResumo", () => {
  it("parses a PascalCase speech summary", () => {
    const d = {
      Pronunciamento: {
        CodigoPronunciamento: "12345",
        DataPronunciamento: "2024-06-15",
        SiglaCasaPronunciamento: "SF",
        TipoUsoPalavra: { Descricao: "Discurso" },
        TextoResumo: "O senador tratou de...",
        Indexacao: "educação; saúde",
        UrlTexto: "https://example.com/texto/12345",
        NomeParlamentar: "Senador Fulano",
      },
    };
    const result = parseDiscursoResumo(d);
    expect(result.codigo).toBe("12345");
    expect(result.data).toBe("2024-06-15");
    expect(result.casa).toBe("SF");
    expect(result.tipoUsoPalavra).toBe("Discurso");
    expect(result.resumo).toBe("O senador tratou de...");
    expect(result.indexacao).toBe("educação; saúde");
    expect(result.url).toBe("https://example.com/texto/12345");
    expect(result.nomeParlamentar).toBe("Senador Fulano");
  });

  it("parses a camelCase speech summary", () => {
    const d = {
      codigoPronunciamento: 99999,
      dataPronunciamento: "2024-03-10",
      siglaCasa: "CN",
      tipoUsoPalavra: "Explicação Pessoal",
      resumo: "O senador esclareceu...",
      indexacao: "política",
      urlTexto: "https://example.com/texto/99999",
      nomeParlamentar: "Senadora Ciclana",
    };
    const result = parseDiscursoResumo(d);
    expect(result.codigo).toBe(99999);
    expect(result.data).toBe("2024-03-10");
    expect(result.casa).toBe("CN");
    expect(result.tipoUsoPalavra).toBe("Explicação Pessoal");
    expect(result.resumo).toBe("O senador esclareceu...");
    expect(result.nomeParlamentar).toBe("Senadora Ciclana");
  });

  it("returns nulls for empty object", () => {
    const result = parseDiscursoResumo({});
    expect(result.codigo).toBeNull();
    expect(result.data).toBeNull();
    expect(result.casa).toBeNull();
    expect(result.tipoUsoPalavra).toBeNull();
    expect(result.resumo).toBeNull();
    expect(result.indexacao).toBeNull();
    expect(result.url).toBeNull();
    expect(result.nomeParlamentar).toBeNull();
  });

  it("handles nested Pronunciamento wrapper with empty content", () => {
    const d = { Pronunciamento: {} };
    const result = parseDiscursoResumo(d);
    expect(result.codigo).toBeNull();
    expect(result.resumo).toBeNull();
  });

  it("resolves TipoUsoPalavra.Descricao over flat string", () => {
    const d = {
      Pronunciamento: {
        TipoUsoPalavra: { Descricao: "Apartes" },
      },
    };
    const result = parseDiscursoResumo(d);
    expect(result.tipoUsoPalavra).toBe("Apartes");
  });
});
