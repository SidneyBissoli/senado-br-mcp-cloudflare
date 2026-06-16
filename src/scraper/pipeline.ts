/**
 * e-Cidadania Cron sync pipeline (P2 step 3).
 *
 * Scrapes the three REST "highlight" lists (top ~5 per entity — NOT the full corpus; the full
 * corpus would need the paginated /pesquisa* HTML pages, deferred to P2.6) and persists them:
 *   - upsert into ecidadania_current  (latest snapshot per item, refreshes scraped_at)
 *   - append into ecidadania_history  (only when the item's content_hash changed)
 *   - one row in ecidadania_scrape_runs per entity (run bookkeeping / alarm)
 *
 * Hard guard (P2 refinement #4): an anomalous or errored run NEVER overwrites ecidadania_current
 * — the last good state is preserved; only a scrape_runs row is written so the failure is visible.
 */

import type { Env } from "../types.js";
import { classifyRun, parseAnomalyMinPct, type RunStatus } from "./anomaly.js";
import {
  buildConsultaResumo,
  listarConsultasInternal,
  listarIdeiasInternal,
  listarEventosInternal,
  type ConsultaResumo,
} from "./ecidadania.js";

export type Entidade = "consultas" | "ideias" | "eventos";

/** Normalized row ready for persistence (entity-agnostic). */
export interface SyncRecord {
  entityId: number;
  sourceUrl: string;
  payloadJson: string;
  status: string | null;
  metrica: number | null; // metrica_principal: votos | apoios | comentarios
  comissao: string | null;
  contentHash: string;
}

export interface RunSummary {
  entidade: Entidade;
  // 'ok' | 'anomalo' | 'erro' for syncEntity (ideias/eventos); 'ok-metrica' | 'erro-metrica' for the
  // 2h consultas highlight refresh. The '-metrica' markers are intentionally NOT 'ok', so neither the
  // classifyRun baseline nor the corpus freshness signal (both filter status='ok') picks them up.
  status: RunStatus | "ok-metrica" | "erro-metrica";
  rowsScraped: number;
  rowsChanged: number;
  error?: string;
}

/** FNV-1a 32-bit + length suffix — fast, synchronous, good enough for change detection. */
export function contentHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0") + ":" + s.length.toString(16);
}

function toRecord(item: Record<string, unknown>, metrica: number | null, comissao: string | null): SyncRecord {
  const payloadJson = JSON.stringify(item);
  return {
    entityId: Number(item.id),
    sourceUrl: String(item.url ?? ""),
    payloadJson,
    status: (item.status as string) ?? null,
    metrica,
    comissao,
    contentHash: contentHash(payloadJson),
  };
}

/** Scrape one entity's highlight list and normalize to SyncRecords. */
async function scrapeEntity(entidade: Entidade): Promise<SyncRecord[]> {
  if (entidade === "consultas") {
    const items = await listarConsultasInternal({ limite: 100 });
    return items.map((c) => toRecord(c as unknown as Record<string, unknown>, c.totalVotos, null));
  }
  if (entidade === "ideias") {
    const items = await listarIdeiasInternal({ limite: 100 });
    return items.map((i) => toRecord(i as unknown as Record<string, unknown>, i.apoios, null));
  }
  const items = await listarEventosInternal({ limite: 100 });
  return items.map((e) => toRecord(e as unknown as Record<string, unknown>, e.comentarios, e.comissao));
}

/**
 * Annotate records with whether each changed vs the existing content_hash. Pure — testable
 * without D1. `existing` maps entity_id -> last stored content_hash.
 */
export function planEntitySync(
  records: SyncRecord[],
  existing: Map<number, string>,
): { annotated: Array<{ rec: SyncRecord; changed: boolean }>; rowsChanged: number } {
  const annotated = records.map((rec) => ({ rec, changed: existing.get(rec.entityId) !== rec.contentHash }));
  return { annotated, rowsChanged: annotated.filter((a) => a.changed).length };
}

const SQL = {
  existing: "SELECT entity_id, content_hash FROM ecidadania_current WHERE entidade = ?",
  currentRow:
    "SELECT content_hash, payload_json, status FROM ecidadania_current WHERE entidade = ? AND entity_id = ?",
  lastGood:
    "SELECT rows_scraped FROM ecidadania_scrape_runs WHERE entidade = ? AND status = 'ok' ORDER BY id DESC LIMIT 1",
  upsert:
    "INSERT INTO ecidadania_current (entidade, entity_id, scraped_at, content_hash, source_url, payload_json, status, metrica_principal, comissao) " +
    "VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(entidade, entity_id) DO UPDATE SET " +
    "scraped_at=excluded.scraped_at, content_hash=excluded.content_hash, source_url=excluded.source_url, " +
    "payload_json=excluded.payload_json, status=excluded.status, metrica_principal=excluded.metrica_principal, comissao=excluded.comissao",
  history:
    "INSERT OR IGNORE INTO ecidadania_history (entidade, entity_id, scraped_at, content_hash, payload_json) VALUES (?,?,?,?,?)",
  run: "INSERT INTO ecidadania_scrape_runs (run_at, entidade, status, rows_scraped, rows_changed, error) VALUES (?,?,?,?,?,?)",
} as const;

/** Sync one entity: classify the run, and only on "ok" touch current/history. Exported for tests. */
export async function syncEntity(
  db: D1Database,
  entidade: Entidade,
  records: SyncRecord[],
  now: string,
  minPct: number,
  error: unknown,
): Promise<RunSummary> {
  const lastGoodRow = await db.prepare(SQL.lastGood).bind(entidade).first<{ rows_scraped: number }>();
  const lastGoodRows = lastGoodRow ? lastGoodRow.rows_scraped : null;
  const status = classifyRun({ rowsScraped: records.length, lastGoodRows, error }, minPct);
  const errMsg = error ? (error instanceof Error ? error.message : String(error)) : null;

  // Anomalous or errored: never overwrite current — only record the run.
  if (status !== "ok") {
    await db.prepare(SQL.run).bind(now, entidade, status, records.length, 0, errMsg).run();
    return { entidade, status, rowsScraped: records.length, rowsChanged: 0, error: errMsg ?? undefined };
  }

  const existingRes = await db.prepare(SQL.existing).bind(entidade).all<{ entity_id: number; content_hash: string }>();
  const existing = new Map<number, string>((existingRes.results ?? []).map((r) => [r.entity_id, r.content_hash]));
  const { annotated, rowsChanged } = planEntitySync(records, existing);

  const stmts = [];
  for (const { rec, changed } of annotated) {
    stmts.push(
      db.prepare(SQL.upsert).bind(
        entidade, rec.entityId, now, rec.contentHash, rec.sourceUrl, rec.payloadJson, rec.status, rec.metrica, rec.comissao,
      ),
    );
    if (changed) {
      stmts.push(db.prepare(SQL.history).bind(entidade, rec.entityId, now, rec.contentHash, rec.payloadJson));
    }
  }
  stmts.push(db.prepare(SQL.run).bind(now, entidade, "ok", records.length, rowsChanged, null));
  await db.batch(stmts);

  return { entidade, status, rowsScraped: records.length, rowsChanged };
}

/**
 * 2h consultas refresh — TARGETED METRIC UPDATE of the ~5 REST "highlight" ids (P2.6, option b).
 *
 * The full consultas corpus is owned by the weekly off-Worker ingestion job; this 2h tick keeps the
 * vote counts of the hot/open highlights fresh WITHOUT going through syncEntity/classifyRun. That is
 * deliberate (it reconciles two writers into ecidadania_current, §6.5):
 *   - It bypasses classifyRun: a 5-row run can't be compared against the ~thousands-row corpus
 *     baseline, and must never write a 'consultas' status='ok' run (it would re-break the corpus
 *     baseline and inflate the freshness signal). It records its run as 'ok-metrica' instead.
 *   - It is a SPLICE: for an existing row it overwrites only the vote fields and preserves the
 *     corpus-authoritative materia/ementa/status/url, so the content_hash only changes when the
 *     votes actually move (history-on-change preserved; no source ping-pong between the two writers).
 *   - A brand-new highlight not yet in the corpus is inserted fresh (status "aberta" — an active
 *     highlight by construction); the next weekly corpus run reconciles its other fields.
 */
export async function refreshConsultasHighlights(db: D1Database, now: string): Promise<RunSummary> {
  let highlights: ConsultaResumo[];
  try {
    highlights = await listarConsultasInternal({ limite: 100 });
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await db.prepare(SQL.run).bind(now, "consultas", "erro-metrica", 0, 0, errMsg).run();
    return { entidade: "consultas", status: "erro-metrica", rowsScraped: 0, rowsChanged: 0, error: errMsg };
  }

  const stmts = [];
  let rowsChanged = 0;
  for (const hl of highlights) {
    const existing = await db
      .prepare(SQL.currentRow)
      .bind("consultas", hl.id)
      .first<{ content_hash: string; payload_json: string; status: string | null }>();

    // Existing corpus row → splice in fresh votes, keep corpus materia/ementa/status/url.
    // No existing row → insert the REST highlight as-is (active by definition).
    const item = existing
      ? buildConsultaResumo({
          id: hl.id,
          materia: (JSON.parse(existing.payload_json) as ConsultaResumo).materia,
          ementa: (JSON.parse(existing.payload_json) as ConsultaResumo).ementa,
          votosSim: hl.votosSim,
          votosNao: hl.votosNao,
          totalVotos: hl.totalVotos,
          status: (JSON.parse(existing.payload_json) as ConsultaResumo).status,
          url: (JSON.parse(existing.payload_json) as ConsultaResumo).url,
        })
      : hl;

    const payloadJson = JSON.stringify(item);
    const hash = contentHash(payloadJson);
    if (existing && existing.content_hash === hash) continue; // votes unchanged — skip

    rowsChanged++;
    stmts.push(
      db.prepare(SQL.upsert).bind(
        "consultas", hl.id, now, hash, item.url, payloadJson, item.status, item.totalVotos, null,
      ),
    );
    stmts.push(db.prepare(SQL.history).bind("consultas", hl.id, now, hash, payloadJson));
  }
  stmts.push(db.prepare(SQL.run).bind(now, "consultas", "ok-metrica", highlights.length, rowsChanged, null));
  await db.batch(stmts);

  return { entidade: "consultas", status: "ok-metrica", rowsScraped: highlights.length, rowsChanged };
}

/**
 * Top-level Cron entry (every 2h): refresh ideias/eventos via the full syncEntity path (their REST
 * endpoint IS their full source), and consultas via the targeted highlight metric splice above.
 * The weekly full consultas corpus is loaded separately by the off-Worker ingestion job.
 */
export async function refreshEcidadania(env: Env, now = new Date().toISOString()): Promise<RunSummary[]> {
  const db = env.ECIDADANIA_DB;
  if (!db) return [];
  const minPct = parseAnomalyMinPct(env.ECIDADANIA_ANOMALY_MIN_PCT);
  const summaries: RunSummary[] = [];

  // consultas: targeted highlight refresh (bypasses syncEntity/classifyRun — see above).
  try {
    summaries.push(await refreshConsultasHighlights(db, now));
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    summaries.push({ entidade: "consultas", status: "erro-metrica", rowsScraped: 0, rowsChanged: 0, error: errMsg });
  }

  // ideias/eventos: full syncEntity path with the anomaly guard.
  for (const entidade of ["ideias", "eventos"] as Entidade[]) {
    let records: SyncRecord[] = [];
    let error: unknown;
    try {
      records = await scrapeEntity(entidade);
    } catch (e) {
      error = e;
    }
    summaries.push(await syncEntity(db, entidade, records, now, minPct, error));
  }
  return summaries;
}
