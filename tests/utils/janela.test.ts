import { describe, it, expect, vi } from "vitest";
import { LimiteLocalError, UpstreamError, upstreamIo } from "../../src/throttle/upstream.js";
import {
  TENTATIVAS_LIMITE_LOCAL,
  avisoDeCorte,
  camposDePeriodosNaoLidos,
  carimboDaJanela,
  carimboDoMes,
  dataBR,
  diasEntre,
  excedeUmAno,
  fatiar,
  filtrarPeriodo,
  hojeEmBrasilia,
  lerFatias,
  lerPorAno,
  maisAntigo,
  paraCompacta,
  paraISO,
  recusarJanelaInvertida,
} from "../../src/utils/janela.js";

const textoDoErro = (r: { content: Array<{ text: string }> }) => JSON.parse(r.content[0].text).error as string;

describe("datas", () => {
  it("converts between compact, ISO and Brazilian formats", () => {
    expect(paraISO("20261030")).toBe("2026-10-30");
    expect(paraISO("2026-10-30")).toBe("2026-10-30");
    expect(paraCompacta("2026-10-30")).toBe("20261030");
    expect(dataBR("2026-10-30")).toBe("30/10/2026");
    expect(carimboDoMes("20260215")).toBe("2026-02");
  });

  it("today is Brasília's date, not UTC's", () => {
    // 01:30 UTC on 31/10 is still 30/10 in Brasília (UTC−3).
    expect(hojeEmBrasilia(new Date("2026-10-31T01:30:00Z"))).toBe("2026-10-30");
    expect(hojeEmBrasilia(new Date("2026-10-31T03:30:00Z"))).toBe("2026-10-31");
  });

  it("counts calendar days between the two ends", () => {
    expect(diasEntre("20260801", "20260831")).toBe(30);
    expect(diasEntre("2026-08-01", "2026-09-01")).toBe(31);
  });
});

describe("recusarJanelaInvertida (decisão 3)", () => {
  it("refuses end before start, naming both dates, as a contract error", () => {
    const r = recusarJanelaInvertida("20261030", "20260101")!;
    expect(r.isError).toBe(true);
    expect(textoDoErro(r)).toBe("A data de fim (01/01/2026) é anterior à de início (30/10/2026); corrija o período.");
  });

  it("accepts mixed formats and equal ends; a missing end is not inverted", () => {
    expect(recusarJanelaInvertida("2026-10-30", "20261030")).toBeNull();
    expect(recusarJanelaInvertida("20260101", "2026-10-30")).toBeNull();
    expect(recusarJanelaInvertida("20261030", undefined)).toBeNull();
    expect(recusarJanelaInvertida("2026-10-30", "2026-01-01")!.isError).toBe(true);
  });
});

describe("carimboDaJanela (decisões 4 e 7)", () => {
  const hoje = "2026-10-30";
  it("past window: ISO interval, whatever the input format", () => {
    expect(carimboDaJanela("20260101", "20261030", hoje)).toBe("2026-01-01/2026-10-30");
  });
  it("end in the future: cut at today, with the request in parentheses", () => {
    expect(carimboDaJanela("20260901", "20271231", hoje)).toBe("2026-09-01/2026-10-30 (pedido até 2027-12-31)");
  });
  it("whole window in the future: claims no period at all", () => {
    expect(carimboDaJanela("2027-01-01", "2027-12-31", hoje)).toBe(
      "nenhum período já ocorrido (pedido 2027-01-01/2027-12-31, todo depois de 2026-10-30)",
    );
  });
});

describe("fatiar", () => {
  it("dia: one slice per day", () => {
    expect(fatiar("20260830", "20260902", "dia").map((f) => f.inicio)).toEqual([
      "2026-08-30", "2026-08-31", "2026-09-01", "2026-09-02",
    ]);
  });
  it("mes: calendar months, the ends cut to the window", () => {
    expect(fatiar("20260215", "20260410", "mes")).toEqual([
      { inicio: "2026-02-15", fim: "2026-02-28" },
      { inicio: "2026-03-01", fim: "2026-03-31" },
      { inicio: "2026-04-01", fim: "2026-04-10" },
    ]);
    expect(fatiar("20240201", "20240229", "mes")).toEqual([{ inicio: "2024-02-01", fim: "2024-02-29" }]);
  });
  it("ano: calendar years; a window inside one year is one slice", () => {
    expect(fatiar("2024-01-01", "2026-10-30", "ano")).toEqual([
      { inicio: "2024-01-01", fim: "2024-12-31" },
      { inicio: "2025-01-01", fim: "2025-12-31" },
      { inicio: "2026-01-01", fim: "2026-10-30" },
    ]);
    expect(fatiar("2026-03-01", "2026-03-01", "ano")).toEqual([{ inicio: "2026-03-01", fim: "2026-03-01" }]);
  });
});

describe("excedeUmAno (limite de /processo/emenda)", () => {
  it("start + 1 year passes (measured 30/10/2026: 365 and 366 days answer 200); one more day does not", () => {
    expect(excedeUmAno("2025-10-31", "2026-10-30")).toBe(false);
    expect(excedeUmAno("2025-10-30", "2026-10-30")).toBe(false);
    expect(excedeUmAno("2025-10-29", "2026-10-30")).toBe(true);
    expect(excedeUmAno("20251001", "20261030")).toBe(true);
  });
});

describe("lerFatias / lerPorAno", () => {
  const fatias = fatiar("20260101", "20260105", "dia");

  it("a failing slice does not sink the others; results keep the slice order", async () => {
    const r = await lerFatias(fatias, async (f) => {
      if (f.inicio === "2026-01-03") throw new Error("HTTP 500");
      return f.inicio;
    }, 2);
    expect(r.lidas.map((l) => l.valor)).toEqual(["2026-01-01", "2026-01-02", "2026-01-04", "2026-01-05"]);
    expect(r.falhas.map((f) => f.fatia.inicio)).toEqual(["2026-01-03"]);
  });

  it("never runs more than the concurrency at once", async () => {
    let emVoo = 0;
    let pico = 0;
    await lerFatias(fatias, async () => {
      pico = Math.max(pico, ++emVoo);
      await new Promise((r) => setTimeout(r, 5));
      emVoo--;
    }, 2);
    expect(pico).toBe(2);
  });

  it("a refusal by OUR limiter waits its turn and retries; a source failure does not", async () => {
    const espera = vi.spyOn(upstreamIo, "sleep").mockResolvedValue(undefined);
    const tentativas: Record<string, number> = {};
    const r = await lerFatias(fatias, async (f) => {
      tentativas[f.inicio] = (tentativas[f.inicio] ?? 0) + 1;
      if (f.inicio === "2026-01-02" && tentativas[f.inicio] < 3) throw new LimiteLocalError("[x] Taxa de requisições excedida.", 429);
      if (f.inicio === "2026-01-04") throw new UpstreamError("HTTP 500", 500, true);
      return f.inicio;
    });
    expect(r.lidas.map((l) => l.valor)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-05"]);
    expect(tentativas["2026-01-02"]).toBe(3);
    expect(tentativas["2026-01-04"]).toBe(1);
    expect(r.falhas.map((f) => f.fatia.inicio)).toEqual(["2026-01-04"]);
    expect(espera).toHaveBeenCalledTimes(2);
    espera.mockRestore();
  });

  it("gives up after the limiter refuses every attempt (the slice is then named as not read)", async () => {
    const espera = vi.spyOn(upstreamIo, "sleep").mockResolvedValue(undefined);
    let n = 0;
    const r = await lerFatias([fatias[0]], async () => {
      n++;
      throw new LimiteLocalError("[x] Taxa de requisições excedida.", 429);
    });
    expect(n).toBe(TENTATIVAS_LIMITE_LOCAL);
    expect(r.falhas).toHaveLength(1);
    espera.mockRestore();
  });

  it("lerPorAno: one call per calendar year with both ends, a single call otherwise", async () => {
    const pedidos: Array<Record<string, string | undefined>> = [];
    const ler = async (j: { dataInicio?: string; dataFim?: string }) => (pedidos.push(j), { fetchedAt: "2026-10-30T10:00:00Z" });
    await lerPorAno("2024-06-01", "2025-02-01", ler);
    expect(pedidos).toEqual([
      { dataInicio: "2024-06-01", dataFim: "2024-12-31" },
      { dataInicio: "2025-01-01", dataFim: "2025-02-01" },
    ]);
    pedidos.length = 0;
    await lerPorAno("2024-06-01", undefined, ler);
    expect(pedidos).toEqual([{ dataInicio: "2024-06-01" }]);
  });

  it("lerPorAno: when EVERY slice fails, the failure surfaces (no silent empty list)", async () => {
    await expect(lerPorAno("2024-01-01", "2025-12-31", async () => { throw new Error("HTTP 400"); }))
      .rejects.toThrow("HTTP 400");
  });

  it("names what was left out", () => {
    const campos = camposDePeriodosNaoLidos([{ fatia: { inicio: "2024-01-01", fim: "2024-12-31" } }]);
    expect(campos).toEqual({
      periodosNaoLidos: ["2024-01-01/2024-12-31"],
      aviso: "A fonte falhou ao entregar este período, que ficou FORA da lista: 01/01/2024 a 31/12/2024. Repita a consulta mais tarde para cobri-lo.",
    });
    expect(camposDePeriodosNaoLidos([
      { fatia: { inicio: "2024-01-01", fim: "2024-12-31" } },
      { fatia: { inicio: "2025-01-01", fim: "2025-12-31" } },
    ]).aviso).toBe(
      "A fonte falhou ao entregar estes períodos, que ficaram FORA da lista: 01/01/2024 a 31/12/2024; 01/01/2025 a 31/12/2025. Repita a consulta mais tarde para cobri-los.",
    );
    expect(camposDePeriodosNaoLidos([])).toEqual({});
  });

  it("maisAntigo picks the oldest instant", () => {
    expect(maisAntigo(["2026-10-30T12:00:00Z", "2026-10-30T09:00:00Z", "2026-10-30T10:00:00Z"])).toBe("2026-10-30T09:00:00Z");
    expect(maisAntigo([])).toBeUndefined();
  });
});

describe("filtrarPeriodo (apartes: a fonte ignora o período)", () => {
  const itens = [{ data: "2021-06-29" }, { data: "2023-10-17T00:00:00" }, { data: "2025-03-01" }, { data: null }];
  it("keeps only the items inside the window; no window keeps everything", () => {
    expect(filtrarPeriodo(itens, (x) => x.data, "20240101", "20261030")).toEqual([{ data: "2025-03-01" }]);
    expect(filtrarPeriodo(itens, (x) => x.data, "2023-01-01", undefined)).toHaveLength(2);
    expect(filtrarPeriodo(itens, (x) => x.data)).toBe(itens);
  });
});

describe("avisoDeCorte (decisão 5)", () => {
  const datas = (ds: string[]) => ds.map((data) => ({ data }));
  const d = (x: { data: string }) => x.data;

  it("no cut, no warning", () => {
    expect(avisoDeCorte(datas(["2026-01-01"]), 5, d, "resultados")).toBeUndefined();
  });

  it("list in descending date order: says the most recent and the delivered period", () => {
    expect(avisoDeCorte(datas(["2026-10-29", "2026-08-01", "2026-04-23", "2026-01-02"]), 3, d, "resultados")).toBe(
      "Exibindo 3 de 4 resultados: os mais recentes, de 23/04/2026 a 29/10/2026. Os demais ficaram de fora: reduza o período ou aumente o limite.",
    );
  });

  it("ascending order says the oldest; a boundary day cut in the middle is flagged", () => {
    expect(avisoDeCorte(datas(["2026-01-02", "2026-02-01", "2026-02-01", "2026-03-01"]), 2, d, "processos")).toBe(
      "Exibindo 2 de 4 processos: os mais antigos, de 02/01/2026 a 01/02/2026 (o dia 01/02/2026 só em parte). Os demais ficaram de fora: reduza o período ou aumente o limite.",
    );
  });

  it("out of date order (or no date): never claims a delivered period", () => {
    const fora = avisoDeCorte(datas(["2026-03-01", "2026-01-01", "2026-05-01"]), 2, d, "registros")!;
    expect(fora).toBe(
      "Exibindo 2 de 3 registros, fora de ordem de data: as entregues não cobrem um trecho contínuo do período. Reduza o período ou aumente o limite.",
    );
    expect(avisoDeCorte([{}, {}, {}], 2, () => undefined, "registros")).toMatch(/fora de ordem de data/);
  });
});
