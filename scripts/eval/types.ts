/**
 * Shared types for the golden-battery evaluation harness (F2 of
 * docs/_local/spec-bateria-dourada.md).
 *
 * Naming convention: code identifiers are English (repo convention for
 * scripts/), but the JSON field names that land in perguntas.json and in the
 * NDJSON result lines keep the Portuguese names fixed by the spec (section 3.5).
 */

/** One golden question, derived from a section-5 table row of the spec. */
export interface GoldenQuestion {
  id: string;
  persona: string;
  pergunta: string;
  /** Raw "Esperado" column text — the canonical (human) answer key. */
  esperado: string;
  classes: string[];
  nota: string;
  /**
   * True when the question still carries an F1 placeholder ([NOME], [N/ANO],
   * [UF], [X]...). Pending questions are skipped by the runner.
   */
  pendente: boolean;
  /**
   * Tool names mechanically resolved from the "Esperado" column, validated
   * against the live catalog. Empty for LIM questions whose gold answer is
   * "no tool can answer this precisely".
   */
  ferramentasEsperadas: string[];
  /**
   * key=value pairs mechanically extracted from the "Esperado" column
   * (e.g. estatisticas=true, campo=liquida). Used for the mechanical M2 check;
   * the LLM/manual M4 judgment remains authoritative for multi-path questions.
   */
  parametrosEssenciais: Record<string, string>;
}

/** Shape of scripts/eval/perguntas.json. */
export interface QuestionsFile {
  fonte: string;
  totalPerguntas: number;
  perguntas: GoldenQuestion[];
}

/** One MCP tool call observed in the conversation trace. */
export interface CallRecord {
  tool: string;
  params: unknown;
  /** Compressed view of the mcp_tool_result payload ("erro:"/"vazio:" prefixed). */
  resultadoResumo: string;
  isError: boolean;
  /** Heuristic: the result looked like an empty collection / zero-count. */
  vazio: boolean;
}

/** Token usage accumulated over every HTTP request of one conversation. */
export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  requests: number;
}

/** One NDJSON line: (perguntaId, modelo, run) — spec section 3.5. */
export interface ResultLine {
  perguntaId: string;
  modelo: string;
  run: number;
  timestamp: string;
  shaServidor: string;
  chamadas: CallRecord[];
  /** M1 — correct tool on the first call (null = not mechanically decidable). */
  m1: 0 | 1 | null;
  /** M2 — essential params present on a call to an expected tool (null = no mechanical key). */
  m2: 0 | 1 | null;
  /** M3 — recovery after an empty/error result (null = NA, nothing to recover from). */
  m3: 0 | 1 | null;
  /** M4 — final-answer correctness. Always null here; filled by a later judge pass. */
  m4: null;
  /** M5 — number of tool calls until the answer. */
  m5: number;
  respostaFinal: string;
  /** M4 verdict text. Always empty here; filled by a later judge pass. */
  veredito: string;
  // --- extensions beyond the spec's minimum line (mechanical provenance) ---
  stopReason: string | null;
  /** pause_turn continuations needed to finish the server-side tool loop. */
  continuacoes: number;
  usage: UsageTotals;
  custoUSD: number;
  /** Present only when the conversation never completed (infra failure). */
  erroInfra?: string;
}
