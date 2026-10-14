/**
 * O prazo da ida ao e-Cidadania cobre o CORPO, não só os cabeçalhos. No modo
 * `response`, o `@sbissoli/mcp-upstream` desarma o cronômetro quando chegam os
 * cabeçalhos; sem `PrazoDoCorpo`, um portal que trava no corpo pendurava a chamada.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchEcidadaniaJson, fetchPage } from "../../src/scraper/ecidadania.js";

const mockFetch = vi.fn();

/** Cabeçalhos chegam; o corpo só termina (com erro) quando o sinal da ida aborta. */
function cabecalhosSemCorpo() {
  mockFetch.mockImplementation((_url: string, init: { signal: AbortSignal }) =>
    Promise.resolve(
      new Response(
        new ReadableStream({
          start(c) {
            init.signal.addEventListener("abort", () =>
              c.error(Object.assign(new Error("aborted"), { name: "AbortError" })),
            );
          },
        }),
        { status: 200 },
      ),
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  vi.clearAllMocks();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("e-Cidadania: prazo no corpo", () => {
  it("página HTML que trava no corpo sai como timeout retryable da fonte", async () => {
    cabecalhosSemCorpo();
    const esperado = expect(fetchPage("/visualizacaoideia?id=1")).rejects.toMatchObject({
      message: "e-Cidadania: timeout (10s) ao acessar /visualizacaoideia?id=1",
      retryable: true,
      classe: "fonte",
    });
    await vi.advanceTimersByTimeAsync(10_500);
    await esperado;
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("REST JSON que trava no corpo sai como o mesmo timeout", async () => {
    cabecalhosSemCorpo();
    const esperado = expect(fetchEcidadaniaJson("/restcolecaomaisideia")).rejects.toMatchObject({
      message: "e-Cidadania REST API: timeout (10s) ao acessar /restcolecaomaisideia",
      retryable: true,
    });
    await vi.advanceTimersByTimeAsync(10_500);
    await esperado;
  });

  it("corpo que chega a tempo continua lido normalmente", async () => {
    mockFetch.mockResolvedValueOnce(new Response('[{"id":1}]', { status: 200 }));
    await expect(fetchEcidadaniaJson("/restcolecaomaisideia")).resolves.toEqual([{ id: 1 }]);
  });
});
