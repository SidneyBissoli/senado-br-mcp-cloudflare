# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MCP server for Brazilian Senate open data (Senado Federal Dados Abertos API + e-Cidadania portal), running on Cloudflare Workers with Streamable HTTP transport. Currently 67 tools across 20 group modules, spanning the legislative API (legis.senado.leg.br/dadosabertos), the administrative API (adm.senado.gov.br/adm-dadosabertos — CEAPS, payroll, contracts; spec at /v3/api-docs there), e-Cidadania, and the institutional portal (www12.senado.leg.br/institucional/estrutura — organizational structure, crawled off-Worker into a bundled snapshot). Tool names, descriptions, and error messages are user-facing in Portuguese (pt-BR) — keep them that way. Besides tools, the server exposes the MCP **prompts** capability (4 pt-BR workflow templates in `src/prompts.ts`) and **resources** capability (5 static context docs/tables in `src/resources.ts`), both wired in `src/server.ts` via `registerPrompts`/`registerResources`. Keep their text builders exported for unit tests.

The upstream OpenAPI spec lives at `https://legis.senado.leg.br/dadosabertos/v3/api-docs` (save it to the gitignored `.api-spec/` for analysis). 42 endpoints there are marked deprecated — mostly the `/materia/*` family. Do NOT add tools on deprecated endpoints; this repo already migrated off them (tools kept their names but call `/processo` and `/votacao`, bridging legacy IDs via the `codigoMateria` query param). Before writing a parser for a new endpoint, smoke-test the live response shape — wrapper names and casing (legacy PascalCase vs v3 camelCase) often differ from the spec.

## Commands

```bash
npm run dev          # wrangler dev — local server on port 8787
npm run typecheck    # tsc --noEmit AND tsc -p scripts/tsconfig.json (two passes: src + ingest scripts)
npm test             # vitest run (all tests)
npm run test:watch   # vitest watch mode
npx vitest run tests/tools/votacoes.test.ts   # single test file
npm run build        # tsc -p tsconfig.build.json — compiles the npm/stdio package (dist/)
npm run smoke:openai-app   # scripts/smoke-openai-app.mjs — exercises the ChatGPT-App MCP surface
npm run deploy       # wrangler deploy
```

The `ingest:ecidadania*` scripts (run via `tsx`) are the off-Worker corpus crawlers invoked by GitHub Actions, not part of local dev. `ingest:estrutura` (`scripts/ingest-estrutura/index.ts`) is a similar off-Worker crawler that reconstructs the full organizational tree (down to serviço level) from the institutional portal and freezes it into the bundled snapshot `src/data/estrutura-organizacional.ts` — run it by hand when the org structure changes (rare). The dados-abertos API only publishes units down to Secretaria and never links leaf units to a parent, so the portal crawl is the only public source that maps a servant's deep lotação up to a directorate like DGER; `senado_estrutura_organizacional` and `senado_servidores`'s `subordinadasA` filter both read that snapshot via `src/estrutura/resolver.ts` (pure matching in layers: exact by sigla/normalized name, then approximate — sigla→extenso and token-prefix — because the servant registry truncates/abbreviates lotação names; ties are returned as ambiguous, never guessed). There is no lint script. Config lives in `wrangler.toml` (KV binding `CACHE_KV`, vars `SENADO_BASE_URL`, `SENADO_ADM_BASE_URL`, `ALLOWED_ORIGIN`, `OPENAI_APPS_CHALLENGE_TOKEN` for the OpenAI Apps domain-verification endpoint). Optional `API_KEY` (Bearer auth) is set as a Wrangler secret; when absent, the server is open access.

## Architecture

**Request flow** (`src/index.ts`): Worker `fetch` → a chain of **public, pre-auth** short-circuits served before any Bearer check: `/health`, the OpenAI Apps domain-verification challenge (`/.well-known/openai-apps-challenge`, `src/openai-domain-verification.ts`), the legal HTML pages (`/privacy`, `/terms`, `src/legal.ts`), `/icon.jpg`, `/metrics`, `/status` (`src/status.ts` — version + deploy metadata), and `/.well-known/glama.json` (registry ownership) → Bearer auth check (`src/auth.ts`, constant-time compare, skipped for OPTIONS) → the request path selects a **tool profile** and MCP route (`src/app-surface.ts`) → a **new `McpServer` instance is created per request** (`src/server.ts` — SDK 1.26.0+ requirement) → `createMcpHandler` from `agents/mcp` serves the MCP endpoint (POST/GET/DELETE). Stateless — no Durable Objects.

**Two delivery channels, one server.** Besides the hosted Worker, the same code ships as an npm package (`senado-br-mcp`) with a stdio entrypoint (`src/cli.ts`, run via `npx senado-br-mcp`). It calls the identical `createServer` over `StdioServerTransport` — no `agents/mcp`, no `ctx`. Cloudflare-specific paths degrade on their own: the L1 Cache API becomes a no-op (L0 in-memory Map still works), D1/Analytics/version bindings are absent, and the e-Cidadania corpus tools fall back to live scraping (flagged via `meta.fonte`/`possivelDesatualizacao`). Keep `createServer` and everything it touches Node-safe — don't import Workers-only APIs at module top level, or you break the CLI. `cli.ts` is never imported by `src/index.ts`.

**MCP routes & tool profiles** (`src/app-surface.ts`): two surfaces coexist behind the same Worker. `/mcp` is the **`full`** profile (all 66 tools). `/mcp/openai-app-v2` (and legacy `/mcp/openai-app`) is the **`openai-app`** profile for ChatGPT Apps — a curated `OPENAI_APP_TOOL_ALLOWLIST` (~24 tools), reduced server instructions, an `_meta`/`openai/outputTemplate` pointing tools at the widget, and `minimizeToolResultForProfile` stripping `meta` from results. `toolProfileForRoute` maps the path to the profile; `createServer(env, ctx, { toolProfile })` builds the right surface (the `server.tool` override in `src/server.ts` skips tools not enabled for the profile). The widget itself is a self-contained HTML resource (`ui://senado-br-mcp/...`) registered only on the openai-app profile by `registerOpenAiAppWidget` (`src/openai-app-widget.ts`); it renders `structuredContent` (metrics/items/provenance) in the ChatGPT iframe. When changing tool output shape, keep it renderable by that widget's generic field logic.

**Tool registration**: each file in `src/tools/` exports a `registerXTools(server, baseUrl)` function that calls `server.tool(name, description, zodShape, callback)`. New tool groups must also be wired into `src/server.ts`. The `server.tool` shim there (re-pointed in `createServer`) routes every call through `server.registerTool` with shared read-only annotations + a permissive passthrough `outputSchema`, wraps the callback in `instrumentTool` (per-tool Analytics Engine counts) and the profile minimizer, and applies the profile allowlist. To expose a tool on the ChatGPT App surface, add its name to `OPENAI_APP_TOOL_ALLOWLIST`.

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

**e-Cidadania corpus model** (D1, `ecidadania_current/_history/_scrape_runs`, discriminated by `entidade`): list tools read the persisted corpus (`src/scraper/store.ts → resolveList`), never scrape per call. Four entities: `consultas`, `eventos`, `ideias` (full corpora, each owned by a **weekly off-Worker GitHub Action** in `scripts/ingest-ecidadania/index-*.ts` that crawls the paginated HTML listing and emits batched `out-*.sql`), and `consultas_votos` (a separate **historical** acervo of votes-by-UF parsed from the ~33 MB Arquimedes CSV — `index-consultas-votos.ts` + `csv.ts`). The in-Worker **2h Cron** (`src/scraper/pipeline.ts → refreshEcidadania`) only does a targeted **metric splice** of the ~5 REST highlights per live entity (votos/comentários/apoios) — recorded as `'ok-metrica'`, never touching the long tail. Two writers into `ecidadania_current` (weekly job + 2h splice) stay byte-compatible by always building payloads through the canonical `buildXResumo` in `src/scraper/ecidadania.ts` — diverging field order would make every row read as "changed" and bloat `_history`. `consultas_votos` has a single writer but excludes its CSV vintage stamp from the hash (`consultaVotoCore`) for the same reason.

## Testing convention

Tests (`tests/`, mirroring `src/`) are pure unit tests with no network or mocking of fetch: tool modules **export their parsing/formatting helpers** (e.g. `parseVotacaoItem`, `toISODate`) precisely so tests can target them directly. When adding tool logic, extract parsers/date helpers as exported functions and test those.

## Keeping docs in sync

`README.md` carries the full tool inventory, the upstream-path-to-tool mapping, and the cache table. When adding or renaming tools or changing upstream paths, update it (it lags the code at times — verify counts against `server.tool(` occurrences rather than trusting the README).
