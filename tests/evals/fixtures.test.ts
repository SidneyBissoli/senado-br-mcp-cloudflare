/**
 * Offline guard for the eval harness — runs in `npm test`, no network, no model.
 *
 * This is the reusable regression signal the ROADMAP's *Contínuo* block depends on:
 * when a tool is renamed/removed in src/tools/*, the catalog extractor reflects it and
 * any fixture pointing at the old name fails HERE, immediately, for free.
 */

import { describe, it, expect } from "vitest";
import { buildCatalog, catalogToolNames, catalogAreaByName } from "../../evals/catalog.js";
import { FIXTURES } from "../../evals/fixtures/queries.js";

describe("catalog extractor", () => {
  it("collects the full live tool catalog (66 tools)", () => {
    const catalog = buildCatalog();
    // The repo currently ships 66 tools (see CLAUDE.md). If this number changes,
    // it should change deliberately — bump it here alongside the tool change.
    expect(catalog.length).toBe(66);
  });

  it("has no duplicate tool names", () => {
    const names = buildCatalog().map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every tool has a non-empty pt-BR description and an object inputSchema", () => {
    for (const t of buildCatalog()) {
      expect(t.name).toMatch(/^senado_/);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.inputSchema.type).toBe("object");
      expect(t.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("produces JSON-schema with required arrays derived from zod (e.g. obter_votacao requires codigoVotacao)", () => {
    const obter = buildCatalog().find((t) => t.name === "senado_obter_votacao");
    expect(obter).toBeDefined();
    expect(obter!.inputSchema.required).toContain("codigoVotacao");
    // search_votacoes has only optional params → empty required array
    const search = buildCatalog().find((t) => t.name === "senado_search_votacoes");
    expect(search!.inputSchema.required).toEqual([]);
  });
});

describe("fixtures", () => {
  it("has between 30 and 50 fixtures", () => {
    expect(FIXTURES.length).toBeGreaterThanOrEqual(30);
    expect(FIXTURES.length).toBeLessThanOrEqual(50);
  });

  it("has no duplicate ids", () => {
    const ids = FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has no duplicate queries", () => {
    const queries = FIXTURES.map((f) => f.query.trim().toLowerCase());
    expect(new Set(queries).size).toBe(queries.length);
  });

  it("every fixture has a non-empty expectedTools set", () => {
    for (const f of FIXTURES) {
      expect(Array.isArray(f.expectedTools)).toBe(true);
      expect(f.expectedTools.length).toBeGreaterThan(0);
      expect(new Set(f.expectedTools).size).toBe(f.expectedTools.length); // no dup within a fixture
    }
  });

  it("every expectedTool exists in the live catalog (catches tool renames)", () => {
    const names = catalogToolNames();
    const offenders: string[] = [];
    for (const f of FIXTURES) {
      for (const tool of f.expectedTools) {
        if (!names.has(tool)) offenders.push(`${f.id} -> ${tool}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every fixture has a useful query and note", () => {
    for (const f of FIXTURES) {
      expect(f.query.length).toBeGreaterThan(10);
      expect(f.note.length).toBeGreaterThan(0);
    }
  });

  it("covers a broad spread of functional areas (>= 12 distinct areas)", () => {
    const areaByName = catalogAreaByName();
    const areas = new Set<string>();
    for (const f of FIXTURES) {
      const area = areaByName.get(f.expectedTools[0]);
      if (area) areas.add(area);
    }
    expect(areas.size).toBeGreaterThanOrEqual(12);
  });
});
