/**
 * Dynamic answer key (gabarito dinâmico) — spec section 3.4: for questions whose
 * "Esperado" column defines a verifiable tool + parameters, the judge executes
 * the reference call against the LIVE MCP server at judgment time (upstream data
 * changes) and mechanically compares the central value(s) of the model's final
 * answer with the reference.
 *
 * Curation policy: only questions with a well-defined central value are listed
 * here (statistics envelopes and whole-collection counts). Everything else —
 * including every LIM question — goes to the rubric-based LLM judge. If a
 * reference call fails or an extractor returns nothing (upstream shape drift),
 * the item falls back to the LLM judge, flagged `llm-judge-fallback-gabarito`.
 *
 * Extractors target the response shapes produced by src/utils/estatisticas.ts
 * and the statistics tools (checked 2026-07-22): `estatisticas.media/mediana`,
 * labeled `percentis: [{percentil, valor}]`, `top: [{nome, valor}]`,
 * grouped `grupos: [{grupo, soma}]` (sorted desc), and `{count, total}` lists.
 */

export interface ReferenceValueSpec {
  rotulo: string;
  tipo: "numero" | "texto";
  extrair: (payload: any) => number | string | null | undefined;
}

export interface ReferenceSpec {
  ferramenta: string;
  params: Record<string, unknown>;
  valores: ReferenceValueSpec[];
}

const percentilValor = (payload: any, alvo: number): number | undefined =>
  (payload?.estatisticas?.percentis as any[] | undefined)?.find((p) => p?.percentil === alvo)?.valor;

/**
 * Reference specs by question id. Periods are the ones fixed in the questions
 * themselves (section 5 of the spec) — keep in sync when the spec changes.
 */
export const REFERENCE_SPECS: Record<string, ReferenceSpec> = {
  // B01: average payroll, April 2026 (default campo = bruto).
  B01: {
    ferramenta: "senado_remuneracoes_servidores",
    params: { ano: 2026, mes: 4, estatisticas: true },
    valores: [
      { rotulo: "remuneração bruta média (abr/2026)", tipo: "numero", extrair: (p) => p?.estatisticas?.media },
    ],
  },
  // B02: median + 90th percentile of NET pay, May 2026.
  B02: {
    ferramenta: "senado_remuneracoes_servidores",
    params: { ano: 2026, mes: 5, estatisticas: true, campo: "liquida" },
    valores: [
      { rotulo: "mediana da remuneração líquida (mai/2026)", tipo: "numero", extrair: (p) => p?.estatisticas?.mediana },
      { rotulo: "percentil 90 da remuneração líquida (mai/2026)", tipo: "numero", extrair: (p) => percentilValor(p, 90) },
    ],
  },
  // B06: total number of outsourced workers (whole-collection `total`).
  B06: {
    ferramenta: "senado_terceirizados",
    params: { limite: 1 },
    valores: [{ rotulo: "total de terceirizados", tipo: "numero", extrair: (p) => p?.total }],
  },
  // B10: top-20 gross salaries, March 2026 — reference = the highest one.
  B10: {
    ferramenta: "senado_remuneracoes_servidores",
    params: { ano: 2026, mes: 3, estatisticas: true, topN: 20 },
    valores: [{ rotulo: "maior remuneração bruta (mar/2026)", tipo: "numero", extrair: (p) => p?.top?.[0]?.valor }],
  },
  // C05: number of interns (limite maxed so count == full table size).
  C05: {
    ferramenta: "senado_pessoal_tabelas",
    params: { tabela: "estagiarios", limite: 2000 },
    valores: [{ rotulo: "total de estagiários na tabela", tipo: "numero", extrair: (p) => p?.count }],
  },
  // E01: best-paid servant, June 2026 — reference = top-1 name.
  E01: {
    ferramenta: "senado_remuneracoes_servidores",
    params: { ano: 2026, mes: 6, estatisticas: true },
    valores: [{ rotulo: "servidor mais bem pago (jun/2026)", tipo: "texto", extrair: (p) => p?.top?.[0]?.nome }],
  },
  // E04: who received the most overtime, December 2025 — groups come sorted desc.
  E04: {
    ferramenta: "senado_horas_extras",
    params: { ano: 2025, mes: 12, estatisticas: true, agruparPor: "nome" },
    valores: [{ rotulo: "servidor com mais horas extras (dez/2025)", tipo: "texto", extrair: (p) => p?.grupos?.[0]?.grupo }],
  },
};

// ---------------------------------------------------------------------------
// Mechanical answer-vs-reference matching
// ---------------------------------------------------------------------------

function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Extract every numeric value from a pt-BR (or plain) answer text.
 * Handles "34.567,89", "34567,89", "34567.89", "3.192" and bare integers.
 */
export function extractNumbers(text: string): number[] {
  const out: number[] = [];
  for (const m of text.match(/-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:[.,]\d+)?/g) ?? []) {
    let s = m;
    if (s.includes(",")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else if (/^-?\d{1,3}(?:\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, ""); // pt-BR thousands-separated integer
    }
    const v = Number(s);
    if (Number.isFinite(v)) out.push(v);
  }
  return out;
}

/** A numeric reference matches if some answer number equals it (rounded) or is within 0.5%. */
export function numberMatches(reference: number, answerNumbers: number[]): boolean {
  for (const v of answerNumbers) {
    if (Math.abs(v - reference) <= 0.005) return true; // same value, 2-decimal rounding
    if (Math.round(v) === Math.round(reference)) return true; // answer rounded to units
    if (reference !== 0 && Math.abs(v - reference) / Math.abs(reference) <= 0.005) return true;
  }
  return false;
}

/**
 * A textual reference (a person's name) matches if the normalized answer
 * contains the full name, or at least the first AND last name tokens.
 */
export function textMatches(reference: string, answerText: string): boolean {
  const answer = normalizeText(answerText);
  const ref = normalizeText(reference).trim();
  if (!ref) return false;
  if (answer.includes(ref)) return true;
  const tokens = ref.split(/\s+/).filter((t) => t.length > 2);
  if (tokens.length < 2) return tokens.length === 1 && answer.includes(tokens[0]);
  return answer.includes(tokens[0]) && answer.includes(tokens[tokens.length - 1]);
}
