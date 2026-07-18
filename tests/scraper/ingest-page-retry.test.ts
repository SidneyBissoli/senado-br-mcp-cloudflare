import { describe, it, expect } from "vitest";
import { fetchParsedPage, logPageFailure } from "../../scripts/ingest-ecidadania/page-retry.js";

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
