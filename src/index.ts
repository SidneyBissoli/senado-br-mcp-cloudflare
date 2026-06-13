/**
 * Cloudflare Worker entrypoint for senado-br-mcp.
 * Uses createMcpHandler (stateless, no Durable Objects).
 * Per-request McpServer instance (SDK 1.26.0+ requirement).
 */

import { createMcpHandler } from "agents/mcp";
import { checkAuth } from "./auth.js";
import { createServer } from "./server.js";
import type { Env } from "./types.js";
import { logger } from "./utils/logger.js";
import { incr, getMetrics } from "./metrics.js";
import { ICON_JPEG_BASE64 } from "./icon.js";

/** Decoded once per isolate — server logo bytes referenced by serverInfo.icons. */
const ICON_JPEG = Uint8Array.from(atob(ICON_JPEG_BASE64), (c) => c.charCodeAt(0));

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const start = Date.now();
    incr("requests");

    // Health check — outside MCP handler (always public)
    if (url.pathname === "/health") {
      return new Response("ok", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
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

    // CORS preflight never carries Authorization — skip auth
    if (request.method !== "OPTIONS") {
      const authResponse = await checkAuth(request, env.API_KEY);
      if (authResponse) {
        incr("authFailures");
        logger.warn("auth_failure", { method: request.method, path: url.pathname, status: authResponse.status });
        return authResponse;
      }
    }

    // Create new McpServer per request (required by SDK 1.26.0+)
    const server = createServer(env);

    const handler = createMcpHandler(server, {
      corsOptions: {
        origin: env.ALLOWED_ORIGIN || "*",
        methods: "GET, POST, DELETE, OPTIONS",
        headers: "Content-Type, mcp-session-id, Authorization",
        maxAge: 86400,
      },
    });

    const response = await handler(request, env, ctx);
    const ms = Date.now() - start;
    logger.info("request", { method: request.method, path: url.pathname, status: response.status, ms });
    return response;
  },
} satisfies ExportedHandler<Env>;
