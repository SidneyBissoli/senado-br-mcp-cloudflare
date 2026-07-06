/**
 * Defensive root-parsing helpers for upstream responses.
 *
 * The single most common failure class in this codebase is a parser that navigates
 * to a root node the upstream no longer serves (renamed wrapper, 301 to a dump with a
 * different shape, a flat array where an object was expected, an unwrapped envelope):
 * `ensureArray(dig-to-wrong-root)` silently returns `[]` and the tool reports `count: 0`
 * as if the collection were legitimately empty.
 *
 * These helpers turn "expected root absent" into a LOUD error instead of a silent empty
 * list, while still allowing genuinely-empty collections through. See RootNotFoundError.
 */

import { ensureArray } from "./validation.js";

/** Thrown when none of the expected upstream root paths are present in a response. */
export class RootNotFoundError extends Error {
  constructor(
    public readonly context: string,
    message?: string,
  ) {
    super(
      message ??
        `Estrutura inesperada da fonte oficial em ${context}: raiz de dados esperada ausente. ` +
          `Pode indicar mudanca de formato no upstream.`,
    );
    this.name = "RootNotFoundError";
  }
}

/** Walk a path of keys; returns undefined if any step is missing/non-object. */
function walk(obj: unknown, path: string[]): unknown {
  let cur = obj;
  for (const key of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/** True when a candidate path's ROOT key (first segment) exists on obj. */
function rootPresent(obj: unknown, path: string[]): boolean {
  // An empty path means "obj itself" (flat array/object at the response root).
  if (path.length === 0) return obj != null;
  if (obj == null || typeof obj !== "object") return false;
  return path[0] in (obj as Record<string, unknown>);
}

/**
 * Resolve the array node at the first candidate path that yields a defined value.
 *
 * @param candidates - Full key paths to the array node. An empty path `[]` means the
 *   response root itself (for flat arrays served at the root).
 * @param context - Tool name, embedded in the error for diagnosis.
 *
 * Behavior:
 *  - First candidate whose leaf is defined (non-null) -> returned via `ensureArray`.
 *  - No leaf defined, but at least one candidate ROOT key is present -> the collection
 *    is legitimately empty (upstream responded, just no rows) -> returns `[]`.
 *  - No candidate root present at all -> throws `RootNotFoundError`.
 *
 * Note: if the upstream keeps the root wrapper but renames an INNER key, this still
 * returns `[]` (indistinguishable from empty here). That residual case is caught by the
 * "count 0 -> warn" sanity invariant and by per-bug regression tests, not by this guard.
 */
export function digArrayRoot(
  obj: unknown,
  candidates: string[][],
  context: string,
): unknown[] {
  for (const path of candidates) {
    const node = walk(obj, path);
    if (node !== undefined && node !== null) {
      return ensureArray(node);
    }
  }
  if (candidates.some((p) => rootPresent(obj, p))) return [];
  throw new RootNotFoundError(context);
}

/**
 * Resolve the object node at the first candidate path that yields a plain object.
 * Unlike `digArrayRoot`, absence is never "legitimately empty" for a detail lookup:
 * if no candidate resolves to an object, it throws (callers may pass a friendlier
 * `notFoundMessage`, e.g. "Bloco nao encontrado").
 */
export function digObjectRoot(
  obj: unknown,
  candidates: string[][],
  context: string,
  opts?: { notFoundMessage?: string },
): Record<string, unknown> {
  for (const path of candidates) {
    const node = walk(obj, path);
    if (node !== null && node !== undefined && typeof node === "object" && !Array.isArray(node)) {
      return node as Record<string, unknown>;
    }
  }
  throw new RootNotFoundError(context, opts?.notFoundMessage);
}

/**
 * Unwrap the administrative API v1 envelope `{statusCode, msg, data}`.
 * The adm API is heterogeneous: some endpoints wrap their payload in this envelope
 * (estagiarios, auxilio-moradia, escritorios), others serve a flat array/object
 * (pensionistas, aposentados, contratos). Applying this unconditionally is safe:
 * a payload without both `statusCode` and `data` is returned unchanged.
 */
export function unwrapAdmEnvelope(payload: unknown): unknown {
  if (
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "statusCode" in payload &&
    "data" in payload
  ) {
    return (payload as Record<string, unknown>).data;
  }
  return payload;
}
