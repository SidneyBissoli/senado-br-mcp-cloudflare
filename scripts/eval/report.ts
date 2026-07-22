/**
 * Metrics report (F3 of docs/_local/spec-bateria-dourada.md).
 *
 * Reads a judged NDJSON (default: the most recent `*_julgado.ndjson` in
 * scripts/eval/results/) and produces `<base>_relatorio.md` (tables) and
 * `<base>_relatorio.json` (data):
 *
 *  - M1–M5 aggregated by model, by trap class and by expected tool;
 *  - fragility index per tool — M4 rate on the strong model minus M4 rate on
 *    the weak model, over the questions that expect that tool — sorted desc;
 *  - R1 signal: share of non-ENC lines answered with M5 <= 2, plus offenders.
 *
 * Rates ignore null metrics (NA / not mechanically decidable / unjudged).
 * Offline — no network, no API key. Usage:
 *   npm run eval:report [-- --input scripts/eval/results/FILE_julgado.ndjson]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { STRONG_MODEL, WEAK_MODEL } from "./pricing.js";
import { baseNameOf, dedupeLines, loadLines, resolveInputPath } from "./results-io.js";
import type { GoldenQuestion, JudgedLine, QuestionsFile } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(HERE, "results");
const QUESTIONS_PATH = join(HERE, "perguntas.json");

const CLASSES = ["SEL", "PAR", "REC", "ENC", "AGG", "TMP", "LIM"] as const;

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

interface MetricAgg {
  n: number;
  m1: number | null;
  m1N: number;
  m2: number | null;
  m2N: number;
  m3: number | null;
  m3N: number;
  m4: number | null;
  m4N: number;
  m5Media: number | null;
}

function aggregate(lines: JudgedLine[]): MetricAgg {
  const rate = (vals: (0 | 1 | null)[]): { r: number | null; n: number } => {
    const v = vals.filter((x): x is 0 | 1 => x !== null);
    return { r: v.length > 0 ? v.reduce<number>((a, b) => a + b, 0) / v.length : null, n: v.length };
  };
  const m1 = rate(lines.map((l) => l.m1));
  const m2 = rate(lines.map((l) => l.m2));
  const m3 = rate(lines.map((l) => l.m3));
  const m4 = rate(lines.map((l) => l.m4));
  const m5s = lines.map((l) => l.m5);
  return {
    n: lines.length,
    m1: m1.r, m1N: m1.n,
    m2: m2.r, m2N: m2.n,
    m3: m3.r, m3N: m3.n,
    m4: m4.r, m4N: m4.n,
    m5Media: m5s.length > 0 ? m5s.reduce((a, b) => a + b, 0) / m5s.length : null,
  };
}

const pct = (r: number | null): string => (r === null ? "NA" : `${(r * 100).toFixed(1)}%`);
const num = (r: number | null, d = 2): string => (r === null ? "NA" : r.toFixed(d));

function aggRow(label: string, a: MetricAgg): string {
  return (
    `| ${label} | ${a.n} | ${pct(a.m1)} (${a.m1N}) | ${pct(a.m2)} (${a.m2N}) | ` +
    `${pct(a.m3)} (${a.m3N}) | ${pct(a.m4)} (${a.m4N}) | ${num(a.m5Media)} |`
  );
}

const AGG_HEADER = [
  "| | n | M1 (avaliadas) | M2 (avaliadas) | M3 (avaliadas) | M4 (julgadas) | M5 médio |",
  "|---|---:|---:|---:|---:|---:|---:|",
];

function main(): void {
  const inputPath = resolveInputPath(process.argv, RESULTS_DIR, true);
  const base = baseNameOf(inputPath);
  const mdPath = join(RESULTS_DIR, `${base}_relatorio.md`);
  const jsonPath = join(RESULTS_DIR, `${base}_relatorio.json`);

  const questionsFile = JSON.parse(readFileSync(QUESTIONS_PATH, "utf8")) as QuestionsFile;
  const byId = new Map<string, GoldenQuestion>(questionsFile.perguntas.map((q) => [q.id, q]));
  const lines = dedupeLines(loadLines<JudgedLine>(inputPath));
  const models = [...new Set(lines.map((l) => l.modelo))].sort();

  const questionOf = (l: JudgedLine): GoldenQuestion => {
    const q = byId.get(l.perguntaId);
    if (!q) throw new Error(`line references unknown question ${l.perguntaId}`);
    return q;
  };

  // --- by model ---
  const byModel = models.map((m) => ({ modelo: m, ...aggregate(lines.filter((l) => l.modelo === m)) }));

  // --- by class x model ---
  const byClass = CLASSES.flatMap((cls) =>
    models.map((m) => ({
      classe: cls,
      modelo: m,
      ...aggregate(lines.filter((l) => l.modelo === m && questionOf(l).classes.includes(cls))),
    })),
  ).filter((r) => r.n > 0);

  // --- by expected tool x model (a line counts for EVERY tool it expects) ---
  const tools = [...new Set(questionsFile.perguntas.flatMap((q) => q.ferramentasEsperadas))].sort();
  const byTool = tools.flatMap((tool) =>
    models.map((m) => ({
      ferramenta: tool,
      modelo: m,
      ...aggregate(lines.filter((l) => l.modelo === m && questionOf(l).ferramentasEsperadas.includes(tool))),
    })),
  ).filter((r) => r.n > 0);

  // --- fragility index per tool: M4 rate (strong) - M4 rate (weak), desc ---
  const fragilidade = tools
    .map((tool) => {
      const strong = byTool.find((r) => r.ferramenta === tool && r.modelo === STRONG_MODEL);
      const weak = byTool.find((r) => r.ferramenta === tool && r.modelo === WEAK_MODEL);
      return {
        ferramenta: tool,
        m4Forte: strong?.m4 ?? null,
        m4Fraco: weak?.m4 ?? null,
        indice: strong?.m4 != null && weak?.m4 != null ? strong.m4 - weak.m4 : null,
        nForte: strong?.m4N ?? 0,
        nFraco: weak?.m4N ?? 0,
      };
    })
    .filter((f) => f.nForte > 0 || f.nFraco > 0)
    .sort((a, b) => (b.indice ?? -Infinity) - (a.indice ?? -Infinity));
  const fragilidadeCompleta = fragilidade.some((f) => f.indice !== null);

  // --- R1 signal: non-ENC lines should resolve in <= 2 calls ---
  const naoEnc = lines.filter((l) => !questionOf(l).classes.includes("ENC"));
  const r1Ok = naoEnc.filter((l) => l.m5 <= 2).length;
  const r1Ofensores = [...new Set(naoEnc.filter((l) => l.m5 > 2).map((l) => `${l.perguntaId} (${l.modelo}, m5=${l.m5})`))];

  // --- outputs ---
  const reportJson = {
    geradoEm: new Date().toISOString(),
    fonte: inputPath.replace(/\\/g, "/"),
    shaServidor: lines[0]?.shaServidor ?? null,
    linhas: lines.length,
    modelos: models,
    porModelo: byModel,
    porClasse: byClass,
    porFerramenta: byTool,
    fragilidadePorFerramenta: fragilidade,
    r1: { naoEncLinhas: naoEnc.length, comAteDuasChamadas: r1Ok, ofensores: r1Ofensores },
  };
  writeFileSync(jsonPath, `${JSON.stringify(reportJson, null, 2)}\n`, "utf8");

  const md: string[] = [];
  md.push(`# Relatório da bateria dourada — ${base}`);
  md.push("");
  md.push(
    `Fonte: \`${baseNameOf(inputPath)}_julgado.ndjson\` · ${lines.length} conversas · ` +
      `modelos: ${models.join(", ")} · sha do servidor: \`${reportJson.shaServidor}\`. ` +
      `Taxas ignoram métricas NA; "(n)" é o nº de linhas avaliadas/julgadas na taxa.`,
  );
  md.push("");
  md.push("## Por modelo");
  md.push("");
  md.push(...AGG_HEADER);
  for (const r of byModel) md.push(aggRow(`\`${r.modelo}\``, r));
  md.push("");
  md.push("## Por classe de armadilha");
  md.push("");
  md.push(...AGG_HEADER.map((h, i) => (i === 0 ? h.replace("| |", "| classe · modelo |") : h)));
  for (const r of byClass) md.push(aggRow(`${r.classe} · \`${r.modelo}\``, r));
  md.push("");
  md.push("## Por ferramenta esperada");
  md.push("");
  md.push("Uma conversa conta para TODAS as ferramentas esperadas da sua pergunta.");
  md.push("");
  md.push(...AGG_HEADER.map((h, i) => (i === 0 ? h.replace("| |", "| ferramenta · modelo |") : h)));
  for (const r of byTool) md.push(aggRow(`\`${r.ferramenta}\` · \`${r.modelo}\``, r));
  md.push("");
  md.push("## Índice de fragilidade por ferramenta");
  md.push("");
  md.push(`Definição (spec 3.3): taxa de M4 no modelo forte (\`${STRONG_MODEL}\`) menos a taxa no fraco (\`${WEAK_MODEL}\`), decrescente — maior índice = prioridade de redesign.`);
  if (!fragilidadeCompleta) {
    md.push("");
    md.push("> ⚠️ Indisponível: o NDJSON julgado não contém os DOIS modelos (o índice exige forte e fraco). Rode a bateria completa.");
  }
  md.push("");
  md.push("| ferramenta | M4 forte (n) | M4 fraco (n) | índice |");
  md.push("|---|---:|---:|---:|");
  for (const f of fragilidade) {
    md.push(`| \`${f.ferramenta}\` | ${pct(f.m4Forte)} (${f.nForte}) | ${pct(f.m4Fraco)} (${f.nFraco}) | ${f.indice === null ? "n/d" : f.indice.toFixed(2)} |`);
  }
  md.push("");
  md.push("## Sinal R1 (agregação server-side)");
  md.push("");
  md.push(
    `Conversas não-ENC resolvidas com M5 <= 2: ${r1Ok}/${naoEnc.length}` +
      (r1Ofensores.length > 0 ? ` · ofensores: ${r1Ofensores.join("; ")}` : " · sem ofensores"),
  );
  md.push("");
  writeFileSync(mdPath, `${md.join("\n")}\n`, "utf8");

  console.log(`report: ${mdPath}`);
  console.log(`data:   ${jsonPath}`);
  for (const r of byModel) {
    console.log(`  ${r.modelo}: n=${r.n} m1=${pct(r.m1)} m2=${pct(r.m2)} m3=${pct(r.m3)} m4=${pct(r.m4)} m5=${num(r.m5Media)}`);
  }
  if (!fragilidadeCompleta) console.log("  fragility index: n/d (requires both models in the judged NDJSON)");
}

main();
