/**
 * Leitura do corpus soberano (D1) para o build do dataset — OFF-Worker, via `wrangler d1 execute
 * --remote --json` (mesmo padrão/credencial de `scripts/ingest-ecidadania/d1.ts`).
 *
 * PAGINAÇÃO COM ORDER BY OBRIGATÓRIO: `ecidadania_current` de ideias tem ~114k linhas, acima do que
 * uma leitura única aguenta no buffer do execSync. Toda página é `ORDER BY entity_id LIMIT ? OFFSET ?`
 * — OFFSET sem ORDER BY explícito NÃO garante ordem estável no SQLite (risco de linha duplicada/perdida
 * na fronteira das páginas, o defeito silencioso que uma amostra de 50 na ETAPA 4 não pegaria). Assim
 * a paginação é consistente e a ordenação final do NDJSON fica verificável fim a fim.
 */

import { execSync } from "node:child_process";
import type { CorpusRow } from "../../src/dataset/harmonize.js";
import type { Entidade } from "../../src/scraper/pipeline.js";

const DB_NAME = "senado-ecidadania";
const PAGE_SIZE = Number(process.env.DATASET_PAGE_SIZE) || 5000;

/** Executa uma query read-only e devolve as linhas `results`. SQL deve ser estático (sem input externo). */
function queryD1<T = Record<string, unknown>>(sql: string, attempts = 2): T[] {
  const cmd = `npx --no-install wrangler d1 execute ${DB_NAME} --remote --json --command "${sql}"`;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const out = execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 128 * 1024 * 1024 });
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

interface CurrentRow {
  entity_id: number;
  scraped_at: string;
  payload_json: string;
}

/**
 * Lê `ecidadania_current` de uma entidade, paginado e ordenado por entity_id. `limit` (amostra p/
 * ETAPA 4) corta o total lido. Sem firstSeenAt — o orquestrador o anexa depois.
 */
export function readCurrent(entidade: Entidade, limit?: number): CorpusRow[] {
  const rows: CorpusRow[] = [];
  let offset = 0;
  for (;;) {
    const remaining = limit != null ? limit - rows.length : PAGE_SIZE;
    if (remaining <= 0) break;
    const take = Math.min(PAGE_SIZE, remaining);
    const page = queryD1<CurrentRow>(
      `SELECT entity_id, scraped_at, payload_json FROM ecidadania_current ` +
        `WHERE entidade='${entidade}' ORDER BY entity_id LIMIT ${take} OFFSET ${offset}`,
    );
    for (const r of page) {
      rows.push({
        entityId: Number(r.entity_id),
        scrapedAt: String(r.scraped_at),
        payload: JSON.parse(String(r.payload_json)) as Record<string, unknown>,
      });
    }
    if (page.length < take) break; // última página
    offset += take;
  }
  return rows;
}

/** Divide um array em lotes de tamanho `size`. */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * first-seen = MIN(scraped_at) por entity_id em `ecidadania_history` (Recon Parte III). Para uma
 * amostra (`ids` informado) busca só esses ids via IN(...) em lotes; sem `ids`, pagina o agregado
 * inteiro por entity_id. Só faz sentido para entidades vivas (consultas/ideias/eventos).
 */
export function readFirstSeen(entidade: Entidade, ids?: number[]): Map<number, string> {
  const map = new Map<number, string>();
  const ingest = (r: { entity_id: number; fs: string }) => map.set(Number(r.entity_id), String(r.fs));

  if (ids) {
    for (const batch of chunk(ids.map((n) => Math.trunc(n)), 500)) {
      if (batch.length === 0) continue;
      queryD1<{ entity_id: number; fs: string }>(
        `SELECT entity_id, MIN(scraped_at) AS fs FROM ecidadania_history ` +
          `WHERE entidade='${entidade}' AND entity_id IN (${batch.join(",")}) GROUP BY entity_id`,
      ).forEach(ingest);
    }
    return map;
  }

  let offset = 0;
  for (;;) {
    const page = queryD1<{ entity_id: number; fs: string }>(
      `SELECT entity_id, MIN(scraped_at) AS fs FROM ecidadania_history ` +
        `WHERE entidade='${entidade}' GROUP BY entity_id ORDER BY entity_id LIMIT ${PAGE_SIZE} OFFSET ${offset}`,
    );
    page.forEach(ingest);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return map;
}

/** Contagem de linhas em `ecidadania_current` de uma entidade (para o manifesto). */
export function countCurrent(entidade: Entidade): number {
  const r = queryD1<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ecidadania_current WHERE entidade='${entidade}'`,
  );
  return r.length ? Number(r[0].n) : 0;
}
