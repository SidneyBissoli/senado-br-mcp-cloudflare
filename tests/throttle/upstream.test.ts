import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  upstreamFetch,
  UpstreamError,
  RecursoAusenteError,
  upstreamIo,
  withUpstreamCall,
  currentRetrieval,
} from "../../src/throttle/upstream.js";
import { provenanceFor } from "../../src/utils/provenance.js";
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

/** Sem espera real entre tentativas e sem jitter: os testes contam chamadas, não o relógio. */
function calarEsperas() {
  vi.spyOn(upstreamIo, "sleep").mockResolvedValue(undefined);
  vi.spyOn(upstreamIo, "random").mockReturnValue(0);
}

describe("upstreamFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: rate limiter allows
    vi.spyOn(tokenBucket.globalBucket, "tryConsume").mockReturnValue(true);
    calarEsperas();
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
    const headers = new Headers(mockFetch.mock.calls[0][1].headers);
    expect(headers.get("accept")).toBe("application/json");
    expect(headers.get("user-agent")).toContain("senado-br-mcp");
  });

  it("modo texto: devolve o corpo cru com o Accept pedido, sem sufixo .json", async () => {
    mockFetch.mockResolvedValueOnce(new Response("Senhor Presidente, ...", { status: 200 }));
    const texto = await upstreamFetch("/discurso/texto-integral/1", {}, undefined, {
      noJsonSuffix: true,
      text: true,
      accept: "text/plain, application/json",
    });
    expect(texto).toBe("Senhor Presidente, ...");
    expect(mockFetch.mock.calls[0][0]).toBe("https://legis.senado.leg.br/dadosabertos/discurso/texto-integral/1");
    expect(new Headers(mockFetch.mock.calls[0][1].headers).get("accept")).toBe("text/plain, application/json");
  });

  it("gives up immediately when Retry-After exceeds the time budget", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 429, { "retry-after": "3600" }));
    const start = Date.now();
    await expect(upstreamFetch("/busy")).rejects.toMatchObject({ status: 429, retryable: true });
    expect(mockFetch).toHaveBeenCalledOnce();
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

// ── Política de repetição (o pacote classifica, o senado decide) ──────────────
//
// `Retry-After`, backoff e a desistência por orçamento são provados no pacote
// (`@sbissoli/mcp-upstream`, 42 testes offline). Aqui fica o que é DESTE
// servidor: quais classes repetem, com que mensagem e que contagem sai no bloco.

describe("upstreamFetch — política de repetição (3.11.0)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(tokenBucket.globalBucket, "tryConsume").mockReturnValue(true);
    calarEsperas();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("503 repete e o sucesso seguinte sai limpo, com a espera pedida ao upstreamIo", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 503)).mockResolvedValueOnce(jsonResponse({ ok: 1 }));
    await expect(upstreamFetch("/x")).resolves.toEqual({ ok: 1 });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(upstreamIo.sleep).toHaveBeenCalledWith(1000); // backoff 1 s, jitter 0 (random calado)
  });

  it("500 genérico passa a repetir (era retryable para o agente, mas o servidor não repetia)", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 500));
    await expect(upstreamFetch("/x")).rejects.toMatchObject({
      status: 500,
      retryable: true,
      transport: false,
      message: "[/x] Upstream retornou HTTP 500",
    });
    expect(mockFetch).toHaveBeenCalledTimes(3); // 1 + 2 retries
  });

  it("falha de rede repete e sai como 502 de transporte com a causa na mensagem", async () => {
    mockFetch.mockRejectedValue(new TypeError("fetch failed: ECONNRESET"));
    await expect(upstreamFetch("/x")).rejects.toMatchObject({
      status: 502,
      retryable: true,
      transport: true,
      message: "[/x] Erro de rede: fetch failed: ECONNRESET",
    });
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it("timeout NÃO repete: a tentativa pendurada já gastou o orçamento", async () => {
    vi.useFakeTimers();
    try {
      mockFetch.mockImplementation(
        (_url: string, init: { signal: AbortSignal }) =>
          new Promise((_, reject) => {
            init.signal.addEventListener("abort", () =>
              reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            );
          }),
      );
      const promessa = upstreamFetch("/lento");
      const esperado = expect(promessa).rejects.toMatchObject({
        status: 504,
        retryable: true,
        transport: true,
        message: "[/lento] Timeout na requisição upstream (10s)",
      });
      await vi.advanceTimersByTimeAsync(10_500);
      await esperado;
      expect(mockFetch).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("4xx que não é 404 não repete e não é retryable", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({}, 400));
    await expect(upstreamFetch("/x")).rejects.toMatchObject({
      status: 400,
      retryable: false,
      message: "[/x] Upstream retornou HTTP 400",
    });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("corpo vazio continua 502 retryable SEM repetir (há endpoint em que é determinístico)", async () => {
    mockFetch.mockResolvedValueOnce(new Response("", { status: 200 }));
    await expect(upstreamFetch("/comissao/reuniao/1")).rejects.toMatchObject({
      status: 502,
      retryable: true,
      transport: false,
      message: "[/comissao/reuniao/1] Resposta upstream vazia",
    });
    expect(mockFetch).toHaveBeenCalledOnce();
  });
});

// ── O coletor: o que `retrieval` diz ─────────────────────────────────────────

describe("upstreamFetch — coletor de rede e retrieval", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(tokenBucket.globalBucket, "tryConsume").mockReturnValue(true);
    calarEsperas();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fora de uma chamada de tool não há medição: retrieval null, e a ida acontece mesmo assim", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ a: 1 }));
    await upstreamFetch("/x");
    expect(currentRetrieval()).toBeNull();
    expect(provenanceFor("SENADO_LEGIS", "https://b", "/x").retrieval).toBeNull();
  });

  it("dentro de withUpstreamCall conta idas, tentativas e anomalias — e provenanceFor as emite", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse({}, 503))
      .mockResolvedValueOnce(jsonResponse({ a: 1 }))
      .mockResolvedValueOnce(jsonResponse({ b: 2 }));
    await withUpstreamCall(async () => {
      await upstreamFetch("/a");
      await upstreamFetch("/b");
      expect(currentRetrieval()).toEqual({
        requests: 2,
        attempts: 3,
        anomalies: [{ kind: "http_5xx", count: 1 }],
      });
      const prov = provenanceFor("SENADO_LEGIS", "https://b", "/a");
      expect(prov.retrieval).toMatchObject({ requests: 2, attempts: 3, unstable: true });
    });
  });

  it("chamada aninhada reusa o coletor aberto (a tool de fora não perde as idas de dentro)", async () => {
    // Uma Response NOVA por chamada: o corpo só pode ser lido uma vez.
    mockFetch.mockImplementation(() => jsonResponse({}));
    await withUpstreamCall(async () => {
      await withUpstreamCall(async () => {
        await upstreamFetch("/dentro");
      });
      await upstreamFetch("/fora");
      expect(currentRetrieval()).toEqual({ requests: 2, attempts: 2, anomalies: [] });
    });
  });

  it("404 com on404 conta como ida, não como anomalia", async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 404 }));
    await withUpstreamCall(async () => {
      await expect(upstreamFetch("/supridos/2005", {}, undefined, { on404: "absent" })).rejects.toBeInstanceOf(
        RecursoAusenteError,
      );
      expect(currentRetrieval()).toEqual({ requests: 1, attempts: 1, anomalies: [] });
    });
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
