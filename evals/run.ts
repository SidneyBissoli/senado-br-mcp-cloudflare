/**
 * Runner — drives the real tool-selection eval against the Anthropic Messages API.
 *
 * The whole engine (retry/backoff, bounded concurrency, fatal-infra short-circuit,
 * report + gate) lives in `@sbissoli/mcp-evals` (`runEval`); this file only supplies
 * the senado-specific pieces: catalog, fixtures and the routing system prompt.
 *
 * Gated on ANTHROPIC_API_KEY: when absent, prints instructions and exits 0 (never
 * breaks CI, never requires network). **The live run bills API usage** — see CLAUDE.md.
 *
 * Run:  ANTHROPIC_API_KEY=sk-ant-... npx tsx evals/run.ts
 * Opts: EVAL_MODEL (default claude-opus-4-8) · EVAL_CONCURRENCY (default 4) · EVAL_LIMIT
 */

import { runEval } from "@sbissoli/mcp-evals";
import { CATALOG } from "./catalog.js";
import { FIXTURES } from "./fixtures/queries.js";

const SYSTEM_PROMPT =
  "Você é o roteador de ferramentas do MCP senado-br (dados abertos do Senado Federal). " +
  "Dada a pergunta de um jornalista ou pesquisador em português, escolha a ÚNICA ferramenta " +
  "mais adequada para o PRIMEIRO passo da resposta e chame-a. Se for preciso resolver um " +
  "código/identificador antes (ex.: achar o código de um senador pelo nome), escolha a " +
  "ferramenta de busca/listagem desse primeiro passo. Não responda em texto — apenas chame a ferramenta.";

const { exitCode } = await runEval({
  catalog: CATALOG,
  fixtures: FIXTURES,
  systemPrompt: SYSTEM_PROMPT,
});
process.exit(exitCode);
