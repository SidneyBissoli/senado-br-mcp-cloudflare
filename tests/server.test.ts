import { describe, it, expect } from "vitest";
import { createServer } from "../src/server.js";

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
});
