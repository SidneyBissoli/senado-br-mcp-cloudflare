#!/usr/bin/env node
/**
 * npm/stdio channel entrypoint — runs the same `createServer` as the hosted
 * Worker, but over the stdio transport so it can be launched via `npx senado-br-mcp`.
 *
 * Parity note: this binary reaches the official government APIs directly (no
 * third-party hop). Everything Workers-specific degrades on its own — the L1
 * Cloudflare Cache API becomes a no-op (L0 in-memory Map still works), D1 /
 * Analytics / version_metadata bindings are simply absent, and `ctx.waitUntil`
 * write-through is skipped (no `ctx` passed). The only behavioural gap is the
 * e-Cidadania list/corpus tools: without D1 they fall back to the existing live
 * scrape (~5 REST highlights), flagged via `meta.fonte` / `possivelDesatualizacao`.
 *
 * This file is NOT imported by the Worker entrypoint (`src/index.ts`) and never
 * touches `agents/mcp`. It only depends on `createServer` + the stdio transport.
 */

import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { unknownCursorError } from "./pagination.js";
import { createServer } from "./server.js";
import type { Env } from "./types.js";

// No Cloudflare bindings in Node: createServer defaults the base URLs when these
// are empty, and every binding-dependent path is guarded. CACHE_KV is declared on
// Env but never read in src/, so the cast is safe.
const env = {
  SENADO_BASE_URL: process.env.SENADO_BASE_URL,
  SENADO_ADM_BASE_URL: process.env.SENADO_ADM_BASE_URL,
  API_KEY: process.env.API_KEY,
} as unknown as Env;

async function main(): Promise<void> {
  // No `ctx` → e-Cidadania detail write-through is a no-op (fire-and-forget skipped).
  const server = createServer(env);

  // O transporte é construído aqui para que o guarda de cursor possa se
  // pendurar nele. Cursor de paginação inválido -> -32602, o MESMO guarda que o
  // Worker aplica no POST (ver src/pagination.ts). Substitui `onmessage` em vez
  // de somar um ouvinte: só quem está NO lugar do `onmessage` pode interromper
  // a entrega ao SDK, e é a interrupção que produz a recusa.
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const entregaAoServidor = transport.onmessage;
  transport.onmessage = (message) => {
    const recusa = unknownCursorError(message);
    if (recusa) {
      void transport.send(recusa);
      return;
    }
    entregaAoServidor?.(message);
  };
  // Logs go to stderr (see src/utils/logger.ts); stdout carries only JSON-RPC.
  console.error(
    JSON.stringify({ level: "info", msg: "stdio_ready", ts: new Date().toISOString() }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
