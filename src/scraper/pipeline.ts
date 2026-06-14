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
  listarConsultasInternal,
  listarIdeiasInternal,
  listarEventosInternal,
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
  status: RunStatus;
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

/** Top-level Cron entry: refresh all three e-Cidadania highlight lists into D1. */
export async function refreshEcidadania(env: Env, now = new Date().toISOString()): Promise<RunSummary[]> {
  const db = env.ECIDADANIA_DB;
  if (!db) return [];
  const minPct = parseAnomalyMinPct(env.ECIDADANIA_ANOMALY_MIN_PCT);
  const entidades: Entidade[] = ["consultas", "ideias", "eventos"];
  const summaries: RunSummary[] = [];
  for (const entidade of entidades) {
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
