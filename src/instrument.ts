/**
 * Per-tool-call instrumentation.
 *
 * Goal: measure *which tool the agent selected* and whether it succeeded, so the
 * later tool-consolidation decision (P1) rests on real usage instead of guesses.
 *
 * Two sinks:
 *  - In-memory per-tool tallies (metrics.ts) — a live smoke test at /metrics for
 *    the current isolate only.
 *  - Analytics Engine — durable, queryable via SQL; the decision-grade signal.
 *
 * Instrumentation is observability, never the critical path: a failure here must
 * not add latency nor alter a tool's response. `writeDataPoint` is synchronous and
 * fire-and-forget in the Workers runtime (returns void, flushed out of band), so
 * there is nothing to await and no need for ctx.waitUntil — a try/catch is the
 * correct and sufficient guard.
 *
 * Privacy: only the tool name, a coarse ok/error status, cache-outcome counts,
 * aggregable request context (country, AS organization, owner's self-use marker),
 * and — since 2026-09-10 — the SHAPE of the call: the NAMES of the parameters
 * supplied and a closed-vocabulary error class. No user query content, no
 * parameter VALUES, no IP and no PII ever reach Analytics Engine. The reasoning
 * for that line, and why the shape was worth adding, is in src/call-shape.ts.
 *
 * Request context (blobs 4–6): hosted AI-platform connectors egress from the
 * platform's own servers (e.g. Anthropic in the US), so country/AS is the only way
 * to tell that traffic apart in aggregate — and the owner's own use through such a
 * connector is only identifiable via the secret header his MCP clients send
 * (SELF_HEADER, value = the SELF_MARKER Wrangler secret).
 */

// Loosely typed to match the group modules' `server.tool(name, desc, shape, cb)`
// callback. The real signature comes from the MCP SDK; we only need to invoke it
// and inspect the `isError` flag on its result.
type ToolCallback = (...args: unknown[]) => Promise<unknown> | unknown;

import { classifyError, errorText, paramNames, type ErrorClass } from "./call-shape.js";
import { incr, incrTool } from "./metrics.js";
import { callCache, cacheClass, type CallCacheStats } from "./observability/call-context.js";

/** Header the owner's MCP clients send (value = the SELF_MARKER secret). */
export const SELF_HEADER = "x-mcp-self";

/**
 * Rota privada do dono: mesma superficie, mesmo resultado, outro ENDERECO.
 *
 * O marcador por header so funciona em cliente que aceita header custom, e o
 * conector do claude.ai nao aceita — e e por ele que o dono mais usa os
 * proprios servidores. Medido em 28/08/2026: o header pegava UMA chamada por
 * produto por semana; todo o resto do uso proprio saia dos servidores da
 * Anthropic, indistinguivel de terceiro, inflando a adocao.
 *
 * O conector nao manda header, mas aponta para qualquer URL. Entao a
 * separacao vem da ROTA: chamada que chega aqui e uso proprio por construcao.
 *
 * O caminho e adivinhavel de proposito (o dono precisa cola-lo em varios
 * clientes). O risco e um varredor cair aqui e ser contado como dono: sujeira
 * no balde do uso proprio, nao vazamento — a rota serve o mesmo conteudo
 * publico. Detectavel olhando pais/AS das chamadas marcadas.
 */
export const SELF_ROUTE = "/mcp/uso-proprio";

/** Per-request context, computed once in the Worker's fetch handler. */
export interface RequestTag {
  self: boolean;
  country: string;
  asOrg: string;
}

/** Extracts country/AS from request.cf and matches the self-use secret header. */
export function tagRequest(request: Request, selfSecret?: string): RequestTag {
  const cf = (request as { cf?: IncomingRequestCfProperties }).cf;
  return {
    self:
      (!!selfSecret && request.headers.get(SELF_HEADER) === selfSecret) ||
      new URL(request.url).pathname === SELF_ROUTE,
    country: typeof cf?.country === "string" ? cf.country : "",
    asOrg: typeof cf?.asOrganization === "string" ? cf.asOrganization : "",
  };
}

export function instrumentTool(
  name: string,
  cb: ToolCallback,
  analytics?: AnalyticsEngineDataset,
  tag?: RequestTag,
): ToolCallback {
  return async (...args: unknown[]) => {
    incr("toolCalls");
    let isError = false;
    let classe: ErrorClass | "" = "";
    // Per-call store the cache layer increments per upstream fetch (see call-context.ts).
    const stats: CallCacheStats = { fetches: 0, hits: 0 };
    try {
      const result = await callCache.run(stats, () => cb(...args));
      isError =
        typeof result === "object" && result !== null && (result as { isError?: unknown }).isError === true;
      if (isError) classe = classifyError(errorText(result));
      return result;
    } catch (e) {
      // A thrown error is also a failed tool call — record it, then rethrow so the
      // SDK still produces the normal error response.
      isError = true;
      classe = classifyError(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      // ATENÇÃO ao que NÃO chega aqui: erro de validação do esquema. O SDK o
      // responde ANTES do callback, então a chamada não é contada nem como
      // chamada nem como erro. Medido em 10/09/2026 pelo /metrics: três
      // chamadas com argumento de forma errada não moveram o contador.
      recordToolCall(name, isError, stats, analytics, tag, classe, paramNames(args));
    }
  };
}

function recordToolCall(
  name: string,
  isError: boolean,
  stats: CallCacheStats,
  analytics?: AnalyticsEngineDataset,
  tag?: RequestTag,
  errorClass: ErrorClass | "" = "",
  params = "",
): void {
  incrTool(name, isError);
  if (!analytics) return;
  try {
    analytics.writeDataPoint({
      // Low-cardinality index → cheap GROUP BY in SQL. The tool name only.
      indexes: [name],
      // blob1 = tool name (for GROUP BY without relying on the index), blob2 = outcome,
      // blob3 = cache class of the call (cached | live | partial | none),
      // blob4 = "self" when the owner's secret header matched, blob5 = country,
      // blob6 = AS organization (request.cf) — same positions in every portfolio MCP.
      // blob7 = error class (closed vocabulary, "" when the call succeeded),
      // blob8 = NAMES of the parameters supplied, comma-separated — never values.
      blobs: [
        name,
        isError ? "error" : "ok",
        cacheClass(stats),
        tag?.self ? "self" : "",
        tag?.country ?? "",
        tag?.asOrg ?? "",
        errorClass,
        params,
      ],
      // double1 = error flag (error rate via avg); double2 = upstream fetches in the call;
      // double3 = how many were cache hits (fetch-level cache-hit ratio via sum/sum).
      doubles: [isError ? 1 : 0, stats.fetches, stats.hits],
    });
  } catch {
    // Swallow: a telemetry failure must never break or slow a tool response.
  }
}

/**
 * Métodos de PROTOCOLO, gravados na camada HTTP.
 *
 * `instrumentTool` só vê `tools/call`: ela envolve o callback da tool.
 * `initialize`, `tools/list`, `notifications/*`, `ping` e o que mais o
 * cliente mande (`server/discover`, por exemplo) atravessam o transporte sem
 * tocar tool nenhuma — e são eles que contam o FUNIL DE SESSÃO: quantos
 * `initialize` viram chamada de ferramenta de verdade, que é o que separa
 * "acharam o servidor" de "usaram o servidor". Medido em 2026-09-10: só o
 * sih-br-mcp os gravava, porque lá o Worker é um proxy que lê o corpo
 * JSON-RPC antes de encaminhar. Aqui o servidor roda dentro do Worker, e o
 * corpo vem de uma CÓPIA tirada antes de o handler consumir o stream
 * (src/index.ts). Desde 2026-09-16 a frota inteira grava igual.
 *
 * Mesmo esquema de blobs, com o método no lugar do nome da tool — igual ao
 * sih. O painel separa os dois pelo nome (`metodo_de_protocolo`). Classe de
 * cache, classe de erro e parâmetros ficam vazios; fetches e hits, zero.
 *
 * O que entra, e de onde vem o desfecho:
 *  - todo método que não é `tools/call` → uma linha, "ok" se o HTTP da
 *    resposta for < 400, "error" senão. LIMITAÇÃO, a mesma do sih: erro
 *    JSON-RPC que viaja dentro de um 200 (método desconhecido, -32601) sai
 *    como "ok" — ler exigiria consumir o corpo que está sendo devolvido;
 *  - `tools/call` só quando o HTTP é ≥ 400: o transporte recusou antes de
 *    despachar (Accept errado, sessão inválida, Origin estrangeiro) e a tool
 *    nunca rodou; sem isto a recusa seria invisível. Com HTTP < 400 a
 *    `instrumentTool` já gravou a linha, com o desfecho de verdade — não se
 *    grava de novo;
 *  - lote JSON-RPC (array) → uma linha por item; item sem `method` (resposta
 *    do cliente, corpo que não é JSON) → nada.
 *
 * Só no Analytics Engine: os contadores do /metrics continuam contando tools.
 */
export function protocolNamesFromBody(body: unknown, status: number): string[] {
  const itens = Array.isArray(body) ? body : [body];
  const nomes: string[] = [];
  for (const item of itens) {
    if (!item || typeof item !== "object") continue;
    const msg = item as { method?: unknown; params?: unknown };
    if (typeof msg.method !== "string" || msg.method === "") continue;
    if (msg.method === "tools/call") {
      if (status < 400) continue; // instrumentTool já gravou esta
      const params = msg.params as { name?: unknown } | undefined;
      nomes.push(typeof params?.name === "string" && params.name !== "" ? params.name : "tools/call");
    } else {
      nomes.push(msg.method);
    }
  }
  return nomes;
}

/**
 * Grava no Analytics Engine os métodos de protocolo de um POST no endpoint
 * MCP (ver protocolNamesFromBody). Devolve os nomes gravados. Sem binding,
 * não grava nada.
 */
export function recordProtocolMethods(
  analytics: AnalyticsEngineDataset | undefined,
  tag: RequestTag | undefined,
  body: unknown,
  status: number,
): string[] {
  if (!analytics || body === undefined) return [];
  const nomes = protocolNamesFromBody(body, status);
  const isError = status >= 400;
  for (const name of nomes) {
    try {
      analytics.writeDataPoint({
        indexes: [name],
        blobs: [name, isError ? "error" : "ok", "", tag?.self ? "self" : "", tag?.country ?? "", tag?.asOrg ?? "", "", ""],
        doubles: [isError ? 1 : 0, 0, 0],
      });
    } catch {
      // Falha de telemetria nunca quebra nem atrasa a resposta.
    }
  }
  return nomes;
}
