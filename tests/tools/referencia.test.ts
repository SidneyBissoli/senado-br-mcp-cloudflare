import { describe, it, expect } from "vitest";
import { TIPOS_MATERIA, UFS, extractParlamentares } from "../../src/tools/referencia.js";
import { digArrayRoot } from "../../src/utils/upstream-parse.js";

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
