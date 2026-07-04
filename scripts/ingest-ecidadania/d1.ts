/**
 * D1 reads for the corpus job (§8 step 5), via `wrangler d1 execute --remote --json`.
 *
 * The job must read TWO things from D1 before generating the load SQL:
 *   1. existing (entity_id -> content_hash) for 'consultas' — to diff append-on-change history
 *      (reusing planEntitySync), so unchanged rows are not re-appended.
 *   2. rows_scraped of the last status='ok' corpus run — the baseline for the catastrophic floor.
 *
 * We shell out to wrangler (same auth as the apply step: CLOUDFLARE_API_TOKEN) rather than the D1
 * HTTP API, to keep one tool and one credential across read and write.
 */

import { execSync } from "node:child_process";

const DB_NAME = "senado-ecidadania";

/** Run a read-only query and return the `results` rows. SQL must be static (no untrusted input). */
function queryD1<T = Record<string, unknown>>(sql: string, attempts = 2): T[] {
  // --no-install so npx never tries to fetch wrangler; capture stderr so a failure surfaces the real
  // Cloudflare/wrangler message instead of a bare "Command failed". Retry once for transient API errors.
  const cmd = `npx --no-install wrangler d1 execute ${DB_NAME} --remote --json --command "${sql}"`;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const out = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
      // wrangler --json prints an array of query results; tolerate leading non-JSON log lines.
      const start = out.indexOf("[");
      const parsed = JSON.parse(start >= 0 ? out.slice(start) : out) as Array<{ results?: T[] }>;
      const first = Array.isArray(parsed) ? parsed[0] : undefined;
      return first?.results ?? [];
    } catch (e) {
      lastErr = e;
      const stderr = (e as { stderr?: Buffer | string }).stderr;
      if (stderr) (e as Error).message += `\nwrangler stderr: ${stderr.toString().slice(0, 1000)}`;
    }
  }
  throw lastErr;
}

export interface ExistingRow {
  id: number;
  content_hash: string;
  status: string;
}

/**
 * All current consultas rows with id + content_hash + status (NOT payload — that would be ~12 MB).
 * content_hash feeds the history diff (planEntitySync); status feeds the linger re-status (§2).
 */
export function readExistingMeta(entidade: string = "consultas"): ExistingRow[] {
  const rows = queryD1<{ entity_id: number; content_hash: string; status: string | null }>(
    `SELECT entity_id, content_hash, status FROM ecidadania_current WHERE entidade='${entidade}'`,
  );
  return rows.map((r) => ({ id: Number(r.entity_id), content_hash: String(r.content_hash), status: String(r.status ?? "") }));
}

/** payload_json for specific ids (targeted — only the rows being re-statused). */
export function readPayloads(ids: number[], entidade: string = "consultas"): Map<number, string> {
  if (ids.length === 0) return new Map();
  const list = ids.map((n) => String(Math.trunc(n))).join(",");
  const rows = queryD1<{ entity_id: number; payload_json: string }>(
    `SELECT entity_id, payload_json FROM ecidadania_current WHERE entidade='${entidade}' AND entity_id IN (${list})`,
  );
  return new Map(rows.map((r) => [Number(r.entity_id), String(r.payload_json)]));
}

/** rows_scraped of the most recent status='ok' corpus run, or null if there is no baseline yet. */
export function readLastGoodRows(entidade: string = "consultas"): number | null {
  const rows = queryD1<{ rows_scraped: number }>(
    `SELECT rows_scraped FROM ecidadania_scrape_runs WHERE entidade='${entidade}' AND status='ok' ORDER BY id DESC LIMIT 1`,
  );
  return rows.length ? Number(rows[0].rows_scraped) : null;
}

// ── v2: leituras para o enriquecimento por detalhe ──────────────────────────

export interface CurrentPayloadRow {
  id: number;
  payload_json: string;
  content_hash: string;
}

/**
 * Uma faixa de linhas de `ecidadania_current` de uma entidade com entity_id > `afterId`, ordenada por
 * entity_id, com no máximo `limit` linhas — o chunk do backfill de detalhe RESUMÍVEL (ideias ~113,7k
 * não cabe num run). Retorna id + payload_json (para preservar os campos de listagem no merge) +
 * content_hash (para diffar a escrita).
 */
export function readCurrentRange(entidade: string, afterId: number, limit: number): CurrentPayloadRow[] {
  const rows = queryD1<{ entity_id: number; payload_json: string; content_hash: string }>(
    `SELECT entity_id, payload_json, content_hash FROM ecidadania_current ` +
      `WHERE entidade='${entidade}' AND entity_id > ${Math.trunc(afterId)} ORDER BY entity_id LIMIT ${Math.trunc(limit)}`,
  );
  return rows.map((r) => ({ id: Number(r.entity_id), payload_json: String(r.payload_json), content_hash: String(r.content_hash) }));
}

/**
 * Todos os `payload_json` de uma entidade, chaveados por entity_id. Paginado por entity_id. Usado
 * pelos crawls que PRESERVAM campos de detalhe imutáveis (só reenriquecem quem ainda não tem).
 */
export function readAllPayloads(entidade: string, pageSize = 5000): Map<number, string> {
  const map = new Map<number, string>();
  let offset = 0;
  for (;;) {
    const rows = queryD1<{ entity_id: number; payload_json: string }>(
      `SELECT entity_id, payload_json FROM ecidadania_current ` +
        `WHERE entidade='${entidade}' ORDER BY entity_id LIMIT ${pageSize} OFFSET ${offset}`,
    );
    for (const r of rows) map.set(Number(r.entity_id), String(r.payload_json));
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return map;
}

/** Estado do cursor de backfill de detalhe de uma entidade (0/0 quando ainda não existe). */
export function readDetalheCursor(entidade: string): { lastEntityId: number; fullPasses: number } {
  const rows = queryD1<{ last_entity_id: number; full_passes: number }>(
    `SELECT last_entity_id, full_passes FROM ecidadania_detalhe_cursor WHERE entidade='${entidade}'`,
  );
  return rows.length
    ? { lastEntityId: Number(rows[0].last_entity_id), fullPasses: Number(rows[0].full_passes) }
    : { lastEntityId: 0, fullPasses: 0 };
}

/** content_hash de TODOS os comentários já gravados, chaveado por `${eventoId}:${comentarioId}`. Paginado. */
export function readComentarioHashes(pageSize = 20000): Map<string, string> {
  const map = new Map<string, string>();
  let offset = 0;
  for (;;) {
    const rows = queryD1<{ evento_id: number; comentario_id: number; content_hash: string }>(
      `SELECT evento_id, comentario_id, content_hash FROM ecidadania_comentarios ` +
        `ORDER BY evento_id, comentario_id LIMIT ${pageSize} OFFSET ${offset}`,
    );
    for (const r of rows) map.set(`${Number(r.evento_id)}:${Number(r.comentario_id)}`, String(r.content_hash));
    if (rows.length < pageSize) break;
    offset += pageSize;
  }
  return map;
}
