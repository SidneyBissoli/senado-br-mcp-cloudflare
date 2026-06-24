# Senado Brasil MCP Server

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white)
![MCP](https://img.shields.io/badge/MCP-Streamable%20HTTP-1f6feb)
![Tools](https://img.shields.io/badge/tools-66-2ea44f)
[![MCP Registry](https://img.shields.io/badge/MCP-Registry-blue)](https://registry.modelcontextprotocol.io)
[![LobeHub](https://lobehub.com/badge/mcp/sidneybissoli-senado-br-mcp-cloudflare)](https://lobehub.com/mcp/sidneybissoli-senado-br-mcp-cloudflare)
[![smithery badge](https://smithery.ai/badge/sidneybissoli/senado-br-mcp-cloudflare)](https://smithery.ai/servers/sidneybissoli/senado-br-mcp-cloudflare)
[![GitHub stars](https://img.shields.io/github/stars/SidneyBissoli/senado-br-mcp-cloudflare?style=flat&logo=github)](https://github.com/SidneyBissoli/senado-br-mcp-cloudflare)
[![GitHub Sponsors](https://img.shields.io/github/sponsors/SidneyBissoli?logo=githubsponsors&label=Sponsor&color=db61a2)](https://github.com/sponsors/SidneyBissoli)
[![License: MIT](https://img.shields.io/github/license/SidneyBissoli/senado-br-mcp-cloudflare)](LICENSE)
[![Status](https://img.shields.io/website?url=https%3A%2F%2Fsenado.sidneybissoli.com%2Fhealth&up_message=online&down_message=offline&label=status)](https://senado.sidneybissoli.com/status)

🇧🇷 [Leia em Português](README.pt-BR.md)

A **public, hosted** MCP server that gives AI assistants live, structured access to **Brazilian Senate open data** — **no installation, no account, no API key**. Point your MCP client at the hosted endpoint and start asking about senators, bills, votes, expenses, and more. It runs on Cloudflare Workers over Streamable HTTP.

It exposes **66 tools**, **4 prompts**, and **5 resources** across two domains:

- **Legislative** — senators; bills and their tramitation; votes; committees; plenary sessions, results and presidential vetoes; party-bloc voting orientation; speeches and stenographic transcripts; blocs and leadership; federal legislation; and citizen participation via the e-Cidadania portal.
- **Administrative** — CEAPS parliamentary-quota expenses; housing allowance; civil servants and payroll; overtime; interns; procurement contracts and biddings; outsourced staff; petty-cash funds; and budget execution.

Data comes from three official sources — the [legislative open-data API](https://legis.senado.leg.br/dadosabertos/), the [administrative open-data API](https://adm.senado.gov.br/adm-dadosabertos/swagger-ui/index.html), and the e-Cidadania portal. All tool responses are in Portuguese (pt-BR). See [CHANGELOG.md](CHANGELOG.md) for release history.

## See it in action

Point a client at the endpoint and ask, in plain Portuguese:

- *"Como os senadores de São Paulo votaram nas últimas votações do plenário?"* → `senado_search_votacoes`
- *"Mostre a tramitação da PEC 45/2019."* → `senado_buscar_materias` + `senado_obter_materia`
- *"Quanto foi gasto com a cota parlamentar (CEAPS) em 2024, por tipo de despesa?"* → `senado_ceaps`

The answers come live from the Senate's official open-data APIs — exact figures with provenance, not numbers guessed from training data.

## Use it (hosted — no setup)

This is a **remote, hosted, open-access** server. To use it, point any MCP client at the Streamable
HTTP endpoint — **no install, no account, no API key, no configuration**:

```
https://senado.sidneybissoli.com/mcp
```

### Install (any client)

For clients that launch MCP servers as a command — and for one-command setup — use the
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote) bridge. **No build, no config, no key:**

```bash
npx -y mcp-remote https://senado.sidneybissoli.com/mcp
```

- **One-click (LobeHub):** open the [server page](https://lobehub.com/mcp/sidneybissoli-senado-br-mcp-cloudflare) and click **Install**.
- **Native remote URL** (Claude Desktop/Code and other Streamable-HTTP clients): see [Connecting MCP Clients](#connecting-mcp-clients).

Everything below *Architecture* (Prerequisites, Setup, Deploy) is **only for optionally self-hosting your
own instance** — it is **not** required to use this public server.

## Run locally (npx · stdio)

Prefer not to route queries through a third-party host (e.g. a newsroom policy)? The **same server**
also runs as a **local stdio process** that talks **directly to the official government APIs** — same
66 tools, same provenance envelope, no Cloudflare in the loop. This is the npm/stdio channel, published
as [`senado-br-mcp`](https://www.npmjs.com/package/senado-br-mcp).

Point a command-based client (Claude Desktop/Code, etc.) at the package — npm fetches and runs it,
no clone or build:

```json
{
  "mcpServers": {
    "senado-br": {
      "command": "npx",
      "args": ["-y", "senado-br-mcp"]
    }
  }
}
```

To run it directly or hack on it, use the source checkout instead:

```bash
git clone https://github.com/SidneyBissoli/senado-br-mcp-cloudflare
cd senado-br-mcp-cloudflare
npm install
npm run build
node dist/cli.js   # serves MCP over stdio (Ctrl+C to stop)
```

**Parity with the hosted server:** the legislative and administrative tools are **identical** (same
upstream APIs, same throttle/cache/provenance) — locally the L1 Cloudflare cache is a no-op, but the L0
in-memory cache still works, so results are the same. The **only** difference is the e-Cidadania
list/corpus tools: without D1 they fall back to a live scrape of the ~5 REST highlights, flagged via
`meta.fonte` / `possivelDesatualizacao`; the detail tools (`obter_*`) are identical. Logs go to
**stderr** — stdout carries only the JSON-RPC protocol stream.

## Agent Skill (optional)

This repo bundles a Claude [Agent Skill](https://platform.claude.com/docs/en/docs/agents-and-tools/agent-skills/overview)
at [`.claude/skills/senado-br/`](.claude/skills/senado-br/SKILL.md) that teaches Claude **when** to reach for
this server and **how** to use its 66 tools well — a themed tool map, common question→tool playbooks, the
provenance contract, and gotchas (dates, the `codigoMateria` bridge, e-Cidadania's open-set listing, pagination).
It points back to the server's own `senado://catalogo` / `senado://guia` resources rather than duplicating them.

Claude Code auto-discovers it when you work in this repo. To use it elsewhere, copy
`.claude/skills/senado-br/` into your `~/.claude/skills/`, or zip the folder and upload it in claude.ai
(Settings → Features). The skill assumes the `senado-br` MCP server is connected (hosted or via npx).

## Architecture

- **Runtime:** Cloudflare Workers (ESM)
- **Transport:** Streamable HTTP (MCP spec 2025-03-26) via `createMcpHandler` from `agents/mcp`
- **Protocol:** MCP over JSON-RPC — single `/mcp` endpoint handles POST, GET, DELETE
- **SDK:** `@modelcontextprotocol/sdk` 1.26.0+ (per-request McpServer instances)
- **Validation:** Zod schemas for all tool inputs
- **Caching:** 2-layer (L0 memory + L1 Cache API) with SHA-256 keying
- **e-Cidadania store:** D1 database refreshed by a Cron Trigger (every 2h) — list tools read from D1 with a live-scrape fallback and a staleness flag; detail tools stay live with write-through (see [e-Cidadania](#e-cidadania-d1-backed-cron-refreshed))
- **Rate limiting:** Token bucket — global (8 req/s) + per-client (2 req/s)
- **Upstream throttle:** Max 6 concurrent requests, 10s timeout, retry with exponential backoff
- **Auth:** Optional Bearer token (set the `API_KEY` secret; open access when unset). Constant-time comparison.
- **Observability:** Structured JSON logging + in-memory counters at `/metrics`; per-tool call telemetry (selection, error rate, cache-vs-live) in Cloudflare Analytics Engine, PII-free
- **Liveness:** Runs on Cloudflare's own global network behind a custom domain — no third-party host that can go dark. Public `/health` and `/status` (version + last-deploy id/timestamp) make uptime and the current build verifiable; the **status** badge above pings the live endpoint
- **Tests:** Vitest unit tests for parsers, helpers, cache, throttle, and auth

## Self-hosting (optional)

> **Not needed to use the server** — it is already hosted at `https://senado.sidneybissoli.com/mcp`
> (open access). Follow this section only if you want to run your **own** private instance.

### Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) v4+
- Cloudflare account

### Setup

#### 1. Install dependencies

```bash
npm install
```

#### 2. Create KV namespace

```bash
# Create the KV namespace
wrangler kv namespace create CACHE_KV

# Note the ID from the output, e.g.:
# { binding = "CACHE_KV", id = "abc123..." }
```

#### 3. Configure wrangler.toml

Replace the placeholder KV namespace ID:

```toml
[[kv_namespaces]]
binding = "CACHE_KV"
id = "YOUR_KV_NAMESPACE_ID_HERE"
```

Optionally set `ALLOWED_ORIGIN` to restrict CORS:

```toml
[vars]
ALLOWED_ORIGIN = "https://your-app.example.com"
```

The e-Cidadania pipeline needs a **D1 database** and a **Cron Trigger** (both already declared in `wrangler.toml` — replace the database ID):

```toml
[[d1_databases]]
binding = "ECIDADANIA_DB"
database_name = "senado-ecidadania"
database_id = "YOUR_D1_DATABASE_ID_HERE"

[triggers]
crons = ["0 */2 * * *"]
```

Create the database (paste the returned ID above) and apply the schema:

```bash
npx wrangler d1 create senado-ecidadania
npx wrangler d1 migrations apply senado-ecidadania --remote
```

The list tools fall back to live scraping when D1 is empty, so the server works before the first Cron run.

#### 4. (Optional) Enable authentication

```bash
wrangler secret put API_KEY
# Clients must then send: Authorization: Bearer <key>
# When API_KEY is not set, the server is open access.
```

#### 5. Local development

```bash
npm run dev
# Dev server runs locally on port 8787 (local only).
# The public MCP endpoint is https://senado.sidneybissoli.com/mcp
```

#### 6. Tests and typecheck

```bash
npm test             # run all tests once
npm run test:watch   # watch mode
npm run typecheck    # tsc --noEmit
```

#### 7. Deploy

```bash
npm run deploy
# Serves at https://senado.sidneybissoli.com (custom domain) and
# https://senado-br-mcp.sidneybissoli.workers.dev (workers.dev fallback)
```

## Endpoints

| Path | Methods | Description |
|------|---------|-------------|
| `/mcp` | POST, GET, DELETE, OPTIONS | MCP Streamable HTTP endpoint (managed by `createMcpHandler`) |
| `/health` | GET | Health check — returns `ok` (always public) |
| `/status` | GET | JSON: `status`, `version`, and last-deploy metadata (`deploy.id`/`tag`/`timestamp`) — liveness + current build, no MCP handshake needed (always public) |
| `/metrics` | GET | JSON counters: requests, tool calls, cache hits/misses, upstream calls/retries/errors, auth failures (always public) |

## MCP Request Examples

All requests go to `POST /mcp` with JSON-RPC 2.0 format.

### List available tools

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```

### Call a tool — List senators from SP

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "senado_listar_senadores",
    "arguments": {
      "uf": "SP",
      "emExercicio": true
    }
  }
}
```

### Call a tool — Search bills by keyword

```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "senado_buscar_materias",
    "arguments": {
      "palavraChave": "inteligência artificial",
      "tramitando": true
    }
  }
}
```

### Call a tool — Get recent plenary votes

```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "senado_search_votacoes",
    "arguments": {
      "dias": 7
    }
  }
}
```

### Call a tool — Most popular citizen ideas

```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "senado_ecidadania_listar_ideias",
    "arguments": {
      "ordenarPor": "apoios",
      "ordem": "desc",
      "status": "aberta"
    }
  }
}
```

## Upstream API Endpoints

The server consumes two classes of upstream endpoints from the Senado API:

### Legacy endpoints (`.json` suffix, PascalCase responses)

Used by Groups A, E, F, H, I, J, K, L, M, N. The `.json` suffix is appended automatically by `upstream.ts`. None of these is marked deprecated upstream.

| Upstream path | Used by |
|---------------|---------|
| `/senador/lista/atual` | `senado_listar_senadores` |
| `/senador/lista/legislatura/{legislatura}` | `senado_listar_senadores` (param `legislatura`) |
| `/senador/{codigo}` | `senado_obter_senador` |
| `/senador/{codigo}/licencas`, `/comissoes`, `/cargos`, `/historicoAcademico`, `/filiacoes`, `/profissao` | `senado_senador_historico` (`tipo` enum) |
| `/senador/afastados` | `senado_senadores_afastados` |
| `/senador/{codigo}/apartes` | `senado_discursos_senador` (`tipo=apartes`) |
| `/comissao/lista/colegiados` | `senado_listar_comissoes` (+ sigla-to-code resolution) |
| `/comissao/{codigo}` | `senado_obter_comissao` (`secao=resumo`; numeric code, not sigla) |
| `/composicao/comissao/{codigo}` | `senado_obter_comissao` (`secao=membros`) |
| `/comissao/agenda/{data}` | `senado_agenda_comissoes` |
| `/comissao/agenda/{dataInicio}/{dataFim}` | `senado_reunioes_comissao` |
| `/comissao/reuniao/{codigoReuniao}` | `senado_reuniao_comissao` |
| `/comissao/cpi/{sigla}/requerimentos` | `senado_requerimentos_cpi` (empty body = no requests) |
| `/materia/distribuicao/autoria`, `/distribuicao/relatoria/{sigla}` | `senado_distribuicao_materias` |
| `/plenario/agenda/dia/{data}`, `/agenda/mes/{data}`, `/agenda/cn/...` | `senado_agenda_plenario` |
| `/plenario/resultado/{data}`, `/resultado/cn/{data}`, `/resultado/mes/{data}` | `senado_resultado_plenario` |
| `/plenario/resultado/veto/{codigo}` (+ `/materia/`, `/dispositivo/`) | `senado_resultado_veto` |
| `/plenario/votacao/orientacaoBancada/{data}` (+ período) | `senado_orientacao_bancada` |
| `/plenario/encontro/{codigo}` (+ `/pauta`, `/resultado`, `/resumo`) | `senado_encontro_plenario` |
| `/plenario/tiposSessao`, `/lista/tiposComparecimento`, `/lista/legislaturas` | `senado_tabelas_plenario` |
| `/materia/vetos/{ano}`, `/vetos/aposrcn`, `/vetos/antesrcn`, `/vetos/encerrados` | `senado_vetos` |
| `/taquigrafia/notas/{sessao\|reuniao}/{id}` | `senado_notas_taquigraficas` |
| `/taquigrafia/videos/{sessao\|reuniao}/{id}` | `senado_videos_taquigrafia` |
| `/senador/{codigo}/discursos` | `senado_discursos_senador` |
| `/plenario/lista/discursos/{dataInicio}/{dataFim}` | `senado_discursos_plenario` |
| `/discurso/texto-integral/{codigo}` | `senado_discurso_texto` (plain text, fetched directly) |
| `/senador/lista/tiposUsoPalavra` | `senado_tabelas_referencia` (`tabela=tipos-uso-palavra`) |
| `/composicao/lista/blocos` | `senado_listar_blocos` |
| `/composicao/bloco/{codigo}` | `senado_obter_bloco` |
| `/composicao/lideranca` | `senado_liderancas` |
| `/composicao/mesaSF` | `senado_mesa` (`casa=senado`) |
| `/composicao/mesaCN` | `senado_mesa` (`casa=congresso`) |
| `/orcamento/lista` | `senado_orcamento_parlamentar` (`tipo=emendas`) |
| `/orcamento/oficios` | `senado_orcamento_parlamentar` (`tipo=oficios`) |
| `/legislacao/lista` | `senado_buscar_legislacao` |
| `/legislacao/{codigo}` | `senado_obter_legislacao` |
| `/legislacao/tiposNorma` | `senado_tabelas_referencia` (`tabela=tipos-norma`) |
| `/votacaoComissao/comissao/{sigla}` | `senado_votacao_comissao` (`por=comissao`) |
| `/votacaoComissao/parlamentar/{codigo}` | `senado_votacao_comissao` (`por=senador`) |
| `/votacaoComissao/materia/{sigla}/{numero}/{ano}` | `senado_votacao_comissao` (`por=materia`) |
| `/autor/lista/atual` | `senado_autores_atuais` |

### v3 endpoints (flat JSON arrays/objects, camelCase)

Used by Groups B, C, D. Dates must be in **ISO format** (`YYYY-MM-DD`) — tools accept `YYYYMMDD` and convert. The `codigoMateria` query param bridges legacy matéria codes to v3 processes.

| Upstream path | Used by |
|---------------|---------|
| `/votacao` | `senado_obter_votacao`, `senado_search_votacoes`, `senado_votos_materia`, `senado_votacoes_senador` |
| `/processo` | `senado_search_processos`, `senado_buscar_materias` |
| `/processo/{id}` | `senado_obter_processo`, `senado_obter_materia` (`secao=detalhe`/`tramitacao`) |
| `/processo/documento` | `senado_obter_materia` (`secao=textos`) |
| `/processo/emenda` | `senado_processo_detalhe` (`secao=emendas`) |
| `/processo/relatoria` | `senado_processo_detalhe` (`secao=relatorias`), `senado_obter_materia` (rapporteur) |
| `/processo/prazo` | `senado_processo_detalhe` (`secao=prazos`) |
| `/processo/{siglas,assuntos,classes,destinos,entes,tipos-*}` | `senado_tabelas_processo` (12 reference tables) |

### Administrative API (adm.senado.gov.br/adm-dadosabertos, flat snake_case JSON)

Used by Groups O, P, Q, R via `admFetch` (no `.json` suffix; HTTP 404 treated as empty collection). Base URL configurable via `SENADO_ADM_BASE_URL`.

| Upstream path | Used by |
|---------------|---------|
| `/api/v1/senadores/despesas_ceaps/{ano}` | `senado_ceaps` (~10 MB/year, cached + aggregated in-Worker) |
| `/api/v1/senadores/{auxilio-moradia,escritorios,aposentados}` | `senado_senadores_admin` (`tipo` enum) |
| `/api/v1/servidores/servidores/{ativos,efetivos,comissionados,inativos}` | `senado_servidores` |
| `/api/v1/servidores/remuneracoes/{ano}/{mes}` | `senado_remuneracoes_servidores` (~5.5 MB/month) |
| `/api/v1/servidores/horas-extras/{ano}/{mes}` | `senado_horas_extras` |
| `/api/v1/servidores/quantitativos/*`, `/previsao-aposentadoria`, `/api/v1/senadores/quantitativos/senadores` | `senado_pessoal_tabelas` (quantitativos) |
| `/api/v1/servidores/{estagiarios,pensionistas,lotacoes,cargos}` | `senado_pessoal_tabelas` (listas nominais) |
| `/api/v1/contratacoes/contratos` (+ `/{id}/aditivos`) | `senado_contratos`, `senado_contratacao_detalhe` |
| `/api/v1/contratacoes/{tipo}/{id}/{itens,pagamentos,garantias}` | `senado_contratacao_detalhe` |
| `/api/v1/contratacoes/licitacoes` | `senado_licitacoes` |
| `/api/v1/contratacoes/terceirizados` | `senado_terceirizados` |
| `/api/v1/contratacoes/empresas` | `senado_empresas_contratadas` (~13 MB, requires filter) |
| `/api/v1/contratacoes/{atas_registro_preco,notas_empenho,menores_aprendizes}` | `senado_contratacoes_lista` |
| `/api/v1/supridos/{ano}` (+ atosConcessao, empenhos, movimentacoes, transacoes) | `senado_suprimento_fundos` |
| `senado.gov.br/bi-arqs/Arquimedes/Financeiro/{Despesa,Receitas}SenadoDadosAbertos.json` | `senado_execucao_orcamentaria` (daily JSON feeds, Brazilian decimal strings normalized) |

### e-Cidadania (D1-backed, Cron-refreshed)

The e-Cidadania **list** data is persisted in a **D1 database** (`ecidadania_current/_history/_scrape_runs`, discriminated by `entidade`) and read from there instead of being scraped on every call. **Two cadences** write into it:

- a **weekly off-Worker GitHub Action** owns the **full corpus** of each entity (see below) — the source of truth;
- an in-Worker **Cron Trigger** (`0 */2 * * *`, `src/scraper/pipeline.ts → refreshEcidadania`) does only a **targeted metric splice** of the ~5 REST highlights per live entity (`restcolecaomaismateria/ideia/audiencia` — votos/comentários/apoios), recorded as `ok-metrica` so it never re-breaks the corpus baseline and never touches the long tail.

Both writers build payloads through the canonical `buildXResumo` builders + shared `contentHash`, so their rows are byte-identical. Each write:

- **upserts** `ecidadania_current` (one row per item — what the tools read),
- **appends** `ecidadania_history` only when an item's `content_hash` changes (time-series-ready),
- records each run in `ecidadania_scrape_runs`.

An **anomaly guard** (`src/scraper/anomaly.ts`, `classifyRun`) ensures a failed or anomalous corpus run (zero rows, or fewer than `ECIDADANIA_CORPUS_MIN_PCT`% of the last good run) **never overwrites** the last good state.

The **list / analysis tools** (`listar_*`, `consultas_analise`, `sugerir_tema_enquete`, `consultas_votos`) read from D1 via `resolveList` (`src/scraper/store.ts`): D1-first. Because every entity is now a full corpus, a stale corpus is served from D1 **flagged** (`possivelDesatualizacao: true`) rather than collapsing to the ~5-item live highlights (the original coverage bug); the live scrape is reserved for an empty D1 (cold start, before the first weekly run). Staleness uses `ECIDADANIA_CORPUS_STALE_MAX_MIN` (~10 days). Every list response carries an additive `meta` (`fonte`, `lastScrapedAt`, `possivelDesatualizacao`) so callers always see the data's real age and never get stale data silently.

The **detail tools** (`obter_*`) stay **live** (HTML scraped with CSS-class-targeted regex) for freshness, and write their richer payload through to `ecidadania_detalhe` fire-and-forget (deduped by `content_hash`), so detail history accrues without adding latency to the response.

#### Full-corpus ingestion (off-Worker, weekly)

All four e-Cidadania entities are full corpora owned by the weekly Action (`.github/workflows/ingest-ecidadania.yml`), each with its own `scripts/ingest-ecidadania/index-*.ts` orchestrator emitting batched `out-*.sql` the apply step bulk-loads:

- **`consultas`** — open consultations (detailed below).
- **`eventos`** — audiências/eventos from the `principalaudiencia?p=N` HTML listing; status comes straight from the listing block (no `/processo` bridge).
- **`ideias`** — ideias legislativas (~150k) from `pesquisaideia?situacao=N&p=M`, crawled **per `situacao` bucket** (the listing has no inline status) and emitted in ~10k-statement batches.
- **`consultas_votos`** — a separate **historical** acervo of votes-by-UF parsed from the ~33 MB Arquimedes CSV (`Proposições-com-votos.csv`), aggregated to one record per matéria with a `votosPorUf` breakdown. The CSV's "dados atualizados até" stamp becomes the provenance `reference_period`; it is excluded from the row hash (`consultaVotoCore`) so a weekly stamp bump on these frozen votes doesn't churn `_history`. `STATUS ATUAL` is uniformly "Descontinuado", hence archival, not a migration of the open consultations. Served by `senado_ecidadania_consultas_votos` with provenance pointing at the CSV (`ECIDADANIA_ARQUIMEDES`).

The `consultas` job is the reference implementation:

`consultas` covers the **full set of OPEN consultations** — every matter currently in tramitação (~7.7k), not just the ~5 highlights. Confirmed on the first run: the `pesquisamateria` listing is **in-tramitação-only**, so closed/historical consultations are **not** captured by this source (a pre-ingestion historical backfill is out of scope). Three settled design decisions:

1. **Decoupled ingestion.** The open set is acquired by an **off-Worker TypeScript job** (`scripts/ingest-ecidadania/`, run by a weekly GitHub Action — `.github/workflows/ingest-ecidadania.yml`) that paginates the HTML listing (`pesquisamateria?p=1..N`, the only full-coverage source for open consultations) for ids + vote counts and **bulk-loads D1**; the Worker only reads. The brittle, long crawl is kept out of the request/Cron path.
2. **Status from `/processo`, not HTML.** A consultation runs from presentation until the end of tramitação, so `status` is a function of the matter: **aberta ⟺ the `codigoMateria` is in the `/processo` `tramitando=S` set**, derived from robust JSON (never scraped). Every consultation enters as `aberta` (the listing only yields in-tramitação matters); on each **complete** run the job re-derives status for **all stored rows** by `/processo` membership (not by listing-absence, which can be transient), so a consultation whose matter leaves tramitação flips to `encerrada`. The `encerrada`/`todas` sets therefore grow over time; consultations that closed **before** the first ingestion aren't captured (out of scope). The list/analysis tools default to `status: aberta`.
3. **Two reconciled cadences (one shared writer contract).** The job **reuses** `contentHash` + the `ConsultaResumo` builder + `classifyRun` from `src/scraper/`, so its rows are byte-identical to the Cron's. The weekly job owns the long tail; the **2h Cron** keeps the ~5 hot/open highlights fresh via a *targeted metric splice* (recorded as `ok-metrica`, bypassing the corpus `classifyRun` baseline). Corpus freshness (`possivelDesatualizacao`) is computed from the last `status='ok'` run and uses a larger window (`ECIDADANIA_CORPUS_STALE_MAX_MIN`), and a stale consultas corpus is served from D1 flagged rather than collapsing back to the live highlights.

Write guards on the load: an **incomplete crawl** (any page failed) or an incomplete `/processo` status universe writes only an `erro` run row; even a complete crawl is rejected by a **catastrophic floor** (`ECIDADANIA_CORPUS_MIN_PCT`, default 80% of the last good corpus) to guard against a degraded page — overridable with `--force` / `INGEST_FORCE=1` for a legitimate large shrink. Run weekly via the Action, or manually:

```bash
CLOUDFLARE_API_TOKEN=… npm run ingest:ecidadania                 # writes scripts/ingest-ecidadania/out.sql
npx wrangler d1 execute senado-ecidadania --remote --file=scripts/ingest-ecidadania/out.sql
```

## Caching

### Layer architecture

| Layer | Storage | Scope | TTL range | Purpose |
|-------|---------|-------|-----------|---------|
| **L0** | In-memory `Map` | Per-isolate | 30-300s | Ultra-fast, eliminates redundant requests within a Worker isolate |
| **L1** | Cloudflare Cache API (`caches.default`) | Per-colo (PoP) | 60-600s | Shared across requests at the same edge location |
| **L2** | KV (optional) | Global | Variable | Reserved for rare, low-write data |

### Cache categories

| Category | L0 TTL | L1 TTL | Used for |
|----------|--------|--------|----------|
| **STATIC** | 300s | 600s | Legislation types, static reference |
| **SEMI_STATIC** | 120s | 300s | Party list, UF list, committee details |
| **DYNAMIC** | 30s | 60s | Agendas, recent votes, meeting lists |
| **ON_DEMAND** | 30s | 120s | Specific bill/senator/vote lookups |

### POST caching approach

MCP uses POST for all `tools/call` requests. Caching POST responses is not natively supported by the Cache API, which requires GET requests. The solution:

1. **Hash parameters** — Tool name + sorted parameters are hashed with SHA-256
2. **Synthetic GET key** — A synthetic URL `https://senado-br-mcp.internal/__cache/{tool}/{hash}` is constructed
3. **Cache API match/put** — The synthetic GET URL is used with `caches.default.match()` and `caches.default.put()`, allowing standard Cache API operations on POST-originated data

This caching happens at the **tool level** (inside each tool's callback), not at the MCP transport level.

## Provenance

**Every tool** attaches a **provenance envelope** so a result is traceable back to its official source — provenance is treated as a first-class part of the answer, not an optional extra (the audience is journalists and political-science researchers, for whom an un-sourced figure is unusable). The envelope lives in `structuredContent.provenance` (parseable by clients, validated by the tool's output schema) and is mirrored as a one-line source footer in the text content for clients that only render text — the data JSON itself is **not** duplicated with the envelope, to keep the per-response token cost low (a fixed ≈170 chars).

Coverage spans all four upstream sources, each with its own `source`/`attribution`/`license` (in `src/utils/provenance.ts`):

- **Senado Federal — Dados Abertos (Legislativo)** — `legis.senado.leg.br/dadosabertos`
- **Senado Federal — Dados Abertos (Administrativo)** — `adm.senado.gov.br/adm-dadosabertos`
- **Senado Federal — Execução Orçamentária e Financeira** — Arquimedes/Financeiro feed at `senado.gov.br`
- **Senado Federal — Portal e-Cidadania** — `www12.senado.leg.br/ecidadania`

Fields (per response — one tool, one source):

| Field | Meaning |
|-------|---------|
| `source` | Official source name (e.g. *Senado Federal — Dados Abertos (Legislativo)*) |
| `source_url` | Canonical endpoint/item URL consulted (e.g. `…/processo/{id}`) |
| `dataset_id` | Item/series identifier (e.g. `codigoMateria=137808`) |
| `reference_period` | Vintage/competência of the data (e.g. `2024-03-15`, `2019`) |
| `retrieved_at` | ISO-8601 of the **upstream extraction** — carried through the cache, so it reflects when the data was actually fetched, not the build or the cache-hit time |
| `attribution` | Ready-to-use citation string |
| `license` | Source terms (Dados Abertos do Senado Federal) |

`retrieved_at` fidelity is provided by the cache layer (`cachedFetchWithMeta`), which persists the fetch timestamp alongside the value, so it reflects the real upstream extraction even on a cache hit. Two exceptions report an honest live timestamp instead: the e-Cidadania **list** tools (read from D1) use the corpus's `lastScrapedAt` — the true age of the stored data — while e-Cidadania **detail** tools, scraped live, use the fetch time and a level-3 canonical item URL.

Coverage is **universal**: all 66 tools carry the envelope (verify with `grep -c 'resultWithProvenance(' src/tools/*.ts`). The **⊕** marks in the inventory below denote the original pilot tools (votes, bills, processes); the envelope now extends to every tool, so the marks are historical.

## Tool Inventory

### Group H — Reference/Metadata (1 tool)

| Tool | Description |
|------|-------------|
| `senado_tabelas_referencia` | Tabelas de referência via `tabela` enum: tipos-materia, partidos, ufs, legislatura-atual, tipos-norma, tipos-uso-palavra |

### Group A — Senators (5 tools)

| Tool | Description |
|------|-------------|
| `senado_listar_senadores` | Lista senadores em exercício/por legislatura, com filtros `nome` (busca parcial sem acento), `uf` e `partido` |
| `senado_obter_senador` | Detalhe biográfico de um senador: bio, mandatos, partido, contato |
| `senado_votacoes_senador` ⊕ | Como um senador votou em cada matéria (via v3 `/votacao`) |
| `senado_senador_historico` | Histórico funcional via `tipo` enum: licencas, comissoes, cargos, historico-academico, filiacoes, profissoes |
| `senado_senadores_afastados` | Senadores atualmente afastados (fora de exercício) |

### Group B — Bills/Matters (2 tools, v3 backend)

| Tool | Description |
|------|-------------|
| `senado_buscar_materias` ⊕ | Busca matérias por tipo, número, ano, palavra-chave, autor ou tramitação (via v3 `/processo`) |
| `senado_obter_materia` ⊕ | Dados de uma matéria via `secao` enum: detalhe (situação/relator), tramitacao (histórico) ou textos (documentos) |

### Group C — Processes (5 tools)

| Tool | Description |
|------|-------------|
| `senado_search_processos` ⊕ | Busca processos legislativos (complementar à busca de matérias) |
| `senado_obter_processo` ⊕ | Detalhes completos de um processo legislativo específico |
| `senado_processo_detalhe` | Aspecto de um processo via `secao` enum: emendas, relatorias ou prazos |
| `senado_autores_atuais` | Parlamentares autores de processos em tramitação, ordenados por produção |
| `senado_tabelas_processo` | 12 tabelas de referência (siglas, assuntos, classes, tipos-*) via `tabela` enum |

### Group D — Votes (3 tools)

| Tool | Description |
|------|-------------|
| `senado_obter_votacao` ⊕ | Detalhes de uma votação com votos nominais. Aceita `codigoVotacao` (codigoSessao da sessão plenária). |
| `senado_votos_materia` ⊕ | Votações de uma matéria (via v3 `/votacao?codigoMateria`), com votos nominais opcionais |
| `senado_search_votacoes` ⊕ | Busca/listagem flexível de votações do plenário por `dias`, período, processo, matéria ou senador |

### Group E — Committees (7 tools)

| Tool | Description |
|------|-------------|
| `senado_listar_comissoes` | Lista comissões (colegiados) ativas, filtráveis por tipo |
| `senado_obter_comissao` | Dados de uma comissão via `secao` enum: resumo (mesa/totais) ou membros (composição). Resolve sigla para código internamente. |
| `senado_reunioes_comissao` | Reuniões de uma comissão num período (lida com intervalos entre anos) |
| `senado_agenda_comissoes` | Agenda de reuniões de todas as comissões numa data |
| `senado_reuniao_comissao` | Detalhe completo de uma reunião: partes, itens, convidados, resultados, links pauta/ata |
| `senado_requerimentos_cpi` | Requerimentos protocolados numa CPI em atividade, paginados |
| `senado_distribuicao_materias` | Estatísticas de carga por senador numa comissão: autoria ou relatoria |

### Group F — Plenary (7 tools)

| Tool | Description |
|------|-------------|
| `senado_agenda_plenario` | Plenary schedule — by day, month or Congress (escopo dia/mes/cn) |
| `senado_resultado_plenario` | Session results: items deliberated, opinions, outcomes (SF/CN/month) |
| `senado_orientacao_bancada` | Party leadership voting instructions per vote, with tallies |
| `senado_vetos` | Presidential vetoes by year or tramitation status |
| `senado_resultado_veto` | Nominal veto vote results (by veto, vetoed bill or device) |
| `senado_encontro_plenario` | Legislative session detail, agenda items, results or summary |
| `senado_tabelas_plenario` | Session types, attendance types, legislatures list |

### Group G — e-Cidadania (9 tools)

| Tool | Description |
|------|-------------|
| `senado_ecidadania_listar_consultas` | Consultas públicas (conjunto completo das **abertas** — matérias em tramitação) com votação sim/não; filtro `status` (padrão `aberta`) |
| `senado_ecidadania_obter_consulta` | Detalhe de uma consulta: votos, autor, relator, comentários |
| `senado_ecidadania_consultas_analise` | Analisa o conjunto completo de consultas **abertas** via `modo` (consenso/polarizada); `status` padrão `aberta` |
| `senado_ecidadania_listar_ideias` | Ideias legislativas de cidadãos; ranking das mais apoiadas via `ordenarPor: apoios` |
| `senado_ecidadania_obter_ideia` | Detalhe de uma ideia: texto, apoios, status de conversão em projeto |
| `senado_ecidadania_listar_eventos` | Eventos interativos (audiências, sabatinas, lives); ranking dos mais comentados via `ordenarPor` |
| `senado_ecidadania_obter_evento` | Detalhe de um evento: pauta, convidados, link de vídeo |
| `senado_ecidadania_sugerir_tema_enquete` | Sugere temas para enquete mensal a partir de critérios configuráveis |
| `senado_ecidadania_consultas_votos` | Acervo **histórico** de votos das consultas com quebra **por UF** (CSV Arquimedes); ranking por `total`/`sim`/`nao`, filtro `uf`/`materia` |

### Group I — Speeches (3 tools)

| Tool | Description |
|------|-------------|
| `senado_discursos_senador` | Pronunciamentos de um senador via `tipo` enum: discursos (próprios) ou apartes (intervenções) |
| `senado_discursos_plenario` | Todos os discursos em plenário num intervalo de datas |
| `senado_discurso_texto` | Texto integral de um pronunciamento/discurso específico |

### Group J — Blocs & Leadership (4 tools)

| Tool | Description |
|------|-------------|
| `senado_listar_blocos` | Blocos parlamentares do Senado e seus partidos membros |
| `senado_obter_bloco` | Detalhes de um bloco parlamentar específico |
| `senado_liderancas` | Lideranças do Senado/Congresso (líderes, vice-líderes), filtráveis |
| `senado_mesa` | Membros da Mesa Diretora via `casa` enum: senado (Mesa do SF) ou congresso (Mesa do CN) |

### Group K — Budget (1 tool)

| Tool | Description |
|------|-------------|
| `senado_orcamento_parlamentar` | Dados de emendas orçamentárias via `tipo` enum: emendas (lotes) ou oficios (ofícios de apoio) |

### Group L — Federal Law (2 tools)

| Tool | Description |
|------|-------------|
| `senado_buscar_legislacao` | Busca normas jurídicas federais por tipo, número, ano ou data (ao menos um obrigatório) |
| `senado_obter_legislacao` | Detalhes de uma norma jurídica federal específica |

### Group M — Committee Voting (1 tool)

| Tool | Description |
|------|-------------|
| `senado_votacao_comissao` | Votações em comissões via `por` enum: comissao, senador ou materia; período opcional |

### Group N — Taquigrafia (2 tools)

| Tool | Description |
|------|-------------|
| `senado_notas_taquigraficas` | Official transcripts of plenary sessions or committee meetings — summary mode with excerpts, full-text mode paginated in blocks, speaker filter |
| `senado_videos_taquigrafia` | Video/audio units per session or meeting, with speaker and media links |

### Group O — Senadores/Administrativo (2 tools)

| Tool | Description |
|------|-------------|
| `senado_ceaps` | CEAPS parliamentary quota expenses by year — aggregated by senator, expense type, month or supplier, or itemized detail; filters by senator/month/type/supplier |
| `senado_senadores_admin` | Dados administrativos dos senadores via `tipo` enum: auxilio-moradia, escritorios-apoio ou aposentados |

### Group P — Servidores / Gestão de Pessoas (4 tools)

| Tool | Description |
|------|-------------|
| `senado_servidores` | Civil servants by status (active/effective/commissioned/inactive), filterable by name, unit, position |
| `senado_remuneracoes_servidores` | Monthly payroll — summary by payroll type or per-person composition with computed gross |
| `senado_horas_extras` | Overtime payments by month with totals |
| `senado_pessoal_tabelas` | Tabelas de pessoal via `tabela` enum: quantitativos (pessoal, cargos-funcoes, previsao-aposentadoria, senadores) e listas (estagiarios, pensionistas, lotacoes, cargos) |

### Group Q — Contratações (6 tools)

| Tool | Description |
|------|-------------|
| `senado_contratos` | Contracts with server-side filters: supplier, CNPJ, year, number, object, labor |
| `senado_contratacao_detalhe` | Items, payments, guarantees, amendments or activations of a contract/ata/empenho |
| `senado_licitacoes` | Biddings by number or object text |
| `senado_terceirizados` | Outsourced collaborators by name, company or unit |
| `senado_empresas_contratadas` | Companies contracting with the Senate (requires name/CNPJ filter) |
| `senado_contratacoes_lista` | Price-registration atas, commitment notes, young apprentices |

### Group R — Suprimento de Fundos (1 tool)

| Tool | Description |
|------|-------------|
| `senado_suprimento_fundos` | Petty-cash advances by year: recipients, concession acts, commitments, movements, card transactions |

### Group S — Orçamento do Senado (1 tool)

| Tool | Description |
|------|-------------|
| `senado_execucao_orcamentaria` | Budget execution since 2013 (allocation, committed/settled/paid) and own revenues since 2012 (forecast vs collected) — aggregated by year, action, expense group, source or revenue origin |

**Total: 66 tools**

### Prompts (4)

Reusable pt-BR workflow templates (MCP `prompts` capability), defined in `src/prompts.ts`:

| Prompt | Args | What it guides |
| --- | --- | --- |
| `senado_gastos_senador` | `senador`, `ano` | Resolve o senador e agrega/detalha despesas CEAPS. |
| `senado_tramitacao_materia` | `sigla`, `numero`, `ano` | Obtém situação atual + histórico de tramitação da matéria. |
| `senado_votos_senador` | `senador`, `periodo?` | Lista os votos nominais do senador no período. |
| `senado_panorama_ecidadania` | — | Consolida consultas (consenso/polarização), ideias e eventos populares. |

### Resources (5)

Static context documents/tables (MCP `resources` capability), defined in `src/resources.ts`:

| URI | Type | Content |
| --- | --- | --- |
| `senado://guia` | markdown | Visão geral e qual ferramenta usar por objetivo. |
| `senado://catalogo` | markdown | As 66 ferramentas agrupadas por domínio. |
| `senado://glossario` | markdown | Siglas e termos do Senado (PEC, CEAPS, CCJ, RCN…). |
| `senado://tabelas/tipos-materia` | json | Tipos de proposição (sigla/nome/descrição). |
| `senado://tabelas/ufs` | json | As 27 unidades federativas. |

## Project Structure

```
src/
├── index.ts              # Worker entrypoint (fetch handler + scheduled/Cron handler)
├── server.ts             # McpServer factory (creates per-request instance)
├── auth.ts               # Optional Bearer token auth (constant-time compare)
├── metrics.ts            # In-memory counters served at /metrics
├── types.ts              # Env, cache categories, safeguard constants
├── cache/
│   ├── l0-memory.ts      # In-memory Map cache with TTL + LRU eviction
│   ├── l1-cache-api.ts   # Cloudflare Cache API wrapper (synthetic GET keys)
│   └── manager.ts        # Cache orchestrator (L0 → L1 → upstream)
├── throttle/
│   ├── token-bucket.ts   # Token bucket rate limiter (global + per-client)
│   └── upstream.ts       # Upstream fetch with concurrency limit, retry, timeout
├── scraper/
│   ├── ecidadania.ts     # Isolated e-Cidadania scraper (REST lists + regex HTML detail; buildConsultaResumo)
│   ├── pipeline.ts       # 2h Cron: targeted highlight metric splice (consultas/eventos/ideias); corpora owned by the weekly jobs
│   ├── anomaly.ts        # Run classification (anomalous run never overwrites current)
│   └── store.ts          # D1 reads (resolveList + per-entity staleness, lastGoodRunAt) + detail write-through
├── instrument.ts         # Per-tool call telemetry (in-memory + Analytics Engine)
├── utils/
│   ├── logger.ts         # Structured JSON logging
│   └── validation.ts     # toolResult, toolError, errorFrom, buildParams, ensureArray helpers
└── tools/
    ├── referencia.ts        # Group H — 1 reference/metadata tool
    ├── senadores.ts         # Group A — 5 senator tools
    ├── materias.ts          # Group B — 2 bill/matter tools (v3 backend)
    ├── processos.ts         # Group C — 5 process tools
    ├── votacoes.ts          # Group D — 3 vote tools
    ├── comissoes.ts         # Group E — 7 committee tools
    ├── plenario.ts          # Group F — 7 plenary tools
    ├── ecidadania.ts        # Group G — 8 e-Cidadania tools (read from D1; see scraper/)
    ├── discursos.ts         # Group I — 3 speech tools
    ├── composicao.ts        # Group J — 4 bloc/leadership tools
    ├── orcamento.ts         # Group K — 1 budget tool
    ├── legislacao.ts        # Group L — 2 federal law tools
    ├── votacao-comissao.ts  # Group M — 1 committee voting tool
    ├── taquigrafia.ts       # Group N — 2 stenographic record tools
    ├── senadores-admin.ts   # Group O — 2 admin senator tools (CEAPS, housing)
    ├── servidores.ts        # Group P — 4 personnel tools
    ├── contratacoes.ts      # Group Q — 6 procurement tools
    ├── supridos.ts          # Group R — 1 petty-cash tool
    └── orcamento-senado.ts  # Group S — 1 budget execution tool
scripts/
└── ingest-ecidadania/    # Off-Worker weekly full-corpus consultas ingestion (run via `npm run ingest:ecidadania`)
    ├── index.ts          # Orchestrator: crawl → status (/processo) → normalize → guards → out.sql
    ├── listing.ts        # Pure listing parser (parseConsultaListingPage, findLastPage)
    ├── status.ts         # tramitando=S set from /processo → aberta/encerrada (deriveStatus)
    ├── restatus.ts       # Linger fix: re-status stored rows by /processo membership (close zombies)
    ├── http.ts           # Polite fetch (retry/backoff) for the unattended crawl
    ├── d1.ts             # D1 pre-reads (existing meta, payloads, last good rows) via wrangler
    └── sql.ts            # out.sql generation (mirrors SQL.upsert/SQL.history; reuses SyncRecord)
.github/workflows/        # publish-mcp.yml (registry) + ingest-ecidadania.yml (weekly D1 corpus load)
migrations/               # D1 schema (0001 tables, 0002 indexes) for the e-Cidadania pipeline
tests/                    # Vitest unit tests mirroring src/ (parsers, cache, throttle, auth, scraper,
                          # pipeline/anomaly/store, listing/sql/highlights, plus e-Cidadania contract tests)
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SENADO_BASE_URL` | No | `https://legis.senado.leg.br/dadosabertos` | Legislative API base URL |
| `SENADO_ADM_BASE_URL` | No | `https://adm.senado.gov.br/adm-dadosabertos` | Administrative API base URL |
| `ALLOWED_ORIGIN` | No | `*` | CORS allowed origin |
| `API_KEY` | No (secret) | — | When set, requires `Authorization: Bearer <key>` on all requests except `/health`, `/metrics`, and CORS preflight |
| `CACHE_KV` | Yes (binding) | — | KV namespace for L2 cache |
| `ECIDADANIA_DB` | Yes (binding) | — | D1 database for the e-Cidadania pipeline (list persistence + history) |
| `ECIDADANIA_CORPUS_STALE_MAX_MIN` | No | `14400` | Staleness window (minutes, ~10d) for the weekly full corpora (all e-Cidadania entities) — served flagged, never collapsed to highlights |
| `ECIDADANIA_CORPUS_MIN_PCT` | No | `80` | Catastrophic floor for the off-Worker corpus jobs: a complete crawl/parse below this % of the last good corpus is rejected |
| `CLOUDFLARE_API_TOKEN` | No (secret) | — | GitHub Actions secret (D1 edit scope) for the weekly corpus ingestion job; not used by the Worker |
| `CLOUDFLARE_ACCOUNT_ID` | No (Actions var) | — | GitHub Actions repo variable so wrangler skips `/memberships` account auto-discovery (a D1-scoped token can't read it); required alongside `CLOUDFLARE_API_TOKEN` in the ingestion job |
| `SENADO_ANALYTICS` | No (binding) | — | Analytics Engine dataset for per-tool call telemetry |

## Connecting MCP Clients

This is a **remote** server (Streamable HTTP, no install, open access) — point any MCP client at
`https://senado.sidneybissoli.com/mcp`. Besides 66 tools, it exposes **prompts** (ready-made pt-BR
workflows: `senado_gastos_senador`, `senado_tramitacao_materia`, `senado_votos_senador`,
`senado_panorama_ecidadania`) and **resources** (`senado://guia`, `senado://catalogo`,
`senado://glossario`, `senado://tabelas/tipos-materia`, `senado://tabelas/ufs`).

### One-click (LobeHub)

Install from the LobeHub marketplace — open the
[server page](https://lobehub.com/mcp/sidneybissoli-senado-br-mcp-cloudflare) and click **Install**
(it pre-fills the remote endpoint, no config needed).

### Claude Desktop / Claude Code

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "senado-br": {
      "url": "https://senado.sidneybissoli.com/mcp"
    }
  }
}
```

For command-based clients (or any client without native remote support), use the `mcp-remote` bridge:

```json
{
  "mcpServers": {
    "senado-br": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://senado.sidneybissoli.com/mcp"]
    }
  }
}
```

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector https://senado.sidneybissoli.com/mcp
```

## License

MIT

## Credits

Icon: *"Amanhecer no Congresso Nacional"* — photograph of the Brazilian National
Congress, used under a Creative Commons license. (If you are the author, open an
issue so we can add full attribution / the license link.)
