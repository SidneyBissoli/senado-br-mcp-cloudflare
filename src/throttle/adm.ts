/**
 * Fetch wrapper for the Senado ADMINISTRATIVE open data API
 * (https://adm.senado.gov.br/adm-dadosabertos — Swagger at /v3/api-docs).
 *
 * Differences from the legislative API:
 * - no `.json` suffix on paths
 * - a chave fora da cobertura responde 404, não array vazio
 * - some datasets are very large (CEAPS year ≈ 10 MB), hence the raised guard
 *
 * Reuses upstreamFetch, so the global token bucket, concurrency limit,
 * retries and timeout all apply.
 */

import { upstreamFetch, type UpstreamOptions } from "./upstream.js";
import { SENADO_ADM_BASE_URL_DEFAULT, MAX_RESPONSE_SIZE_LARGE } from "../types.js";

export async function admFetch(
  path: string,
  params: Record<string, string> = {},
  baseUrl?: string,
  options: UpstreamOptions = {},
): Promise<unknown> {
  const base = baseUrl || SENADO_ADM_BASE_URL_DEFAULT;
  return upstreamFetch(`/api/v1${path}`, params, base, {
    noJsonSuffix: true,
    // `absent`, e não o `treat404AsEmpty: true` que estava aqui até 24/09/2026.
    // A flag antiga transformava TODO 404 em `[]`, e com isso 16 pontos de
    // chamada — CEAPS, supridos, remunerações, horas extras, contratos — diziam
    // "count: 0" para ano que a fonte NÃO PUBLICA. Medido: `/supridos/2005` e
    // `/senadores/despesas_ceaps/2007` respondem 404, enquanto a chave válida
    // sem dado responde `200 []`. Logo o 404 aqui nunca significou "vazio".
    // Quem precisa do `[]` pede `on404: "empty"` explicitamente, pelo
    // `options` abaixo, e assume o ônus de desfazer a ambiguidade.
    on404: "absent",
    ...options,
  });
}

/** admFetch with the large-response guard (for CEAPS, empresas, etc.). */
export async function admFetchLarge(
  path: string,
  params: Record<string, string> = {},
  baseUrl?: string,
): Promise<unknown> {
  return admFetch(path, params, baseUrl, { maxSize: MAX_RESPONSE_SIZE_LARGE });
}
