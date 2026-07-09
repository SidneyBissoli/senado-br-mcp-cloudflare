import { describe, it, expect } from "vitest";
import { createServer } from "../src/server.js";
import { TOOL_TITLES, titleForTool } from "../src/tool-titles.js";

/**
 * Anthropic Connectors Directory compliance: every registered tool must carry a
 * non-empty, human-readable `title` annotation. These tests guard against a new
 * tool being added without a corresponding TOOL_TITLES entry (which would ship
 * with only the name as its title) and against a title going empty.
 */
describe("tool titles", () => {
  const env = { CACHE_KV: {} as any };

  it("gives every registered tool a title in TOOL_TITLES", () => {
    const server = createServer(env as any);
    const names = Object.keys((server as any)._registeredTools);
    const missing = names.filter((name) => !(name in TOOL_TITLES));
    expect(missing, `tools sem título em TOOL_TITLES: ${missing.join(", ")}`).toEqual([]);
  });

  it("annotates every registered tool with a non-empty title", () => {
    const server = createServer(env as any);
    const tools = (server as any)._registeredTools as Record<string, { annotations?: { title?: string } }>;
    for (const [name, tool] of Object.entries(tools)) {
      expect(tool.annotations?.title, `tool ${name} sem annotations.title`).toBe(titleForTool(name));
      expect((tool.annotations?.title ?? "").length, `tool ${name} com título vazio`).toBeGreaterThan(0);
    }
  });

  it("has no stale TOOL_TITLES entries (every key maps to a registered tool)", () => {
    const server = createServer(env as any);
    const names = new Set(Object.keys((server as any)._registeredTools));
    const stale = Object.keys(TOOL_TITLES).filter((name) => !names.has(name));
    expect(stale, `entradas órfãs em TOOL_TITLES: ${stale.join(", ")}`).toEqual([]);
  });

  it("falls back to the tool name for an unknown tool", () => {
    expect(titleForTool("senado_ferramenta_inexistente")).toBe("senado_ferramenta_inexistente");
  });
});
