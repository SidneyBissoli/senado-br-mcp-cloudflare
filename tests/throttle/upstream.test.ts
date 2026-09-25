import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  upstreamFetch,
  UpstreamError,
  RecursoAusenteError,
  parseRetryAfterMs,
  computeRetryWaitMs,
} from "../../src/throttle/upstream.js";
import { classifyError } from "../../src/call-shape.js";
import * as tokenBucket from "../../src/throttle/token-bucket.js";

// Mock the global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Mock logger to silence output
vi.mock("../../src/utils/logger.js", () => ({
  log: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock metrics
vi.mock("../../src/metrics.js", () => ({
  incr: vi.fn(),
}));

function jsonResponse(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("upstreamFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: rate limiter allows
    vi.spyOn(tokenBucket.globalBucket, "tryConsume").mockReturnValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and returns parsed JSON", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ result: "ok" }));
    const result = await upstreamFetch("/test/path");
    expect(result).toEqual({ result: "ok" });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("builds URL with sorted query params", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    await upstreamFetch("/test", { b: "2", a: "1" });
    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain("a=1");
    expect(url).toContain("b=2");
    expect(url.indexOf("a=1")).toBeLessThan(url.indexOf("b=2"));
  });

  it("appends .json suffix to path", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    await upstreamFetch("/senador/lista/atual");
    expect(mockFetch.mock.calls[0][0]).toContain("/senador/lista/atual.json");
  });

  it("throws UpstreamError on rate limit (bucket empty)", async () => {
    vi.spyOn(tokenBucket.globalBucket, "tryConsume").mockReturnValue(false);
    await expect(upstreamFetch("/test")).rejects.toThrow(UpstreamError);
    await expect(upstreamFetch("/test")).rejects.toMatchObject({ status: 429, retryable: true });
  });

  it("throws UpstreamError on non-OK non-retryable status", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 404));
    try {
      await upstreamFetch("/missing");
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UpstreamError);
      expect((e as UpstreamError).status).toBe(404);
      expect((e as UpstreamError).retryable).toBe(false);
    }
  });

  it("throws on response exceeding size limit (via Content-Length)", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({}, 200, { "content-length": "10000000" }),
    );
    await expect(upstreamFetch("/big")).rejects.toThrow("5 MB");
  });

  it("throws on invalid JSON response", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("not json at all", { status: 200 }),
    );
    await expect(upstreamFetch("/bad-json")).rejects.toThrow("JSON");
  });

  it("omits empty string params from URL", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    await upstreamFetch("/test", { a: "1", b: "" });
    const url = mockFetch.mock.calls[0][0];
    expect(url).toContain("a=1");
    expect(url).not.toContain("b=");
  });

  it("uses custom base URL when provided", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    await upstreamFetch("/path", {}, "https://custom.api.com");
    expect(mockFetch.mock.calls[0][0]).toContain("https://custom.api.com/path.json");
  });

  it("sends correct headers", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}));
    await upstreamFetch("/test");
    const opts = mockFetch.mock.calls[0][1];
    expect(opts.headers.Accept).toBe("application/json");
    expect(opts.headers["User-Agent"]).toContain("senado-br-mcp");
  });

  it("gives up immediately when Retry-After exceeds the time budget", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 429, { "retry-after": "3600" }));
    const start = Date.now();
    await expect(upstreamFetch("/busy")).rejects.toMatchObject({ status: 429, retryable: true });
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe("parseRetryAfterMs", () => {
  it("parses the delta-seconds form", () => {
    expect(parseRetryAfterMs("5")).toBe(5000);
    expect(parseRetryAfterMs("0")).toBe(0);
    expect(parseRetryAfterMs(" 12 ")).toBe(12000);
  });

  it("parses the HTTP-date form relative to now", () => {
    const now = Date.parse("2026-07-16T12:00:00Z");
    const inThirty = new Date(now + 30_000).toUTCString();
    expect(parseRetryAfterMs(inThirty, now)).toBe(30_000);
  });

  it("clamps past HTTP-dates to zero", () => {
    const now = Date.parse("2026-07-16T12:00:00Z");
    const past = new Date(now - 60_000).toUTCString();
    expect(parseRetryAfterMs(past, now)).toBe(0);
  });

  it("returns null for absent or unparseable values", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs("")).toBeNull();
    expect(parseRetryAfterMs("soon")).toBeNull();
  });
});

describe("computeRetryWaitMs", () => {
  it("uses bounded exponential backoff when there is no Retry-After", () => {
    expect(computeRetryWaitMs(0, null, 0)).toBe(1000);
    expect(computeRetryWaitMs(1, null, 0)).toBe(2000);
    expect(computeRetryWaitMs(5, null, 0)).toBe(4000); // capped
  });

  it("honors a Retry-After longer than the backoff", () => {
    expect(computeRetryWaitMs(0, 3000, 0)).toBe(3000);
  });

  it("never waits less than the backoff even if Retry-After is shorter", () => {
    expect(computeRetryWaitMs(1, 500, 0)).toBe(2000);
  });

  it("adds the jitter on top", () => {
    expect(computeRetryWaitMs(0, 3000, 250)).toBe(3250);
  });
});

// ── on404: os DOIS 404 da fonte ───────────────────────────────────────────────
//
// Os corpos abaixo são CÓPIA LITERAL do que as duas APIs do Senado
// responderam em 24/09/2026, coladas de `curl`, não construídas a partir do
// padrão que `rotaInexistente` casa — o conferidor não pode reusar o caminho do
// defeito ([[guarda-que-reusa-o-padrao-do-defeito]]). Se a fonte mudar a forma,
// é o tier de contrato que acusa, e estas guardas continuam descrevendo o
// contrato que o código promete.

/** `GET /api/v1/servidores/xxxx` — rota que NÃO existe. */
const CORPO_ROTA_INEXISTENTE =
  '{"type":"about:blank","title":"Not Found","status":404,' +
  '"detail":"No static resource api/v1/servidores/xxxx.",' +
  '"instance":"/adm-dadosabertos/api/v1/servidores/xxxx"}';

/** `GET /taquigrafia/notas/sessao/99999999` — rota existe, CHAVE não. */
const CORPO_CHAVE_AUSENTE =
  '{"instance":"/dadosabertos/taquigrafia/notas/sessao/99999999",' +
  '"status":404,"title":"Not Found"}';

/** `GET /api/v1/supridos/2005` — ano fora da cobertura: nginx, Content-Length 0. */
const CORPO_VAZIO = "";

function resposta404(corpo: string) {
  return new Response(corpo || null, {
    status: 404,
    headers: { "Content-Type": "application/problem+json" },
  });
}

describe("upstreamFetch — on404", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(tokenBucket.globalBucket, "tryConsume").mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sem on404, o 404 continua erro de upstream", async () => {
    mockFetch.mockResolvedValueOnce(resposta404(CORPO_VAZIO));
    await expect(upstreamFetch("/supridos/2005")).rejects.toBeInstanceOf(UpstreamError);
  });

  it('on404 "absent": corpo vazio vira ausência tipada, não []', async () => {
    mockFetch.mockResolvedValueOnce(resposta404(CORPO_VAZIO));
    await expect(
      upstreamFetch("/supridos/2005", {}, undefined, { on404: "absent" }),
    ).rejects.toBeInstanceOf(RecursoAusenteError);
  });

  it('on404 "absent": problem+json SEM detail também é chave ausente', async () => {
    mockFetch.mockResolvedValueOnce(resposta404(CORPO_CHAVE_AUSENTE));
    await expect(
      upstreamFetch("/taquigrafia/notas/sessao/99999999", {}, undefined, { on404: "absent" }),
    ).rejects.toBeInstanceOf(RecursoAusenteError);
  });

  it("a ausência tipada classifica como nao_encontrado", async () => {
    mockFetch.mockResolvedValueOnce(resposta404(CORPO_VAZIO));
    try {
      await upstreamFetch("/supridos/2005", {}, undefined, { on404: "absent" });
      expect.unreachable("deveria ter lançado");
    } catch (e) {
      expect(classifyError((e as Error).message)).toBe("nao_encontrado");
      expect((e as UpstreamError).retryable).toBe(false);
    }
  });

  it('on404 "empty": corpo vazio vira [] (rota de 404 ambíguo)', async () => {
    mockFetch.mockResolvedValueOnce(resposta404(CORPO_VAZIO));
    const r = await upstreamFetch("/contratacoes/contratos/541/itens", {}, undefined, {
      on404: "empty",
    });
    expect(r).toEqual([]);
  });

  it("rota inexistente NUNCA vira [] nem ausência — nem com on404 empty", async () => {
    for (const on404 of ["absent", "empty"] as const) {
      mockFetch.mockResolvedValueOnce(resposta404(CORPO_ROTA_INEXISTENTE));
      try {
        await upstreamFetch("/servidores/xxxx", {}, undefined, { on404 });
        expect.unreachable(`deveria ter lançado com on404=${on404}`);
      } catch (e) {
        expect(e).not.toBeInstanceOf(RecursoAusenteError);
        // É defeito NOSSO (caminho montado errado), não ausência de dado:
        // a telemetria tem de separar os dois.
        expect(classifyError((e as Error).message)).toBe("defeito");
      }
    }
  });
});
