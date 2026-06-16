/**
 * Unit tests for the corpus-load SQL generation and status derivation (§8 step 3/5).
 * Pure functions — no network, no wrangler.
 */

import { describe, it, expect } from "vitest";
import { sqlValue, generateLoadSql, generateRunOnlySql } from "../../scripts/ingest-ecidadania/sql.js";
import { deriveStatus } from "../../scripts/ingest-ecidadania/status.js";
import { contentHash, type SyncRecord } from "../../src/scraper/pipeline.js";

const NOW = "2026-06-16T00:00:00Z";

function rec(entityId: number, payload: string, status = "aberta"): SyncRecord {
  return {
    entityId,
    sourceUrl: `https://www12.senado.leg.br/ecidadania/visualizacaomateria?id=${entityId}`,
    payloadJson: payload,
    status,
    metrica: 1234,
    comissao: null,
    contentHash: contentHash(payload),
  };
}

describe("sqlValue", () => {
  it("renders null, numbers, and single-quote-escaped strings", () => {
    expect(sqlValue(null)).toBe("NULL");
    expect(sqlValue(42)).toBe("42");
    expect(sqlValue("plain")).toBe("'plain'");
    expect(sqlValue("O'Brien & cia")).toBe("'O''Brien & cia'");
  });

  it("renders non-finite numbers as NULL", () => {
    expect(sqlValue(NaN)).toBe("NULL");
  });
});

describe("generateLoadSql", () => {
  const annotated = [
    { rec: rec(1, '{"id":1,"ementa":"a"}'), changed: true },
    { rec: rec(2, '{"id":2,"ementa":"b"}'), changed: false },
  ];
  const sql = generateLoadSql(annotated, NOW, 2, 1);

  it("emits no explicit transaction control (D1 rejects BEGIN/COMMIT; --file is atomic)", () => {
    expect(sql).not.toContain("BEGIN TRANSACTION");
    expect(sql).not.toContain("COMMIT");
  });

  it("writes the run row last (only recorded if all upserts applied)", () => {
    expect(sql.trimEnd().endsWith(");")).toBe(true);
    const lastStmt = sql.trimEnd().split("\n").pop() ?? "";
    expect(lastStmt).toContain("INSERT INTO ecidadania_scrape_runs");
  });

  it("records rows_scraped as the crawled count, not the upsert count (re-status rows excluded)", () => {
    // 3 upserts written, but only 2 were crawled → run row must report 2, not 3.
    const annotated3 = [...annotated, { rec: rec(3, '{"id":3,"ementa":"c"}'), changed: true }];
    const s = generateLoadSql(annotated3, NOW, 2, 1);
    expect(s.match(/INSERT INTO ecidadania_current/g)).toHaveLength(3);
    const runLine = s.trimEnd().split("\n").pop() ?? "";
    expect(runLine).toContain("'ok', 2,"); // rows_scraped=2
  });

  it("emits an upsert per record and history only for changed rows", () => {
    expect(sql.match(/INSERT INTO ecidadania_current/g)).toHaveLength(2);
    expect(sql.match(/INSERT OR IGNORE INTO ecidadania_history/g)).toHaveLength(1);
  });

  it("mirrors the SQL.upsert conflict clause and writes one ok run row", () => {
    expect(sql).toContain("ON CONFLICT(entidade, entity_id) DO UPDATE SET");
    const runMatches = sql.match(/INSERT INTO ecidadania_scrape_runs/g) ?? [];
    expect(runMatches).toHaveLength(1);
    expect(sql).toContain("'ok'");
  });
});

describe("generateRunOnlySql", () => {
  it("emits only a run row (no current/history writes) on a rejected run", () => {
    const sql = generateRunOnlySql(NOW, "erro", 0, "crawl incompleto");
    expect(sql).toContain("INSERT INTO ecidadania_scrape_runs");
    expect(sql).toContain("'erro'");
    expect(sql).toContain("'crawl incompleto'");
    expect(sql).not.toContain("ecidadania_current");
    expect(sql).not.toContain("ecidadania_history");
  });
});

describe("deriveStatus", () => {
  it("aberta iff the codigoMateria is in the tramitando set", () => {
    const set = new Set<number>([137929]);
    expect(deriveStatus(set, 137929)).toBe("aberta");
    expect(deriveStatus(set, 160575)).toBe("encerrada");
  });
});
