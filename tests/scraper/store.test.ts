import { describe, it, expect, vi } from "vitest";
import { isStale, resolveList, writeDetalheThrough } from "../../src/scraper/store.js";
import { contentHash } from "../../src/scraper/pipeline.js";

const NOW = new Date("2026-06-14T12:00:00Z");
const FRESH = "2026-06-14T11:30:00Z"; // 30 min old
const STALE = "2026-06-14T00:00:00Z"; // 720 min old (> 360)

function fakeReadD1(currentRows: Array<{ scraped_at: string; payload_json: string }>) {
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        async all() {
          return sql.includes("ecidadania_current") ? { results: currentRows } : { results: [] };
        },
        async first() {
          return null;
        },
      }),
    }),
  } as unknown as D1Database;
}

const row = (scraped_at: string, obj: unknown) => ({ scraped_at, payload_json: JSON.stringify(obj) });

describe("isStale", () => {
  it("null is always stale", () => expect(isStale(null, 360, NOW)).toBe(true));
  it("recent is fresh", () => expect(isStale(FRESH, 360, NOW)).toBe(false));
  it("old is stale", () => expect(isStale(STALE, 360, NOW)).toBe(true));
});

describe("resolveList", () => {
  it("serves D1 when fresh and does not call live", async () => {
    const live = vi.fn();
    const db = fakeReadD1([row(FRESH, { id: 1 }), row(FRESH, { id: 2 })]);
    const { items, meta } = await resolveList(db, "consultas", 360, live, NOW);
    expect(items).toHaveLength(2);
    expect(meta.fonte).toBe("d1");
    expect(meta.possivelDesatualizacao).toBe(false);
    expect(meta.lastScrapedAt).toBe(FRESH);
    expect(live).not.toHaveBeenCalled();
  });

  it("falls back to live when D1 is stale (serves fresh, flag false)", async () => {
    const live = vi.fn().mockResolvedValue([{ id: 9 }]);
    const db = fakeReadD1([row(STALE, { id: 1 })]);
    const { items, meta } = await resolveList(db, "ideias", 360, live, NOW);
    expect(items).toEqual([{ id: 9 }]);
    expect(meta.fonte).toBe("ao-vivo");
    expect(meta.motivo).toBe("d1-desatualizado");
    expect(live).toHaveBeenCalled();
  });

  it("falls back to live when D1 is empty", async () => {
    const live = vi.fn().mockResolvedValue([{ id: 9 }]);
    const { items, meta } = await resolveList(fakeReadD1([]), "eventos", 360, live, NOW);
    expect(items).toEqual([{ id: 9 }]);
    expect(meta.motivo).toBe("d1-vazio");
  });

  it("falls back to live when D1 is unavailable", async () => {
    const live = vi.fn().mockResolvedValue([{ id: 9 }]);
    const { meta } = await resolveList(undefined, "consultas", 360, live, NOW);
    expect(meta.fonte).toBe("ao-vivo");
    expect(meta.motivo).toBe("d1-indisponivel");
  });

  it("serves stale D1 (flagged) when live also fails, instead of erroring", async () => {
    const live = vi.fn().mockRejectedValue(new Error("portal down"));
    const db = fakeReadD1([row(STALE, { id: 1 })]);
    const { items, meta } = await resolveList(db, "consultas", 360, live, NOW);
    expect(items).toEqual([{ id: 1 }]);
    expect(meta.fonte).toBe("d1-stale");
    expect(meta.possivelDesatualizacao).toBe(true);
  });

  it("rethrows when D1 empty and live fails (nothing to serve)", async () => {
    const live = vi.fn().mockRejectedValue(new Error("portal down"));
    await expect(resolveList(fakeReadD1([]), "consultas", 360, live, NOW)).rejects.toThrow("portal down");
  });
});

/** Fake D1 that also answers the scrape_runs run_at query (lastGoodRunAt). */
function fakeRunsD1(currentRows: Array<{ scraped_at: string; payload_json: string }>, goodRunAt: string | null) {
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        async all() {
          return sql.includes("ecidadania_current") ? { results: currentRows } : { results: [] };
        },
        async first() {
          return sql.includes("ecidadania_scrape_runs") && goodRunAt ? { run_at: goodRunAt } : null;
        },
      }),
    }),
  } as unknown as D1Database;
}

describe("resolveList — consultas corpus (fallbackOnStale:false + lastGoodRunAt freshness)", () => {
  it("serves flagged corpus on staleness WITHOUT calling live (no collapse to highlights)", async () => {
    const live = vi.fn();
    const db = fakeRunsD1([row(STALE, { id: 1 }), row(STALE, { id: 2 })], STALE);
    const { items, meta } = await resolveList(db, "consultas", 360, live, NOW, { fallbackOnStale: false });
    expect(items).toHaveLength(2);
    expect(meta.fonte).toBe("d1-stale");
    expect(meta.possivelDesatualizacao).toBe(true);
    expect(meta.motivo).toBe("corpus-desatualizado");
    expect(live).not.toHaveBeenCalled();
  });

  it("freshness comes from the corpus run_at, not the (fresh) hot-row scraped_at", async () => {
    // Hot rows refreshed 30min ago by the 2h ok-metrica tick, but the weekly corpus run is stale.
    const live = vi.fn();
    const db = fakeRunsD1([row(FRESH, { id: 1 })], STALE);
    const { meta } = await resolveList(db, "consultas", 360, live, NOW, { fallbackOnStale: false });
    expect(meta.fonte).toBe("d1-stale"); // stale despite the fresh row, because run_at is old
    expect(meta.lastScrapedAt).toBe(STALE);
    expect(live).not.toHaveBeenCalled();
  });

  it("serves fresh D1 when the corpus run_at is recent (run_at preferred over row scraped_at)", async () => {
    const live = vi.fn();
    const db = fakeRunsD1([row(STALE, { id: 1 })], FRESH); // old rows, but a recent corpus run
    const { meta } = await resolveList(db, "consultas", 360, live, NOW, { fallbackOnStale: false });
    expect(meta.fonte).toBe("d1");
    expect(meta.possivelDesatualizacao).toBe(false);
    expect(meta.lastScrapedAt).toBe(FRESH);
    expect(live).not.toHaveBeenCalled();
  });

  it("cold start (no corpus 'ok' run yet): serves current FLAGGED, never reports fresh, never crashes", async () => {
    // Rows present with a fresh scraped_at (e.g. a metric-splice insert) but NO status='ok' corpus run.
    const live = vi.fn();
    const db = fakeRunsD1([row(FRESH, { id: 1 })], null);
    const { items, meta } = await resolveList(db, "consultas", 360, live, NOW, { fallbackOnStale: false });
    expect(items).toHaveLength(1); // serves the current rows
    expect(meta.fonte).toBe("d1-stale");
    expect(meta.possivelDesatualizacao).toBe(true); // flagged, NOT fresh
    expect(live).not.toHaveBeenCalled();
  });
});

function fakeWriteD1(existingHash: string | null) {
  const inserts: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        async first() {
          return existingHash != null ? { content_hash: existingHash } : null;
        },
        async run() {
          inserts.push({ sql, args });
          return {};
        },
      }),
    }),
  } as unknown as D1Database;
  return { db, inserts };
}

function fakeCtx() {
  const promises: Promise<unknown>[] = [];
  return { ctx: { waitUntil: (p: Promise<unknown>) => promises.push(p) }, flush: () => Promise.all(promises) };
}

describe("writeDetalheThrough", () => {
  it("no-ops without db or ctx", () => {
    const { ctx } = fakeCtx();
    expect(() => writeDetalheThrough(undefined, ctx, "consultas", 1, {})).not.toThrow();
    const { db } = fakeWriteD1(null);
    expect(() => writeDetalheThrough(db, undefined, "consultas", 1, {})).not.toThrow();
  });

  it("inserts when detail is new", async () => {
    const { db, inserts } = fakeWriteD1(null);
    const { ctx, flush } = fakeCtx();
    writeDetalheThrough(db, ctx, "consultas", 1, { url: "u", x: 1 });
    await flush();
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toContain("INSERT INTO ecidadania_detalhe");
  });

  it("dedups when content_hash is unchanged", async () => {
    const payload = { url: "u", x: 1 };
    const { db, inserts } = fakeWriteD1(contentHash(JSON.stringify(payload)));
    const { ctx, flush } = fakeCtx();
    writeDetalheThrough(db, ctx, "consultas", 1, payload);
    await flush();
    expect(inserts).toHaveLength(0);
  });

  it("swallows write errors (never throws)", async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          async first() {
            throw new Error("D1 down");
          },
          async run() {
            return {};
          },
        }),
      }),
    } as unknown as D1Database;
    const { ctx, flush } = fakeCtx();
    writeDetalheThrough(db, ctx, "consultas", 1, {});
    await expect(flush()).resolves.toBeDefined();
  });
});
