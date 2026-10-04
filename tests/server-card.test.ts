/**
 * O server card (`/.well-known/mcp/server-card.json`) que a Smithery lê quando
 * a varredura do `/mcp` não completa — gerado por `@sbissoli/mcp-surface/card`.
 * Três provas: a forma (`serverInfo` com a versão do package.json), que o card
 * É a superfície travada do perfil `full` (o do /mcp), e que `authentication`
 * diz o que a borda MEDIU (`semToken`).
 *
 * A seção `declarada` aqui é um mapa POR PERFIL (`full`, `openai-app`), então
 * o card normalizado entra no lugar do `full` e o mapa inteiro tem de dar o
 * MESMO sha256 gravado. Nada pinado: versão, sha e autenticação vêm do
 * package.json e do surface.lock.json.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { impressaoDigital, lerTrava, normalizarSuperficie } from "@sbissoli/mcp-surface";
import { superficieDoCard } from "@sbissoli/mcp-surface/card";
import { describe, expect, it } from "vitest";

import worker from "../src/index.js";
import type { Env } from "../src/types.js";

const raiz = fileURLToPath(new URL("../", import.meta.url).href);
const caminhoTrava = `${raiz}surface.lock.json`;
const versao = (JSON.parse(readFileSync(`${raiz}package.json`, "utf8")) as { version: string }).version;

const kvVazio = {
  get: async () => null,
  put: async () => {},
  delete: async () => {},
  list: async () => ({ keys: [], list_complete: true }),
} as unknown as KVNamespace;
const ctx = { waitUntil: () => {}, passThroughOnException: () => {} } as unknown as ExecutionContext;

async function pedirCard(env: Env = { CACHE_KV: kvVazio } as Env): Promise<{ res: Response; card: Record<string, unknown> }> {
  const res = await worker.fetch(
    new Request("https://senado.sidneybissoli.com/.well-known/mcp/server-card.json"),
    env,
    ctx,
  );
  return { res, card: (await res.json()) as Record<string, unknown> };
}

describe("GET /.well-known/mcp/server-card.json", () => {
  it("responde 200 JSON com serverInfo.name e serverInfo.version do package.json", async () => {
    const { res, card } = await pedirCard();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/json");
    const serverInfo = card["serverInfo"] as { name?: unknown; version?: unknown } | undefined;
    expect(typeof serverInfo?.name).toBe("string");
    expect(serverInfo!.name).not.toBe("");
    expect(serverInfo!.version).toBe(versao);
  });

  it("é público: responde sem token mesmo com API_KEY configurada", async () => {
    const { res } = await pedirCard({ CACHE_KV: kvVazio, API_KEY: "chave-do-teste" } as Env);
    expect(res.status).toBe(200);
  });

  it("é a MESMA superfície do perfil full declarada no surface.lock.json", async () => {
    const declarada = lerTrava(caminhoTrava).declarada;
    expect(declarada, "trava sem seção declarada").toBeDefined();
    const perfis = declarada!.conteudo as Record<string, unknown>;
    const { card } = await pedirCard();
    const doCard = normalizarSuperficie(superficieDoCard(card));
    expect(impressaoDigital(doCard)).toBe(impressaoDigital(perfis["full"]));
    expect(impressaoDigital({ ...perfis, full: doCard })).toBe(declarada!.sha256);
  });

  it("authentication.required segue a seção semToken da trava", async () => {
    // Em produção (sem API_KEY), POST /mcp responde tools/list sem token: o
    // card tem de dizer que NÃO exige credencial. Lido da trava, não pinado.
    const semToken = lerTrava(caminhoTrava).semToken?.conteudo as
      | Record<string, Record<string, Record<string, boolean>>>
      | undefined;
    const abertoSemToken = semToken?.["apiKeyAusente"]?.["POST /mcp"]?.["tools/list"];
    expect(abertoSemToken, "trava sem semToken medido").toBe(true);
    const { card } = await pedirCard();
    expect(card["authentication"]).toEqual({ required: false });
  });
});
