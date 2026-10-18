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
  lerDestaquesConsultas,
  lerDestaquesIdeias,
  listarEventosInternal,
  type ConsultaDestaque,
  type ConsultaResumo,
  type EventoResumo,
  type IdeiaDestaque,
  type IdeiaResumo,
} from "./ecidadania.js";
import { mesclarCampo } from "./mesclar.js";

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
 *   - The fresh metric goes through `mesclarCampo` (src/scraper/mesclar.ts): a count the REST item
 *     did not carry is `null`, never 0, and keeps the stored one. Until 17/10/2026 an absent
 *     `apoiamentos` became 0 and overwrote the stored apoios (zero calado).
 */
interface HighlightConfig<T extends { id: number; url: string; status: string }, D extends { id: number } = T> {
  entidade: Entidade;
  /** Raw highlight readings (D), metric nullable where the source can omit it. */
  scrape: () => Promise<D[]>;
  /** metrica_principal of the (final) item (votos | comentários | apoios). */
  metrica: (item: T) => number;
  /** comissao column of the (final) item, or null. */
  comissao: (item: T) => string | null;
  /**
   * The row to write: corpus-authoritative fields + the fresh metric spliced in (corpus present), or
   * the fresh reading as a new row (corpus absent). `null` = nothing to write (a brand-new highlight
   * whose metric was not read: inserting it would record an invented 0).
   */
  splice: (corpus: T | undefined, fresh: D) => T | null;
}

async function refreshHighlights<T extends { id: number; url: string; status: string }, D extends { id: number }>(
  db: D1Database,
  now: string,
  cfg: HighlightConfig<T, D>,
): Promise<RunSummary> {
  let highlights: D[];
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

    const item = cfg.splice(existing ? (JSON.parse(existing.payload_json) as T) : undefined, hl);
    if (!item) continue;
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

export const consultasHighlightCfg: HighlightConfig<ConsultaResumo, ConsultaDestaque> = {
  entidade: "consultas",
  scrape: () => lerDestaquesConsultas(),
  metrica: (c) => c.totalVotos,
  comissao: () => null,
  // Preserves the corpus-authoritative detail fields (autoria/relator, v2) so the 2h metric splice
  // never wipes them; only the volatile vote counts come from the fresh REST highlight — and only
  // the ones it actually carried.
  splice: (corpus, fresh) => {
    if (!corpus) {
      if (fresh.votosSim === null || fresh.votosNao === null) return null;
      return buildConsultaResumo({
        id: fresh.id, materia: fresh.materia, ementa: fresh.ementa,
        votosSim: fresh.votosSim, votosNao: fresh.votosNao, totalVotos: fresh.totalVotos ?? undefined,
        status: "aberta",
      });
    }
    const votosSim = mesclarCampo(fresh.votosSim, corpus.votosSim) ?? 0;
    const votosNao = mesclarCampo(fresh.votosNao, corpus.votosNao) ?? 0;
    return buildConsultaResumo({
      id: fresh.id,
      materia: corpus.materia,
      ementa: corpus.ementa,
      votosSim,
      votosNao,
      // Total do REST quando veio; senão o guardado só se os votos também são os guardados (nada
      // lido); com votos novos e total ausente, o builder deriva votosSim + votosNao.
      totalVotos:
        fresh.totalVotos ??
        (fresh.votosSim === null && fresh.votosNao === null ? corpus.totalVotos : undefined),
      autoria: corpus.autoria,
      relator: corpus.relator,
      status: corpus.status,
      url: corpus.url,
    });
  },
};

export const eventosHighlightCfg: HighlightConfig<EventoResumo> = {
  entidade: "eventos",
  scrape: () => listarEventosInternal({ limite: 100 }),
  metrica: (e) => e.comentarios,
  comissao: (e) => e.comissao,
  // v2 decision (estudo A3): the CANONICAL comment count comes from the AJAX endpoint during the
  // daily corpus crawl — the REST listing count is the degraded one (0-spurious in 82% of events).
  // So this 2h splice PRESERVES `corpus.comentarios` (canonical) instead of overwriting it with the
  // fresh REST count: it stays byte-stable (no ping-pong / history churn against the daily crawl) and
  // also carries all v2 detail fields through untouched. The eventos splice is thus effectively inert
  // between daily crawls — the daily crawl is the sole source of the canonical count.
  splice: (corpus, fresh) =>
    !corpus ? fresh : buildEventoResumo({
      id: corpus.id,
      titulo: corpus.titulo,
      data: corpus.data,
      hora: corpus.hora,
      comissao: corpus.comissao,
      comissaoNomeCompleto: corpus.comissaoNomeCompleto,
      local: corpus.local,
      descricao: corpus.descricao,
      pauta: corpus.pauta,
      convidados: corpus.convidados,
      videoUrl: corpus.videoUrl,
      comentarios: corpus.comentarios,
      status: corpus.status,
      url: corpus.url,
    }),
};

export const ideiasHighlightCfg: HighlightConfig<IdeiaResumo, IdeiaDestaque> = {
  entidade: "ideias",
  scrape: () => lerDestaquesIdeias(),
  metrica: (i) => i.apoios,
  comissao: () => null,
  // Preserves the corpus-authoritative detail fields (dataPublicacao/autorUf/descricao/plConvertido,
  // v2) so the 2h apoios splice never wipes them; apoios only when the REST item carried it.
  splice: (corpus, fresh) => {
    if (!corpus) {
      return fresh.apoios === null ? null : buildIdeiaResumo({ id: fresh.id, titulo: fresh.titulo, apoios: fresh.apoios });
    }
    return buildIdeiaResumo({
      id: fresh.id,
      titulo: mesclarCampo(corpus.titulo, fresh.titulo) ?? undefined,
      apoios: mesclarCampo(fresh.apoios, corpus.apoios) ?? undefined,
      dataPublicacao: corpus.dataPublicacao,
      autorUf: corpus.autorUf,
      descricao: corpus.descricao,
      plConvertido: corpus.plConvertido,
      status: corpus.status,
      url: corpus.url,
    });
  },
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
