/** Shared validation helpers and response builders. */

export function toolError(message: string, isRetryable = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error: message, retryable: isRetryable }) }],
    isError: true,
  };
}

export function toolResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
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
