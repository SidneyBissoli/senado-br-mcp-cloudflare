/**
 * D1-backed reads for the e-Cidadania tools (P2 step 4).
 *
 * List/analysis tools read the latest snapshot from ecidadania_current (populated by the Cron),
 * degrading gracefully so they NEVER break and NEVER serve stale data silently:
 *   - D1 fresh           -> serve D1            (possivelDesatualizacao: false)
 *   - D1 stale / empty   -> fall back to live   (possivelDesatualizacao: false; fonte: "ao-vivo")
 *   - live also fails    -> serve stale D1 if any, flagged (possivelDesatualizacao: true), else rethrow
 *
 * Detail tools (obter_*) stay live for freshness and write their richer payload through to
 * ecidadania_detalhe fire-and-forget (ctx.waitUntil), deduped by content_hash.
 */

import { contentHash, type Entidade } from "./pipeline.js";

export interface ReadMeta {
  fonte: "d1" | "ao-vivo" | "d1-stale";
  lastScrapedAt: string | null;
  possivelDesatualizacao: boolean;
  motivo?: string;
}

export function isStale(lastScrapedAt: string | null, maxMin: number, now: Date = new Date()): boolean {
  if (!lastScrapedAt) return true;
  const ageMin = (now.getTime() - new Date(lastScrapedAt).getTime()) / 60000;
  return ageMin > maxMin;
}

/** Read all current rows for an entity; items are the parsed normalized payloads. */
export async function readCurrent(
  db: D1Database,
  entidade: Entidade,
): Promise<{ items: any[]; lastScrapedAt: string | null }> {
  const res = await db
    .prepare("SELECT scraped_at, payload_json FROM ecidadania_current WHERE entidade = ?")
    .bind(entidade)
    .all<{ scraped_at: string; payload_json: string }>();
  const rows = res.results ?? [];
  let lastScrapedAt: string | null = null;
  const items = rows.map((r) => {
    if (!lastScrapedAt || r.scraped_at > lastScrapedAt) lastScrapedAt = r.scraped_at;
    return JSON.parse(r.payload_json);
  });
  return { items, lastScrapedAt };
}

/**
 * Resolve a list with the D1-first / live-fallback policy above.
 * `liveScrape` is the existing live path (e.g. listarConsultasInternal).
 */
export async function resolveList(
  db: D1Database | undefined,
  entidade: Entidade,
  staleMaxMin: number,
  liveScrape: () => Promise<any[]>,
  now: Date = new Date(),
): Promise<{ items: any[]; meta: ReadMeta }> {
  let d1Items: any[] = [];
  let lastScrapedAt: string | null = null;

  if (db) {
    try {
      const cur = await readCurrent(db, entidade);
      d1Items = cur.items;
      lastScrapedAt = cur.lastScrapedAt;
      if (d1Items.length > 0 && !isStale(lastScrapedAt, staleMaxMin, now)) {
        return { items: d1Items, meta: { fonte: "d1", lastScrapedAt, possivelDesatualizacao: false } };
      }
    } catch {
      // D1 read failed — treat as empty and fall back to live.
    }
  }

  // D1 stale, empty, or unavailable → fall back to live (fresh).
  try {
    const live = await liveScrape();
    return {
      items: live,
      meta: {
        fonte: "ao-vivo",
        lastScrapedAt,
        possivelDesatualizacao: false,
        motivo: !db ? "d1-indisponivel" : d1Items.length === 0 ? "d1-vazio" : "d1-desatualizado",
      },
    };
  } catch (liveErr) {
    // Live failed too. Better to serve stale D1 (flagged) than nothing; only error if D1 is empty.
    if (d1Items.length > 0) {
      return {
        items: d1Items,
        meta: { fonte: "d1-stale", lastScrapedAt, possivelDesatualizacao: true, motivo: "raspagem-ao-vivo-falhou" },
      };
    }
    throw liveErr;
  }
}

/**
 * Fire-and-forget write-through of an obter_* detail payload into ecidadania_detalhe.
 * Never affects the tool response: scheduled on ctx.waitUntil, deduped by content_hash, errors swallowed.
 */
export function writeDetalheThrough(
  db: D1Database | undefined,
  ctx: { waitUntil(p: Promise<unknown>): void } | undefined,
  entidade: Entidade,
  entityId: number,
  payloadObj: Record<string, unknown>,
): void {
  if (!db || !ctx) return;
  ctx.waitUntil(
    (async () => {
      try {
        const payloadJson = JSON.stringify(payloadObj);
        const hash = contentHash(payloadJson);
        const existing = await db
          .prepare("SELECT content_hash FROM ecidadania_detalhe WHERE entidade = ? AND entity_id = ?")
          .bind(entidade, entityId)
          .first<{ content_hash: string }>();
        if (existing && existing.content_hash === hash) return; // unchanged — skip
        await db
          .prepare(
            "INSERT INTO ecidadania_detalhe (entidade, entity_id, scraped_at, content_hash, source_url, payload_json) " +
              "VALUES (?,?,?,?,?,?) ON CONFLICT(entidade, entity_id) DO UPDATE SET " +
              "scraped_at=excluded.scraped_at, content_hash=excluded.content_hash, source_url=excluded.source_url, payload_json=excluded.payload_json",
          )
          .bind(entidade, entityId, new Date().toISOString(), hash, String(payloadObj.url ?? ""), payloadJson)
          .run();
      } catch {
        // Write-through is best-effort observability of detail; never surface failures.
      }
    })(),
  );
}
