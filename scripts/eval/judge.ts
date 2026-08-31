/**
 * M4 judge (F3 of docs/_local/spec-bateria-dourada.md — spec section 3.4).
 *
 * Reads a runner NDJSON (default: the most recent in scripts/eval/results/),
 * fills m4/veredito on every line and writes `<base>_julgado.ndjson`:
 *
 *  - Dynamic answer key: for questions curated in gabarito.ts, the reference
 *    tool call is executed against the LIVE MCP server at judgment time (via
 *    the official MCP SDK client) and the central value(s) are mechanically
 *    compared with the model's final answer. Both the verdict and the fetched
 *    reference values are recorded on the line (`gabarito`).
 *  - LLM judge: every other question (including class LIM) is judged by
 *    claude-sonnet-4-6 at temperature 0 with the rubric versioned in
 *    scripts/eval/rubrica.md. If a reference call fails, the item falls back
 *    here too (flagged), with whatever reference data was obtained.
 *  - Manual-review sample: 20% of the LLM-judged items (deterministic draw,
 *    fixed seed) exported to `<base>_amostra-manual.md` as a checklist.
 *  - Cost: judge token usage is priced and merged into `<base>.resumo.json`.
 *
 * Usage: npm run eval:judge [-- --input scripts/eval/results/FILE.ndjson]
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Na v2 o transporte HTTP sai do ENTRY principal; na v1 vinha de
// `@modelcontextprotocol/sdk/client/streamableHttp.js`.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import { loadDotEnv, postMessages } from "./api.js";
import { extractNumbers, numberMatches, REFERENCE_SPECS, textMatches, type ReferenceSpec } from "./gabarito.js";
import { costUSD, STRONG_MODEL } from "./pricing.js";
import { baseNameOf, dedupeLines, loadLines, resolveInputPath } from "./results-io.js";
import type {
  GabaritoRef,
  GabaritoValor,
  GoldenQuestion,
  JudgedLine,
  QuestionsFile,
  ResultLine,
  UsageTotals,
} from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const RESULTS_DIR = join(HERE, "results");
const QUESTIONS_PATH = join(HERE, "perguntas.json");
const RUBRIC_PATH = join(HERE, "rubrica.md");

const JUDGE_MODEL = STRONG_MODEL; // claude-sonnet-4-6, temperature 0 (spec 3.4)
const JUDGE_MAX_TOKENS = 1024;
/** Deterministic seed for the 20% manual-review draw — fixed so reruns pick the same items. */
const SAMPLE_SEED = 42;
const SAMPLE_SHARE = 0.2;
const DEFAULT_MCP_URL = "https://senado.sidneybissoli.com/mcp";

// ---------------------------------------------------------------------------
// Dynamic answer key (reference calls against the live MCP)
// ---------------------------------------------------------------------------

interface ReferenceResult {
  gabarito: Omit<GabaritoRef, "valores"> & { valores: Omit<GabaritoValor, "encontradoNaResposta">[] };
  /** Set when the call or an extractor failed — the item falls back to the LLM judge. */
  falha?: string;
}

class ReferenceFetcher {
  private client: Client | null = null;
  private readonly cache = new Map<string, ReferenceResult>();

  constructor(private readonly mcpUrl: string, private readonly token: string | undefined) {}

  private async connect(): Promise<Client> {
    if (this.client) return this.client;
    const client = new Client({ name: "senado-br-eval-judge", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(this.mcpUrl), {
      requestInit: this.token ? { headers: { authorization: `Bearer ${this.token}` } } : undefined,
    });
    await client.connect(transport);
    this.client = client;
    return client;
  }

  /** Fetch (once per question id) the reference values for a curated spec. */
  async fetch(questionId: string, spec: ReferenceSpec): Promise<ReferenceResult> {
    const cached = this.cache.get(questionId);
    if (cached) return cached;

    const base: ReferenceResult["gabarito"] = {
      ferramenta: spec.ferramenta,
      params: spec.params,
      valores: [],
      obtidoEm: new Date().toISOString(),
    };
    let result: ReferenceResult;
    try {
      const client = await this.connect();
      const res = (await client.callTool({ name: spec.ferramenta, arguments: spec.params })) as {
        content?: { type: string; text?: string }[];
        isError?: boolean;
      };
      const text = res.content?.find((b) => b.type === "text")?.text ?? "";
      if (res.isError) throw new Error(`tool error: ${text.slice(0, 200)}`);
      const payload = JSON.parse(text);
      const valores = spec.valores.map((v) => ({ rotulo: v.rotulo, tipo: v.tipo, valor: v.extrair(payload) }));
      const missing = valores.filter((v) => v.valor === null || v.valor === undefined || v.valor === "");
      if (missing.length > 0) {
        result = {
          gabarito: base,
          falha: `extractor(s) returned nothing: ${missing.map((v) => v.rotulo).join("; ")} (upstream shape drift?)`,
        };
      } else {
        result = { gabarito: { ...base, valores: valores as ReferenceResult["gabarito"]["valores"] } };
      }
    } catch (e) {
      result = { gabarito: base, falha: (e as Error).message };
    }
    this.cache.set(questionId, result);
    return result;
  }

  async close(): Promise<void> {
    await this.client?.close().catch(() => {});
  }
}

/** Mechanical verdict: every reference value must appear in the final answer. */
function judgeAgainstReference(
  gabarito: ReferenceResult["gabarito"],
  respostaFinal: string,
): { m4: 0 | 1; veredito: string; valores: GabaritoValor[] } {
  const answerNumbers = extractNumbers(respostaFinal);
  const valores: GabaritoValor[] = gabarito.valores.map((v) => {
    const encontrado =
      v.tipo === "numero"
        ? numberMatches(Number(v.valor), answerNumbers)
        : textMatches(String(v.valor), respostaFinal);
    return { ...v, valor: v.valor as number | string, encontradoNaResposta: encontrado };
  });
  const m4: 0 | 1 = valores.every((v) => v.encontradoNaResposta) ? 1 : 0;
  const partes = valores.map(
    (v) => `${v.rotulo} = ${v.valor} (${v.encontradoNaResposta ? "presente" : "AUSENTE"} na resposta)`,
  );
  const veredito =
    `[gabarito dinâmico] ${m4 === 1 ? "Correta" : "Incorreta"}: ` +
    `valor(es) de referência obtidos ao vivo de ${gabarito.ferramenta}: ${partes.join("; ")}.`;
  return { m4, veredito, valores };
}

// ---------------------------------------------------------------------------
// LLM judge (rubric in rubrica.md, claude-sonnet-4-6, temperature 0)
// ---------------------------------------------------------------------------

interface LlmJudgeOutcome {
  m4: 0 | 1 | null;
  veredito: string;
}

function buildJudgeItem(question: GoldenQuestion, line: ResultLine, referencia?: GabaritoRef): string {
  return JSON.stringify(
    {
      pergunta: question.pergunta,
      classes: question.classes,
      esperado: question.esperado,
      nota: question.nota,
      chamadas: line.chamadas.map((c) => ({
        ferramenta: c.tool,
        params: c.params,
        resultadoResumo: c.resultadoResumo,
        erro: c.isError,
        vazio: c.vazio,
      })),
      respostaFinal: line.respostaFinal,
      ...(referencia ? { valorReferencia: referencia } : {}),
    },
    null,
    2,
  );
}

function parseJudgeJson(text: string): LlmJudgeOutcome | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const parsed = JSON.parse(m[0]) as { m4?: unknown; veredito?: unknown };
    if (parsed.m4 !== 0 && parsed.m4 !== 1) return null;
    return { m4: parsed.m4, veredito: String(parsed.veredito ?? "") };
  } catch {
    return null;
  }
}

async function llmJudge(
  apiKey: string,
  rubric: string,
  question: GoldenQuestion,
  line: ResultLine,
  usage: UsageTotals,
  referencia?: GabaritoRef,
): Promise<LlmJudgeOutcome> {
  const item = buildJudgeItem(question, line, referencia);
  let prompt = `Julgue o item abaixo conforme a rubrica.\n\n<item>\n${item}\n</item>`;
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await postMessages(
      {
        model: JUDGE_MODEL,
        max_tokens: JUDGE_MAX_TOKENS,
        temperature: 0,
        system: [{ type: "text", text: rubric, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: prompt }],
      },
      apiKey,
      `judge ${line.perguntaId}/${line.modelo}/run${line.run}`,
    );
    usage.requests += 1;
    usage.inputTokens += response.usage?.input_tokens ?? 0;
    usage.outputTokens += response.usage?.output_tokens ?? 0;
    usage.cacheCreationInputTokens += response.usage?.cache_creation_input_tokens ?? 0;
    usage.cacheReadInputTokens += response.usage?.cache_read_input_tokens ?? 0;

    const text = (response.content ?? [])
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("\n");
    const parsed = parseJudgeJson(text);
    if (parsed) return parsed;
    // One strict retry — the rubric already demands bare JSON.
    prompt += `\n\nResponda SOMENTE com o JSON {"m4": 0 ou 1, "veredito": "..."}, sem nenhum outro texto.`;
  }
  return { m4: null, veredito: "juiz LLM não retornou JSON válido após 2 tentativas" };
}

// ---------------------------------------------------------------------------
// Manual-review sample (deterministic 20% of LLM-judged items)
// ---------------------------------------------------------------------------

/** mulberry32 PRNG — tiny, deterministic across platforms. */
function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawSample<T>(items: T[], share: number, seed: number): T[] {
  const rand = mulberry32(seed);
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.ceil(items.length * share));
}

function renderManualSample(sample: JudgedLine[], byId: Map<string, GoldenQuestion>, base: string): string {
  const rows = sample.map((line, i) => {
    const q = byId.get(line.perguntaId);
    return [
      `## ${i + 1}. ${line.perguntaId} · ${line.modelo} · run ${line.run}`,
      ``,
      `**Pergunta:** ${q?.pergunta ?? "(?)"}`,
      ``,
      `**Classes:** ${q?.classes.join(", ") ?? "?"} · **Esperado:** ${q?.esperado ?? "?"}`,
      ``,
      `**Chamadas:** ${line.chamadas.map((c) => c.tool).join(" -> ") || "(nenhuma)"}`,
      ``,
      `**Resposta final:**`,
      ``,
      `> ${line.respostaFinal.replace(/\n/g, "\n> ")}`,
      ``,
      `**Veredito do juiz (m4=${line.m4 ?? "NA"}):** ${line.veredito}`,
      ``,
      `- [ ] Concordo com o veredito`,
      `- [ ] Discordo — veredito correto seria m4=____ · observação: ______________________`,
      ``,
    ].join("\n");
  });
  return [
    `# Amostra de revisão manual — ${base}`,
    ``,
    `Sorteio determinístico de ${Math.round(SAMPLE_SHARE * 100)}% dos itens julgados por LLM ` +
      `(seed ${SAMPLE_SEED}); regenerável por \`npm run eval:judge\`. Marque uma caixa por item.`,
    ``,
    ...rows,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  loadDotEnv(REPO_ROOT);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY is not set (env var or repo-root .env) — the LLM judge needs it.");
    process.exit(1);
  }

  const inputPath = resolveInputPath(process.argv, RESULTS_DIR, false);
  const base = baseNameOf(inputPath);
  const outPath = join(RESULTS_DIR, `${base}_julgado.ndjson`);
  const samplePath = join(RESULTS_DIR, `${base}_amostra-manual.md`);
  const resumoPath = join(RESULTS_DIR, `${base}.resumo.json`);

  const questionsFile = JSON.parse(readFileSync(QUESTIONS_PATH, "utf8")) as QuestionsFile;
  const byId = new Map(questionsFile.perguntas.map((q) => [q.id, q]));
  const rubric = readFileSync(RUBRIC_PATH, "utf8");

  const lines = dedupeLines(loadLines<ResultLine>(inputPath));
  console.log(`judging ${lines.length} conversations from ${inputPath}`);
  console.log(`judge model: ${JUDGE_MODEL} (temperature 0) · rubric: scripts/eval/rubrica.md`);

  const mcpUrl = process.env.EVAL_MCP_URL ?? DEFAULT_MCP_URL;
  const fetcher = new ReferenceFetcher(mcpUrl, process.env.SENADO_MCP_TOKEN || undefined);
  const judgeUsage: UsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    requests: 0,
  };

  const judged: JudgedLine[] = [];
  let nGabarito = 0;
  let nLlm = 0;

  for (const line of lines) {
    const question = byId.get(line.perguntaId);
    if (!question) throw new Error(`line references unknown question ${line.perguntaId} — regenerate perguntas.json?`);
    const label = `${line.perguntaId} [${line.modelo}] run ${line.run}`;

    if (line.erroInfra !== undefined) {
      judged.push({ ...line, m4: null, veredito: "não julgado: a conversa falhou por infra na execução", julgadoPor: "nao-julgado-erro-infra", julgadoEm: new Date().toISOString() });
      console.log(`  ${label} · não julgado (erro de infra na execução)`);
      continue;
    }

    const spec = REFERENCE_SPECS[line.perguntaId];
    if (spec) {
      const ref = await fetcher.fetch(line.perguntaId, spec);
      if (!ref.falha) {
        const { m4, veredito, valores } = judgeAgainstReference(ref.gabarito, line.respostaFinal);
        judged.push({
          ...line,
          m4,
          veredito,
          julgadoPor: "gabarito-dinamico",
          julgadoEm: new Date().toISOString(),
          gabarito: { ...ref.gabarito, valores },
        });
        nGabarito += 1;
        console.log(`  ${label} · m4=${m4} (gabarito dinâmico)`);
        continue;
      }
      // Reference unavailable — LLM judge, flagged, with whatever we recorded.
      console.warn(`  ${label} · gabarito falhou (${ref.falha}) — caindo para o juiz LLM`);
      const outcome = await llmJudge(apiKey, rubric, question, line, judgeUsage);
      judged.push({
        ...line,
        m4: outcome.m4,
        veredito: `[fallback do gabarito: ${ref.falha}] ${outcome.veredito}`,
        julgadoPor: "llm-judge-fallback-gabarito",
        julgadoEm: new Date().toISOString(),
      });
      nLlm += 1;
      console.log(`  ${label} · m4=${outcome.m4 ?? "NA"} (llm-judge, fallback)`);
      continue;
    }

    const outcome = await llmJudge(apiKey, rubric, question, line, judgeUsage);
    judged.push({
      ...line,
      m4: outcome.m4,
      veredito: outcome.veredito,
      julgadoPor: "llm-judge",
      julgadoEm: new Date().toISOString(),
    });
    nLlm += 1;
    console.log(`  ${label} · m4=${outcome.m4 ?? "NA"} (llm-judge)`);
  }
  await fetcher.close();

  writeFileSync(outPath, `${judged.map((l) => JSON.stringify(l)).join("\n")}\n`, "utf8");

  // Manual-review sample over the LLM-judged items, deterministic ordering + seed.
  const llmJudged = judged
    .filter((l) => l.julgadoPor === "llm-judge" || l.julgadoPor === "llm-judge-fallback-gabarito")
    .sort((a, b) => `${a.perguntaId}|${a.modelo}|${a.run}`.localeCompare(`${b.perguntaId}|${b.modelo}|${b.run}`));
  const sample = drawSample(llmJudged, SAMPLE_SHARE, SAMPLE_SEED);
  writeFileSync(samplePath, renderManualSample(sample, byId, base), "utf8");

  // Merge judgment cost into the existing execution cost summary.
  const judgeCost = costUSD(JUDGE_MODEL, judgeUsage);
  const resumo = existsSync(resumoPath) ? JSON.parse(readFileSync(resumoPath, "utf8")) : {};
  resumo.julgamento = {
    geradoEm: new Date().toISOString(),
    modelo: JUDGE_MODEL,
    itens: judged.length,
    itensGabaritoDinamico: nGabarito,
    itensLlmJudge: nLlm,
    amostraManual: sample.length,
    usage: judgeUsage,
    custoTotalUSD: Number(judgeCost.toFixed(6)),
    custoMedioPorItemUSD: Number((nLlm > 0 ? judgeCost / nLlm : 0).toFixed(6)),
  };
  resumo.custoTotalComJulgamentoUSD = Number(((resumo.custoTotalUSD ?? 0) + judgeCost).toFixed(6));
  writeFileSync(resumoPath, `${JSON.stringify(resumo, null, 2)}\n`, "utf8");

  const m4Rate = (() => {
    const vals = judged.map((l) => l.m4).filter((v): v is 0 | 1 => v !== null);
    return vals.length > 0 ? vals.reduce<number>((a, b) => a + b, 0) / vals.length : null;
  })();
  console.log("");
  console.log(`judged NDJSON: ${outPath}`);
  console.log(`manual sample (${sample.length} of ${llmJudged.length} LLM-judged): ${samplePath}`);
  console.log(`cost summary updated: ${resumoPath}`);
  console.log(
    `  verdicts: ${judged.length} lines · gabarito dinâmico ${nGabarito} · llm-judge ${nLlm} · ` +
      `m4 rate ${m4Rate === null ? "n/a" : (m4Rate * 100).toFixed(1) + "%"} · judge cost $${judgeCost.toFixed(4)}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
