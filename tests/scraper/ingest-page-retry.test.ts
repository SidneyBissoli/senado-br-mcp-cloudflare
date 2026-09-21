import { describe, it, expect } from "vitest";
import { fetchParsedPage, firstContactOpts, logPageFailure } from "../../scripts/ingest-ecidadania/page-retry.js";

const noSleep = async () => {};
const parseCsv = (html: string) => (html ? html.split(",").filter(Boolean) : []);

describe("fetchParsedPage", () => {
  it("returns html+items on first successful attempt", async () => {
    const result = await fetchParsedPage("u", parseCsv, {
      fetchText: async () => "a,b",
      sleepFn: noSleep,
    });
    expect(result).toEqual({ html: "a,b", items: ["a", "b"] });
  });

  it("retries when the fetch throws, then succeeds", async () => {
    let calls = 0;
    const result = await fetchParsedPage("u", parseCsv, {
      fetchText: async () => {
        calls++;
        if (calls === 1) throw new Error("HTTP 503 for u");
        return "a";
      },
      sleepFn: noSleep,
    });
    expect(calls).toBe(2);
    expect(result.items).toEqual(["a"]);
  });

  it("retries a 200 page that parses to zero items (degraded HTML)", async () => {
    let calls = 0;
    const result = await fetchParsedPage("u", parseCsv, {
      fetchText: async () => {
        calls++;
        return calls === 1 ? "" : "a,b,c";
      },
      sleepFn: noSleep,
    });
    expect(calls).toBe(2);
    expect(result.items).toEqual(["a", "b", "c"]);
  });

  it("does not retry an empty parse when allowEmpty is set", async () => {
    let calls = 0;
    const result = await fetchParsedPage("u", parseCsv, {
      allowEmpty: true,
      fetchText: async () => {
        calls++;
        return "";
      },
      sleepFn: noSleep,
    });
    expect(calls).toBe(1);
    expect(result.items).toEqual([]);
  });

  it("throws with the LAST failure reason after exhausting attempts", async () => {
    let calls = 0;
    await expect(
      fetchParsedPage("u", parseCsv, {
        attempts: 3,
        fetchText: async () => {
          calls++;
          if (calls < 3) throw new Error(`erro ${calls}`);
          return ""; // last attempt: degraded page
        },
        sleepFn: noSleep,
      }),
    ).rejects.toThrow(/HTML degradado: 0 itens parseados \(len=0\) — após 3 tentativa\(s\)/);
    expect(calls).toBe(3);
  });

  it("sleeps between attempts but not after the last one", async () => {
    const sleeps: number[] = [];
    await expect(
      fetchParsedPage("u", parseCsv, {
        attempts: 3,
        retryDelayMs: 123,
        fetchText: async () => {
          throw new Error("down");
        },
        sleepFn: async (ms) => {
          sleeps.push(ms);
        },
      }),
    ).rejects.toThrow(/down — após 3 tentativa\(s\)/);
    expect(sleeps).toEqual([123, 123]);
  });

  it("treats a parse-thrown error as a failed attempt (retryable)", async () => {
    let calls = 0;
    const result = await fetchParsedPage(
      "u",
      (html) => {
        calls++;
        if (calls === 1) throw new Error("regex explodiu");
        return parseCsv(html);
      },
      { fetchText: async () => "a", sleepFn: noSleep },
    );
    expect(result.items).toEqual(["a"]);
  });
});

describe("logPageFailure", () => {
  it("does not throw on non-Error values", () => {
    expect(() => logPageFailure("ideias", "s7:p9", "string qualquer")).not.toThrow();
    expect(() => logPageFailure("ideias", "s7:p9", new Error("x"))).not.toThrow();
  });
});

describe("firstContactOpts — o orcamento da pagina 1", () => {
  // Estes casos derivam do defeito de 21/09/2026: a ingestao de consultas morreu em
  // `pesquisamateria?p=1` com curl (28) depois de ~8 min, dentro de um job com 200 min de
  // orcamento, e a pagina 1 e FATAL (sem ela o run inteiro se perde). Nada aqui fixa um
  // numero literal: o que se afirma e a RELACAO entre os dois perfis e o efeito observavel.

  it("e estritamente mais paciente que o perfil de pagina do meio do crawl", async () => {
    const meioDoCrawl = await contarTentativasAteDesistir({});
    const primeiroContato = await contarTentativasAteDesistir(firstContactOpts());
    expect(primeiroContato).toBeGreaterThan(meioDoCrawl);
  });

  it("espera entre as tentativas por muito mais tempo que o perfil de pagina", async () => {
    const meioDoCrawl = await somarEsperaAteDesistir({});
    const primeiroContato = await somarEsperaAteDesistir(firstContactOpts());
    expect(primeiroContato).toBeGreaterThan(meioDoCrawl);
  });

  it("sobrevive a uma queda do portal que derruba o perfil de pagina", async () => {
    // Quantas falhas seguidas o perfil de pagina NAO aguenta.
    const quedas = await contarTentativasAteDesistir({});
    const tentar = (opts: Parameters<typeof fetchParsedPage>[2]) =>
      fetchParsedPage(
        "u",
        parseCsv,
        {
          ...opts,
          fetchText: (() => {
            let n = 0;
            return async () => {
              n++;
              if (n <= quedas) throw new Error("curl failed: (28) Operation timed out");
              return "a,b";
            };
          })(),
          sleepFn: noSleep,
        },
      );

    await expect(tentar({})).rejects.toThrow(/28/);
    await expect(tentar(firstContactOpts())).resolves.toMatchObject({ items: ["a", "b"] });
  });
});

/** Quantas tentativas o perfil faz antes de desistir, medido contra um fetch que sempre falha. */
async function contarTentativasAteDesistir(opts: Record<string, unknown>): Promise<number> {
  let calls = 0;
  await fetchParsedPage("u", parseCsv, {
    ...opts,
    fetchText: async () => {
      calls++;
      throw new Error("sempre falha");
    },
    sleepFn: noSleep,
  }).catch(() => {});
  return calls;
}

/** Soma das pausas que o perfil pede antes de desistir. */
async function somarEsperaAteDesistir(opts: Record<string, unknown>): Promise<number> {
  let total = 0;
  await fetchParsedPage("u", parseCsv, {
    ...opts,
    fetchText: async () => {
      throw new Error("sempre falha");
    },
    sleepFn: async (ms: number) => {
      total += ms;
    },
  }).catch(() => {});
  return total;
}
