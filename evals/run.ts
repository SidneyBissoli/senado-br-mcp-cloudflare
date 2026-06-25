/**
 * Runner — drives the real tool-selection eval against the Anthropic Messages API.
 *
 * For each fixture query we send the full ~66-tool catalog (built offline by evals/catalog.ts)
 * as the request's `tools`, force a tool call with `tool_choice: {type: "any"}`, and record
 * which tool the model picked first. The pure scorer (evals/score.ts) turns those picks into
 * top-1 / top-k / per-area accuracy and the ROADMAP gate decision.
 *
 * Design goals (from the ROADMAP "rodar evals após mudança de tool" item — cheap reruns):
 *   - No SDK dependency: plain `fetch` against /v1/messages (no package.json edit allowed).
 *   - Gated on ANTHROPIC_API_KEY: when absent, print instructions and exit 0 (never breaks CI,
 *     never requires network).
 *   - Catalog + fixtures are the source of truth; the model only chooses among real tools.
 *
 * Run:  ANTHROPIC_API_KEY=sk-ant-... npx tsx evals/run.ts
 * Opts: EVAL_MODEL=claude-sonnet-4-6 (default claude-opus-4-8)
 *       EVAL_CONCURRENCY=4 (parallel requests, default 4)
 *       EVAL_LIMIT=10 (only run the first N fixtures, for a quick smoke run)
 */

import { catalogAsAnthropicTools, catalogAreaByName, buildCatalog } from "./catalog.js";
import { FIXTURES, type EvalFixture } from "./fixtures/queries.js";
import {
  scoreItem,
  aggregate,
  evaluateGate,
  type Prediction,
  type ScoredItem,
} from "./score.js";
import {
  EvalApiError,
  classifyApiError,
  backoffMs,
  parseRetryAfter,
  isFatalInfra,
  MAX_RETRIES,
  type ErrorKind,
} from "./retry.js";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-opus-4-8";

const SYSTEM_PROMPT =
  "Você é o roteador de ferramentas do MCP senado-br (dados abertos do Senado Federal). " +
  "Dada a pergunta de um jornalista ou pesquisador em português, escolha a ÚNICA ferramenta " +
  "mais adequada para o PRIMEIRO passo da resposta e chame-a. Se for preciso resolver um " +
  "código/identificador antes (ex.: achar o código de um senador pelo nome), escolha a " +
  "ferramenta de busca/listagem desse primeiro passo. Não responda em texto — apenas chame a ferramenta.";

function printSetupInstructions(): void {
  const lines = [
    "",
    "  ANTHROPIC_API_KEY não está definido — pulando a execução com modelo real.",
    "  Este runner faz a seleção de tool real via Anthropic Messages API.",
    "",
    "  Para rodar de verdade:",
    "    ANTHROPIC_API_KEY=sk-ant-... npx tsx evals/run.ts",
    "",
    "  Variáveis opcionais:",
    "    EVAL_MODEL=claude-sonnet-4-6   (padrão: claude-opus-4-8)",
    "    EVAL_CONCURRENCY=4             (requisições paralelas)",
    "    EVAL_LIMIT=10                  (rodar só as N primeiras fixtures)",
    "",
    `  Catálogo: ${buildCatalog().length} tools · Fixtures: ${FIXTURES.length} consultas pt-BR`,
    "  O scorer e o catálogo são testados offline em `npm test` (tests/evals/).",
    "",
  ];
  console.log(lines.join("\n"));
}

interface AnthropicToolUse {
  type: "tool_use";
  name: string;
  input: unknown;
}

interface AnthropicContentBlock {
  type: string;
  name?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** One HTTP attempt. Throws a typed EvalApiError on any non-2xx or network failure. */
async function callOnce(
  fixture: EvalFixture,
  apiKey: string,
  model: string,
  tools: ReturnType<typeof catalogAsAnthropicTools>,
): Promise<{ prediction: Prediction } | never> {
  const body = {
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools,
    tool_choice: { type: "any" as const },
    messages: [{ role: "user" as const, content: fixture.query }],
  };

  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    // DNS/TCP/TLS/abort — always worth a retry.
    throw new EvalApiError(`erro de rede: ${(e as Error).message || "desconhecido"}`, 0, "network", true);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const { kind, retryable } = classifyApiError(res.status, text);
    const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
    const err = new EvalApiError(
      `Anthropic API ${res.status}: ${text.slice(0, 200)}`,
      res.status,
      kind,
      retryable,
    );
    // Smuggle the server's Retry-After hint to the retry loop via a property.
    (err as EvalApiError & { retryAfterSeconds?: number }).retryAfterSeconds = retryAfter;
    throw err;
  }

  const data = (await res.json()) as { content?: AnthropicContentBlock[] };
  const picks: string[] = [];
  for (const block of data.content ?? []) {
    if (block.type === "tool_use" && typeof (block as AnthropicToolUse).name === "string") {
      picks.push((block as AnthropicToolUse).name);
    }
  }
  return { prediction: { id: fixture.id, predictedTools: picks } };
}

/**
 * Call the Messages API for one fixture, retrying transient infra failures (429/529/5xx/network)
 * with bounded exponential backoff + jitter, honoring a Retry-After hint. Fatal infra errors
 * (auth/billing) throw immediately — retrying them only wastes time. The thrown EvalApiError
 * carries a `kind` so the caller can tell "infra dropout" from "model picked the wrong tool".
 */
async function predictOne(
  fixture: EvalFixture,
  apiKey: string,
  model: string,
  tools: ReturnType<typeof catalogAsAnthropicTools>,
): Promise<Prediction> {
  let lastError: EvalApiError | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { prediction } = await callOnce(fixture, apiKey, model, tools);
      return prediction;
    } catch (e) {
      const err = e instanceof EvalApiError ? e : new EvalApiError((e as Error).message, 0, "other", false);
      lastError = err;
      if (!err.retryable || attempt === MAX_RETRIES) throw err;
      const retryAfter = (err as EvalApiError & { retryAfterSeconds?: number }).retryAfterSeconds;
      const base = backoffMs(attempt, retryAfter);
      const jitter = Math.floor(Math.random() * 500);
      console.error(`    ↻ ${fixture.id}: ${err.kind} (HTTP ${err.status}); retry ${attempt + 1}/${MAX_RETRIES} em ${base + jitter}ms`);
      await sleep(base + jitter);
    }
  }
  throw lastError ?? new EvalApiError(`falha desconhecida em ${fixture.id}`, 0, "other", false);
}

/** Run an async mapper over `items` with bounded concurrency, preserving order. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** A fixture that never reached the model — an infra dropout, NOT a wrong tool pick. */
interface FixtureError {
  id: string;
  kind: ErrorKind;
  status: number;
  message: string;
}

/**
 * Print the report and return the process exit code.
 *   0 → every fixture was evaluated (the gate decision is authoritative).
 *   2 → one or more fixtures never reached the model (infra dropout); the gate over the
 *       evaluated subset is shown but flagged PRELIMINAR, because unattempted fixtures must
 *       not be silently scored as wrong tool picks.
 */
function printReport(items: ScoredItem[], errors: FixtureError[], model: string): number {
  // Score only the fixtures that actually reached the model — infra dropouts are excluded
  // so a rate-limit/billing failure can't masquerade as poor tool-selection accuracy.
  const erroredIds = new Set(errors.map((e) => e.id));
  const evaluated = items.filter((it) => !erroredIds.has(it.id));
  const report = aggregate(evaluated, 3);
  const complete = errors.length === 0;

  console.log("");
  console.log("=".repeat(64));
  console.log(`  Eval de seleção de tool — modelo: ${model}`);
  console.log("=".repeat(64));
  console.log(`  Cobertura:          ${evaluated.length}/${items.length} fixtures avaliadas` +
    (complete ? "" : ` · ${errors.length} não avaliadas (falha de infra)`));
  console.log(`  Acurácia top-1:     ${pct(report.top1Accuracy)} (${report.top1Correct}/${report.total} avaliadas)`);
  console.log(`  Acurácia top-2:     ${pct(report.topKAccuracy[2] ?? 0)}`);
  console.log(`  Acurácia top-3:     ${pct(report.topKAccuracy[3] ?? 0)}`);
  console.log("");
  console.log("  Por área (acurácia top-1 entre as avaliadas, pior → melhor):");
  for (const a of report.byArea) {
    console.log(`    ${a.area.padEnd(18)} ${pct(a.top1Accuracy).padStart(6)}  (${a.top1Correct}/${a.total})`);
  }

  const misses = evaluated.filter((it) => !it.top1);
  if (misses.length > 0) {
    console.log("");
    console.log("  Escolhas erradas (top-1 fora do esperado):");
    for (const m of misses) {
      const got = m.predictedTools[0] ?? "(nenhuma)";
      console.log(`    [${m.id}] esperado ${JSON.stringify(m.expectedTools)} · obteve ${got}`);
    }
  }

  if (errors.length > 0) {
    const byKind = new Map<ErrorKind, number>();
    for (const e of errors) byKind.set(e.kind, (byKind.get(e.kind) ?? 0) + 1);
    const kindSummary = [...byKind.entries()].map(([k, n]) => `${k}×${n}`).join(", ");
    console.log("");
    console.log(`  ⚠ RODADA INCOMPLETA — ${errors.length} fixtures não avaliadas (${kindSummary}):`);
    for (const e of errors) {
      console.log(`    [${e.id}] ${e.kind} (HTTP ${e.status})`);
    }
    const fatal = errors.find((e) => isFatalInfra(e.kind));
    if (fatal) {
      console.log("");
      if (fatal.kind === "billing") {
        console.log("    Causa fatal: saldo de créditos insuficiente. Reponha créditos em");
        console.log("    https://console.anthropic.com/settings/billing e rode de novo.");
      } else {
        console.log("    Causa fatal: chave rejeitada (auth). Verifique a ANTHROPIC_API_KEY e rode de novo.");
      }
    } else {
      console.log("");
      console.log("    Dica: rate-limit. Rode com EVAL_CONCURRENCY=1 (e/ou EVAL_MODEL=claude-sonnet-4-6).");
    }
  }

  const gate = evaluateGate(report.top1Accuracy);
  console.log("");
  console.log("  Gate do ROADMAP (Sessão 1):");
  if (complete) {
    console.log(`    decisão: ${gate.decision}`);
    console.log(`    ${gate.message}`);
  } else {
    console.log(`    decisão: PRELIMINAR/${gate.decision} (rodada incompleta — NÃO usar para decisão)`);
    console.log(`    ${gate.message}`);
    console.log("    Complete a cobertura (100%) antes de tratar o gate como definitivo.");
  }
  console.log("=".repeat(64));
  console.log("");

  return complete ? 0 : 2;
}

async function main(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    printSetupInstructions();
    process.exit(0);
  }

  const model = process.env.EVAL_MODEL || DEFAULT_MODEL;
  const concurrency = Math.max(1, parseInt(process.env.EVAL_CONCURRENCY || "4", 10) || 4);
  const limit = parseInt(process.env.EVAL_LIMIT || "", 10);
  const fixtures = Number.isFinite(limit) && limit > 0 ? FIXTURES.slice(0, limit) : FIXTURES;

  const tools = catalogAsAnthropicTools();
  const areaByName = catalogAreaByName();
  console.log(`Rodando ${fixtures.length} fixtures contra ${tools.length} tools (modelo ${model}, concorrência ${concurrency})...`);

  // Once a fatal infra error (auth/billing) is seen, every remaining fixture would hit the
  // same wall — short-circuit them instead of hammering the API with doomed requests.
  let fatalAbort: EvalApiError | null = null;
  const predictions: Prediction[] = [];
  const errors: FixtureError[] = [];

  await mapWithConcurrency(fixtures, concurrency, async (f) => {
    if (fatalAbort) {
      errors.push({ id: f.id, kind: fatalAbort.kind, status: fatalAbort.status, message: "abortado (falha fatal anterior)" });
      return;
    }
    try {
      predictions.push(await predictOne(f, apiKey, model, tools));
    } catch (e) {
      const err = e instanceof EvalApiError ? e : new EvalApiError((e as Error).message, 0, "other", false);
      if (isFatalInfra(err.kind)) fatalAbort = err;
      console.error(`  ! ${f.id}: [${err.kind}] ${err.message}`);
      errors.push({ id: f.id, kind: err.kind, status: err.status, message: err.message });
    }
  });

  const predById = new Map(predictions.map((p) => [p.id, p]));
  const items: ScoredItem[] = fixtures.map((f) => {
    // The fixture's "area" is the area of its first expected tool (the canonical answer).
    const area = areaByName.get(f.expectedTools[0]) ?? "desconhecida";
    return scoreItem(f, predById.get(f.id), area);
  });

  const exitCode = printReport(items, errors, model);
  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
