/**
 * Detail-fetch helpers for the off-Worker corpus jobs (v2 enrichment — ROADMAP ETAPA 5.5).
 *
 * The ingestion moved from listing-only to listing + DETAIL (+ AJAX comments for events). These
 * wrappers fetch each detail source with the polite ingest client (`http.getText`: timeout, retry,
 * backoff) and feed the PURE parsers exported by `src/scraper/ecidadania.ts` — the same parsers the
 * live Worker tools use, so there is one tested extraction per source.
 *
 * PRIVACIDADE: the citizen-content parsers (`parseIdeiaDetalheCorpus`, `parseComentariosAudiencia`)
 * discard the name at the source — only the UF is ever returned. This module never re-introduces it.
 */

import { getText } from "./http.js";
import {
  ECIDADANIA_BASE,
  parseEventoDetalhe,
  parseComentariosAudiencia,
  parseIdeiaDetalheCorpus,
  parseConsultaDetalheCorpus,
  type EventoDetalhe,
  type ComentarioAudiencia,
  type IdeiaDetalheCorpus,
  type ConsultaDetalheCorpus,
} from "../../src/scraper/ecidadania.js";
import { contentHash, type SyncRecord } from "../../src/scraper/pipeline.js";
import type { ComentarioRecord } from "./sql.js";

/** Detalhe canônico de um evento (data/hora + campos v2). */
export async function fetchEventoDetalhe(id: number): Promise<EventoDetalhe> {
  const html = await getText(`${ECIDADANIA_BASE}/visualizacaoaudiencia?id=${id}`, { accept: "text/html" });
  return parseEventoDetalhe(html);
}

/** Comentários (nível-comentário) de um evento — fragmento AJAX; UF-only. Vazio = 0 comentários. */
export async function fetchComentariosAudiencia(id: number): Promise<ComentarioAudiencia[]> {
  const html = await getText(`${ECIDADANIA_BASE}/ajaxcolecaocomentarioaudiencia?audienciaId=${id}`, {
    accept: "text/html,*/*",
    xhr: true,
    allowEmpty: true,
  });
  return parseComentariosAudiencia(html);
}

/** Detalhe da ideia para o corpus (UF-only — sem nome do autor cidadão). */
export async function fetchIdeiaDetalheCorpus(id: number): Promise<IdeiaDetalheCorpus> {
  const html = await getText(`${ECIDADANIA_BASE}/visualizacaoideia?id=${id}`, { accept: "text/html" });
  return parseIdeiaDetalheCorpus(html);
}

/** Detalhe da consulta para o corpus (autoria/relator — agentes públicos, nome mantido). */
export async function fetchConsultaDetalheCorpus(id: number): Promise<ConsultaDetalheCorpus> {
  const html = await getText(`${ECIDADANIA_BASE}/visualizacaomateria?id=${id}`, { accept: "text/html" });
  return parseConsultaDetalheCorpus(html);
}

/**
 * Núcleo canônico de um comentário para o content_hash — só os campos de conteúdo (sem scraped_at),
 * ordem fixa. Assim uma re-coleta idêntica não gera reescrita.
 */
export function comentarioCore(eventoId: number, c: ComentarioAudiencia): string {
  return JSON.stringify({
    eventoId,
    comentarioId: c.comentarioId,
    uf: c.uf,
    texto: c.texto,
    data: c.data,
    hora: c.hora,
    momentoVideoUrl: c.momentoVideoUrl,
    convidadoAssociado: c.convidadoAssociado,
  });
}

/** Constrói o `ComentarioRecord` (com content_hash) a partir de um comentário parseado. */
export function toComentarioRecord(eventoId: number, c: ComentarioAudiencia): ComentarioRecord {
  return {
    eventoId,
    comentarioId: c.comentarioId,
    uf: c.uf,
    texto: c.texto,
    data: c.data,
    hora: c.hora,
    momentoVideoUrl: c.momentoVideoUrl,
    convidadoAssociado: c.convidadoAssociado,
    contentHash: contentHash(comentarioCore(eventoId, c)),
  };
}

/** Anota `ComentarioRecord[]` com `changed` vs. os hashes já gravados (`${eventoId}:${comentarioId}`). */
export function planComentariosSync(
  records: ComentarioRecord[],
  existing: Map<string, string>,
): { annotated: Array<{ rec: ComentarioRecord; changed: boolean }>; rowsChanged: number } {
  const annotated = records.map((rec) => ({
    rec,
    changed: existing.get(`${rec.eventoId}:${rec.comentarioId}`) !== rec.contentHash,
  }));
  return { annotated, rowsChanged: annotated.filter((a) => a.changed).length };
}

/** Reconstrói um `SyncRecord` de corpus a partir de um payload já normalizado (para o merge de ideias). */
export function corpusRecordFrom(
  entityId: number,
  payload: Record<string, unknown>,
  status: string | null,
  metrica: number | null,
  comissao: string | null,
): SyncRecord {
  const payloadJson = JSON.stringify(payload);
  return {
    entityId,
    sourceUrl: String(payload.url ?? ""),
    payloadJson,
    status,
    metrica,
    comissao,
    contentHash: contentHash(payloadJson),
  };
}
