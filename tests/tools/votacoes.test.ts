import { describe, it, expect } from "vitest";
import { toISODate, formatISO, lastDayOfMonth, parseVotacaoItem, expandirResultado, acharPorCodigoVotacao } from "../../src/tools/votacoes.js";

describe("toISODate", () => {
  it("converts YYYYMMDD to YYYY-MM-DD", () => {
    expect(toISODate("20240315")).toBe("2024-03-15");
  });

  it("handles January", () => {
    expect(toISODate("20240101")).toBe("2024-01-01");
  });

  it("handles December", () => {
    expect(toISODate("20241231")).toBe("2024-12-31");
  });

  it("handles edge dates", () => {
    expect(toISODate("19000101")).toBe("1900-01-01");
    expect(toISODate("21001231")).toBe("2100-12-31");
  });
});

describe("formatISO", () => {
  it("formats a Date as YYYY-MM-DD", () => {
    const d = new Date(2024, 2, 15); // March 15, 2024
    expect(formatISO(d)).toBe("2024-03-15");
  });

  it("zero-pads single-digit months and days", () => {
    const d = new Date(2024, 0, 5); // Jan 5, 2024
    expect(formatISO(d)).toBe("2024-01-05");
  });

  it("handles last day of year", () => {
    const d = new Date(2024, 11, 31); // Dec 31, 2024
    expect(formatISO(d)).toBe("2024-12-31");
  });
});

describe("lastDayOfMonth", () => {
  it("returns 31 for January", () => {
    expect(lastDayOfMonth(2024, 1)).toBe(31);
  });

  it("returns 29 for Feb in leap year", () => {
    expect(lastDayOfMonth(2024, 2)).toBe(29);
  });

  it("returns 28 for Feb in non-leap year", () => {
    expect(lastDayOfMonth(2023, 2)).toBe(28);
  });

  it("returns 30 for April", () => {
    expect(lastDayOfMonth(2024, 4)).toBe(30);
  });

  it("returns 31 for December", () => {
    expect(lastDayOfMonth(2024, 12)).toBe(31);
  });

  it("handles all months correctly", () => {
    const expected2024 = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    for (let m = 1; m <= 12; m++) {
      expect(lastDayOfMonth(2024, m)).toBe(expected2024[m - 1]);
    }
  });
});

describe("parseVotacaoItem", () => {
  it("parses basic vote item", () => {
    const item = {
      codigoSessao: "12345",
      codigoSessaoVotacao: "67890",
      dataSessao: "2024-03-15T14:30:00",
      identificacao: "PEC 45/2024",
      codigoMateria: "151234",
      ementa: "Altera a Constitui\u00e7\u00e3o",
      descricaoVotacao: "Aprova\u00e7\u00e3o do texto",
      resultadoVotacao: "Aprovada",
      totalVotosSim: 55,
      totalVotosNao: 20,
      totalVotosAbstencao: 2,
      votacaoSecreta: "N",
    };
    const result = parseVotacaoItem(item);
    expect(result.codigoSessao).toBe("12345");
    expect(result.codigoVotacao).toBe("67890");
    expect(result.data).toBe("2024-03-15");
    expect(result.materia).toBe("PEC 45/2024");
    expect(result.totalSim).toBe(55);
    expect(result.totalNao).toBe(20);
    expect(result.secreta).toBe(false);
  });

  it("expands the raw resultado code (OBS-4)", () => {
    const r = parseVotacaoItem({ resultadoVotacao: "A" });
    expect(r.resultado).toBe("Aprovada");
    expect(r.resultadoCodigo).toBe("A");
    const r2 = parseVotacaoItem({ resultadoVotacao: "R" });
    expect(r2.resultado).toBe("Rejeitada");
    expect(r2.resultadoCodigo).toBe("R");
  });

  it("strips time from dataSessao", () => {
    const item = { dataSessao: "2024-06-01T10:00:00" };
    const result = parseVotacaoItem(item);
    expect(result.data).toBe("2024-06-01");
  });

  it("constructs materia from sigla/numero/ano when identificacao is missing", () => {
    const item = { sigla: "PL", numero: "100", ano: "2024" };
    const result = parseVotacaoItem(item);
    expect(result.materia).toBe("PL 100/2024");
  });

  it("detects secret votes", () => {
    expect(parseVotacaoItem({ votacaoSecreta: "S" }).secreta).toBe(true);
    expect(parseVotacaoItem({ votacaoSecreta: "N" }).secreta).toBe(false);
    expect(parseVotacaoItem({}).secreta).toBe(false);
  });

  it("expandirResultado passes unknown/absent codes through (OBS-4)", () => {
    expect(expandirResultado("P")).toEqual({ resultado: "Prejudicada", resultadoCodigo: "P" });
    expect(expandirResultado("Aprovada")).toEqual({ resultado: "Aprovada", resultadoCodigo: "Aprovada" });
    expect(expandirResultado(null)).toEqual({ resultado: null, resultadoCodigo: null });
    expect(expandirResultado("")).toEqual({ resultado: null, resultadoCodigo: null });
  });

  it("includes nominal votes when requested", () => {
    const item = {
      votos: [
        {
          codigoParlamentar: 5012,
          nomeParlamentar: "Senador A",
          siglaPartidoParlamentar: "PT",
          siglaUFParlamentar: "SP",
          descricaoVotoParlamentar: "Sim",
        },
      ],
    };
    const result = parseVotacaoItem(item, true);
    expect(result.votos).toHaveLength(1);
    expect(result.votos[0].nomeSenador).toBe("Senador A");
    expect(result.votos[0].voto).toBe("Sim");
  });

  it("does not include votes when not requested", () => {
    const item = {
      votos: [{ codigoParlamentar: 5012, nomeParlamentar: "A" }],
    };
    const result = parseVotacaoItem(item, false);
    expect(result.votos).toBeUndefined();
  });

  it("handles empty/missing votos gracefully", () => {
    const result = parseVotacaoItem({}, true);
    expect(result.votos).toBeUndefined();
  });

  // BUG-005: open roll calls return null totals but carry votos[]; recompute the tally.
  it("computes the placar from votos when totals are null (open vote)", () => {
    const item = {
      votos: [
        { siglaVotoParlamentar: "Sim" },
        { siglaVotoParlamentar: "Sim" },
        { siglaVotoParlamentar: "N\u00e3o" },
        { siglaVotoParlamentar: "Absten\u00e7\u00e3o" },
        { siglaVotoParlamentar: "P-NRV" }, // non-vote, excluded
        { siglaVotoParlamentar: "AP" }, // non-vote, excluded
      ],
    };
    const r = parseVotacaoItem(item);
    expect(r.totalSim).toBe(2);
    expect(r.totalNao).toBe(1);
    expect(r.totalAbstencao).toBe(1);
    expect(r.placarComputado).toBe(true);
  });

  it("does not recompute when totals are already present", () => {
    const item = { totalVotosSim: 55, totalVotosNao: 20, totalVotosAbstencao: 2, votos: [{ siglaVotoParlamentar: "Sim" }] };
    const r = parseVotacaoItem(item);
    expect(r.totalSim).toBe(55);
    expect(r.placarComputado).toBeUndefined();
  });
});

// ── Os dois espaços de numeração de /votacao ──────────────────────────────────
//
// A guarda fixa o PAR, não o valor ([[notacao-do-codigo-limpa-dos-dois-lados]]):
// o que o conserto de 24/09/2026 promete é que 7101 e 581816 levem à MESMA
// votação, e que um código de nenhum dos dois espaços não devolva vazio.
//
// Item copiado da resposta real de `/votacao?codigoSessao=581816` em
// 24/09/2026 (votos truncados). O conferidor NÃO monta a URL como o handler:
// ele exercita `acharPorCodigoVotacao` sobre a lista crua, que é a parte que
// antes não existia ([[guarda-que-reusa-o-padrao-do-defeito]]).
const ITEM_PLP_124 = {
  codigoSessao: 581816,
  codigoSessaoVotacao: 7101,
  dataSessao: "2026-08-12T14:00:00",
  identificacao: "PLP 124/2022 (Substitutivo-CD)",
  codigoMateria: 171682,
  descricaoVotacao:
    "Votação nominal do Substitutivo da Câmara dos Deputados ao Projeto de Lei Complementar nº 124, de 2022.",
  resultadoVotacao: "A",
  votacaoSecreta: "N",
  votos: [
    { codigoParlamentar: 5322, nomeParlamentar: "Teste Um", siglaPartidoParlamentar: "MDB", siglaUFParlamentar: "ES", descricaoVotoParlamentar: "Sim" },
    { codigoParlamentar: 5323, nomeParlamentar: "Teste Dois", siglaPartidoParlamentar: "PT", siglaUFParlamentar: "BA", descricaoVotoParlamentar: "Sim" },
  ],
};

/** As outras duas votações da MESMA sessão — é por isso que a sessão não serve de chave única. */
const OUTRAS_DA_SESSAO = [
  { codigoSessao: 581816, codigoSessaoVotacao: 7102, dataSessao: "2026-08-12T19:40:00", resultadoVotacao: "A" },
  { codigoSessao: 581816, codigoSessaoVotacao: 7103, dataSessao: "2026-08-12T20:03:00", resultadoVotacao: "A" },
];

const BASE_CRUA = [ITEM_PLP_124, ...OUTRAS_DA_SESSAO];

describe("acharPorCodigoVotacao — os dois espaços de numeração", () => {
  it("acha a votação pelo codigoVotacao de 4 dígitos, que a fonte não filtra", () => {
    const achado = acharPorCodigoVotacao(BASE_CRUA, 7101);
    expect(achado).toBeDefined();
    expect(achado.codigoSessao).toBe(581816);
  });

  it("o par 7101/581816 aponta para a MESMA votação", () => {
    // Caminho A: o código da votação, resolvido na janela.
    const porVotacao = parseVotacaoItem(acharPorCodigoVotacao(BASE_CRUA, 7101), true);
    // Caminho B: o código da sessão, que é o filtro que a fonte honra — a
    // sessão devolve as três votações, e a do PLP 124 é a de codigoVotacao 7101.
    const daSessao = BASE_CRUA.filter((v) => v.codigoSessao === 581816);
    const porSessao = parseVotacaoItem(
      daSessao.find((v) => v.codigoSessaoVotacao === 7101),
      true,
    );
    expect(porVotacao).toEqual(porSessao);
    expect(porVotacao.materia).toBe("PLP 124/2022 (Substitutivo-CD)");
    expect(porVotacao.votos).toHaveLength(2);
  });

  it("o codigoSessao NÃO é codigoVotacao: 581816 não se acha neste espaço", () => {
    // Se isto passasse a achar, os dois espaços teriam colidido e o passo 2 do
    // handler poderia responder a pergunta errada.
    expect(acharPorCodigoVotacao(BASE_CRUA, 581816)).toBeUndefined();
  });

  it("código de nenhum dos dois espaços não se acha — e o handler erra em vez de devolver vazio", () => {
    expect(acharPorCodigoVotacao(BASE_CRUA, 99999999)).toBeUndefined();
    // 13059 é o codigoVotacaoSve de senado_orientacao_bancada: um TERCEIRO
    // espaço, que não aparece uma vez em /votacao.
    expect(acharPorCodigoVotacao(BASE_CRUA, 13059)).toBeUndefined();
  });

  it("compara como número dos dois lados, e não trata ausência como zero", () => {
    expect(acharPorCodigoVotacao([{ codigoSessaoVotacao: "7101" }], 7101)).toBeDefined();
    for (const vazio of [null, undefined, ""]) {
      expect(acharPorCodigoVotacao([{ codigoSessaoVotacao: vazio }], 0)).toBeUndefined();
    }
  });

  it("aceita lista vazia e payload que não é lista", () => {
    expect(acharPorCodigoVotacao([], 7101)).toBeUndefined();
    expect(acharPorCodigoVotacao(null, 7101)).toBeUndefined();
  });
});

describe("parseVotacaoItem — expõe os dois códigos", () => {
  it("nomeia cada espaço com o seu campo", () => {
    const r = parseVotacaoItem(ITEM_PLP_124, true);
    expect(r.codigoSessao).toBe(581816);
    expect(r.codigoVotacao).toBe(7101);
  });
});
