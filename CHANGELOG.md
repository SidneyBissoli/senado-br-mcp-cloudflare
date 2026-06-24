# Changelog

All notable changes to this project are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows
[Semantic Versioning](https://semver.org/).

## [3.3.1]

### Changed
- `agents` moved from `dependencies` to `devDependencies` — it is only used by the Worker entrypoint (`src/index.ts`), which the npm/stdio build excludes, so `npx senado-br-mcp` no longer downloads it (~1.1 MB + transitive deps). The hosted Worker still bundles it at build time; no behavior change.

## [3.3.0]

### Added
- Error envelope is now richer and symmetric with successful results: every tool error carries an actionable `hint` (derived from `retryable`) alongside `error`/`retryable`, and the same payload is returned as `structuredContent` so clients can parse errors deterministically. Additive — existing `{ error, retryable }` consumers are unaffected.

### Fixed
- e-Cidadania (which uses its own fetch, not the shared upstream throttle) now marks transient failures (HTTP 5xx/429, timeouts, network errors) as `retryable: true`; only 4xx stay non-retryable.

## [3.2.0]

### Added
- **npm/stdio channel** — the same server now runs locally via `npx senado-br-mcp` (stdio transport), published to npm and advertised in the official MCP Registry alongside the hosted remote. Reaches the official government APIs directly.
- **Provenance** — the level-1 provenance envelope (source, source_url, dataset_id, reference_period, retrieved_at, attribution) now covers all tools, not just the initial pilot set.
- Public `GET /status` endpoint (version + last-deploy id/timestamp) and per-tool usage telemetry in Cloudflare Analytics Engine (PII-free).

## [3.1.0]

### Added
- **Prompts** capability — 4 reusable pt-BR workflow templates: CEAPS expenses, bill tracking, senator votes, and an e-Cidadania overview.
- **Resources** capability — 5 static context docs: usage guide, tool catalog, glossary, and the tipos-matéria / UFs reference tables.
- `LICENSE` file (MIT).

## [3.0.0]

### Changed (BREAKING)
- Consolidated 90 → 65 tools by merging near-duplicate tools into enum parameters (e.g. reference tables → `senado_tabelas_referencia`; per-process sub-resources → `senado_processo_detalhe`; `senado_mesa` with a `casa` param; `senado_search_votacoes` absorbing the recent-votes/list tools). Several tool names were removed or renamed.

## [2.3.0]

### Added
- Every tool now declares MCP annotations (`readOnlyHint`, `openWorldHint`) and a structured-output schema.

### Changed
- Canonical endpoint moved to the custom domain `https://senado.sidneybissoli.com/mcp` (the `*.workers.dev` URL still works as a fallback).

## [2.2.0]

### Added
- Administrative domain (groups O, P, Q, R — 16 tools) consuming `adm.senado.gov.br`. Large datasets (CEAPS ≈ 10 MB/year, payroll ≈ 5.5 MB/month) are fetched once, cached, and filtered/aggregated inside the Worker — tools never return raw dumps.

## [2.1.0]

### Changed
- Migrated all tools that consumed upstream-deprecated endpoints (the legacy `/materia/*` family and `/senador/{codigo}/votacoes`) to the v3 `/processo` and `/votacao` APIs, keeping tool names and output keys stable.
