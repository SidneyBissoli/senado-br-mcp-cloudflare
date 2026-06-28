/**
 * Public liveness/status payload (Vetor C — make the live, own-infra deployment visible).
 *
 * Surfaces the server version and the real last-deploy metadata (id/tag/timestamp from the
 * Workers `version_metadata` binding) at GET /status, so registries, monitors and users can
 * verify the server is up and on which build — without the MCP handshake. The deploy block is
 * omitted when the binding is absent (local dev / tests), so the endpoint always degrades cleanly.
 */

import { VERSION } from "./version.js";
import { OPENAI_APP_MCP_ROUTE } from "./app-surface.js";
import { PRIVACY_URL, TERMS_URL } from "./legal.js";
import type { Env } from "./types.js";

export function buildStatus(env: Env) {
  const meta = env.CF_VERSION_METADATA;
  return {
    status: "ok" as const,
    name: "senado-br-mcp",
    version: VERSION,
    mcp: "/mcp",
    openaiAppMcp: OPENAI_APP_MCP_ROUTE,
    legal: {
      privacy: PRIVACY_URL,
      terms: TERMS_URL,
    },
    ...(meta
      ? { deploy: { id: meta.id, tag: meta.tag || null, timestamp: meta.timestamp } }
      : {}),
  };
}
