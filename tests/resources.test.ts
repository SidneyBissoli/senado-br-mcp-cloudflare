import { describe, it, expect } from "vitest";
import { buildGuia, buildCatalogo, buildGlossario } from "../src/resources.js";
import { TIPOS_MATERIA, UFS } from "../src/tools/referencia.js";

describe("resource builders", () => {
  it("guia covers the main tool groups", () => {
    const g = buildGuia();
    expect(g).toContain("# Senado BR MCP");
    expect(g).toContain("senado_listar_senadores");
    expect(g).toContain("e-Cidadania");
    expect(g).toContain("senado_tabelas_referencia");
  });

  it("catalogo lists 65 and a representative tool from each end", () => {
    const c = buildCatalogo();
    expect(c).toContain("(65)");
    expect(c).toContain("senado_search_votacoes");
    expect(c).toContain("senado_execucao_orcamentaria");
  });

  it("glossario explains key acronyms", () => {
    const g = buildGlossario();
    for (const term of ["CEAPS", "PEC", "CCJ", "RCN", "e-Cidadania"]) {
      expect(g).toContain(term);
    }
  });

  it("reference tables are intact and JSON-serializable", () => {
    expect(TIPOS_MATERIA.length).toBeGreaterThan(5);
    expect(UFS).toHaveLength(27);
    expect(() => JSON.stringify({ TIPOS_MATERIA, UFS })).not.toThrow();
  });
});
