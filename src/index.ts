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

/** Server logo (neoclassical legislative facade) — referenced by serverInfo.icons. */
const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Senado BR MCP">
  <rect width="512" height="512" rx="104" fill="#0E4D78"/>
  <polygon points="256,92 440,182 72,182" fill="#F2C200"/>
  <g fill="#FFFFFF">
    <rect x="88" y="196" width="336" height="26" rx="4"/>
    <rect x="110" y="234" width="30" height="182"/>
    <rect x="174" y="234" width="30" height="182"/>
    <rect x="238" y="234" width="30" height="182"/>
    <rect x="302" y="234" width="30" height="182"/>
    <rect x="366" y="234" width="30" height="182"/>
    <rect x="96" y="416" width="320" height="16" rx="3"/>
    <rect x="72" y="432" width="368" height="24" rx="6"/>
  </g>
</svg>`;

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
    if (url.pathname === "/icon.svg") {
      return new Response(ICON_SVG, {
        status: 200,
        headers: {
          "Content-Type": "image/svg+xml",
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
