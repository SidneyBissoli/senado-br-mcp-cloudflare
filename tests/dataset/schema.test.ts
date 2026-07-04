import { describe, it, expect } from "vitest";
import { ENTITY_SCHEMAS, selectValue, DATASET_SCHEMA_VERSION } from "../../src/dataset/schema.js";
import type { Entidade } from "../../src/scraper/pipeline.js";

describe("ENTITY_SCHEMAS — integridade do esquema", () => {
  const entidades = Object.keys(ENTITY_SCHEMAS) as Entidade[];

  it("cobre as 4 entidades do corpus + o nível-comentário (v2)", () => {
    expect(entidades.sort()).toEqual([
      "consultas", "consultas_votos", "eventos", "eventos_comentarios", "ideias",
    ]);
  });

  it("eventos_comentarios não guarda nome do comentarista (só UF)", () => {
    const names = ENTITY_SCHEMAS.eventos_comentarios.variables.map((v) => v.name);
    expect(names).toContain("uf");
    expect(names).not.toContain("nome");
    expect(names).not.toContain("autor");
  });

  it("toda variável tem nome/tipo/descrição/endpoint/campo/operacionalização não-vazios", () => {
    for (const e of entidades) {
      for (const v of ENTITY_SCHEMAS[e].variables) {
        for (const k of ["name", "type", "description", "sourceEndpoint", "sourceField", "operationalization"] as const) {
          expect(v[k], `${e}.${v.name}.${k}`).toBeTruthy();
        }
      }
    }
  });

  it("nomes de variáveis são únicos dentro de cada entidade", () => {
    for (const e of entidades) {
      const names = ENTITY_SCHEMAS[e].variables.map((v) => v.name);
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it("todo sourceEndpoint derived: é um dos marcadores previstos", () => {
    const allowed = new Set(["derived:ecidadania_history", "derived:calculo-local"]);
    for (const e of entidades) {
      for (const v of ENTITY_SCHEMAS[e].variables) {
        if (v.sourceEndpoint.startsWith("derived:")) {
          expect(allowed.has(v.sourceEndpoint), `${e}.${v.name}: ${v.sourceEndpoint}`).toBe(true);
          expect(v.derived).toBe(true);
        }
      }
    }
  });

  it("selectValue: default lê payload[name]; custom select tem precedência; undefined vira null", () => {
    const materia = ENTITY_SCHEMAS.consultas.variables.find((v) => v.name === "materia")!;
    expect(selectValue(materia, { payload: { materia: "PL 1/2020" }, meta: { retrievedAt: "x" } })).toBe("PL 1/2020");
    expect(selectValue(materia, { payload: {}, meta: { retrievedAt: "x" } })).toBeNull();

    const firstSeen = ENTITY_SCHEMAS.consultas.variables.find((v) => v.name === "firstSeenAt")!;
    expect(selectValue(firstSeen, { payload: {}, meta: { retrievedAt: "x", firstSeenAt: "2026-06-22" } })).toBe("2026-06-22");
  });

  it("consultas_votos não declara firstSeenAt (acervo sem série)", () => {
    const names = ENTITY_SCHEMAS.consultas_votos.variables.map((v) => v.name);
    expect(names).not.toContain("firstSeenAt");
    expect(names).toContain("referencePeriod");
  });

  it("schemaVersion segue semver", () => {
    expect(DATASET_SCHEMA_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
