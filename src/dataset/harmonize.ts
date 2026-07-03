/**
 * Harmonizadores puros do dataset de participação do e-Cidadania (Fase 1.2, sessão C1).
 *
 * Transformam uma linha do corpus soberano (D1 `ecidadania_current` + first-seen do `_history`) num
 * `HarmonizedRecord` — identidade + um envelope de proveniência por variável, na ordem do esquema.
 * São puros e sem I/O (o driver off-Worker lê o D1 e chama estes); a convenção do repo é testar os
 * transformadores diretamente com fixtures.
 */

import { assembleRecord, type HarmonizedRecord } from "./provenance.js";
import type { HarmonizeMeta } from "./schema.js";
import type { Entidade } from "../scraper/pipeline.js";

/** Uma linha do corpus pronta para harmonizar (payload já parseado do payload_json). */
export interface CorpusRow {
  entityId: number;
  /** ISO-8601 do scraped_at da linha (vira o retrievedAt de todos os campos do registro). */
  scrapedAt: string;
  payload: Record<string, unknown>;
  /** MIN(scraped_at) do history — só para entidades vivas; ausente/undefined em consultas_votos. */
  firstSeenAt?: string | null;
}

/** Deriva o meta de harmonização de uma linha. `referencePeriod` vem do próprio payload (votos). */
function metaFor(row: CorpusRow): HarmonizeMeta {
  const referencePeriod =
    typeof row.payload.referencePeriod === "string" ? row.payload.referencePeriod : null;
  return {
    retrievedAt: row.scrapedAt,
    firstSeenAt: row.firstSeenAt ?? null,
    referencePeriod,
  };
}

/** Harmoniza uma linha do corpus. */
export function harmonizeRow(entidade: Entidade, row: CorpusRow): HarmonizedRecord {
  return assembleRecord(entidade, row.entityId, row.payload, metaFor(row));
}

/**
 * Harmoniza um lote de linhas de uma entidade, ORDENADO por entityId (ascendente). A ordenação é
 * parte do contrato de saída: dois runs sobre o mesmo corpus produzem NDJSON byte-idêntico, então
 * um diff entre vintages só mostra mudança real (não ruído de ordem).
 */
export function harmonizeEntity(entidade: Entidade, rows: CorpusRow[]): HarmonizedRecord[] {
  return [...rows]
    .sort((a, b) => a.entityId - b.entityId)
    .map((row) => harmonizeRow(entidade, row));
}
