import { describe, it, expect } from "vitest";
import { toISODate, formatISO, lastDayOfMonth, parseVotacaoItem } from "../../src/tools/votacoes.js";

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
      ementa: "Altera a Constituição",
      descricaoVotacao: "Aprovação do texto",
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
});
