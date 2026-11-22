/**
 * Lê do D1 as versões das ideias no `ecidadania_history` (o corpus, desde 14/06/2026) para a C3: só
 * id, instante, apoios e status, extraídos no próprio banco (o payload inteiro seria ~100× maior).
 * Em páginas pelo rowid, que só cresce (o history só acrescenta).
 */

import { queryD1 } from "../ingest-ecidadania/d1.js";
import type { VersaoDoCorpus } from "./series.js";

const PAGINA = 50_000;

/** SQL de uma página (só inteiros entram; nada vindo de fora). */
export function sqlDoCorpus(depoisDe: number, pagina = PAGINA): string {
  if (!Number.isInteger(depoisDe) || !Number.isInteger(pagina)) throw new Error("página inválida");
  return (
    "SELECT rowid AS r, entity_id, scraped_at, json_extract(payload_json, '$.apoios') AS apoios, " +
    "json_extract(payload_json, '$.status') AS status FROM ecidadania_history " +
    `WHERE entidade = 'ideias' AND rowid > ${depoisDe} ORDER BY rowid LIMIT ${pagina}`
  );
}

export function lerCorpus(): VersaoDoCorpus[] {
  const out: VersaoDoCorpus[] = [];
  let depoisDe = 0;
  for (;;) {
    const rs = queryD1<{ r: number; entity_id: number; scraped_at: string; apoios: number | null; status: string | null }>(sqlDoCorpus(depoisDe));
    if (rs.length === 0) break;
    for (const x of rs) out.push({ entityId: String(x.entity_id), scrapedAt: x.scraped_at, apoios: x.apoios ?? null, status: x.status ?? null });
    depoisDe = rs[rs.length - 1].r;
    if (rs.length < PAGINA) break;
  }
  return out;
}
