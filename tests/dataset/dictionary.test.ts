import { describe, it, expect } from "vitest";
import { buildDictionaryMarkdown } from "../../src/dataset/dictionary.js";
import { ENTITY_SCHEMAS } from "../../src/dataset/schema.js";
import type { Entidade } from "../../src/scraper/pipeline.js";

describe("buildDictionaryMarkdown", () => {
  const md = buildDictionaryMarkdown("2026-07-02T00:00:00.000Z");

  it("cobre 100% das variáveis de todas as entidades", () => {
    for (const entidade of Object.keys(ENTITY_SCHEMAS) as Entidade[]) {
      expect(md).toContain(`\`${entidade}\``);
      for (const v of ENTITY_SCHEMAS[entidade].variables) {
        expect(md, `variável ${entidade}.${v.name} ausente no dicionário`).toContain(`\`${v.name}\``);
      }
    }
  });

  it("declara a semântica de retrievedAt e a nota do mesmo-run do status", () => {
    expect(md).toMatch(/retrievedAt.*scraped_at/s);
    expect(md).toMatch(/mesmo run/);
  });

  it("declara a convenção derived: e a transcodificação windows-1252", () => {
    expect(md).toContain("derived:ecidadania_history");
    expect(md).toContain("derived:calculo-local");
    expect(md).toMatch(/windows-1252/i);
  });

  it("registra os caveats de cobertura temporal (piso, censura, vintage único)", () => {
    expect(md).toContain("14/06/2026");
    expect(md).toMatch(/censurado à esquerda/i);
    expect(md).toMatch(/vintage único/i);
  });
});
