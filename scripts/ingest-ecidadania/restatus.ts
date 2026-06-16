/**
 * Linger fix (§2) — keep the status of ALL stored consultas truthful, not just the crawled ones.
 *
 * The `pesquisamateria` listing is in-tramitação-only, so when a matter's tramitação ends its
 * consultation drops off the listing. Since the load only UPSERTs crawled rows, such a row would
 * otherwise stay `aberta` forever with frozen votes (an "aberta zombie"), and the `encerrada` filter
 * would never become truthful. On every COMPLETE run we therefore re-derive status for every stored
 * row from `/processo` membership (the authoritative rule, §4) and flip the ones that disagree.
 *
 * Key discipline (per the spec): decide by MEMBERSHIP in the tramitando set, NOT by absence from the
 * crawl — a transient listing gap must not flip a still-tramitando consultation to `encerrada`.
 * Crawled rows already get a fresh membership-derived status in the normal load path; this only
 * handles the rows NOT seen in this crawl.
 */

import { buildConsultaResumo, type ConsultaResumo } from "../../src/scraper/ecidadania.js";
import { contentHash, type SyncRecord } from "../../src/scraper/pipeline.js";
import { deriveStatus } from "./status.js";

export interface ExistingMetaRow {
  id: number;
  status: string;
}

export interface StatusFlip {
  id: number;
  newStatus: "aberta" | "encerrada";
}

/**
 * Pure: choose stored rows whose status must change. A row qualifies when it was NOT in this crawl
 * and its membership-derived status (aberta ⟺ in tramitando) differs from what is stored. Rows in
 * the crawl are skipped (the normal load path restates them).
 */
export function selectRestatus(
  existing: ExistingMetaRow[],
  crawledIds: Set<number>,
  tramitando: Set<number>,
): StatusFlip[] {
  const flips: StatusFlip[] = [];
  for (const row of existing) {
    if (crawledIds.has(row.id)) continue;
    const newStatus = deriveStatus(tramitando, row.id);
    if (newStatus !== row.status) flips.push({ id: row.id, newStatus });
  }
  return flips;
}

/**
 * Pure: build the flipped `SyncRecord`s from the chosen flips and their stored payloads. Only the
 * `status` changes; votes/ementa/materia/url are preserved from the existing payload, so the content
 * hash changes exactly because the status changed (history-on-change stays correct). Flips whose
 * payload is missing are skipped defensively.
 */
export function buildRestatusRecords(flips: StatusFlip[], payloads: Map<number, string>): SyncRecord[] {
  const records: SyncRecord[] = [];
  for (const flip of flips) {
    const payloadJson = payloads.get(flip.id);
    if (!payloadJson) continue;
    const old = JSON.parse(payloadJson) as ConsultaResumo;
    const item = buildConsultaResumo({
      id: flip.id,
      materia: old.materia,
      ementa: old.ementa,
      votosSim: old.votosSim,
      votosNao: old.votosNao,
      totalVotos: old.totalVotos,
      status: flip.newStatus,
      url: old.url,
    });
    const json = JSON.stringify(item);
    records.push({
      entityId: flip.id,
      sourceUrl: item.url,
      payloadJson: json,
      status: item.status,
      metrica: item.totalVotos,
      comissao: null,
      contentHash: contentHash(json),
    });
  }
  return records;
}
