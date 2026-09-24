/**
 * Cloudflare Worker entrypoint for senado-br-mcp.
 * Uses createMcpHandler (stateless, no Durable Objects).
 * Per-request McpServer instance (SDK 1.26.0+ requirement).
 */

import { createMcpHandler } from "agents/mcp/server";
import { unknownCursorError } from "./pagination.js";
import { checkAuth } from "./auth.js";
import { createServer } from "./server.js";
import { buildStatus } from "./status.js";
import type { Env } from "./types.js";
import { logger } from "./utils/logger.js";
import { incr, getMetrics } from "./metrics.js";
import { recordProtocolMethods, sessionFromRequest, tagRequest, withSessionHeader } from "./instrument.js";
import { desfechosDoCorpo, teeResposta, type Desfecho } from "./envelope.js";
import { ICON_JPEG_BASE64 } from "./icon.js";
import { refreshEcidadania } from "./scraper/pipeline.js";
import { handlerRouteForPath, toolProfileForRoute } from "./app-surface.js";
import { legalResponseForPath } from "./legal.js";
import { landingResponseForPath } from "./landing.js";
import { discoveryResponseForPath } from "./discovery.js";
import { openAiAppsChallengeResponseForPath } from "./openai-domain-verification.js";

/** Decoded once per isolate — server logo bytes referenced by serverInfo.icons. */
const ICON_JPEG = Uint8Array.from(atob(ICON_JPEG_BASE64), (c) => c.charCodeAt(0));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const start = Date.now();
    incr("requests");

    // Landing page at the root — public. This is the URL advertised in the outgoing
    // User-Agent, so it must resolve to something human-readable (identification + contact).
    // robots.txt, sitemap.xml e a chave do IndexNow vêm ANTES da auth: um
    // rastreador não tem credencial, e robots.txt atrás de Bearer é o mesmo que
    // não ter robots.txt.
    const descoberta = discoveryResponseForPath(url.pathname);
    if (descoberta) return descoberta;

    const landingResponse = landingResponseForPath(url.pathname);
    if (landingResponse) {
      return landingResponse;
    }

    // Health check — outside MCP handler (always public)
    if (url.pathname === "/health") {
      return new Response("ok", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    const openAiChallengeResponse = openAiAppsChallengeResponseForPath(
      url.pathname,
      env.OPENAI_APPS_CHALLENGE_TOKEN,
    );
    if (openAiChallengeResponse) {
      return openAiChallengeResponse;
    }

    const legalResponse = legalResponseForPath(url.pathname);
    if (legalResponse) {
      return legalResponse;
    }

    // Server icon — public (referenced by serverInfo.icons; registries fetch it)
    if (url.pathname === "/icon.jpg") {
      return new Response(ICON_JPEG, {
        status: 200,
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    // Metrics endpoint — public (for monitoring systems)
    if (url.pathname === "/metrics") {
      return new Response(JSON.stringify(getMetrics()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Status endpoint — public. Surfaces version + last-deploy metadata (Vetor C) so
    // liveness and the current build are verifiable without the MCP handshake.
    if (url.pathname === "/status") {
      return new Response(JSON.stringify(buildStatus(env)), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }

    // Glama connector ownership verification — public, served on the domain.
    if (url.pathname === "/.well-known/glama.json") {
      return new Response(
        JSON.stringify({
          $schema: "https://glama.ai/mcp/schemas/connector.json",
          maintainers: [{ email: "sbissoli76@gmail.com" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // mcpindex.ai ownership challenge — public. Serves the temporary token from
    // the MCPINDEX_CHALLENGE secret (the claim's 15-minute window) as text/plain;
    // when the secret is absent (the permanent state) the route answers 404.
    if (url.pathname === "/.well-known/mcpindex-challenge") {
      if (!env.MCPINDEX_CHALLENGE) {
        return new Response("Not Found", {
          status: 404,
          headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
        });
      }
      return new Response(env.MCPINDEX_CHALLENGE, {
        status: 200,
        headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
      });
    }

    // CORS preflight never carries Authorization — skip auth
    if (request.method !== "OPTIONS") {
      const authResponse = await checkAuth(request, env.API_KEY);
      if (authResponse) {
        incr("authFailures");
        logger.warn("auth_failure", { method: request.method, path: url.pathname, status: authResponse.status });
        return authResponse;
      }
    }

    // Create new McpServer per request (required by SDK 1.26.0+). ctx enables the
    // e-Cidadania detail write-through (fire-and-forget via ctx.waitUntil).
    const toolProfile = toolProfileForRoute(url.pathname);
    const route = handlerRouteForPath(url.pathname, toolProfile);
    // Per-request context (self marker, country, AS) for the per-tool telemetry.
    // FÁBRICA, não instância. O SDK v2 exige um `McpServer` novo por request e
    // o `createMcpHandler` da `agents` 0.20+ recebe a função que o constrói —
    // era `createMcpHandler(server, …)` na v1. É também o que os cinco irmãos
    // do portfólio já fazem.
    // Cópia do corpo tirada ANTES do handler consumir o stream — é dela que o
    // guarda de cursor decide.
    const corpoMcp =
      request.method === "POST"
        ? await request
            .clone()
            .json()
            .catch(() => undefined)
        : undefined;
    // Sessão: o handler é stateless e não emite id; o Worker sorteia no
    // initialize e devolve no cabeçalho, e nas demais requisições lê o que o
    // cliente repetiu. Vai na telemetria (blob9). Ver src/instrument.ts.
    const sessao = sessionFromRequest(request, url.pathname === route ? corpoMcp : undefined);
    const requestTag = tagRequest(request, env.SELF_MARKER, sessao.id);

    // Recibo da instrumentTool: o que ela gravar nesta requisição fica aqui, e é
    // contra ele que recordProtocolMethods reconcilia. Ver src/instrument.ts.
    const gravados = new Map<string, number>();
    const handler = createMcpHandler(() => createServer(env, ctx, { toolProfile, requestTag, gravados }), {
      route,
      corsOptions: {
        origin: env.ALLOWED_ORIGIN || "*",
        methods: "GET, POST, DELETE, OPTIONS",
        headers: "Content-Type, Accept, mcp-session-id, MCP-Protocol-Version, Authorization",
        maxAge: 86400,
      },
    });

    // Cursor de paginação inválido -> JSON-RPC -32602 (ver src/pagination.ts).
    // DEPOIS do handler: quem valida Host e Origin é o `createMcpHandler`, e um
    // guarda antes dele responderia -32602 a uma requisição que a checagem de
    // segurança ia recusar com 403.
    const doHandler = await handler(request, env, ctx);
    const recusaDeCursor =
      doHandler.status === 200 && corpoMcp !== undefined ? unknownCursorError(corpoMcp) : undefined;

    let response = doHandler;
    if (recusaDeCursor) {
      incr("invalidCursor");
      void doHandler.body?.cancel();
      // 200 com erro JSON-RPC no corpo: a falha é de protocolo, não de HTTP.
      const corsOrigin = doHandler.headers.get("Access-Control-Allow-Origin");
      response = new Response(JSON.stringify(recusaDeCursor), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          ...(corsOrigin ? { "Access-Control-Allow-Origin": corsOrigin } : {}),
        },
      });
    }
    // Métodos de protocolo (initialize, tools/list, notifications/*...) não
    // passam pela instrumentTool, e nem toda `tools/call` passa: a recusa de
    // esquema é respondida pelo SDK antes do callback. As duas vão para o
    // Analytics Engine daqui, e só para o POST de uma rota MCP (fora dela
    // `route` é o default do perfil, não o caminho pedido). Ver
    // recordProtocolMethods em src/instrument.ts.
    //
    // O desfecho sai do ENVELOPE da resposta, não do HTTP — o protocolo MCP
    // manda escrever o erro dentro da mensagem e deixar o HTTP em 200. Para
    // lê-lo sem atrasar ninguém, o corpo é teado e o ramo de leitura corre em
    // `ctx.waitUntil`, DEPOIS de a resposta ter saído; o cliente recebe no mesmo
    // ritmo de antes. Esperar o fim do stream é também o que garante que a
    // instrumentTool já terminou de gravar, e portanto que o recibo está
    // completo. (A recusa de cursor acima também é lida daqui: o corpo dela
    // carrega o -32602, e o envelope o classifica como `contrato`.)
    response = withSessionHeader(response, sessao);
    const corpoDeProtocolo = url.pathname === route ? corpoMcp : undefined;
    if (corpoDeProtocolo !== undefined) {
      const status = response.status;
      const grava = (desfechos: Map<string, Desfecho>): void => {
        recordProtocolMethods(
          env.SENADO_ANALYTICS,
          requestTag,
          corpoDeProtocolo,
          status,
          desfechos,
          gravados,
        );
      };
      const { paraCliente, paraLeitura } = teeResposta(response);
      response = paraCliente;
      if (paraLeitura) {
        ctx.waitUntil(
          desfechosDoCorpo(paraLeitura)
            .then(grava)
            .catch(() => grava(new Map())),
        );
      } else {
        grava(new Map()); // resposta sem corpo: vale o HTTP, como antes
      }
    }

    const ms = Date.now() - start;
    logger.info("request", { method: request.method, path: url.pathname, status: response.status, ms });
    return response;
  },

  // Cron-triggered refresh of the e-Cidadania highlight lists into D1 (P2). Scrapes the cheap
  // REST lists and upserts current + appends history, guarded so an anomalous/errored run never
  // overwrites the last good state. No HTML scraping in this path.
  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    try {
      const summaries = await refreshEcidadania(env);
      logger.info("ecidadania_sync", { cron: controller.cron, summaries });
    } catch (e) {
      logger.error("ecidadania_sync_failed", { error: e instanceof Error ? e.message : String(e) });
    }
  },
} satisfies ExportedHandler<Env>;
