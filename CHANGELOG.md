# Changelog

All notable changes to this project are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- **Purge internal vocabulary from statistics responses.** Live testing showed the model transcribing raw field names, parameter names, enum values and technical `aviso` messages into user-facing prose (`valorTotalTransacoes`, `regimeEspecial = true`, "caiu no default", `tipo=supridos`) — jargon meaningful only to someone who knows the MCP internals. Across all five statistics tools: (1) `aviso` messages rewritten in plain language, with no raw field/param names (e.g. "A medida solicitada não está disponível para esta relação; a estatística usa: total gasto no cartão."); (2) a human `campoAnalisado` label accompanies the raw `campo` (e.g. `valorTotalTransacoes` → "total gasto no cartão"); (3) `agrupadoPorRotulo` accompanies the raw `agrupadoPor`; (4) in `senado_suprimento_fundos`, the raw `regimeEspecial` flag (boolean/`S`/`N`) becomes plain text ("regime especial"/"regime comum") in both ranking entries and group keys; (5) a strong new server-instruction forbids transcribing any internal field/param/enum name or technical aviso, directing the model to the human labels. A follow-up round closed two further leak sources found in live testing: the raw `campo`/`agrupadoPor` echoes were removed from the statistics output entirely (only the human `campoAnalisado`/`agrupadoPorRotulo` remain — the fallback logic is still covered by tests via those labels), and the tool descriptions were cleaned of the "cai no default com aviso" mechanic and the field-name-heavy prose (the `z.enum` values the model needs to call the tool are kept). A second server-instruction now also forbids narrating the internal mechanism (which field/param was requested, defaults, avisos, endpoints) — the model should state only what the data is and is not, in plain terms. Known remaining gap (tracked): `atos-concessao` still identifies a beneficiary only by `codigoInternoSuprido` when the model needs a per-person handle, because the feed carries no name — the proper fix (enriching with the supridos registry name) is deferred.
- **Reader-facing verbalization of statistics.** The `estatisticas: true` envelope no longer surfaces builder shorthand to the user. `percentis` changed from a `{ p25…p99 }` object to a self-documenting list of `{ percentil, valor, rotulo }`, where `rotulo` reads in plain Portuguese (e.g. `"99% dos valores são iguais ou inferiores a R$ 90.026,29"`, median flagged as such) — so the model verbalizes the meaning instead of parroting "p99". In `senado_remuneracoes_servidores`, the internal payroll row id previously exposed as `sequencial` in ranking/extreme entries is now `idInternoFolha` and flagged (in the server instructions) as disambiguation-only, never to be cited as a public identifier. Likewise in `senado_suprimento_fundos` (tipo `atos-concessao`), the raw `codigo_suprido` is renamed `codigoInternoSuprido` and the citable `codigoAtoConcessao`/`data` are now carried so ranking entries have a public reference (the array-valued `elementoDespesa`, useless as an identifier, was dropped from those entries — the `agruparPor` path is unchanged). Two new server-instruction lines codify this for all clients. Affects the five `estatisticas` tools. Internally, the four byte-identical `arredondarEstatisticas`/`arredondarEntradas` copies were consolidated into shared helpers in `src/utils/estatisticas.ts` (`formatarBRL`, `rotularPercentis`, `arredondarEstatisticas`, `arredondarEntradas`).

## [3.4.0]

### Added
- **`estatisticas: true` mode** on five administrative tools (`senado_remuneracoes_servidores`, `senado_ceaps`, `senado_execucao_orcamentaria`, `senado_horas_extras`, `senado_suprimento_fundos`) — returns a quantitative envelope (min/max/mean/median/percentiles plus top/bottom ranking, with optional `campo`/`agruparPor`/`topN`) so max/min/median/ranking questions no longer require paginating the detail mode.

### Changed
- Enriched tool descriptions (Parameters/Behavior/Usage) on 12 tools: `senado_buscar_legislacao`, `senado_obter_legislacao`, `senado_discursos_senador`, `senado_discurso_texto`, `senado_notas_taquigraficas`, `senado_videos_taquigrafia`, `senado_distribuicao_materias`, `senado_resultado_veto`, `senado_tabelas_plenario`, `senado_tabelas_processo`, `senado_contratacao_detalhe`, `senado_ecidadania_obter_evento` — they now disclose pagination/empty/error behavior, parameter semantics (AND filters, internal id vs. law number, enum-by-value), and when-not-to-use guidance. Descriptions only; no logic change.
- Node 20 is now the project baseline (vitest 4 requires ≥20); CI runs a Node 20/22 test matrix on push/PR, with a typecheck+test workflow and README badge.
- Release versioning is now single-source: `package.json` is authoritative and `npm version <bump>` mirrors it into `server.json` and `src/version.ts` via a `version` lifecycle hook.

### Fixed
- Bug-sweep (38 fixes) across pt-BR money parsing, upstream root realignment for the migrated `/processo`/`/votacao` endpoints, senator/plenary/veto field mapping, e-Cidadania anti-injection wrapping and comment-source correction, and orçamento ofícios projection/pagination.

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
