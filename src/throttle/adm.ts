/**
 * Fetch wrapper for the Senado ADMINISTRATIVE open data API
 * (https://adm.senado.gov.br/adm-dadosabertos — Swagger at /v3/api-docs).
 *
 * Differences from the legislative API:
 * - no `.json` suffix on paths
 * - some collections 404 instead of returning an empty array
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
    treat404AsEmpty: true,
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
