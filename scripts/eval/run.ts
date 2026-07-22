/**
 * Golden-battery runner (F2/F3 of docs/_local/spec-bateria-dourada.md).
 *
 * Sends each golden question to the Anthropic Messages API with the MCP
 * connector (beta `mcp-client-2025-11-20`) pointing at the production server,
 * records the full mcp_tool_use/mcp_tool_result trace, computes the mechanical
 * metrics M1/M2/M3/M5 (M4 is left blank for `npm run eval:judge`) and appends
 * one NDJSON line per (perguntaId, modelo, run) to
 * scripts/eval/results/AAAA-MM-DD_<sha>.ndjson.
 *
 * Modes:
 *   npm run eval:dry   5 placeholder-free questions x weak model x 1 run
 *   npm run eval       all non-pending questions x 2 models x 3 runs
 *
 * Resume: when the day's NDJSON already exists, (perguntaId, modelo, run)
 * combinations already recorded WITHOUT an infra failure are skipped, so an
 * interrupted battery continues where it stopped instead of re-paying finished
 * conversations. Infra-failed combos are re-run (a fresh line is appended;
 * judge/report keep the LAST line per combo).
 *
 * Requests are strictly serialized (initial rate-limit tier); retry/backoff
 * lives in api.ts. Prompt caching: `cache_control` on the mcp_toolset (caches
 * the MCP tool definitions — supported per the MCP-connector docs) and on the
 * stable system block; the volatile date line sits after the last breakpoint.
 *
 * API key comes from ANTHROPIC_API_KEY (env var or repo-root .env, gitignored).
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

import { FatalApiError, loadDotEnv, postMessages } from "./api.js";
import { computeM1, computeM2, computeM3, isEmptyOrErrorResult, summarizeResult } from "./metrics.js";
import { costUSD, STRONG_MODEL, WEAK_MODEL } from "./pricing.js";
import { dedupeLines, loadLines } from "./results-io.js";
import type { CallRecord, GoldenQuestion, QuestionsFile, ResultLine, UsageTotals } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const RESULTS_DIR = join(HERE, "results");
const QUESTIONS_PATH = join(HERE, "perguntas.json");

const MCP_BETA = "mcp-client-2025-11-20";
const DEFAULT_MCP_URL = "https://senado.sidneybissoli.com/mcp";

const FULL_RUNS = 3;
/** Dry-run set fixed by the session prompt: placeholder-free questions, weak model, 1 run. */
const DRY_IDS = ["A02", "A09", "B01", "B06", "C09"];

const MAX_TOKENS = 4096;
const MAX_CONTINUATIONS = 10; // pause_turn resumes per conversation
const PAUSE_BETWEEN_CONVERSATIONS_MS = 500;

function gitShortSha(): string {
  return execSync("git rev-parse --short HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}

/** Brasília calendar date (YYYY-MM-DD) — used in the results filename and the system prompt. */
function brasiliaDate(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function brasiliaWeekday(): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long" }).format(new Date());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Conversation runner
// ---------------------------------------------------------------------------

const SYSTEM_STABLE =
  "Você é um assistente conectado ao servidor MCP senado-br, que expõe dados abertos do " +
  "Senado Federal do Brasil. Responda à pergunta do usuário em português, usando as " +
  "ferramentas disponíveis quando necessário. Baseie números e fatos exclusivamente nos " +
  "resultados das ferramentas; se os dados disponíveis não permitirem responder com " +
  "precisão, diga isso explicitamente em vez de estimar ou inventar valores.";

interface RequestContext {
  apiKey: string;
  mcpUrl: string;
  mcpToken: string | undefined;
  dateLine: string;
}

function buildRequestBody(ctx: RequestContext, model: string, messages: unknown[]): unknown {
  return {
    model,
    max_tokens: MAX_TOKENS,
    system: [
      // Stable prefix first, then a cache breakpoint; the volatile date line
      // comes after it so it never invalidates the cached tools+system prefix.
      { type: "text", text: SYSTEM_STABLE, cache_control: { type: "ephemeral" } },
      { type: "text", text: ctx.dateLine },
    ],
    mcp_servers: [
      {
        type: "url",
        url: ctx.mcpUrl,
        name: "senado-br",
        ...(ctx.mcpToken ? { authorization_token: ctx.mcpToken } : {}),
      },
    ],
    tools: [
      // Prompt caching applies to MCP tool definitions via cache_control on the
      // toolset (see the MCP-connector docs, "MCP toolset configuration").
      { type: "mcp_toolset", mcp_server_name: "senado-br", cache_control: { type: "ephemeral" } },
    ],
    messages,
  };
}

function extractResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b) => (b && typeof b === "object" && "text" in b ? String((b as { text: unknown }).text) : ""))
      .join("\n");
  }
  return content == null ? "" : JSON.stringify(content);
}

interface ConversationOutcome {
  chamadas: CallRecord[];
  respostaFinal: string;
  stopReason: string | null;
  continuacoes: number;
  usage: UsageTotals;
  erroInfra?: string;
}

/**
 * Run one full conversation (question x model), following pause_turn
 * continuations of the server-side MCP tool loop until a terminal stop_reason.
 */
async function runConversation(
  ctx: RequestContext,
  model: string,
  question: GoldenQuestion,
): Promise<ConversationOutcome> {
  const messages: unknown[] = [{ role: "user", content: question.pergunta }];
  const chamadas: CallRecord[] = [];
  const pendingByToolUseId = new Map<string, CallRecord>();
  const textParts: string[] = [];
  const usage: UsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    requests: 0,
  };
  let stopReason: string | null = null;
  let continuacoes = 0;

  try {
    for (;;) {
      const response = await postMessages(
        buildRequestBody(ctx, model, messages),
        ctx.apiKey,
        `${question.id}/${model}`,
        { betas: [MCP_BETA] },
      );
      usage.requests += 1;
      usage.inputTokens += response.usage?.input_tokens ?? 0;
      usage.outputTokens += response.usage?.output_tokens ?? 0;
      usage.cacheCreationInputTokens += response.usage?.cache_creation_input_tokens ?? 0;
      usage.cacheReadInputTokens += response.usage?.cache_read_input_tokens ?? 0;

      for (const block of response.content ?? []) {
        if (block.type === "text" && block.text) {
          textParts.push(block.text);
        } else if (block.type === "mcp_tool_use" && block.name) {
          const call: CallRecord = {
            tool: block.name,
            params: block.input ?? {},
            resultadoResumo: "(sem resultado registrado)",
            isError: false,
            vazio: false,
          };
          chamadas.push(call);
          if (block.id) pendingByToolUseId.set(block.id, call);
        } else if (block.type === "mcp_tool_result" && block.tool_use_id) {
          const call = pendingByToolUseId.get(block.tool_use_id);
          if (!call) continue;
          const text = extractResultText(block.content);
          call.isError = block.is_error === true;
          call.vazio = !call.isError && isEmptyOrErrorResult(text, false);
          call.resultadoResumo = summarizeResult(text, call.isError, call.vazio);
        }
      }

      stopReason = response.stop_reason;
      if (stopReason === "pause_turn" && continuacoes < MAX_CONTINUATIONS) {
        // Server-side tool loop hit its iteration limit; resend to resume.
        continuacoes += 1;
        messages.push({ role: "assistant", content: response.content });
        continue;
      }
      break;
    }
  } catch (e) {
    if (e instanceof FatalApiError) throw e;
    return {
      chamadas,
      respostaFinal: textParts.join("\n").trim(),
      stopReason,
      continuacoes,
      usage,
      erroInfra: (e as Error).message,
    };
  }

  return { chamadas, respostaFinal: textParts.join("\n").trim(), stopReason, continuacoes, usage };
}

// ---------------------------------------------------------------------------
// Batch orchestration
// ---------------------------------------------------------------------------

interface ModelSummary {
  conversas: number;
  conversasComErroInfra: number;
  usage: UsageTotals;
  custoTotalUSD: number;
  custoMedioPorConversaUSD: number;
}

function fmtUsd(v: number): string {
  return `$${v.toFixed(4)}`;
}

function fmtMetric(v: 0 | 1 | null): string {
  return v === null ? "NA" : String(v);
}

/** Combos already recorded WITHOUT infra failure in the day's NDJSON (resume mode). */
function loadCompletedCombos(ndjsonPath: string): Set<string> {
  const done = new Set<string>();
  if (!existsSync(ndjsonPath)) return done;
  for (const raw of readFileSync(ndjsonPath, "utf8").split(/\r?\n/)) {
    if (!raw.trim()) continue;
    try {
      const line = JSON.parse(raw) as ResultLine;
      const key = `${line.perguntaId}|${line.modelo}|${line.run}`;
      if (line.erroInfra === undefined) done.add(key);
      else done.delete(key); // a later failed re-run reopens the combo
    } catch {
      // tolerate a torn trailing line from an interrupted process
    }
  }
  return done;
}

async function main(): Promise<void> {
  loadDotEnv(REPO_ROOT);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(
      "ANTHROPIC_API_KEY is not set (env var or repo-root .env). The runner calls the paid " +
        "Anthropic Messages API and cannot proceed without it.",
    );
    process.exit(1);
  }

  const dry = process.argv.includes("--dry");
  const questionsFile = JSON.parse(readFileSync(QUESTIONS_PATH, "utf8")) as QuestionsFile;
  const byId = new Map(questionsFile.perguntas.map((q) => [q.id, q]));

  const idsOverride = (process.env.EVAL_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  let questions: GoldenQuestion[];
  if (idsOverride.length > 0) {
    questions = idsOverride.map((id) => {
      const q = byId.get(id);
      if (!q) throw new Error(`EVAL_IDS: unknown question id ${id}`);
      return q;
    });
  } else if (dry) {
    questions = DRY_IDS.map((id) => {
      const q = byId.get(id);
      if (!q) throw new Error(`dry-run question ${id} missing from perguntas.json`);
      if (q.pendente) throw new Error(`dry-run question ${id} is marked pendente`);
      return q;
    });
  } else {
    questions = questionsFile.perguntas.filter((q) => !q.pendente);
  }

  const models = dry
    ? [WEAK_MODEL]
    : (process.env.EVAL_MODELS ?? `${STRONG_MODEL},${WEAK_MODEL}`).split(",").map((s) => s.trim()).filter(Boolean);
  const runs = dry ? 1 : Math.max(1, parseInt(process.env.EVAL_RUNS ?? "", 10) || FULL_RUNS);

  const sha = gitShortSha();
  const date = brasiliaDate();
  const ctx: RequestContext = {
    apiKey,
    mcpUrl: process.env.EVAL_MCP_URL ?? DEFAULT_MCP_URL,
    mcpToken: process.env.SENADO_MCP_TOKEN || undefined,
    dateLine: `Data de hoje: ${brasiliaWeekday()}, ${date} (fuso horário de Brasília).`,
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  const basePath = join(RESULTS_DIR, `${date}_${sha}`);
  const ndjsonPath = `${basePath}.ndjson`;
  const summaryPath = `${basePath}.resumo.json`;
  const completed = loadCompletedCombos(ndjsonPath);
  if (completed.size > 0) {
    console.log(`resume mode: ${completed.size} completed (perguntaId, modelo, run) combos will be skipped.`);
  } else if (existsSync(ndjsonPath)) {
    console.warn(`warning: ${ndjsonPath} already exists — new lines will be APPENDED.`);
  }

  const skipped = questionsFile.perguntas.filter((q) => q.pendente).map((q) => q.id);
  console.log(`golden battery ${dry ? "DRY RUN" : "full run"} — sha ${sha}, MCP ${ctx.mcpUrl}`);
  console.log(
    `questions: ${questions.length} (pendente skipped: ${skipped.join(", ") || "none"}) · ` +
      `models: ${models.join(", ")} · runs: ${runs} · serialized requests`,
  );

  let firstConversation = true;
  let resumedSkips = 0;

  for (const model of models) {
    for (const question of questions) {
      for (let run = 1; run <= runs; run++) {
        if (completed.has(`${question.id}|${model}|${run}`)) {
          resumedSkips += 1;
          continue;
        }
        if (!firstConversation) await sleep(PAUSE_BETWEEN_CONVERSATIONS_MS);
        firstConversation = false;

        const startedAt = Date.now();
        const outcome = await runConversation(ctx, model, question);
        const custo = costUSD(model, outcome.usage);
        const infraFailed = outcome.erroInfra !== undefined;

        const line: ResultLine = {
          perguntaId: question.id,
          modelo: model,
          run,
          timestamp: new Date().toISOString(),
          shaServidor: sha,
          chamadas: outcome.chamadas,
          m1: infraFailed ? null : computeM1(question, outcome.chamadas),
          m2: infraFailed ? null : computeM2(question, outcome.chamadas),
          m3: infraFailed ? null : computeM3(outcome.chamadas),
          m4: null,
          m5: outcome.chamadas.length,
          respostaFinal: outcome.respostaFinal,
          veredito: "",
          stopReason: outcome.stopReason,
          continuacoes: outcome.continuacoes,
          usage: outcome.usage,
          custoUSD: Number(custo.toFixed(6)),
          ...(infraFailed ? { erroInfra: outcome.erroInfra } : {}),
        };
        appendFileSync(ndjsonPath, `${JSON.stringify(line)}\n`, "utf8");

        const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
        console.log(
          `  ${question.id} [${model}] run ${run} · m1=${fmtMetric(line.m1)} m2=${fmtMetric(line.m2)} ` +
            `m3=${fmtMetric(line.m3)} m5=${line.m5} · ${secs}s · ${fmtUsd(custo)}` +
            (infraFailed ? ` · INFRA FAILURE: ${outcome.erroInfra}` : ""),
        );
      }
    }
  }

  if (resumedSkips > 0) console.log(`resume mode: skipped ${resumedSkips} already-completed conversations.`);

  // The cost summary is derived from the FULL NDJSON (deduped, last line per
  // combo), not from this session's counters — so a resumed battery keeps a
  // consistent cumulative record and never clobbers earlier sessions. The
  // `julgamento` block written by eval:judge is preserved.
  const allLines = dedupeLines(loadLines<ResultLine>(ndjsonPath));
  const fileSummaries = new Map<string, ModelSummary>();
  for (const line of allLines) {
    let s = fileSummaries.get(line.modelo);
    if (!s) {
      s = {
        conversas: 0,
        conversasComErroInfra: 0,
        usage: { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, requests: 0 },
        custoTotalUSD: 0,
        custoMedioPorConversaUSD: 0,
      };
      fileSummaries.set(line.modelo, s);
    }
    s.conversas += 1;
    if (line.erroInfra !== undefined) s.conversasComErroInfra += 1;
    s.custoTotalUSD += line.custoUSD;
    s.usage.inputTokens += line.usage.inputTokens;
    s.usage.outputTokens += line.usage.outputTokens;
    s.usage.cacheCreationInputTokens += line.usage.cacheCreationInputTokens;
    s.usage.cacheReadInputTokens += line.usage.cacheReadInputTokens;
    s.usage.requests += line.usage.requests;
  }
  for (const s of fileSummaries.values()) {
    s.custoMedioPorConversaUSD = s.conversas > 0 ? s.custoTotalUSD / s.conversas : 0;
  }

  const totalConversas = [...fileSummaries.values()].reduce((a, s) => a + s.conversas, 0);
  const totalCusto = [...fileSummaries.values()].reduce((a, s) => a + s.custoTotalUSD, 0);
  const previous = existsSync(summaryPath)
    ? (JSON.parse(readFileSync(summaryPath, "utf8")) as { julgamento?: { custoTotalUSD?: number } })
    : {};
  const summaryDoc = {
    geradoEm: new Date().toISOString(),
    shaServidor: sha,
    modo: dry ? "dry" : "full",
    mcpUrl: ctx.mcpUrl,
    modelos: Object.fromEntries(
      [...fileSummaries.entries()].map(([model, s]) => [
        model,
        { ...s, custoTotalUSD: Number(s.custoTotalUSD.toFixed(6)), custoMedioPorConversaUSD: Number(s.custoMedioPorConversaUSD.toFixed(6)) },
      ]),
    ),
    custoTotalUSD: Number(totalCusto.toFixed(6)),
    custoMedioPorConversaUSD: Number((totalConversas > 0 ? totalCusto / totalConversas : 0).toFixed(6)),
    ...(previous.julgamento
      ? {
          julgamento: previous.julgamento,
          custoTotalComJulgamentoUSD: Number((totalCusto + (previous.julgamento.custoTotalUSD ?? 0)).toFixed(6)),
        }
      : {}),
  };
  writeFileSync(summaryPath, `${JSON.stringify(summaryDoc, null, 2)}\n`, "utf8");

  console.log("");
  console.log(`results: ${ndjsonPath}`);
  console.log(`cost summary (cumulative over the file): ${summaryPath}`);
  for (const [model, s] of fileSummaries) {
    console.log(
      `  ${model}: ${s.conversas} conversations · in=${s.usage.inputTokens} ` +
        `cacheWrite=${s.usage.cacheCreationInputTokens} cacheRead=${s.usage.cacheReadInputTokens} ` +
        `out=${s.usage.outputTokens} · total ${fmtUsd(s.custoTotalUSD)} · avg/conversation ${fmtUsd(s.custoMedioPorConversaUSD)}`,
    );
  }
  console.log(`  TOTAL: ${totalConversas} conversations · ${fmtUsd(totalCusto)} · avg/conversation ${fmtUsd(totalConversas > 0 ? totalCusto / totalConversas : 0)}`);
}

main().catch((e) => {
  console.error(e instanceof FatalApiError ? `FATAL: ${e.message}` : e);
  process.exit(1);
});
