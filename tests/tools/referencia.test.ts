import { describe, it, expect } from "vitest";
import {
  TIPOS_MATERIA, UFS, caminhoLegislaturaNaData, extractParlamentares, parseLegislaturaVigente,
} from "../../src/tools/referencia.js";
import { RootNotFoundError, digArrayRoot } from "../../src/utils/upstream-parse.js";

/** Shape of `/plenario/legislatura/{data}` as measured on 15/11/2026 (sessions trimmed). */
function legislaturaNaData(numero: string, dataInicio: string, dataFim: string) {
  return {
    ListaLegislatura: {
      Legislaturas: {
        Legislatura: [{ NumeroLegislatura: numero, DataInicio: dataInicio, DataFim: dataFim, DataEleicao: "2022-10-02" }],
      },
    },
  };
}

describe("legislatura-atual (read from /plenario/legislatura/{data}, no pinned fallback)", () => {
  it("builds the upstream path from Brasília's ISO date", () => {
    expect(caminhoLegislaturaNaData("2026-11-15")).toBe("/plenario/legislatura/20261115");
  });

  it("copies number and dates from the source and composes the period from their years", () => {
    expect(parseLegislaturaVigente(legislaturaNaData("57", "2023-02-01", "2027-01-31"))).toEqual({
      numero: 57, periodo: "2023-2027", dataInicio: "2023-02-01", dataFim: "2027-01-31",
    });
  });

  it("follows the source across the turn of the legislature (2027-02-01 answers the 58th)", () => {
    expect(parseLegislaturaVigente(legislaturaNaData("58", "2027-02-01", "2031-01-31"))).toMatchObject({
      numero: 58, periodo: "2027-2031",
    });
  });

  it("accepts a single legislatura object (not wrapped in an array)", () => {
    const r = { ListaLegislatura: { Legislaturas: { Legislatura: { NumeroLegislatura: "57", DataInicio: "2023-02-01", DataFim: "2027-01-31" } } } };
    expect(parseLegislaturaVigente(r).numero).toBe(57);
  });

  it("fails loudly instead of guessing when the source sends no legislatura", () => {
    expect(() => parseLegislaturaVigente({ ListaLegislatura: { Legislaturas: {} } })).toThrow(RootNotFoundError);
    expect(() => parseLegislaturaVigente({ ListaLegislatura: { Legislaturas: { Legislatura: [] } } })).toThrow(RootNotFoundError);
    expect(() => parseLegislaturaVigente(legislaturaNaData("57", "", "2027-01-31"))).toThrow(RootNotFoundError);
    expect(() => parseLegislaturaVigente({})).toThrow(RootNotFoundError);
  });
});

describe("tipos-norma root (BUG-027)", () => {
  // tiposNorma 301-redirects to dados/ListaTiposDocumento.json:
  // ListaTiposDocumento.TiposDocumento.TipoDocumento[] (was read as ListaTiposNorma.TiposNorma.TipoNorma).
  it("resolves the norm types at the real dump root", () => {
    const response = {
      ListaTiposDocumento: {
        TiposDocumento: {
          TipoDocumento: [
            { Codigo: "18", Sigla: "ACD", Descricao: "Ato do Presidente da Câmara dos Deputados" },
          ],
        },
      },
    };
    const tipos = digArrayRoot(
      response,
      [["ListaTiposDocumento", "TiposDocumento", "TipoDocumento"]],
      "t",
    ).map((t: any) => ({ sigla: t.Sigla, descricao: t.Descricao }));
    expect(tipos).toHaveLength(1);
    expect(tipos[0].sigla).toBe("ACD");
  });
});

describe("TIPOS_MATERIA", () => {
  it("is a non-empty array", () => {
    expect(TIPOS_MATERIA.length).toBeGreaterThan(0);
  });

  it("each entry has sigla, nome, descricao", () => {
    for (const tipo of TIPOS_MATERIA) {
      expect(tipo.sigla).toBeTruthy();
      expect(tipo.nome).toBeTruthy();
      expect(tipo.descricao).toBeTruthy();
    }
  });

  it("includes PEC, PL, PLP, MPV", () => {
    const siglas = TIPOS_MATERIA.map((t) => t.sigla);
    expect(siglas).toContain("PEC");
    expect(siglas).toContain("PL");
    expect(siglas).toContain("PLP");
    expect(siglas).toContain("MPV");
  });
});

describe("UFS", () => {
  it("has 27 entries (26 states + DF)", () => {
    expect(UFS).toHaveLength(27);
  });

  it("each entry has sigla and nome", () => {
    for (const uf of UFS) {
      expect(uf.sigla).toHaveLength(2);
      expect(uf.nome).toBeTruthy();
    }
  });

  it("includes major states", () => {
    const siglas = UFS.map((u) => u.sigla);
    expect(siglas).toContain("SP");
    expect(siglas).toContain("RJ");
    expect(siglas).toContain("MG");
    expect(siglas).toContain("DF");
  });
});

describe("extractParlamentares", () => {
  it("extracts from ListaParlamentarEmExercicio", () => {
    const response = {
      ListaParlamentarEmExercicio: {
        Parlamentares: {
          Parlamentar: [
            { IdentificacaoParlamentar: { NomeParlamentar: "Senador A" } },
            { IdentificacaoParlamentar: { NomeParlamentar: "Senador B" } },
          ],
        },
      },
    };
    const result = extractParlamentares(response);
    expect(result).toHaveLength(2);
  });

  it("extracts from ListaParlamentarLegislatura", () => {
    const response = {
      ListaParlamentarLegislatura: {
        Parlamentares: {
          Parlamentar: [{ IdentificacaoParlamentar: { NomeParlamentar: "Senador X" } }],
        },
      },
    };
    const result = extractParlamentares(response);
    expect(result).toHaveLength(1);
  });

  it("wraps single object in array", () => {
    const response = {
      ListaParlamentarEmExercicio: {
        Parlamentares: {
          Parlamentar: { IdentificacaoParlamentar: { NomeParlamentar: "Solo" } },
        },
      },
    };
    const result = extractParlamentares(response);
    expect(result).toHaveLength(1);
  });

  it("returns empty array for missing data", () => {
    expect(extractParlamentares({})).toEqual([]);
    expect(extractParlamentares(null)).toEqual([]);
    expect(extractParlamentares(undefined)).toEqual([]);
  });
});
