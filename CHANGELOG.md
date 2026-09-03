# Changelog

All notable changes to this project are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [3.7.0] - 2026-09-03

**`search` e `fetch` — o contrato Deep Research da OpenAI.** O deep research
do ChatGPT (e o company knowledge, e os workflows de pesquisa da API Responses)
só usa um servidor MCP que exponha EXATAMENTE essas duas tools; sem elas o
servidor era conector de chat e de diretório, mas não fonte de pesquisa. 67 →
**69 tools**. Nada muda nas 67 `senado_*`.

### Added

- **Grupo U — Deep Research (2 tools)**, `src/tools/deep-research.ts`, sobre
  `@sbissoli/mcp-search` 0.3.0 (dep nova). Acervo: senadores em exercício
  (`sen:<código>`, `/senador/lista/atual`) e colegiados ativos do Senado e do
  Congresso (`com:<código>`, `/comissao/lista/colegiados`) — as duas listas
  fechadas que a API publica inteiras; matérias ficam de fora (não há dump).
  Índice em memória construído no 1º uso (mesmas chaves de cache das
  `senado_listar_*`) e mantido por 24 h. `fetch` reusa as leituras reais de
  `senado_obter_senador` e `senado_obter_comissao` (extraídas em
  `fetchSenadorDetalhe`/`fetchComissaoColegiado`), com o mesmo cache e a mesma
  proveniência. `url` é sempre a página pública humana — perfil do senador em
  `www25.senado.leg.br` e a página da comissão em
  `legis.senado.leg.br/comissoes/comissao?codcol=<código>` (padrão verificado ao
  vivo: CAE, CCJ e CCAI respondem 200; código inexistente, 404).
- Desenho "coletor + shim": a fábrica do pacote é apontada para um coletor que
  só colhe `description` e `callback`; o registro passa pelo shim `host.tool`
  de `createServer` como o dos outros 20 grupos — filtro de perfil, título de
  `tool-titles.ts`, annotations, `outputSchema` permissivo ÚNICO (o gate de
  `output-contract` fica intacto) e `instrumentTool`. As duas ficam SÓ em
  `/mcp`; o perfil curado `/mcp/openai-app-v2` continua com 27.
- `provenanceExtras()` em `src/utils/provenance.ts`: os canais
  `structuredContent`/`_meta` do envelope sem o rodapé de texto — para tools
  cujo `content` é ditado por contrato externo.
- `npm run smoke:stdio` (o script existia sem entrada em `scripts`).
- Seção "ChatGPT (Deep Research)" nos dois READMEs; Grupo U no inventário.

### Changed

- Superfície: +2 tools (`search`, `fetch`); recurso `senado://catalogo` passa
  a listar o Grupo U e a dizer 69. Baselines `surface-*-3.6.0` → `3.7.0`.
- `parseComissaoItem` exportada de `comissoes.ts` (era mapeamento inline em
  `senado_listar_comissoes`).

### Fixed

- `scripts/smoke-stdio.mjs` pinava **66** tools — já estava errado (o servidor
  registrava 67) e ninguém viu porque nada o executava. Agora deriva a contagem do baseline
  `surface-stdio-<v>.json` mais recente e exercita `search` → `fetch` +
  id desconhecido ao vivo.
- README pt-BR dizia "25 ferramentas" no perfil curado do ChatGPT App
  (são 27; a frase quebrava linha e escapava do teste de contagem).

## [3.6.0] - 2026-08-30

Migra para o **MCP SDK v2** (`@modelcontextprotocol/server` 2.0.0) e fecha os
achados de conformidade. Produção de **114/122 (93,4%) para 173/173 = 100%**.

O NÚMERO ANTIGO MEDIA UM UNIVERSO MENOR, e é isso que a migração revelou: o
denominador foi de 122 para 173. Na v1 o ciclo 2026-07-28 não existe, então o
auditor pulava dezenas de regras — a nota de 93,4% escondia que o servidor não
falava a versão corrente.

Nada muda para quem usa: as mesmas 67 tools, os mesmos schemas, o mesmo
comportamento. O pacote é só binário (`npx senado-br-mcp`), sem API exportada.

### Changed

- **SDK v2.** O que tornou a migração contida foi o shim: os 20 módulos de grupo
  nunca chamaram o SDK direto, chamam `server.tool()` instalado por
  `createServer`. Trocar imports foi mecânico em 27 arquivos; o trabalho real foi
  declarar o tipo do que os módulos consomem (`src/tool-host.ts`) — até então
  diziam receber `McpServer` e chamavam um método que a v1 expunha e a v2 não.
  De quebra, o `params` de 65 callbacks deixou de ser `any` implícito.
- `createMcpHandler` passa a receber FÁBRICA e não instância (a v2 exige um
  `McpServer` novo por request).
- **O bundle do Worker caiu de 3794 para 1803 KiB** — o SDK v1 não é mais
  empacotado.
- TypeScript 7.0.2, `zod` 4.5.4, `agents` 0.5 -> 0.22, `wrangler` 4.127,
  `@cloudflare/workers-types` v5 e `@sbissoli/mcp-stats` 0.2.0.

### Added

- `title` no `serverInfo` do handshake, e `server/discover` anunciando todas as
  revisões atendidas.
- Cursor de paginação inválido recusado com JSON-RPC `-32602` nos quatro
  endpoints de lista, nas duas bordas por onde a mensagem entra.

### Fixed

- `cli.ts` conectava o transporte à mão (`server.connect`), o que atende só o
  ciclo legado. Com `serveStdio` o stdio foi de 127/144 para 146/148 — **sem uma
  falha de diferença nos dois casos**: eram 19 pontos de regras que sequer
  chegavam a ser avaliadas.
- O `websiteUrl` do handshake apontava para o repositório enquanto o manifesto
  apontava para o domínio próprio, que é quem serve o ícone.
- O stderr do wrangler em `d1.ts` e `d1-read.ts` usava `toString()`, que num
  `Uint8Array` devolveria "104,101,..." em vez do texto — mensagem de erro
  ilegível sem ninguém notar.

### CI

- Catraca do `mcpscore` em 98 (stdio) e 100 (produção).
- O `output-contract` deixou de pinar a string do dialeto de JSON Schema: a v2
  emite `2020-12` onde a v1 emitia `draft-07`, e o teste reprovava uma troca de
  biblioteca como se fosse regressão. Agora guarda a FORMA e exige só que o
  `$schema` exista.

## [3.5.1]

### Added
- **`icons` declared in `server.json`.** The server already served a 512×512 icon
  at `/icon.jpg` and already advertised it in the MCP handshake (`serverInfo.icons`,
  `src/server.ts`), but the registry manifest never declared it — and the registry
  is what directories snapshot. The mcpindex.ai Quality Score awards 5 completeness
  points for a declared icon, so the server sat at 95/100 while owning a perfectly
  good icon. Same URL as `serverInfo`, so the two cannot drift; hosted on the
  server's own domain, which is what the MCP schema recommends over a third-party
  host. A published version is immutable in the MCP Registry, so metadata only
  reaches it through a release.

## [3.5.0]

### Changed
- **Provenance envelope migrated to the portfolio-wide contract v1.0** ([`@sbissoli/mcp-provenance`](https://www.npmjs.com/package/@sbissoli/mcp-provenance)). The server now builds a validated canonical provenance model per response and emits its **`concise` projection**: a fixed 6-key block — `source`, `source_url`, `data_vintage`, `retrieved_at`, `citation`, `license` — with explicit `null` for unknown values, in `structuredContent.provenance` and mirrored under the same namespaced `_meta` keys. Visible changes for consumers: `reference_period` is renamed **`data_vintage`** (also inside the canonical `field_sources`); previously-omitted optional fields now appear as explicit `null`; `dataset_id`, `api_version` and `field_sources` left the emitted block (they live in the canonical model, are validated on every build, and keep informing the `attribution` URL list, which is unchanged); and the text footer follows the contract's fixed wording — source line ("Fonte: … · url · dados de … · extraído em …"), license line, and a closing reader notice that the full reference can be requested in the conversation. Timestamps remain Brasília time (-03:00), preserved through the cache. The ChatGPT-App widget now reads `data_vintage`.

## [3.4.4]

### Changed
- **Fase-1 adoption of the portfolio packages** (behavior-preserving): the statistics core of `src/utils/estatisticas.ts` now comes from [`@sbissoli/mcp-stats`](https://www.npmjs.com/package/@sbissoli/mcp-stats) (the module remains as a pt-BR adapter; responses are byte-identical) and the eval harness (`evals/`) now imports [`@sbissoli/mcp-evals`](https://www.npmjs.com/package/@sbissoli/mcp-evals) (`evals/catalog.ts` keeps only the server's GROUPS; `score.ts`/`retry.ts` were removed in favor of the package, which reproduces the gate messages byte-for-byte).
- **Purge internal vocabulary from statistics responses.** Live testing showed the model transcribing raw field names, parameter names, enum values and technical `aviso` messages into user-facing prose (`valorTotalTransacoes`, `regimeEspecial = true`, "caiu no default", `tipo=supridos`) — jargon meaningful only to someone who knows the MCP internals. Across all five statistics tools: (1) `aviso` messages rewritten in plain language, with no raw field/param names (e.g. "A medida solicitada não está disponível para esta relação; a estatística usa: total gasto no cartão."); (2) a human `campoAnalisado` label accompanies the raw `campo` (e.g. `valorTotalTransacoes` → "total gasto no cartão"); (3) `agrupadoPorRotulo` accompanies the raw `agrupadoPor`; (4) in `senado_suprimento_fundos`, the raw `regimeEspecial` flag (boolean/`S`/`N`) becomes plain text ("regime especial"/"regime comum") in both ranking entries and group keys; (5) a strong new server-instruction forbids transcribing any internal field/param/enum name or technical aviso, directing the model to the human labels. A follow-up round closed two further leak sources found in live testing: the raw `campo`/`agrupadoPor` echoes were removed from the statistics output entirely (only the human `campoAnalisado`/`agrupadoPorRotulo` remain — the fallback logic is still covered by tests via those labels), and the tool descriptions were cleaned of the "cai no default com aviso" mechanic and the field-name-heavy prose (the `z.enum` values the model needs to call the tool are kept). A second server-instruction now also forbids narrating the internal mechanism (which field/param was requested, defaults, avisos, endpoints) — the model should state only what the data is and is not, in plain terms. The previously-deferred gap is now closed: `atos-concessao` statistics join the supridos registry (`tipo=supridos`, ~1 MB, cached by year) so each ranking entry carries the beneficiary's `suprido` NAME — the response can now say "Francisco …" instead of "suprido 14568" — and a new `agruparPor='suprido'` ranks beneficiaries by name. The registry fetch degrades gracefully to name = null on failure.
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
