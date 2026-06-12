/**
 * Bearer token authentication for the MCP server.
 *
 * - Uses constant-time comparison to prevent timing attacks.
 * - When no API_KEY is configured, all requests pass through (open access).
 */

const encoder = new TextEncoder();

/** Constant-time string comparison using crypto.subtle.timingSafeEqual. */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);
  if (aBuf.byteLength !== bBuf.byteLength) return false;
  return crypto.subtle.timingSafeEqual(aBuf, bBuf);
}

/**
 * Check Bearer token authentication.
 *
 * @returns `null` if auth passes, or a `Response` (401/403) if it fails.
 */
export async function checkAuth(
  request: Request,
  apiKey: string | undefined,
): Promise<Response | null> {
  // No API_KEY configured — open access (backward compatible)
  if (!apiKey) return null;

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return new Response("Missing Authorization header", {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  // Accept "Bearer <token>" (case-insensitive scheme)
  const match = authHeader.match(/^bearer\s+(.+)$/i);
  if (!match) {
    return new Response("Invalid Authorization format, expected: Bearer <token>", {
      status: 401,
      headers: { "WWW-Authenticate": "Bearer" },
    });
  }

  const token = match[1];
  const valid = await timingSafeEqual(token, apiKey);
  if (!valid) {
    return new Response("Invalid token", { status: 403 });
  }

  return null;
}
