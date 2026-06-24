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
import { classifyRun, type RunStatus } from "./anomaly.js";
import {
  buildConsultaResumo,
  buildEventoResumo,
  buildIdeiaResumo,
  listarConsultasInternal,
  listarIdeiasInternal,
  listarEventosInternal,
  type ConsultaResumo,
  type EventoResumo,
  type IdeiaResumo,
} from "./ecidadania.js";

export type Entidade = "consultas" | "ideias" | "eventos" | "consultas_votos";

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
 * 2h highlight refresh — TARGETED METRIC SPLICE of the ~5 REST "highlight" ids of a corpus entity
 * (P2.6, option b). Generic over consultas/eventos/ideias: the full corpus is owned by the weekly
 * off-Worker ingestion job; this 2h tick keeps the volatile metric (votos | comentários | apoios)
 * of the hot highlights fresh WITHOUT going through syncEntity/classifyRun. That is deliberate (it
 * reconciles two writers into ecidadania_current, §6.5):
 *   - It bypasses classifyRun and records its run as 'ok-metrica' (never 'ok'): a ~5-row tick must
 *     not re-break the corpus baseline nor inflate the freshness signal (both filter status='ok').
 *   - It is a SPLICE: for an existing corpus row it overwrites only the metric and preserves the
 *     corpus-authoritative fields, so content_hash only changes when the metric actually moves
 *     (history-on-change preserved; no source ping-pong between the two writers).
 *   - A brand-new highlight not yet in the corpus is inserted as-is; the next weekly corpus run
 *     reconciles its other fields.
 */
interface HighlightConfig<T extends { id: number; url: string; status: string }> {
  entidade: Entidade;
  scrape: () => Promise<T[]>;
  /** metrica_principal of the (final) item (votos | comentários | apoios). */
  metrica: (item: T) => number;
  /** comissao column of the (final) item, or null. */
  comissao: (item: T) => string | null;
  /** rebuild via the canonical builder: corpus-authoritative fields + the fresh metric spliced in. */
  splice: (corpus: T, fresh: T) => T;
}

async function refreshHighlights<T extends { id: number; url: string; status: string }>(
  db: D1Database,
  now: string,
  cfg: HighlightConfig<T>,
): Promise<RunSummary> {
  let highlights: T[];
  try {
    highlights = await cfg.scrape();
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e);
    await db.prepare(SQL.run).bind(now, cfg.entidade, "erro-metrica", 0, 0, errMsg).run();
    return { entidade: cfg.entidade, status: "erro-metrica", rowsScraped: 0, rowsChanged: 0, error: errMsg };
  }

  const stmts = [];
  let rowsChanged = 0;
  for (const hl of highlights) {
    const existing = await db
      .prepare(SQL.currentRow)
      .bind(cfg.entidade, hl.id)
      .first<{ content_hash: string; payload_json: string; status: string | null }>();

    const item = existing ? cfg.splice(JSON.parse(existing.payload_json) as T, hl) : hl;
    const payloadJson = JSON.stringify(item);
    const hash = contentHash(payloadJson);
    if (existing && existing.content_hash === hash) continue; // metric unchanged — skip

    rowsChanged++;
    stmts.push(
      db.prepare(SQL.upsert).bind(
        cfg.entidade, hl.id, now, hash, item.url, payloadJson, item.status, cfg.metrica(item), cfg.comissao(item),
      ),
    );
    stmts.push(db.prepare(SQL.history).bind(cfg.entidade, hl.id, now, hash, payloadJson));
  }
  stmts.push(db.prepare(SQL.run).bind(now, cfg.entidade, "ok-metrica", highlights.length, rowsChanged, null));
  await db.batch(stmts);

  return { entidade: cfg.entidade, status: "ok-metrica", rowsScraped: highlights.length, rowsChanged };
}

const consultasHighlightCfg: HighlightConfig<ConsultaResumo> = {
  entidade: "consultas",
  scrape: () => listarConsultasInternal({ limite: 100 }),
  metrica: (c) => c.totalVotos,
  comissao: () => null,
  splice: (corpus, fresh) =>
    buildConsultaResumo({
      id: fresh.id,
      materia: corpus.materia,
      ementa: corpus.ementa,
      votosSim: fresh.votosSim,
      votosNao: fresh.votosNao,
      totalVotos: fresh.totalVotos,
      status: corpus.status,
      url: corpus.url,
    }),
};

const eventosHighlightCfg: HighlightConfig<EventoResumo> = {
  entidade: "eventos",
  scrape: () => listarEventosInternal({ limite: 100 }),
  metrica: (e) => e.comentarios,
  comissao: (e) => e.comissao,
  splice: (corpus, fresh) =>
    buildEventoResumo({
      id: fresh.id,
      titulo: corpus.titulo,
      data: corpus.data,
      hora: corpus.hora,
      comissao: corpus.comissao,
      comentarios: fresh.comentarios,
      status: corpus.status,
      url: corpus.url,
    }),
};

const ideiasHighlightCfg: HighlightConfig<IdeiaResumo> = {
  entidade: "ideias",
  scrape: () => listarIdeiasInternal({ limite: 100 }),
  metrica: (i) => i.apoios,
  comissao: () => null,
  splice: (corpus, fresh) =>
    buildIdeiaResumo({
      id: fresh.id,
      titulo: corpus.titulo,
      apoios: fresh.apoios,
      dataPublicacao: corpus.dataPublicacao,
      status: corpus.status,
      autor: corpus.autor,
      url: corpus.url,
    }),
};

/** Thin wrappers (kept by name for tests/back-compat). */
export function refreshConsultasHighlights(db: D1Database, now: string): Promise<RunSummary> {
  return refreshHighlights(db, now, consultasHighlightCfg);
}
export function refreshEventosHighlights(db: D1Database, now: string): Promise<RunSummary> {
  return refreshHighlights(db, now, eventosHighlightCfg);
}
export function refreshIdeiasHighlights(db: D1Database, now: string): Promise<RunSummary> {
  return refreshHighlights(db, now, ideiasHighlightCfg);
}

/**
 * Top-level Cron entry (every 2h): all three corpus entities get the targeted highlight metric
 * splice of their ~5 hot REST highlights (votos | comentários | apoios). The full corpus of each is
 * owned by the weekly off-Worker ingestion job; this tick never touches the long tail and records
 * its run as 'ok-metrica' so it can't re-break the corpus baseline or inflate the freshness signal.
 */
export async function refreshEcidadania(env: Env, now = new Date().toISOString()): Promise<RunSummary[]> {
  const db = env.ECIDADANIA_DB;
  if (!db) return [];
  const summaries: RunSummary[] = [];

  for (const [entidade, refresh] of [
    ["consultas", refreshConsultasHighlights],
    ["eventos", refreshEventosHighlights],
    ["ideias", refreshIdeiasHighlights],
  ] as Array<[Entidade, (db: D1Database, now: string) => Promise<RunSummary>]>) {
    try {
      summaries.push(await refresh(db, now));
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      summaries.push({ entidade, status: "erro-metrica", rowsScraped: 0, rowsChanged: 0, error: errMsg });
    }
  }
  return summaries;
}
