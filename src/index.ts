/**
 * Cloudflare Worker entrypoint for senado-br-mcp.
 * Uses createMcpHandler (stateless, no Durable Objects).
 * Per-request McpServer instance (SDK 1.26.0+ requirement).
 */

import { createMcpHandler } from "agents/mcp";
import { checkAuth } from "./auth.js";
import { createServer } from "./server.js";
import { buildStatus } from "./status.js";
import type { Env } from "./types.js";
import { logger } from "./utils/logger.js";
import { incr, getMetrics } from "./metrics.js";
import { ICON_JPEG_BASE64 } from "./icon.js";
import { refreshEcidadania } from "./scraper/pipeline.js";
import { handlerRouteForPath, toolProfileForRoute } from "./app-surface.js";
import { legalResponseForPath } from "./legal.js";
import { landingResponseForPath } from "./landing.js";
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
    const server = createServer(env, ctx, { toolProfile });

    const handler = createMcpHandler(server, {
      route,
      corsOptions: {
        origin: env.ALLOWED_ORIGIN || "*",
        methods: "GET, POST, DELETE, OPTIONS",
        headers: "Content-Type, Accept, mcp-session-id, MCP-Protocol-Version, Authorization",
        maxAge: 86400,
      },
    });

    const response = await handler(request, env, ctx);
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
