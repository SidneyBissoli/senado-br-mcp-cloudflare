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

/** Call the Messages API for one fixture and return the ordered tool picks (first = top-1). */
async function predictOne(
  fixture: EvalFixture,
  apiKey: string,
  model: string,
  tools: ReturnType<typeof catalogAsAnthropicTools>,
): Promise<Prediction> {
  const body = {
    model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools,
    tool_choice: { type: "any" as const },
    messages: [{ role: "user" as const, content: fixture.query }],
  };

  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": API_VERSION,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status} para fixture ${fixture.id}: ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as { content?: AnthropicContentBlock[] };
  const picks: string[] = [];
  for (const block of data.content ?? []) {
    if (block.type === "tool_use" && typeof (block as AnthropicToolUse).name === "string") {
      picks.push((block as AnthropicToolUse).name);
    }
  }
  return { id: fixture.id, predictedTools: picks };
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

function printReport(items: ScoredItem[], model: string): void {
  const report = aggregate(items, 3);
  console.log("");
  console.log("=".repeat(64));
  console.log(`  Eval de seleção de tool — modelo: ${model}`);
  console.log("=".repeat(64));
  console.log(`  Fixtures avaliadas: ${report.total} (tentativas: ${report.attempted})`);
  console.log(`  Acurácia top-1:     ${pct(report.top1Accuracy)} (${report.top1Correct}/${report.total})`);
  console.log(`  Acurácia top-2:     ${pct(report.topKAccuracy[2] ?? 0)}`);
  console.log(`  Acurácia top-3:     ${pct(report.topKAccuracy[3] ?? 0)}`);
  console.log("");
  console.log("  Por área (acurácia top-1, pior → melhor):");
  for (const a of report.byArea) {
    console.log(`    ${a.area.padEnd(18)} ${pct(a.top1Accuracy).padStart(6)}  (${a.top1Correct}/${a.total})`);
  }

  const misses = items.filter((it) => !it.top1);
  if (misses.length > 0) {
    console.log("");
    console.log("  Erros (top-1 fora do esperado):");
    for (const m of misses) {
      const got = m.predictedTools[0] ?? "(nenhuma)";
      console.log(`    [${m.id}] esperado ${JSON.stringify(m.expectedTools)} · obteve ${got}`);
    }
  }

  const gate = evaluateGate(report.top1Accuracy);
  console.log("");
  console.log("  Gate do ROADMAP (Sessão 1):");
  console.log(`    decisão: ${gate.decision}`);
  console.log(`    ${gate.message}`);
  console.log("=".repeat(64));
  console.log("");
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

  const predictions = await mapWithConcurrency(fixtures, concurrency, async (f) => {
    try {
      return await predictOne(f, apiKey, model, tools);
    } catch (e) {
      console.error(`  ! ${f.id}: ${(e as Error).message}`);
      return { id: f.id, predictedTools: [] } as Prediction;
    }
  });

  const predById = new Map(predictions.map((p) => [p.id, p]));
  const items: ScoredItem[] = fixtures.map((f) => {
    // The fixture's "area" is the area of its first expected tool (the canonical answer).
    const area = areaByName.get(f.expectedTools[0]) ?? "desconhecida";
    return scoreItem(f, predById.get(f.id), area);
  });

  printReport(items, model);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
