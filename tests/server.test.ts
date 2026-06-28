import { describe, it, expect } from "vitest";
import { createServer } from "../src/server.js";
import {
  OPENAI_APP_TOOL_ALLOWLIST,
  OPENAI_APP_WIDGET_URI,
  SERVER_INSTRUCTIONS,
} from "../src/app-surface.js";
import {
  OPENAI_APP_WIDGET_MIME_TYPE,
  OPENAI_APP_WIDGET_RESOURCE_NAME,
} from "../src/openai-app-widget.js";

/**
 * Regression test: every tool group must actually be registered on the
 * McpServer instance. Guards against wiring mistakes in server.ts
 * (imports added but register call missing).
 */
describe("createServer", () => {
  const env = { CACHE_KV: {} as any };

  it("registers all tools (count matches the codebase)", () => {
    const server = createServer(env as any);
    const tools = (server as any)._registeredTools;
    expect(tools).toBeDefined();
    const names = Object.keys(tools);
    expect(names.length).toBe(66);
  });

  it("registers at least one tool from every group", () => {
    const server = createServer(env as any);
    const names = Object.keys((server as any)._registeredTools);
    const representatives = [
      "senado_tabelas_referencia",      // H
      "senado_listar_senadores",        // A
      "senado_buscar_materias",         // B
      "senado_search_votacoes",         // D
      "senado_listar_comissoes",        // E
      "senado_agenda_plenario",         // F
      "senado_search_processos",        // C
      "senado_ecidadania_listar_ideias",// G
      "senado_discursos_senador",       // I
      "senado_listar_blocos",           // J
      "senado_orcamento_parlamentar",   // K
      "senado_buscar_legislacao",       // L
      "senado_votacao_comissao",        // M
      "senado_notas_taquigraficas",     // N
      "senado_ceaps",                   // O
      "senado_servidores",              // P
      "senado_contratos",               // Q
      "senado_suprimento_fundos",       // R
      "senado_execucao_orcamentaria",   // S
    ];
    for (const name of representatives) {
      expect(names, `tool ${name} não registrado`).toContain(name);
    }
  });

  it("publishes server instructions for MCP clients", () => {
    const server = createServer(env as any);
    expect((server as any).server._instructions).toBe(SERVER_INSTRUCTIONS);
  });

  it("can expose the reduced OpenAI app tool surface", () => {
    const server = createServer(env as any, undefined, { toolProfile: "openai-app" });
    const tools = (server as any)._registeredTools;
    const names = Object.keys(tools);

    expect(OPENAI_APP_TOOL_ALLOWLIST.size).toBe(25);
    expect(names.length).toBe(OPENAI_APP_TOOL_ALLOWLIST.size);
    for (const name of OPENAI_APP_TOOL_ALLOWLIST) {
      expect(names, `OpenAI app tool ${name} não registrado`).toContain(name);
      expect(tools[name].annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      });
      expect(tools[name]._meta?.ui?.resourceUri).toBe(OPENAI_APP_WIDGET_URI);
      expect(tools[name]._meta?.["openai/outputTemplate"]).toBe(OPENAI_APP_WIDGET_URI);
    }
    expect(names).not.toContain("senado_suprimento_fundos");
  });

  it("registers the ChatGPT app widget only on the OpenAI app profile", () => {
    const fullServer = createServer(env as any);
    const appServer = createServer(env as any, undefined, { toolProfile: "openai-app" });

    expect((fullServer as any)._registeredResources[OPENAI_APP_WIDGET_URI]).toBeUndefined();

    const widget = (appServer as any)._registeredResources[OPENAI_APP_WIDGET_URI];
    expect(widget).toBeDefined();
    expect(widget.name).toBe(OPENAI_APP_WIDGET_RESOURCE_NAME);
    expect(widget.metadata.mimeType).toBe(OPENAI_APP_WIDGET_MIME_TYPE);
  });
});
