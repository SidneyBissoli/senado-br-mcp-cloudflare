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
import { tagRequest } from "./instrument.js";
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
    const requestTag = tagRequest(request, env.SELF_MARKER);
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

    const handler = createMcpHandler(() => createServer(env, ctx, { toolProfile, requestTag }), {
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
