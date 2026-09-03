/**
 * Offline guard for the eval harness — runs in `npm test`, no network, no model.
 *
 * This is the reusable regression signal the ROADMAP's *Contínuo* block depends on:
 * when a tool is renamed/removed in src/tools/*, the catalog extractor reflects it and
 * any fixture pointing at the old name fails HERE, immediately, for free.
 *
 * The generic fixture invariants (unique ids/queries, non-empty expectedTools that
 * exist in the catalog, area coverage) are encoded in `validateFixtures` from
 * `@sbissoli/mcp-evals`; what stays here are the senado-specific assertions (exact
 * tool count, `senado_` prefix, schema spot-checks).
 */

import { describe, it, expect } from "vitest";
import { validateFixtures } from "@sbissoli/mcp-evals";
import { DEEP_RESEARCH_TOOLS } from "@sbissoli/mcp-search";
import { CATALOG } from "../../evals/catalog.js";
import { FIXTURES } from "../../evals/fixtures/queries.js";

describe("catalog extractor", () => {
  it("collects the full live tool catalog (69 tools)", () => {
    // The repo currently ships 69 tools (see CLAUDE.md). If this number changes,
    // it should change deliberately — bump it here alongside the tool change.
    expect(CATALOG.tools.length).toBe(69);
  });

  it("has no duplicate tool names", () => {
    expect(CATALOG.toolNames.size).toBe(CATALOG.tools.length);
  });

  it("every tool has a non-empty pt-BR description and an object inputSchema", () => {
    // `search`/`fetch` são o contrato Deep Research da OpenAI: nomes fixos, sem prefixo.
    const semPrefixo: readonly string[] = DEEP_RESEARCH_TOOLS;
    for (const t of CATALOG.tools) {
      if (!semPrefixo.includes(t.name)) expect(t.name).toMatch(/^senado_/);
      expect(t.description.length).toBeGreaterThan(20);
      expect(t.inputSchema.type).toBe("object");
      expect(t.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("produces JSON-schema with required arrays derived from zod (e.g. obter_votacao requires codigoVotacao)", () => {
    const obter = CATALOG.tools.find((t) => t.name === "senado_obter_votacao");
    expect(obter).toBeDefined();
    expect(obter!.inputSchema.required).toContain("codigoVotacao");
    // search_votacoes has only optional params → empty required array
    const search = CATALOG.tools.find((t) => t.name === "senado_search_votacoes");
    expect(search!.inputSchema.required).toEqual([]);
  });
});

describe("fixtures", () => {
  it("are valid against the live catalog (count 30–50, unique ids/queries, existing tools, >= 12 areas)", () => {
    expect(
      validateFixtures(FIXTURES, CATALOG, { minFixtures: 30, maxFixtures: 50, minAreas: 12 }),
    ).toEqual([]);
  });
});
