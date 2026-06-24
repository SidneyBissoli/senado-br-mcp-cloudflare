/**
 * Fixture-based unit tests for the consultas_votos CSV parser + aggregator (Arquimedes acervo).
 *
 * Fixture: a tiny but faithful CSV exercising the three gotchas — a quoted EMENTA with an embedded
 * `;` and an embedded newline, a `""`-escaped quote, BR thousand separators in vote counts, and two
 * UF rows for the same matéria (so aggregation is actually tested). Also covers the canonical
 * ConsultaVotoResumo field order and the consultaVotoCore stable-hash contract (a vintage-only
 * change must NOT move the contentHash).
 */

import { describe, it, expect } from "vitest";
import { parseCsv, parseVotosCsv, aggregateByMateria } from "../../scripts/ingest-ecidadania/csv.js";
import { buildConsultaVotoResumo, consultaVotoCore } from "../../src/scraper/ecidadania.js";
import { contentHash } from "../../src/scraper/pipeline.js";
import csvText from "../fixtures/ecidadania/consultas-votos-sample.csv?raw";

describe("parseCsv (RFC-4180 state machine)", () => {
  it("keeps a quoted field with an embedded delimiter and newline as one cell", () => {
    const rows = parseCsv('"a;b\nc";"d"\n"e";"f"\n');
    expect(rows).toEqual([
      ["a;b\nc", "d"],
      ["e", "f"],
    ]);
  });

  it("unescapes a doubled quote inside a quoted field", () => {
    const rows = parseCsv('"say ""hi""";"x"\n');
    expect(rows[0][0]).toBe('say "hi"');
  });

  it("does not emit a spurious empty record for a trailing newline", () => {
    expect(parseCsv("a;b\n")).toEqual([["a", "b"]]);
  });
});

describe("parseVotosCsv", () => {
  const parsed = parseVotosCsv(csvText);

  it("reads the vintage stamp into an ISO referencePeriod", () => {
    expect(parsed.referencePeriod).toBe("2026-06-15");
  });

  it("yields one normalized row per (matéria, UF), skipping stamp + header", () => {
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows.map((r) => r.codigoMateria)).toEqual([164804, 164804, 160575]);
    expect(parsed.rows.map((r) => r.uf)).toEqual(["AC", "SP", "RJ"]);
  });

  it("parses BR thousand-separated vote counts", () => {
    const sp = parsed.rows.find((r) => r.uf === "SP")!;
    expect(sp.votosSim).toBe(1542);
    expect(sp.votosNao).toBe(1000);
  });

  it("collapses the embedded newline in the ementa to a single space", () => {
    expect(parsed.rows[0].ementa).toBe("Ementa com ponto-e-vírgula; e quebra de linha embutida");
  });

  it("unescapes quotes in the ementa", () => {
    const rj = parsed.rows.find((r) => r.uf === "RJ")!;
    expect(rj.ementa).toBe('Proibição do uso de "aspas" em rótulos');
  });

  it("throws when the header column is missing", () => {
    expect(() => parseVotosCsv('"só uma linha sem cabeçalho"\n')).toThrow(/cabeçalho/);
  });
});

describe("aggregateByMateria", () => {
  const aggs = aggregateByMateria(parseVotosCsv(csvText).rows);

  it("produces one record per distinct matéria", () => {
    expect(aggs).toHaveLength(2);
  });

  it("sums VOTO SIM/NÃO across the matéria's UF rows", () => {
    const m = aggs.find((a) => a.id === 164804)!;
    expect(m.votosSim).toBe(239 + 1542);
    expect(m.votosNao).toBe(734 + 1000);
  });

  it("keeps the per-UF breakdown with sorted keys (stable JSON)", () => {
    const m = aggs.find((a) => a.id === 164804)!;
    expect(Object.keys(m.votosPorUf)).toEqual(["AC", "SP"]); // sorted
    expect(m.votosPorUf.AC).toEqual({ sim: 239, nao: 734 });
    expect(m.votosPorUf.SP).toEqual({ sim: 1542, nao: 1000 });
  });
});

describe("buildConsultaVotoResumo + consultaVotoCore", () => {
  const aggs = aggregateByMateria(parseVotosCsv(csvText).rows);
  const agg = aggs.find((a) => a.id === 164804)!;

  it("keeps the canonical field order (referencePeriod last)", () => {
    expect(Object.keys(buildConsultaVotoResumo({ id: 1, votosSim: 0, votosNao: 0 }))).toEqual([
      "id", "materia", "ementa", "autoria", "status",
      "votosSim", "votosNao", "totalVotos", "votosPorUf", "url", "referencePeriod",
    ]);
  });

  it("derives totalVotos as sim + nao", () => {
    const v = buildConsultaVotoResumo({ id: agg.id, votosSim: agg.votosSim, votosNao: agg.votosNao });
    expect(v.totalVotos).toBe(agg.votosSim + agg.votosNao);
  });

  it("a vintage-only change does NOT move the contentHash (history-on-change stays clean)", () => {
    const base = { id: agg.id, materia: agg.materia, ementa: agg.ementa, autoria: agg.autoria, status: agg.status, votosSim: agg.votosSim, votosNao: agg.votosNao, votosPorUf: agg.votosPorUf };
    const wk1 = buildConsultaVotoResumo({ ...base, referencePeriod: "2026-06-15" });
    const wk2 = buildConsultaVotoResumo({ ...base, referencePeriod: "2026-06-22" });
    expect(wk1.referencePeriod).not.toBe(wk2.referencePeriod); // payloads differ…
    // …but the hashed core is identical, so no junk history row on a frozen-vote week.
    expect(JSON.stringify(consultaVotoCore(wk1))).toBe(JSON.stringify(consultaVotoCore(wk2)));
    expect(contentHash(JSON.stringify(consultaVotoCore(wk1)))).toBe(contentHash(JSON.stringify(consultaVotoCore(wk2))));
  });

  it("consultaVotoCore drops only referencePeriod", () => {
    const v = buildConsultaVotoResumo({ id: 7, votosSim: 1, votosNao: 2, referencePeriod: "2026-06-15" });
    expect("referencePeriod" in consultaVotoCore(v)).toBe(false);
    expect(consultaVotoCore(v)).toMatchObject({ id: 7, votosSim: 1, votosNao: 2, totalVotos: 3 });
  });
});
