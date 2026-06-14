# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MCP server for Brazilian Senate open data (Senado Federal Dados Abertos API + e-Cidadania portal), running on Cloudflare Workers with Streamable HTTP transport. Currently 65 tools across 19 group modules, spanning the legislative API (legis.senado.leg.br/dadosabertos), the administrative API (adm.senado.gov.br/adm-dadosabertos — CEAPS, payroll, contracts; spec at /v3/api-docs there) and e-Cidadania. Tool names, descriptions, and error messages are user-facing in Portuguese (pt-BR) — keep them that way. Besides tools, the server exposes the MCP **prompts** capability (4 pt-BR workflow templates in `src/prompts.ts`) and **resources** capability (5 static context docs/tables in `src/resources.ts`), both wired in `src/server.ts` via `registerPrompts`/`registerResources`. Keep their text builders exported for unit tests.

The upstream OpenAPI spec lives at `https://legis.senado.leg.br/dadosabertos/v3/api-docs` (save it to the gitignored `.api-spec/` for analysis). 42 endpoints there are marked deprecated — mostly the `/materia/*` family. Do NOT add tools on deprecated endpoints; this repo already migrated off them (tools kept their names but call `/processo` and `/votacao`, bridging legacy IDs via the `codigoMateria` query param). Before writing a parser for a new endpoint, smoke-test the live response shape — wrapper names and casing (legacy PascalCase vs v3 camelCase) often differ from the spec.

## Commands

```bash
npm run dev          # wrangler dev — local server on port 8787
npm run typecheck    # tsc --noEmit
npm test             # vitest run (all tests)
npm run test:watch   # vitest watch mode
npx vitest run tests/tools/votacoes.test.ts   # single test file
npm run deploy       # wrangler deploy
```

There is no lint script. Config lives in `wrangler.toml` (KV binding `CACHE_KV`, vars `SENADO_BASE_URL`, `ALLOWED_ORIGIN`). Optional `API_KEY` (Bearer auth) is set as a Wrangler secret; when absent, the server is open access.

## Architecture

**Request flow** (`src/index.ts`): Worker `fetch` → `/health` and `/metrics` short-circuit (public) → Bearer auth check (`src/auth.ts`, constant-time compare, skipped for OPTIONS) → a **new `McpServer` instance is created per request** (`src/server.ts` — SDK 1.26.0+ requirement) → `createMcpHandler` from `agents/mcp` serves the single `/mcp` endpoint (POST/GET/DELETE). Stateless — no Durable Objects.

**Tool registration**: each file in `src/tools/` exports a `registerXTools(server, baseUrl)` function that calls `server.tool(name, description, zodShape, callback)`. New tool groups must also be wired into `src/server.ts`.

**Standard tool callback pattern** (follow it for new tools):

```ts
const response = await cachedFetch(
  "tool_name", paramsForCacheKey, CACHE_CATEGORY,
  () => upstreamFetch("/path", queryParams, baseUrl),
);
return toolResult(shapedData);
// in catch: return errorFrom(e, "Mensagem de fallback");
```

- `cachedFetch` (`src/cache/manager.ts`): L0 in-memory Map (per isolate) → L1 Cloudflare Cache API (synthetic GET URLs keyed by SHA-256 of tool+params, since POST isn't cacheable) → upstream. Cache failures degrade gracefully to the fetcher. TTL categories (`CACHE_STATIC`, `CACHE_SEMI_STATIC`, `CACHE_DYNAMIC`, `CACHE_ON_DEMAND`) are in `src/types.ts`. Caching happens at the tool level, never at the transport level.
- `upstreamFetch` (`src/throttle/upstream.ts`): **always appends `.json` to the path**, sorts query params, enforces global token bucket + max 6 concurrent + 10s total time budget, retries 429/503 and network errors with backoff+jitter, 5 MB response guard. Throws `UpstreamError` with a `retryable` flag that `errorFrom` propagates into the tool error payload.
- Helpers in `src/utils/validation.ts`: `toolResult`, `toolError`, `errorFrom`, `buildParams` (drops empty values), `dig` (safe deep access), `ensureArray` (upstream sometimes returns object-or-array), `safeInt`.

**Two upstream API styles** coexist:
- Legacy endpoints (e.g. `/senador/...`, `/comissao/...`, `/plenario/...`, `/taquigrafia/...`): PascalCase nested responses with wrapper objects (strip via `stripWrapper`/`firstArrayDeep` from `plenario.ts`), dates as `YYYYMMDD`.
- Administrative endpoints (`adm.senado.gov.br`, via `admFetch` in `src/throttle/adm.ts`): flat snake_case JSON, no `.json` suffix, 404 means empty collection. Large datasets (CEAPS ~10 MB/year, payroll ~5.5 MB/month) use `admFetchLarge` (20 MB guard) and are cached by coarse key (e.g. year only) then filtered/aggregated per call in the Worker — never returned raw.
- v3 endpoints (`/votacao`, `/processo` and sub-resources): flat camelCase JSON, dates must be ISO `YYYY-MM-DD` (tools accept `YYYYMMDD` and convert via `toISODate`/`ensureISODate`). They accept `codigoMateria` as a bridge from legacy matéria codes.

**Catalog size discipline**: reference-table lookups are consolidated into enum-param tools (`senado_tabelas_processo`, `senado_tabelas_plenario`, `senado_senador_historico`) instead of one tool per table — every extra tool costs context in every MCP client session. Large responses (transcripts, document lists, search results) get `limite`/pagination params with a default cap and an `aviso` field when truncated.

**e-Cidadania tools** (`src/tools/ecidadania.ts`) do not use `upstreamFetch` — they hit `www12.senado.leg.br/ecidadania` directly with their own fetch helpers: internal REST endpoints for lists, HTML scraping via regex for detail pages (no cheerio — Workers compatible).

## Testing convention

Tests (`tests/`, mirroring `src/`) are pure unit tests with no network or mocking of fetch: tool modules **export their parsing/formatting helpers** (e.g. `parseVotacaoItem`, `toISODate`) precisely so tests can target them directly. When adding tool logic, extract parsers/date helpers as exported functions and test those.

## Keeping docs in sync

`README.md` carries the full tool inventory, the upstream-path-to-tool mapping, and the cache table. When adding or renaming tools or changing upstream paths, update it (it lags the code at times — verify counts against `server.tool(` occurrences rather than trusting the README).
