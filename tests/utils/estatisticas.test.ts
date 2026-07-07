import { describe, it, expect } from "vitest";
import {
  computarEstatisticas,
  percentil,
  type Estatisticas,
  type EstatisticasPorGrupo,
} from "../../src/utils/estatisticas.js";

/** 10,20,…,100 — chosen so the type-7 percentiles are hand-verifiable against numpy. */
const DEZ = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((v) => ({ v }));
const valorDe = (r: Record<string, unknown>) => r.v as number;

describe("percentil (type 7 / numpy / Excel PERCENTILE.INC)", () => {
  const asc = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  it("interpolates linearly between neighbouring ranks", () => {
    // numpy.percentile([10..100], q) references:
    expect(percentil(asc, 0.25)).toBeCloseTo(32.5, 10);
    expect(percentil(asc, 0.5)).toBeCloseTo(55, 10);
    expect(percentil(asc, 0.75)).toBeCloseTo(77.5, 10);
    expect(percentil(asc, 0.9)).toBeCloseTo(91, 10);
    expect(percentil(asc, 0.95)).toBeCloseTo(95.5, 10);
    expect(percentil(asc, 0.99)).toBeCloseTo(99.1, 10);
  });
  it("returns the endpoints at q=0 and q=1", () => {
    expect(percentil(asc, 0)).toBe(10);
    expect(percentil(asc, 1)).toBe(100);
  });
  it("handles empty and singleton arrays", () => {
    expect(percentil([], 0.5)).toBe(0);
    expect(percentil([42], 0.9)).toBe(42);
  });
});

describe("computarEstatisticas (no grouping)", () => {
  const r = computarEstatisticas(DEZ, valorDe, { topN: 3 }) as Estatisticas;

  it("computes the scalar summary", () => {
    expect(r.n).toBe(10);
    expect(r.soma).toBe(550);
    expect(r.minimo).toBe(10);
    expect(r.maximo).toBe(100);
    expect(r.media).toBe(55);
    expect(r.mediana).toBe(55);
    expect(r.desvioPadrao).toBeCloseTo(28.722813, 5); // population std = sqrt(825)
  });

  it("exposes the six percentiles", () => {
    expect(r.percentis).toMatchObject({ p25: 32.5, p50: 55, p75: 77.5, p90: 91 });
    expect(r.percentis.p95).toBeCloseTo(95.5, 10);
    expect(r.percentis.p99).toBeCloseTo(99.1, 10);
  });

  it("carries the value into argMax/argMin", () => {
    expect(r.argMax).toMatchObject({ valor: 100 });
    expect(r.argMin).toMatchObject({ valor: 10 });
  });

  it("returns top/bottom of size topN, correctly ordered", () => {
    expect(r.top.map((e) => e.valor)).toEqual([100, 90, 80]);
    expect(r.bottom.map((e) => e.valor)).toEqual([10, 20, 30]);
  });

  it("omits top/bottom when topN is 0 (default)", () => {
    const s = computarEstatisticas(DEZ, valorDe) as Estatisticas;
    expect(s.top).toEqual([]);
    expect(s.bottom).toEqual([]);
  });
});

describe("computarEstatisticas — identifiers and tie-breaks", () => {
  it("argMax carries the identifier fields via `identificar`", () => {
    const folha = [
      { seq: 1, nome: "ANA", bruto: 30 },
      { seq: 2, nome: "BENTO", bruto: 90 },
      { seq: 3, nome: "CARLA", bruto: 60 },
    ];
    const r = computarEstatisticas(folha, (x) => x.bruto as number, {
      identificar: (x) => ({ sequencial: x.seq, nome: x.nome }),
    }) as Estatisticas;
    expect(r.argMax).toEqual({ sequencial: 2, nome: "BENTO", valor: 90 });
    expect(r.argMin).toEqual({ sequencial: 1, nome: "ANA", valor: 30 });
  });

  it("breaks argMax/argMin ties by smallest `desempate` (stable)", () => {
    const empatados = [
      { seq: 7, bruto: 100 },
      { seq: 3, bruto: 100 }, // same value, smaller seq -> should win argMax
      { seq: 5, bruto: 10 },
      { seq: 2, bruto: 10 }, // same value, smaller seq -> should win argMin
    ];
    const r = computarEstatisticas(empatados, (x) => x.bruto as number, {
      identificar: (x) => ({ sequencial: x.seq }),
      desempate: (x) => x.seq as number,
    }) as Estatisticas;
    expect(r.argMax).toMatchObject({ sequencial: 3, valor: 100 });
    expect(r.argMin).toMatchObject({ sequencial: 2, valor: 10 });
  });
});

describe("computarEstatisticas — grouping", () => {
  it("computes statistics per group, ordered by total desc", () => {
    const folha = [
      { tipo: "Normal", bruto: 100 },
      { tipo: "Normal", bruto: 200 },
      { tipo: "Suplementar", bruto: 50 },
    ];
    const r = computarEstatisticas(folha, (x) => x.bruto as number, {
      agruparPor: (x) => x.tipo as string,
    }) as EstatisticasPorGrupo;
    expect(r.totalGrupos).toBe(2);
    expect(r.aviso).toBeUndefined();
    expect(r.grupos.map((g) => g.grupo)).toEqual(["Normal", "Suplementar"]); // Normal (300) before Suplementar (50)
    expect(r.grupos[0]).toMatchObject({ grupo: "Normal", n: 2, soma: 300, media: 150 });
    expect(r.grupos[1]).toMatchObject({ grupo: "Suplementar", n: 1, soma: 50 });
  });

  it("caps the number of groups and emits an aviso", () => {
    const muitos = Array.from({ length: 60 }, (_, i) => ({ g: `grupo${i}`, v: i }));
    const r = computarEstatisticas(muitos, (x) => x.v as number, {
      agruparPor: (x) => x.g as string,
      maxGrupos: 50,
    }) as EstatisticasPorGrupo;
    expect(r.totalGrupos).toBe(60);
    expect(r.grupos).toHaveLength(50);
    expect(r.aviso).toContain("50 de 60 grupos");
  });
});

describe("computarEstatisticas — empty input", () => {
  it("returns a well-formed zeroed result", () => {
    const r = computarEstatisticas([], valorDe, { topN: 5 }) as Estatisticas;
    expect(r.n).toBe(0);
    expect(r.soma).toBe(0);
    expect(r.argMax).toBeNull();
    expect(r.argMin).toBeNull();
    expect(r.top).toEqual([]);
    expect(r.percentis).toEqual({ p25: 0, p50: 0, p75: 0, p90: 0, p95: 0, p99: 0 });
  });
});
