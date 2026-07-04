/**
 * Envelope de proveniência POR REGISTRO E POR CAMPO (Fase 1.2, sessão C1).
 *
 * Diferente da proveniência por-resposta das tools MCP (`src/utils/provenance.ts`, envelope nível-1
 * de uma tool = uma fonte), o DATASET carrega proveniência no nível do valor: cada variável de cada
 * registro vem embrulhada no envelope do ROADMAP:
 *
 *     { value, sourceEndpoint, sourceField, retrievedAt, license, schemaVersion }
 *
 * Contrato estável (exatamente 6 campos, nesta ordem) — é o que a ETAPA 4 valida à mão e o que o
 * revisor de um data paper vai auditar. `sourceEndpoint`/`sourceField`/operacionalização vêm do
 * esquema (`schema.ts`); `retrievedAt`/`license`/`schemaVersion` são preenchidos aqui.
 *
 * SEMÂNTICA de `retrievedAt`: o `scraped_at` da linha do corpus (D1) que produziu o valor — o
 * instante real da extração no upstream, não o momento do build. Campos derivados (`derived:*`)
 * herdam o mesmo `retrievedAt` do registro; para `status` de consultas isso é fiel porque a
 * derivação via `/processo` ocorre no mesmo run do scrape (ver `schema.ts`/dicionário).
 */

import {
  DATASET_LICENSE,
  DATASET_SCHEMA_VERSION,
  ENTITY_SCHEMAS,
  selectValue,
  type DatasetEntity,
  type HarmonizeMeta,
  type VariableDef,
} from "./schema.js";

/** Envelope de proveniência de UM valor. Ordem de chaves fixa (JSON estável / diffável). */
export interface FieldEnvelope {
  value: unknown;
  sourceEndpoint: string;
  sourceField: string;
  /** ISO-8601 do scraped_at da linha do corpus que produziu o valor. */
  retrievedAt: string;
  license: string;
  schemaVersion: string;
}

/** Um registro harmonizado: identidade + um envelope por variável (ordem do esquema). */
export interface HarmonizedRecord {
  entidade: DatasetEntity;
  entityId: number;
  fields: Record<string, FieldEnvelope>;
}

/**
 * Monta um envelope. `value` primeiro, `schemaVersion` por último — a ordem de inserção é a ordem
 * de serialização do JSON, e ela faz parte do contrato (não reordenar).
 */
export function makeEnvelope(input: {
  value: unknown;
  sourceEndpoint: string;
  sourceField: string;
  retrievedAt: string;
}): FieldEnvelope {
  return {
    value: input.value,
    sourceEndpoint: input.sourceEndpoint,
    sourceField: input.sourceField,
    retrievedAt: input.retrievedAt,
    license: DATASET_LICENSE,
    schemaVersion: DATASET_SCHEMA_VERSION,
  };
}

/** Envelopa uma variável a partir de sua definição + o valor selecionado do payload/meta. */
export function envelopeFor(v: VariableDef, value: unknown, retrievedAt: string): FieldEnvelope {
  return makeEnvelope({
    value,
    sourceEndpoint: v.sourceEndpoint,
    sourceField: v.sourceField,
    retrievedAt,
  });
}

/**
 * Assembla o registro harmonizado percorrendo as variáveis do esquema NA ORDEM DECLARADA (chaves de
 * `fields` estáveis). `payload` é o objeto normalizado armazenado no corpus (ex.: ConsultaResumo);
 * `meta.retrievedAt` é o scraped_at da linha.
 */
export function assembleRecord(
  entidade: DatasetEntity,
  entityId: number,
  payload: Record<string, unknown>,
  meta: HarmonizeMeta,
): HarmonizedRecord {
  const schema = ENTITY_SCHEMAS[entidade];
  const fields: Record<string, FieldEnvelope> = {};
  for (const v of schema.variables) {
    const value = selectValue(v, { payload, meta });
    fields[v.name] = envelopeFor(v, value, meta.retrievedAt);
  }
  return { entidade, entityId, fields };
}
