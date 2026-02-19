export interface Env {
  CACHE_KV: KVNamespace;
  ALLOWED_ORIGIN?: string;
  SENADO_BASE_URL?: string;
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

export const MAX_BODY_SIZE = 256 * 1024; // 256 KB
export const MAX_RESPONSE_SIZE = 2 * 1024 * 1024; // 2 MB
export const UPSTREAM_TIMEOUT_MS = 10_000; // 10s
