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

import { buildConsultaResumo, type ConsultaResumo, type ConsultaDetalheCorpus } from "../../src/scraper/ecidadania.js";
import { contentHash, type SyncRecord } from "../../src/scraper/pipeline.js";
import { mesclarCampo } from "../../src/scraper/mesclar.js";
import { deriveStatus } from "./status.js";
import { consultaPrecisaDetalhe } from "./detalhe.js";

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
 * Pure: stored rows NOT in this crawl that still lack `autoria`. The listing is in-tramitação-only,
 * so a consulta that closed before its detail was read (backlog above the per-run cap, failed reads,
 * a future reader fix) is never crawled again: until 18/10/2026 the enrichment walked only the
 * crawl, and 390 encerradas stayed without autoria for good. Ascending id = deterministic order.
 */
export function selectNaoListadasSemDetalhe(payloads: Map<number, string>, crawledIds: Set<number>): number[] {
  const ids: number[] = [];
  for (const [id, prev] of payloads) {
    if (!crawledIds.has(id) && consultaPrecisaDetalhe(prev)) ids.push(id);
  }
  return ids.sort((a, b) => a - b);
}

/**
 * Pure: build the `SyncRecord`s of stored rows NOT in this crawl — the status flips and the rows whose
 * detail was (re)read this run (`detalhes`); a row in both yields ONE record. Votes/ementa/materia/url
 * are preserved from the existing payload; `status` comes from the flip (else the stored one); the
 * detail fields merge field by field (`mesclarCampo`: an empty reading never wipes a stored value), so
 * the content hash changes exactly when status or detail changed. Rows whose payload is missing are
 * skipped defensively.
 */
export function buildRestatusRecords(
  flips: StatusFlip[],
  payloads: Map<number, string>,
  detalhes: Map<number, ConsultaDetalheCorpus> = new Map(),
): SyncRecord[] {
  const novoStatus = new Map(flips.map((f) => [f.id, f.newStatus]));
  const ids = [...new Set([...novoStatus.keys(), ...detalhes.keys()])];
  const records: SyncRecord[] = [];
  for (const id of ids) {
    const payloadJson = payloads.get(id);
    if (!payloadJson) continue;
    const old = JSON.parse(payloadJson) as ConsultaResumo;
    const d = detalhes.get(id);
    const item = buildConsultaResumo({
      id,
      materia: old.materia,
      ementa: old.ementa,
      votosSim: old.votosSim,
      votosNao: old.votosNao,
      totalVotos: old.totalVotos,
      autoria: mesclarCampo(d?.autoria ?? null, old.autoria ?? null),
      relator: mesclarCampo(d?.relator ?? null, old.relator ?? null),
      status: novoStatus.get(id) ?? old.status,
      url: old.url,
    });
    const json = JSON.stringify(item);
    if (!novoStatus.has(id) && json === payloadJson) continue; // detail read, nothing new
    records.push({
      entityId: id,
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
