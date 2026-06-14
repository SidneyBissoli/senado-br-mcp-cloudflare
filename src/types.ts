export interface Env {
  CACHE_KV: KVNamespace;
  ALLOWED_ORIGIN?: string;
  SENADO_BASE_URL?: string;
  SENADO_ADM_BASE_URL?: string;
  API_KEY?: string;
  // Tool-call telemetry (per-tool selection counts). Optional so local dev and
  // tests run without the binding; recordToolCall() degrades to a no-op when absent.
  SENADO_ANALYTICS?: AnalyticsEngineDataset;
}

export interface CacheCategory {
  l0Ttl: number; // seconds
  l1Ttl: number; // seconds
}

export const CACHE_STATIC: CacheCategory = { l0Ttl: 300, l1Ttl: 600 };
export const CACHE_SEMI_STATIC: CacheCategory = { l0Ttl: 120, l1Ttl: 300 };
export const CACHE_DYNAMIC: CacheCategory = { l0Ttl: 30, l1Ttl: 60 };
export const CACHE_ON_DEMAND: CacheCategory = { l0Ttl: 30, l1Ttl: 120 };

export const SENADO_BASE_URL_DEFAULT = "https://legis.senado.leg.br/dadosabertos";
export const SENADO_ADM_BASE_URL_DEFAULT = "https://adm.senado.gov.br/adm-dadosabertos";

export const MAX_BODY_SIZE = 256 * 1024; // 256 KB
export const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5 MB
export const MAX_RESPONSE_SIZE_LARGE = 20 * 1024 * 1024; // 20 MB — CEAPS/empresas datasets
export const UPSTREAM_TIMEOUT_MS = 10_000; // 10s
