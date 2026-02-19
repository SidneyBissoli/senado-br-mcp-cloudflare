/**
 * Cloudflare Worker entrypoint for senado-br-mcp.
 * Uses createMcpHandler (stateless, no Durable Objects).
 * Per-request McpServer instance (SDK 1.26.0+ requirement).
 */

import { createMcpHandler } from "agents/mcp";
import { createServer } from "./server.js";
import type { Env } from "./types.js";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Health check — outside MCP handler
    if (url.pathname === "/health") {
      return new Response("ok", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Create new McpServer per request (required by SDK 1.26.0+)
    const server = createServer(env);

    const handler = createMcpHandler(server, {
      corsOptions: {
        origin: env.ALLOWED_ORIGIN || "*",
        methods: "GET, POST, DELETE, OPTIONS",
        headers: "Content-Type, mcp-session-id",
        maxAge: 86400,
      },
    });

    return handler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
