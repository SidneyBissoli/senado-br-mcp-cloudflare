/**
 * perguntas.json generator — derives the machine-readable question battery from
 * the canonical markdown spec (docs/_local/spec-bateria-dourada.md, section 5).
 *
 * The markdown is the source of truth; this JSON is derived and regenerable:
 *   npx tsx scripts/eval/generate-perguntas.ts
 *
 * Besides copying the table columns verbatim, it mechanically derives:
 *   - `pendente`: the question still carries an F1 placeholder ("[NOME]" etc.);
 *   - `ferramentasEsperadas`: tool names resolved from the "Esperado" column and
 *     validated against the live catalog (evals/catalog.ts runs the registrars,
 *     so a renamed tool breaks regeneration instead of silently drifting);
 *   - `parametrosEssenciais`: key=value pairs from the "Esperado" column.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { CATALOG } from "../../evals/catalog.js";
import type { GoldenQuestion, QuestionsFile } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const SPEC_PATH = join(REPO_ROOT, "docs", "_local", "spec-bateria-dourada.md");
const OUT_PATH = join(HERE, "perguntas.json");

/** F1 placeholders look like [NOME], [N/ANO], [UF], [X]. */
const PLACEHOLDER_RE = /\[[^\]]+\]/;

/** key=value pairs in the Esperado column (estatisticas=true, campo=liquida...). */
const PARAM_RE = /([A-Za-z_][\w]*)\s*=\s*([^\s,)|]+)/g;

/**
 * Shorthands in the spec that cannot be resolved mechanically (either ambiguous
 * or a composite "a/b" token). Keys are matched against the raw token before
 * any splitting. Keep this list tiny — everything else resolves via the
 * catalog (exact name, "senado_" prefix, or unique long-substring match).
 */
const CURATED_ALIASES: Record<string, string[]> = {
  // A08: "listar -> senado_ecidadania_obter_consulta" (e-Cidadania context)
  listar: ["senado_ecidadania_listar_consultas"],
  // D07: either plenary-session lookup is a valid first step
  "resultado/encontro_plenario": ["senado_resultado_plenario", "senado_encontro_plenario"],
};

/** Esperado values that mean "no tool answers this precisely" (LIM gold). */
const NO_TOOL_RE = /^(nenhuma|sem )/i;

export function extractEssentialParams(esperado: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const m of esperado.matchAll(PARAM_RE)) {
    params[m[1]] = m[2];
  }
  return params;
}

export function resolveExpectedTools(esperado: string, known: Set<string>): string[] {
  if (NO_TOOL_RE.test(esperado.trim())) return [];
  // Strip key=value pairs so param values never masquerade as tool tokens.
  const stripped = esperado.replace(PARAM_RE, " ").toLowerCase();
  const out = new Set<string>();
  for (const raw of stripped.match(/[a-z][a-z0-9_/]*/g) ?? []) {
    const curated = CURATED_ALIASES[raw];
    if (curated) {
      curated.forEach((n) => out.add(n));
      continue;
    }
    for (const tok of raw.split("/")) {
      if (!tok) continue;
      if (known.has(tok)) {
        out.add(tok);
      } else if (known.has(`senado_${tok}`)) {
        out.add(`senado_${tok}`);
      } else if (tok.length >= 5) {
        // Unique long-substring fallback ("remuneracoes" -> senado_remuneracoes_servidores).
        const matches = [...known].filter((n) => n.includes(tok));
        if (matches.length === 1) out.add(matches[0]);
      }
    }
  }
  return [...out].sort();
}

interface ParsedRow {
  id: string;
  pergunta: string;
  esperado: string;
  classes: string[];
  nota: string;
}

function parseSpecTables(markdown: string): { persona: string; rows: ParsedRow[] }[] {
  const sections: { persona: string; rows: ParsedRow[] }[] = [];
  let current: { persona: string; rows: ParsedRow[] } | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = line.match(/^###\s+P\d+\s*-\s*(.+?)\s*$/);
    if (heading) {
      current = { persona: heading[1], rows: [] };
      sections.push(current);
      continue;
    }
    if (line.startsWith("## ")) current = null; // left section 5's persona blocks
    if (!current || !line.trimStart().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length !== 5) continue;
    if (!/^[A-Z]\d{2}$/.test(cells[0])) continue; // header / separator rows
    current.rows.push({
      id: cells[0],
      pergunta: cells[1],
      esperado: cells[2],
      classes: cells[3].split(/\s+/).filter(Boolean),
      nota: cells[4],
    });
  }
  return sections.filter((s) => s.rows.length > 0);
}

export function buildQuestions(markdown: string, known: Set<string>): GoldenQuestion[] {
  const questions: GoldenQuestion[] = [];
  for (const section of parseSpecTables(markdown)) {
    for (const row of section.rows) {
      questions.push({
        id: row.id,
        persona: section.persona,
        pergunta: row.pergunta,
        esperado: row.esperado,
        classes: row.classes,
        nota: row.nota,
        pendente: PLACEHOLDER_RE.test(row.pergunta) || PLACEHOLDER_RE.test(row.esperado),
        ferramentasEsperadas: resolveExpectedTools(row.esperado, known),
        parametrosEssenciais: extractEssentialParams(row.esperado),
      });
    }
  }
  return questions;
}

function main(): void {
  const markdown = readFileSync(SPEC_PATH, "utf8");
  const known = CATALOG.toolNames;
  const perguntas = buildQuestions(markdown, known);
  if (perguntas.length === 0) {
    throw new Error(`no question rows parsed from ${SPEC_PATH} — spec format changed?`);
  }

  const file: QuestionsFile = {
    fonte: "docs/_local/spec-bateria-dourada.md (seção 5 — canônica; este JSON é derivado)",
    totalPerguntas: perguntas.length,
    perguntas,
  };
  writeFileSync(OUT_PATH, `${JSON.stringify(file, null, 2)}\n`, "utf8");

  const pendentes = perguntas.filter((p) => p.pendente).length;
  const semFerramenta = perguntas.filter((p) => p.ferramentasEsperadas.length === 0);
  console.log(`perguntas.json: ${perguntas.length} questions (${pendentes} pendente).`);
  console.log(
    `no expected tool (LIM/best-effort): ${semFerramenta.map((p) => p.id).join(", ") || "none"}`,
  );
  for (const p of perguntas) {
    console.log(
      `  ${p.id} -> [${p.ferramentasEsperadas.join(", ")}]` +
        `${Object.keys(p.parametrosEssenciais).length ? ` params=${JSON.stringify(p.parametrosEssenciais)}` : ""}` +
        `${p.pendente ? " (PENDENTE)" : ""}`,
    );
  }
}

main();
