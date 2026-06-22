import { describe, it, expect, beforeEach } from "vitest";
import { instrumentTool } from "../src/instrument.js";
import { getMetrics, _resetMetrics } from "../src/metrics.js";
import { recordFetch } from "../src/observability/call-context.js";

/** Minimal fake of an Analytics Engine dataset that captures written points. */
function fakeAnalytics() {
  const points: AnalyticsEngineDataPoint[] = [];
  return {
    points,
    dataset: {
      writeDataPoint(p: AnalyticsEngineDataPoint) {
        points.push(p);
      },
    } as unknown as AnalyticsEngineDataset,
  };
}

describe("instrumentTool", () => {
  beforeEach(() => {
    _resetMetrics();
  });

  it("counts a successful call per tool and writes an ok datapoint", async () => {
    const ae = fakeAnalytics();
    const wrapped = instrumentTool("senado_obter_senador", async () => ({ ok: true }), ae.dataset);

    const result = await wrapped({});

    expect(result).toEqual({ ok: true });
    expect(getMetrics().toolCalls).toBe(1);
    expect(getMetrics().perTool.senado_obter_senador).toEqual({ calls: 1, errors: 0 });
    expect(ae.points).toHaveLength(1);
    expect(ae.points[0].indexes).toEqual(["senado_obter_senador"]);
    // No cache fetches in this callback → cacheClass "none", zero fetch/hit counts.
    expect(ae.points[0].blobs).toEqual(["senado_obter_senador", "ok", "none"]);
    expect(ae.points[0].doubles).toEqual([0, 0, 0]);
  });

  it("treats a result with isError:true as a failed call", async () => {
    const ae = fakeAnalytics();
    const wrapped = instrumentTool("senado_ceaps", async () => ({ isError: true, content: [] }), ae.dataset);

    await wrapped({});

    expect(getMetrics().perTool.senado_ceaps).toEqual({ calls: 1, errors: 1 });
    expect(ae.points[0].blobs).toEqual(["senado_ceaps", "error", "none"]);
    expect(ae.points[0].doubles).toEqual([1, 0, 0]);
  });

  it("counts a thrown error and rethrows it", async () => {
    const ae = fakeAnalytics();
    const boom = new Error("upstream down");
    const wrapped = instrumentTool("senado_vetos", async () => {
      throw boom;
    }, ae.dataset);

    await expect(wrapped({})).rejects.toThrow("upstream down");
    expect(getMetrics().perTool.senado_vetos).toEqual({ calls: 1, errors: 1 });
    expect(ae.points[0].blobs).toEqual(["senado_vetos", "error", "none"]);
  });

  it("works without an analytics binding (in-memory only)", async () => {
    const wrapped = instrumentTool("senado_listar_senadores", async () => ({ ok: true }), undefined);

    const result = await wrapped({});

    expect(result).toEqual({ ok: true });
    expect(getMetrics().perTool.senado_listar_senadores).toEqual({ calls: 1, errors: 0 });
  });

  it("never lets a telemetry failure break the tool response", async () => {
    const throwingDataset = {
      writeDataPoint() {
        throw new Error("AE unavailable");
      },
    } as unknown as AnalyticsEngineDataset;
    const wrapped = instrumentTool("senado_obter_materia", async () => ({ ok: true }), throwingDataset);

    await expect(wrapped({})).resolves.toEqual({ ok: true });
    expect(getMetrics().perTool.senado_obter_materia).toEqual({ calls: 1, errors: 0 });
  });

  it("records cache fetch counts and classifies a mixed call as 'partial'", async () => {
    const ae = fakeAnalytics();
    // A tool that makes 3 upstream fetches, 2 served from cache → partial.
    const wrapped = instrumentTool("senado_obter_materia", async () => {
      recordFetch(true);
      recordFetch(false);
      recordFetch(true);
      return { ok: true };
    }, ae.dataset);

    await wrapped({});

    expect(ae.points[0].blobs).toEqual(["senado_obter_materia", "ok", "partial"]);
    expect(ae.points[0].doubles).toEqual([0, 3, 2]); // [errorFlag, fetches, hits]
  });

  it("classifies an all-hit call as 'cached' and an all-live call as 'live'", async () => {
    const ae = fakeAnalytics();
    const cached = instrumentTool("senado_obter_votacao", async () => {
      recordFetch(true);
      return { ok: true };
    }, ae.dataset);
    const live = instrumentTool("senado_search_processos", async () => {
      recordFetch(false);
      return { ok: true };
    }, ae.dataset);

    await cached({});
    await live({});

    expect(ae.points[0].blobs).toEqual(["senado_obter_votacao", "ok", "cached"]);
    expect(ae.points[0].doubles).toEqual([0, 1, 1]);
    expect(ae.points[1].blobs).toEqual(["senado_search_processos", "ok", "live"]);
    expect(ae.points[1].doubles).toEqual([0, 1, 0]);
  });

  it("isolates cache stats per call (no leakage across invocations)", async () => {
    const ae = fakeAnalytics();
    const wrapped = instrumentTool("senado_search_votacoes", async () => {
      recordFetch(false);
      return { ok: true };
    }, ae.dataset);

    await wrapped({});
    await wrapped({});

    // Each call sees a fresh store — 1 fetch each, not accumulated.
    expect(ae.points[0].doubles).toEqual([0, 1, 0]);
    expect(ae.points[1].doubles).toEqual([0, 1, 0]);
  });

  it("accumulates calls across invocations of the same tool", async () => {
    const wrapped = instrumentTool("senado_search_votacoes", async () => ({ ok: true }), undefined);
    await wrapped({});
    await wrapped({});
    await wrapped({});
    expect(getMetrics().perTool.senado_search_votacoes).toEqual({ calls: 3, errors: 0 });
  });
});
