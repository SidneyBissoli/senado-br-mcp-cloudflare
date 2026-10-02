/**
 * Impressão digital da superfície (@sbissoli/mcp-surface): mudou sem subir a
 * versão = vermelho, e o deploy não roda (deploy-worker.yml roda `npm test`
 * antes do wrangler). Duas seções no `surface.lock.json`:
 *
 *  - `declarada`: um mapa POR PERFIL, porque este servidor serve duas
 *    superfícies — `full` (`/mcp` e a rota privada) e `openai-app`
 *    (`/mcp/openai-app` e `-v2`), com instructions e tools diferentes. Cada
 *    uma é `initialize` + tools/resources/templates/prompts do `createServer`.
 *  - `semToken`: quais métodos respondem sem credencial nas quatro rotas MCP,
 *    com `API_KEY` ausente (produção) e presente. Nenhuma listagem mostra
 *    isso; só a borda HTTP sabe medir.
 *
 * Ao mudar a superfície: `npm version <nível> --no-git-tag-version` e
 * `npm run surface:lock`. A trava recusa regravar sob a versão antiga.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  CABECALHOS_MCP,
  capturarSuperficie,
  comHost,
  conferirSecao,
  corpoDoPedido,
  ipDaSonda,
  medirSemToken,
  sondaSemToken,
} from "@sbissoli/mcp-surface";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MCP_ROUTE,
  OPENAI_APP_LEGACY_MCP_ROUTE,
  OPENAI_APP_MCP_ROUTE,
  SELF_MCP_ROUTE,
} from "../src/app-surface.js";
import worker from "../src/index.js";
import { createServer } from "../src/server.js";
import type { Env } from "../src/types.js";

const raiz = fileURLToPath(new URL("../", import.meta.url).href);
const trava = `${raiz}surface.lock.json`;
const versao = (JSON.parse(readFileSync(`${raiz}package.json`, "utf8")) as { version: string }).version;

/** KV que nunca acerta: a sonda não pode depender de cache aquecido. */
const kvVazio = {
  get: async () => null,
  put: async () => {},
  delete: async () => {},
  list: async () => ({ keys: [], list_complete: true }),
} as unknown as KVNamespace;

const HOST = "senado.sidneybissoli.com";
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;
const envs: Record<string, Env> = {
  apiKeyAusente: { CACHE_KV: kvVazio } as Env,
  apiKeyPresente: { CACHE_KV: kvVazio, API_KEY: "chave-da-sonda" } as Env,
};

// Organograma empacotado (src/estrutura): `tools/call` sem ir à rede do Senado,
// e a tool existe nos dois perfis.
const sonda = sondaSemToken({ name: "senado_estrutura_organizacional", arguments: { unidade: "DGER" } });
const rotas = [DEFAULT_MCP_ROUTE, SELF_MCP_ROUTE, OPENAI_APP_LEGACY_MCP_ROUTE, OPENAI_APP_MCP_ROUTE].map(r => `POST ${r}`);

const medirBorda = () =>
  medirSemToken(Object.keys(envs), rotas, sonda, (config, rota, pedido) =>
    worker.fetch(
      comHost(
        new Request(`https://${HOST}${rota.slice("POST ".length)}`, {
          method: "POST",
          headers: { ...CABECALHOS_MCP, "CF-Connecting-IP": ipDaSonda() },
          body: corpoDoPedido(pedido),
        }),
        HOST,
      ),
      envs[config]!,
      ctx,
    ),
  );

describe("surface.lock.json", () => {
  it("superfície declarada dos dois perfis bate com a trava, ou a versão subiu junto", async () => {
    const env = envs["apiKeyAusente"]!;
    const medido = {
      full: await capturarSuperficie(createServer(env, undefined, { toolProfile: "full" })),
      "openai-app": await capturarSuperficie(createServer(env, undefined, { toolProfile: "openai-app" })),
    };
    const v = conferirSecao(trava, "declarada", medido, versao);
    expect(v.ok, v.mensagem).toBe(true);
  });

  it("quem responde sem token bate com a trava, ou a versão subiu junto", async () => {
    const v = conferirSecao(trava, "semToken", await medirBorda(), versao);
    expect(v.ok, v.mensagem).toBe(true);
  }, 60_000);

  it("a sonda distingue as duas configurações (não mede só 200 vazio)", async () => {
    const m = await medirBorda();
    expect(m["apiKeyAusente"]?.["POST /mcp"]?.["tools/list"]).toBe(true);
    expect(m["apiKeyAusente"]?.["POST /mcp"]?.["tools/call"]).toBe(true);
    expect(m["apiKeyPresente"]?.["POST /mcp"]?.["tools/list"]).toBe(false);
  }, 60_000);
});
