/**
 * Mechanical metrics for the golden battery (spec section 3.3).
 *
 * M1, M2, M3 and M5 are computable from the conversation trace alone; M4
 * (final-answer correctness) requires the dynamic answer key / LLM judge and is
 * left blank in the NDJSON for a later pass.
 *
 * Every heuristic here errs on the side of `null` (not decidable) rather than
 * guessing — a null metric is excluded from aggregation instead of polluting it.
 */

import type { CallRecord, GoldenQuestion } from "./types.js";

/** Accent/case-insensitive comparison key. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Heuristic "empty collection / zero count / error payload" detector, applied
 * to the serialized text of an mcp_tool_result. Targets the shapes this
 * server actually produces (count fields, empty arrays, `erro` payloads from
 * errorFrom, pt-BR "nenhum resultado" phrasings).
 */
export function isEmptyOrErrorResult(text: string, isError: boolean): boolean {
  if (isError) return true;
  const t = text.toLowerCase();
  if (/"erro"\s*:/.test(t)) return true;
  if (/"(total|totalregistros|total_registros|quantidade|count|totalencontrado)"\s*:\s*0(?=[,}\s])/.test(t)) return true;
  if (/"[a-z_]*(itens|items|lista|listas|resultados|registros|dados|despesas|documentos|servidores|ocorrencias)"\s*:\s*\[\s*\]/.test(t)) return true;
  if (/\b(nenhum|nenhuma)\s+(resultado|registro|item|despesa|dado|ocorr)/.test(normalize(t))) return true;
  if (/\b0\s+resultados?\b/.test(t)) return true;
  const trimmed = t.trim();
  if (trimmed === "[]" || trimmed === "{}" || trimmed === "") return true;
  return false;
}

/** Compressed, prefix-tagged view of a tool result for the NDJSON trace. */
export function summarizeResult(text: string, isError: boolean, empty: boolean): string {
  const compact = text.replace(/\s+/g, " ").trim().slice(0, 180);
  if (isError) return `erro: ${compact}`;
  if (empty) return `vazio: ${compact}`;
  return compact;
}

/** M1 — expected tool on the FIRST call. Null when the question has no expected tool (LIM). */
export function computeM1(question: GoldenQuestion, calls: CallRecord[]): 0 | 1 | null {
  if (question.ferramentasEsperadas.length === 0) return null;
  if (calls.length === 0) return 0;
  return question.ferramentasEsperadas.includes(calls[0].tool) ? 1 : 0;
}

/**
 * M2 — some call to an expected tool carries every essential key=value pair.
 * Null when there is no mechanical key to check (no essential params in the
 * spec, or no expected tool). For multi-path questions (e.g. B11) this is a
 * lower bound; the M4 judgment stays authoritative.
 */
export function computeM2(question: GoldenQuestion, calls: CallRecord[]): 0 | 1 | null {
  const essentials = Object.entries(question.parametrosEssenciais);
  if (question.ferramentasEsperadas.length === 0 || essentials.length === 0) return null;
  const candidates = calls.filter((c) => question.ferramentasEsperadas.includes(c.tool));
  for (const call of candidates) {
    const params = (call.params ?? {}) as Record<string, unknown>;
    const byKey = new Map(Object.keys(params).map((k) => [normalize(k), params[k]]));
    const ok = essentials.every(([key, expected]) => {
      const actual = byKey.get(normalize(key));
      if (actual === undefined || actual === null) return false;
      if (typeof actual === "boolean") return normalize(String(actual)) === normalize(expected);
      return normalize(String(actual)) === normalize(expected);
    });
    if (ok) return 1;
  }
  return 0;
}

/**
 * M3 — recovery after an empty/error result: given the first empty-or-error
 * tool result, did the model try ANOTHER call afterwards (instead of giving up
 * or accepting the zero)? Null (NA) when no result was empty or errored.
 */
export function computeM3(calls: CallRecord[]): 0 | 1 | null {
  const firstFailure = calls.findIndex((c) => c.isError || c.vazio);
  if (firstFailure === -1) return null;
  return firstFailure < calls.length - 1 ? 1 : 0;
}
