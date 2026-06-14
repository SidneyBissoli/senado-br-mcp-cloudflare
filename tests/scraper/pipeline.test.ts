import { describe, it, expect } from "vitest";
import {
  contentHash,
  planEntitySync,
  syncEntity,
  type SyncRecord,
} from "../../src/scraper/pipeline.js";

function rec(entityId: number, payload: string): SyncRecord {
  return {
    entityId,
    sourceUrl: `https://example/${entityId}`,
    payloadJson: payload,
    status: "aberta",
    metrica: 100,
    comissao: null,
    contentHash: contentHash(payload),
  };
}

/** Minimal D1 fake that records executed SQL (via run() and batch()). */
function fakeD1(opts: { existing?: Array<{ entity_id: number; content_hash: string }>; lastGood?: number | null } = {}) {
  const executed: Array<{ sql: string; args: unknown[] }> = [];
  const makeStmt = (sql: string, args: unknown[]) => ({
    sql,
    args,
    async first() {
      return opts.lastGood != null ? { rows_scraped: opts.lastGood } : null;
    },
    async all() {
      return { results: opts.existing ?? [] };
    },
    async run() {
      executed.push({ sql, args });
      return {};
    },
  });
  const db = {
    prepare: (sql: string) => ({ bind: (...args: unknown[]) => makeStmt(sql, args) }),
    async batch(stmts: Array<{ sql: string; args: unknown[] }>) {
      stmts.forEach((s) => executed.push({ sql: s.sql, args: s.args }));
      return [];
    },
  };
  return { db: db as unknown as D1Database, executed };
}

const touchesCurrent = (executed: Array<{ sql: string }>) =>
  executed.some((e) => e.sql.includes("ecidadania_current") || e.sql.includes("ecidadania_history"));

describe("contentHash", () => {
  it("is stable for the same input and differs for different input", () => {
    expect(contentHash("abc")).toBe(contentHash("abc"));
    expect(contentHash("abc")).not.toBe(contentHash("abd"));
  });
});

describe("planEntitySync", () => {
  it("marks all records changed when nothing exists", () => {
    const records = [rec(1, "a"), rec(2, "b")];
    const { rowsChanged, annotated } = planEntitySync(records, new Map());
    expect(rowsChanged).toBe(2);
    expect(annotated.every((a) => a.changed)).toBe(true);
  });

  it("marks unchanged records when the stored hash matches", () => {
    const r1 = rec(1, "a");
    const r2 = rec(2, "b");
    const existing = new Map([[1, r1.contentHash]]); // r1 unchanged, r2 new
    const { rowsChanged, annotated } = planEntitySync([r1, r2], existing);
    expect(rowsChanged).toBe(1);
    expect(annotated.find((a) => a.rec.entityId === 1)!.changed).toBe(false);
    expect(annotated.find((a) => a.rec.entityId === 2)!.changed).toBe(true);
  });
});

describe("syncEntity — happy path", () => {
  it("upserts all + appends history for changed + writes an ok run", async () => {
    const { db, executed } = fakeD1({ existing: [], lastGood: null });
    const records = [rec(1, "a"), rec(2, "b"), rec(3, "c")];
    const summary = await syncEntity(db, "consultas", records, "2026-06-14T00:00:00Z", 50, undefined);

    expect(summary.status).toBe("ok");
    expect(summary.rowsScraped).toBe(3);
    expect(summary.rowsChanged).toBe(3);
    expect(executed.filter((e) => e.sql.includes("INSERT INTO ecidadania_current"))).toHaveLength(3);
    expect(executed.filter((e) => e.sql.includes("ecidadania_history"))).toHaveLength(3);
    const run = executed.find((e) => e.sql.includes("ecidadania_scrape_runs"));
    expect(run?.args).toContain("ok");
  });

  it("does not append history for unchanged items but still upserts (refresh scraped_at)", async () => {
    const r1 = rec(1, "a");
    const { db, executed } = fakeD1({ existing: [{ entity_id: 1, content_hash: r1.contentHash }], lastGood: 1 });
    const summary = await syncEntity(db, "consultas", [r1], "2026-06-14T00:00:00Z", 50, undefined);

    expect(summary.rowsChanged).toBe(0);
    expect(executed.filter((e) => e.sql.includes("INSERT INTO ecidadania_current"))).toHaveLength(1);
    expect(executed.filter((e) => e.sql.includes("ecidadania_history"))).toHaveLength(0);
  });
});

describe("syncEntity — anomaly guard NEVER overwrites current", () => {
  it("zero rows -> anomalo, only a run row, current untouched", async () => {
    const { db, executed } = fakeD1({ lastGood: 5 });
    const summary = await syncEntity(db, "consultas", [], "2026-06-14T00:00:00Z", 50, undefined);
    expect(summary.status).toBe("anomalo");
    expect(touchesCurrent(executed)).toBe(false);
    expect(executed.filter((e) => e.sql.includes("ecidadania_scrape_runs"))).toHaveLength(1);
  });

  it("below threshold (3 of 10 < 50%) -> anomalo, current untouched", async () => {
    const { db, executed } = fakeD1({ lastGood: 10 });
    const records = [rec(1, "a"), rec(2, "b"), rec(3, "c")];
    const summary = await syncEntity(db, "ideias", records, "2026-06-14T00:00:00Z", 50, undefined);
    expect(summary.status).toBe("anomalo");
    expect(touchesCurrent(executed)).toBe(false);
  });

  it("scrape error -> erro, current untouched, error recorded", async () => {
    const { db, executed } = fakeD1({ lastGood: 5 });
    const summary = await syncEntity(db, "eventos", [], "2026-06-14T00:00:00Z", 50, new Error("portal down"));
    expect(summary.status).toBe("erro");
    expect(summary.error).toBe("portal down");
    expect(touchesCurrent(executed)).toBe(false);
  });
});
