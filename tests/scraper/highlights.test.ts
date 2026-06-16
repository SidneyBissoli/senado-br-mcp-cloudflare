/**
 * Unit tests for the 2h consultas highlight refresh (option b — targeted metric splice).
 *
 * Verifies the three correctness conditions agreed for the two-writer reconciliation:
 *   1. it writes a 'ok-metrica' run row (NOT 'ok'), so it can't corrupt the corpus classifyRun
 *      baseline or the corpus freshness signal;
 *   2. it re-hashes via the shared builder and only appends history when votes actually change;
 *   3. it preserves the corpus-authoritative materia/ementa/status, splicing in only the votes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { refreshConsultasHighlights } from "../../src/scraper/pipeline.js";
import { buildConsultaResumo } from "../../src/scraper/ecidadania.js";
import { contentHash } from "../../src/scraper/pipeline.js";

const NOW = "2026-06-16T00:00:00Z";
const mockFetch = vi.fn();

/** REST highlight payload (one item, id 100, 10.000 SIM / 5.000 NÃO). */
function highlightResponse() {
  return new Response(
    JSON.stringify([
      { id: 100, identificacaoBasica: "PLP 183/2019", ementa: "Reforma", votosFavor: "10.000", votosContra: "5.000", totalVotos: "15.000" },
    ]),
    { status: 200 },
  );
}

/** Fake D1 keyed by entity_id for the currentRow lookup; records all upsert/history/run statements. */
function fakeD1(existing: Map<number, { content_hash: string; payload_json: string; status: string }>) {
  const executed: Array<{ sql: string; args: unknown[] }> = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        sql,
        args,
        async first() {
          return existing.get(Number(args[1])) ?? null;
        },
        async run() {
          executed.push({ sql, args });
          return {};
        },
      }),
    }),
    async batch(stmts: Array<{ sql: string; args: unknown[] }>) {
      stmts.forEach((s) => executed.push({ sql: s.sql, args: s.args }));
      return [];
    },
  } as unknown as D1Database;
  return { db, executed };
}

type Stmt = { sql: string; args: unknown[] };
const upserts = (e: Stmt[]) => e.filter((x) => x.sql.includes("INSERT INTO ecidadania_current"));
const history = (e: Stmt[]) => e.filter((x) => x.sql.includes("ecidadania_history"));
const runRow = (e: Stmt[]) => e.find((x) => x.sql.includes("ecidadania_scrape_runs"));

describe("refreshConsultasHighlights", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetch);
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("inserts a brand-new highlight and records an ok-metrica run", async () => {
    mockFetch.mockResolvedValueOnce(highlightResponse());
    const { db, executed } = fakeD1(new Map());
    const summary = await refreshConsultasHighlights(db, NOW);

    expect(summary.status).toBe("ok-metrica");
    expect(summary.rowsScraped).toBe(1);
    expect(summary.rowsChanged).toBe(1);
    expect(upserts(executed)).toHaveLength(1);
    expect(history(executed)).toHaveLength(1);
    expect(runRow(executed)?.args).toContain("ok-metrica");
  });

  it("skips an unchanged highlight (no upsert/history) but still writes the run row", async () => {
    mockFetch.mockResolvedValueOnce(highlightResponse());
    const same = buildConsultaResumo({ id: 100, materia: "PLP 183/2019", ementa: "Reforma", votosSim: 10000, votosNao: 5000, totalVotos: 15000, status: "aberta" });
    const payload_json = JSON.stringify(same);
    const { db, executed } = fakeD1(new Map([[100, { content_hash: contentHash(payload_json), payload_json, status: "aberta" }]]));
    const summary = await refreshConsultasHighlights(db, NOW);

    expect(summary.rowsChanged).toBe(0);
    expect(upserts(executed)).toHaveLength(0);
    expect(history(executed)).toHaveLength(0);
    expect(runRow(executed)?.args).toContain("ok-metrica");
  });

  it("splices fresh votes while preserving the corpus materia/ementa/status (e.g. encerrada stays encerrada)", async () => {
    mockFetch.mockResolvedValueOnce(highlightResponse());
    // Corpus row: a CLOSED consultation with stale votes and corpus-authoritative text.
    const corpus = buildConsultaResumo({ id: 100, materia: "PLP 183/2019 (corpus)", ementa: "Ementa do corpus", votosSim: 9000, votosNao: 5000, totalVotos: 14000, status: "encerrada" });
    const payload_json = JSON.stringify(corpus);
    const { db, executed } = fakeD1(new Map([[100, { content_hash: contentHash(payload_json), payload_json, status: "encerrada" }]]));
    await refreshConsultasHighlights(db, NOW);

    const up = upserts(executed)[0];
    expect(up).toBeDefined();
    const spliced = JSON.parse(up.args[5] as string);
    expect(spliced.votosSim).toBe(10000); // fresh vote from REST
    expect(spliced.materia).toBe("PLP 183/2019 (corpus)"); // corpus text preserved
    expect(spliced.status).toBe("encerrada"); // corpus status preserved, NOT REST "aberta"
    expect(up.args[6]).toBe("encerrada"); // status column too
  });

  it("records erro-metrica without touching current when the live fetch fails", async () => {
    mockFetch.mockRejectedValueOnce(new Error("portal down"));
    const { db, executed } = fakeD1(new Map());
    const summary = await refreshConsultasHighlights(db, NOW);

    expect(summary.status).toBe("erro-metrica");
    expect(upserts(executed)).toHaveLength(0);
    expect(history(executed)).toHaveLength(0);
    expect(runRow(executed)?.args).toContain("erro-metrica");
  });
});
