/** L1 — Cloudflare Cache API (caches.default). Per-datacenter, best-effort. */

const CACHE_HOST = "https://senado-br-mcp.internal";

function buildCacheKey(tool: string, paramsHash: string): Request {
  return new Request(`${CACHE_HOST}/__cache/${tool}/${paramsHash}`, {
    method: "GET",
  });
}

export async function l1Get(tool: string, paramsHash: string): Promise<string | undefined> {
  try {
    const cache = caches.default;
    const key = buildCacheKey(tool, paramsHash);
    const response = await cache.match(key);
    if (!response) return undefined;
    return await response.text();
  } catch {
    return undefined;
  }
}

export async function l1Set(
  tool: string,
  paramsHash: string,
  body: string,
  ttlSeconds: number,
): Promise<void> {
  try {
    const cache = caches.default;
    const key = buildCacheKey(tool, paramsHash);
    const response = new Response(body, {
      headers: {
        "Cache-Control": `public, max-age=${ttlSeconds}`,
        "Content-Type": "application/json",
      },
    });
    await cache.put(key, response);
  } catch {
    // Cache put failures are non-fatal
  }
}
