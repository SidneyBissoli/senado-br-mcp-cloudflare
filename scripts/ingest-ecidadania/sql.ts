/**
 * SQL generation for the off-Worker corpus load (§8 step 5).
 *
 * Emits a single .sql file applied with `wrangler d1 execute senado-ecidadania --remote --file=…`.
 * The statements MIRROR `SQL.upsert` / `SQL.history` / the scrape-runs insert in
 * `src/scraper/pipeline.ts` (same columns, same conflict target) so the off-Worker writer and the
 * in-Worker Cron stay byte-compatible. We reuse the `SyncRecord` shape and `contentHash` from the
 * pipeline rather than re-deriving them, keeping the content hash identical across both writers.
 */

import type { SyncRecord } from "../../src/scraper/pipeline.js";

/** Default entity for the original consultas job; new corpora (ideias/eventos/consultas_votos) pass their own. */
const DEFAULT_ENTIDADE = "consultas";

/** Render a JS value as a SQLite literal. Strings are single-quoted with '' escaping. */
export function sqlValue(v: string | number | null): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "NULL";
  return `'${v.replace(/'/g, "''")}'`;
}

function upsertStmt(entidade: string, rec: SyncRecord, now: string): string {
  const cols = [entidade, rec.entityId, now, rec.contentHash, rec.sourceUrl, rec.payloadJson, rec.status, rec.metrica, rec.comissao];
  return (
    "INSERT INTO ecidadania_current (entidade, entity_id, scraped_at, content_hash, source_url, payload_json, status, metrica_principal, comissao) VALUES (" +
    cols.map(sqlValue).join(", ") +
    ") ON CONFLICT(entidade, entity_id) DO UPDATE SET " +
    "scraped_at=excluded.scraped_at, content_hash=excluded.content_hash, source_url=excluded.source_url, " +
    "payload_json=excluded.payload_json, status=excluded.status, metrica_principal=excluded.metrica_principal, comissao=excluded.comissao;"
  );
}

function historyStmt(entidade: string, rec: SyncRecord, now: string): string {
  const cols = [entidade, rec.entityId, now, rec.contentHash, rec.payloadJson];
  return (
    "INSERT OR IGNORE INTO ecidadania_history (entidade, entity_id, scraped_at, content_hash, payload_json) VALUES (" +
    cols.map(sqlValue).join(", ") +
    ");"
  );
}

/** A scrape-runs row (mirrors SQL.run). Used for both write and no-write outcomes. */
export function runRowStmt(now: string, status: string, rowsScraped: number, rowsChanged: number, error: string | null, entidade: string = DEFAULT_ENTIDADE): string {
  const cols = [now, entidade, status, rowsScraped, rowsChanged, error];
  return (
    "INSERT INTO ecidadania_scrape_runs (run_at, entidade, status, rows_scraped, rows_changed, error) VALUES (" +
    cols.map(sqlValue).join(", ") +
    ");"
  );
}

/**
 * Full load script for a healthy ('ok') run: all upserts, append-on-change history for changed rows,
 * and the run row last. No explicit BEGIN/COMMIT — D1 rejects SQL transaction control, and
 * `wrangler d1 execute --file` already runs the whole file atomically server-side (on failure the DB
 * returns to its original state), so this is all-or-nothing without it. The run row is last so it is
 * only recorded if every upsert/history statement applied. Upserts are idempotent (ON CONFLICT DO
 * UPDATE), so a retry after a failed apply is safe.
 *
 * `rowsScraped` is the CRAWLED count (the open-set size that the catastrophic floor compares against),
 * passed explicitly because `annotated` also includes re-statused rows (§2) that were not crawled and
 * must not inflate the run's rows_scraped baseline.
 */
export function generateLoadSql(
  annotated: Array<{ rec: SyncRecord; changed: boolean }>,
  now: string,
  rowsScraped: number,
  rowsChanged: number,
  entidade: string = DEFAULT_ENTIDADE,
): string {
  const lines: string[] = [];
  for (const { rec, changed } of annotated) {
    lines.push(upsertStmt(entidade, rec, now));
    if (changed) lines.push(historyStmt(entidade, rec, now));
  }
  lines.push(runRowStmt(now, "ok", rowsScraped, rowsChanged, null, entidade));
  return lines.join("\n") + "\n";
}

/** No-write script: only the run row, recording why the corpus was NOT overwritten. */
export function generateRunOnlySql(now: string, status: string, rowsScraped: number, error: string | null, entidade: string = DEFAULT_ENTIDADE): string {
  return runRowStmt(now, status, rowsScraped, 0, error, entidade) + "\n";
}

/**
 * Load SQL do backfill de DETALHE (resumível), em lotes. Emite upsert + history-on-change das linhas
 * `changed` e, no FIM do ÚLTIMO arquivo, o upsert do cursor (`tailStmt`) — para o cursor só avançar
 * depois que todos os upserts do chunk aplicaram. NÃO grava run row 'ok' (não é um crawl de corpus;
 * não deve mexer no baseline de freshness). Sempre retorna ≥1 arquivo (o do cursor), mesmo sem mudança.
 */
export function generateDetalheLoadSqlBatches(
  annotated: Array<{ rec: SyncRecord; changed: boolean }>,
  now: string,
  entidade: string,
  tailStmt: string,
  maxStmtsPerFile = 10000,
): string[] {
  const lines: string[] = [];
  for (const { rec, changed } of annotated) {
    lines.push(upsertStmt(entidade, rec, now));
    if (changed) lines.push(historyStmt(entidade, rec, now));
  }
  lines.push(tailStmt);

  const files: string[] = [];
  for (let i = 0; i < lines.length; i += maxStmtsPerFile) {
    files.push(lines.slice(i, i + maxStmtsPerFile).join("\n") + "\n");
  }
  return files;
}

// ── e-Cidadania v2: nível-comentário de audiências (tabela ecidadania_comentarios) ──

/** Uma linha do nível-comentário pronta para persistir. `contentHash` cobre só o núcleo (sem scraped_at). */
export interface ComentarioRecord {
  eventoId: number;
  comentarioId: number;
  uf: string | null;
  texto: string;
  data: string | null;
  hora: string | null;
  momentoVideoUrl: string | null;
  convidadoAssociado: string | null;
  contentHash: string;
}

function comentarioUpsertStmt(rec: ComentarioRecord, now: string): string {
  const cols = [
    rec.eventoId, rec.comentarioId, now, rec.contentHash,
    rec.uf, rec.texto, rec.data, rec.hora, rec.momentoVideoUrl, rec.convidadoAssociado,
  ];
  return (
    "INSERT INTO ecidadania_comentarios (evento_id, comentario_id, scraped_at, content_hash, uf, texto, data, hora, momento_video_url, convidado_associado) VALUES (" +
    cols.map(sqlValue).join(", ") +
    ") ON CONFLICT(evento_id, comentario_id) DO UPDATE SET " +
    "scraped_at=excluded.scraped_at, content_hash=excluded.content_hash, uf=excluded.uf, texto=excluded.texto, " +
    "data=excluded.data, hora=excluded.hora, momento_video_url=excluded.momento_video_url, convidado_associado=excluded.convidado_associado;"
  );
}

/**
 * Upsert do cursor de backfill de detalhe (retomada resumível). Idempotente por `entidade`.
 */
export function cursorUpsertStmt(entidade: string, lastEntityId: number, fullPasses: number, now: string): string {
  const cols = [entidade, lastEntityId, fullPasses, now];
  return (
    "INSERT INTO ecidadania_detalhe_cursor (entidade, last_entity_id, full_passes, updated_at) VALUES (" +
    cols.map(sqlValue).join(", ") +
    ") ON CONFLICT(entidade) DO UPDATE SET last_entity_id=excluded.last_entity_id, full_passes=excluded.full_passes, updated_at=excluded.updated_at;"
  );
}

/**
 * Load SQL do nível-comentário, em lotes de no máximo `maxStmtsPerFile` statements. Só as linhas
 * `changed` (novas/alteradas) entram — o re-crawl por ciclo diffa contra o content_hash já gravado,
 * então em regime permanente só comentários novos geram statements. Upserts são idempotentes; a
 * aplicação em vários arquivos NÃO é atômica entre arquivos (mesma disciplina de `generateLoadSqlBatches`).
 */
export function generateComentariosSqlBatches(
  annotated: Array<{ rec: ComentarioRecord; changed: boolean }>,
  now: string,
  maxStmtsPerFile = 10000,
): string[] {
  const lines: string[] = [];
  for (const { rec, changed } of annotated) {
    if (changed) lines.push(comentarioUpsertStmt(rec, now));
  }
  if (lines.length === 0) return [];
  const files: string[] = [];
  for (let i = 0; i < lines.length; i += maxStmtsPerFile) {
    files.push(lines.slice(i, i + maxStmtsPerFile).join("\n") + "\n");
  }
  return files;
}

/**
 * Same load as `generateLoadSql`, but split into multiple files of at most `maxStmtsPerFile`
 * statements each — for a large corpus (ideias is ~150k items → ~300k statements) a single .sql
 * file exceeds what `wrangler d1 execute --file` will apply in one shot.
 *
 * The 'ok' run row is the VERY LAST statement of the LAST file, so it is only recorded once every
 * data file before it applied. Unlike the single-file load (atomic server-side), a multi-file apply
 * is NOT atomic across files: a mid-sequence failure leaves the corpus partially updated WITHOUT an
 * 'ok' run row — so the freshness signal still reflects the previous good run (tool serves the old
 * corpus flagged) and the next successful run reconciles it. Upserts are idempotent, so re-applying
 * is safe. Files must be applied in lexical order (callers zero-pad the index: out-x-001.sql, …).
 */
export function generateLoadSqlBatches(
  annotated: Array<{ rec: SyncRecord; changed: boolean }>,
  now: string,
  rowsScraped: number,
  rowsChanged: number,
  entidade: string = DEFAULT_ENTIDADE,
  maxStmtsPerFile = 10000,
): string[] {
  const lines: string[] = [];
  for (const { rec, changed } of annotated) {
    lines.push(upsertStmt(entidade, rec, now));
    if (changed) lines.push(historyStmt(entidade, rec, now));
  }
  lines.push(runRowStmt(now, "ok", rowsScraped, rowsChanged, null, entidade));

  const files: string[] = [];
  for (let i = 0; i < lines.length; i += maxStmtsPerFile) {
    files.push(lines.slice(i, i + maxStmtsPerFile).join("\n") + "\n");
  }
  return files;
}
