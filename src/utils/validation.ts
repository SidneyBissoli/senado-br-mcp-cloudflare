/** Shared validation helpers and response builders. */

import { incr } from "../metrics.js";
import { logger } from "./logger.js";
import { anexarClasse, CLASSE_DO_ERRO, type ErrorClass } from "../call-shape.js";

/** Actionable next-step guidance, derived from whether retrying can help. */
function defaultHint(isRetryable: boolean): string {
  return isRetryable
    ? "Erro transitório na fonte de dados oficial; repita a chamada em alguns segundos."
    : "Erro não recuperável por repetição; verifique os parâmetros (códigos, datas, filtros). Se persistir, a fonte oficial pode estar indisponível.";
}

/**
 * Standard error envelope, identical across all tools: `{ error, retryable, hint }`.
 * `hint` is an actionable next step (additive, defaults from `isRetryable`; callers may
 * override). The same payload is also returned as `structuredContent` so clients can parse
 * errors deterministically — symmetric with toolResult() — the permissive outputSchema is
 * skipped on isError results anyway, and a plain object satisfies it regardless.
 *
 * Sem classe: é o miolo comum de `toolError` (classe declarada) e `errorFrom` (classe
 * pelo tipo da exceção). Não exportado de propósito — ver `toolError`.
 */
function envelopeDeErro(message: string, isRetryable: boolean, hint?: string) {
  incr("toolErrors");
  const payload = { error: message, retryable: isRetryable, hint: hint ?? defaultHint(isRetryable) };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    structuredContent: payload,
    isError: true,
  };
}

/**
 * Erro que o HANDLER decide, com a classe de telemetria DECLARADA por quem o escreve.
 *
 * Por que a classe é obrigatória. Até 30/09/2026 este helper não anexava classe nenhuma, e
 * o hook de `instrumentTool` caía na frase (`classifyError`). A frase ecoa argumento do
 * chamador: "Nenhuma reunião da comissão X em <período>" saía `outro`, e "N reuniões …
 * Repita informando codigoReuniao" também — a primeira é ausência respondida, a segunda é
 * pedido ambíguo. Quem escreve a mensagem SABE o que ela significa; com o parâmetro
 * obrigatório, o compilador cobra isso de toda chamada nova. A classe viaja fora do fio
 * (chave-símbolo não enumerável `CLASSE_DO_ERRO`): o que o cliente recebe não muda.
 *
 *  - `contrato`: parâmetro que falta, combinação proibida, pedido ambíguo;
 *  - `nao_encontrado`: a origem respondeu, e respondeu que não existe.
 */
export function toolError(message: string, classe: ErrorClass, isRetryable = false, hint?: string) {
  const r = envelopeDeErro(message, isRetryable, hint);
  Object.defineProperty(r, CLASSE_DO_ERRO, { value: classe, enumerable: false });
  return r;
}

/**
 * Build an error result from any caught value, preserving UpstreamError's retryable flag.
 * Avoids the repetitive `e instanceof Error ? e.message : "..."` pattern.
 * `sufixo` is appended to the user-facing message only (the log keeps the raw message).
 */
export function errorFrom(e: unknown, fallbackMessage: string, sufixo = "") {
  const message = e instanceof Error ? e.message : fallbackMessage;
  const retryable = e instanceof Error && "retryable" in e && typeof (e as any).retryable === "boolean"
    ? (e as any).retryable
    : false;
  // O `hint` da exceção, quando ela traz um, vence o default — mesmo trato do `retryable`.
  // Sem isto, um erro que sabe o que aconteceu (ex.: e-Cidadania 410 = recurso retirado)
  // saía com a mensagem certa e, AO LADO, o hint genérico "verifique os parâmetros … a
  // fonte pode estar indisponível" — que o contradizia (medido no ar em 06/10/2026).
  const hint = e instanceof Error && "hint" in e && typeof (e as any).hint === "string"
    ? (e as any).hint as string
    : undefined;
  logger.error("tool_error", { message, retryable });
  // A classe de telemetria vai pelo TIPO do erro, fora do fio (ver
  // CLASSE_DO_ERRO em src/call-shape.ts); sem ela, vale a frase — último
  // recurso, só para exceção que não declara classe.
  return anexarClasse(envelopeDeErro(message + sufixo, retryable, hint), e);
}

export function toolResult(data: unknown) {
  // Tools advertise an outputSchema (a permissive object schema), so the SDK requires a
  // `structuredContent` object on every non-error result. All callers pass a plain object;
  // the wrap is a safety net for the rare array/primitive payload (structuredContent must
  // be an object).
  const structuredContent =
    data !== null && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : { result: data };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent,
  };
}

/** NaN-safe parseInt. Returns `fallback` (default 0) for null/undefined/NaN. */
export function safeInt(value: unknown, fallback = 0): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = typeof value === "number" ? Math.trunc(value) : parseInt(String(value), 10);
  return Number.isNaN(n) ? fallback : n;
}

/** Build query params from an object, omitting undefined/null values. */
export function buildParams(obj: Record<string, unknown>): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null && value !== "") {
      params[key] = String(value);
    }
  }
  return params;
}

/** Safe deep access into nested API response objects. */
export function dig(obj: unknown, ...keys: string[]): unknown {
  let current = obj;
  for (const key of keys) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Ensure a value is an array (wraps single objects). */
export function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Parse a Brazilian-format monetary string ("1.234,56", "-7.139,64") into a number.
 * Thousands separator is `.`, decimal separator is `,`. Already-numeric input is
 * returned unchanged (guards against `String(123.45)` losing the decimal dot when
 * dots are stripped). null/undefined/""/unparseable → `fallback`.
 *
 * NOT applied blanket-wide: the administrative API is heterogeneous (some endpoints
 * serve native numbers). Apply per-endpoint where the upstream field is a pt-BR string.
 */
export function parseBRL(value: unknown, fallback = 0): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : fallback;
  if (value === null || value === undefined) return fallback;
  const s = String(value).trim();
  if (s === "") return fallback;
  const n = Number(s.replace(/\./g, "").replace(",", "."));
  return Number.isNaN(n) ? fallback : n;
}

/**
 * Coerce a string-or-boolean into a real boolean. The legacy APIs sometimes return
 * `"true"`/`"false"` as strings, which break a strict `=== true` check. Strictly for
 * true/false semantics — domain flags like "S"/"N" are mapped per-tool, not here.
 */
export function toBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return false;
}

/**
 * Case- and accent-insensitive normalizer for textual filters (lowercase + strip
 * combining diacritics). The single home for the expression that was duplicated
 * across tool modules; reuse it in every textual substring filter.
 */
export function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Sanity invariant: a monetary aggregate of exactly 0 while N > 0 records were
 * processed almost always signals a parsing failure (e.g. pt-BR strings summed via
 * `Number()` → NaN → 0). Returns a warning string to surface in the output, or null.
 */
export function avisoAgregadoZero(total: number, n: number): string | null {
  if (total === 0 && n > 0) {
    return `Agregado monetário zerado com ${n} registro(s) presente(s): possível falha de parsing dos valores. Confira a fonte oficial.`;
  }
  return null;
}
