# senado-br-mcp (Cloudflare Workers)

MCP server for **Brazilian Senate open data** running on Cloudflare Workers with Streamable HTTP transport.

Provides **53 tools** organized into 13 groups covering senators, bills, votes, committees, plenary sessions, legislative processes, reference data, citizen participation (e-Cidadania), speeches, parliamentary blocs and leadership, budget amendments, federal legislation, and committee voting. Connects directly to the [Senado Federal Dados Abertos API](https://legis.senado.leg.br/dadosabertos/) and the e-Cidadania portal.

## Architecture

- **Runtime:** Cloudflare Workers (ESM)
- **Transport:** Streamable HTTP (MCP spec 2025-03-26) via `createMcpHandler` from `agents/mcp`
- **Protocol:** MCP over JSON-RPC — single `/mcp` endpoint handles POST, GET, DELETE
- **SDK:** `@modelcontextprotocol/sdk` 1.26.0+ (per-request McpServer instances)
- **Validation:** Zod schemas for all tool inputs
- **Caching:** 2-layer (L0 memory + L1 Cache API) with SHA-256 keying
- **Rate limiting:** Token bucket — global (8 req/s) + per-client (2 req/s)
- **Upstream throttle:** Max 6 concurrent requests, 10s timeout, retry with exponential backoff
- **Auth:** Optional Bearer token (set the `API_KEY` secret; open access when unset). Constant-time comparison.
- **Observability:** Structured JSON logging + in-memory counters exposed at `/metrics`
- **Tests:** Vitest unit tests for parsers, helpers, cache, throttle, and auth

## Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) v4+
- Cloudflare account

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create KV namespace

```bash
# Create the KV namespace
wrangler kv namespace create CACHE_KV

# Note the ID from the output, e.g.:
# { binding = "CACHE_KV", id = "abc123..." }
```

### 3. Configure wrangler.toml

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

### 4. (Optional) Enable authentication

```bash
wrangler secret put API_KEY
# Clients must then send: Authorization: Bearer <key>
# When API_KEY is not set, the server is open access.
```

### 5. Local development

```bash
npm run dev
# Server runs at http://localhost:8787
```

### 6. Tests and typecheck

```bash
npm test             # run all tests once
npm run test:watch   # watch mode
npm run typecheck    # tsc --noEmit
```

### 7. Deploy

```bash
npm run deploy
# Deploys to https://senado-br-mcp.<your-subdomain>.workers.dev
```

## Endpoints

| Path | Methods | Description |
|------|---------|-------------|
| `/mcp` | POST, GET, DELETE, OPTIONS | MCP Streamable HTTP endpoint (managed by `createMcpHandler`) |
| `/health` | GET | Health check — returns `ok` (always public) |
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
    "name": "senado_votacoes_recentes",
    "arguments": {
      "dias": 30
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
    "name": "senado_ecidadania_ideias_populares",
    "arguments": {
      "limite": 5
    }
  }
}
```

## Upstream API Endpoints

The server consumes two classes of upstream endpoints from the Senado API:

### Legacy endpoints (`.json` suffix, PascalCase responses)

Used by Groups A, B, H, I, J, K, L, M and parts of D/E/F. The `.json` suffix is appended automatically by `upstream.ts`.

| Upstream path | Used by |
|---------------|---------|
| `/senador/lista/atual` | `senado_listar_senadores` |
| `/senador/{codigo}` | `senado_obter_senador`, `senado_senador_detail` |
| `/senador/{codigo}/votacoes` | `senado_votacoes_senador` |
| `/materia/pesquisa/lista` | `senado_buscar_materias` |
| `/materia/{codigo}` | `senado_obter_materia`, `senado_tramitacao_materia` |
| `/materia/textos/{codigo}` | `senado_textos_materia` |
| `/materia/votacoes/{codigo}` | `senado_votos_materia` |
| `/comissao/lista/colegiados` | `senado_listar_comissoes` (+ sigla-to-code resolution) |
| `/comissao/{codigo}` | `senado_obter_comissao` (numeric code, not sigla) |
| `/composicao/comissao/{codigo}` | `senado_membros_comissao` |
| `/comissao/agenda/{data}` | `senado_agenda_comissoes` |
| `/comissao/agenda/{dataInicio}/{dataFim}` | `senado_reunioes_comissao` |
| `/plenario/agenda/dia/{data}` | `senado_agenda_plenario` |
| `/senador/{codigo}/discursos` | `senado_discursos_senador` |
| `/plenario/lista/discursos/{dataInicio}/{dataFim}` | `senado_discursos_plenario` |
| `/discurso/texto-integral/{codigo}` | `senado_discurso_texto` (plain text, fetched directly) |
| `/senador/lista/tiposUsoPalavra` | `senado_tipos_uso_palavra` |
| `/composicao/lista/blocos` | `senado_listar_blocos` |
| `/composicao/bloco/{codigo}` | `senado_obter_bloco` |
| `/composicao/lideranca` | `senado_liderancas` |
| `/composicao/mesaSF` | `senado_mesa_senado` |
| `/composicao/mesaCN` | `senado_mesa_congresso` |
| `/orcamento/lista` | `senado_orcamento_emendas` |
| `/orcamento/oficios` | `senado_orcamento_oficios` |
| `/legislacao/lista` | `senado_buscar_legislacao` |
| `/legislacao/{codigo}` | `senado_obter_legislacao` |
| `/legislacao/tiposNorma` | `senado_tipos_norma` |
| `/votacaoComissao/comissao/{sigla}` | `senado_votacao_comissao` |
| `/votacaoComissao/parlamentar/{codigo}` | `senado_votacao_comissao_senador` |

### New v3 endpoints (flat JSON arrays/objects, camelCase)

Used by Groups C, D (D1/D2/D3/D5). Dates must be in **ISO format** (`YYYY-MM-DD`).

| Upstream path | Used by |
|---------------|---------|
| `/votacao` | `senado_listar_votacoes`, `senado_votacoes_recentes`, `senado_obter_votacao`, `senado_search_votacoes` |
| `/processo` | `senado_search_processos` |
| `/processo/{id}` | `senado_obter_processo` |

### e-Cidadania (HTML scraping + internal REST)

List tools use internal REST APIs (`restcolecaomaismateria`, `restcolecaomaisideia`, `restcolecaomaisaudiencia`) that return clean JSON. Detail tools scrape HTML with CSS-class-targeted regex.

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

## Tool Inventory

### Group H — Reference/Metadata (4 tools)

| Tool | Description |
|------|-------------|
| `senado_legislatura_atual` | Current legislature info (number, period, dates) |
| `senado_tipos_materia` | Valid legislative matter types with codes and descriptions |
| `senado_partidos` | Parties with current Senate representation |
| `senado_ufs` | States with count of sitting senators |

### Group A — Senators (5 tools)

| Tool | Description |
|------|-------------|
| `senado_listar_senadores` | List sitting senators, filter by state and party |
| `senado_buscar_senador_por_nome` | Search senators by name (Unicode-normalized fuzzy match) |
| `senado_obter_senador` | Detailed senator info: bio, mandates, committees |
| `senado_votacoes_senador` | How a senator voted on each matter (by year/period) |
| `senado_senador_detail` | Aggregated detail: mandates, affiliations, profession |

### Group B — Bills/Matters (4 tools)

| Tool | Description |
|------|-------------|
| `senado_buscar_materias` | Search bills by type, number, year, keyword, author, rapporteur |
| `senado_obter_materia` | Full bill details: summary, authorship, status, rapporteur |
| `senado_tramitacao_materia` | Chronological bill processing history |
| `senado_textos_materia` | Available bill texts (initial, substitute, final) with download URLs |

### Group C — Processes (2 tools)

| Tool | Description |
|------|-------------|
| `senado_search_processos` | Search legislative processes (complementary to bill search) |
| `senado_obter_processo` | Full details of a specific legislative process |

### Group D — Votes (5 tools)

| Tool | Description |
|------|-------------|
| `senado_listar_votacoes` | Plenary votes by year, filterable by month/period. Uses the `/votacao` endpoint with ISO dates. |
| `senado_votacoes_recentes` | Most recent plenary votes (last N days) |
| `senado_obter_votacao` | Vote details with individual senator roll call. Accepts `codigoSessao` (plenary session code). |
| `senado_votos_materia` | Voting results for a specific bill (via legacy `/materia/votacoes/{codigo}`) |
| `senado_search_votacoes` | Flexible vote search by process, bill, senator, period |

### Group E — Committees (5 tools)

| Tool | Description |
|------|-------------|
| `senado_listar_comissoes` | List active committees from `/comissao/lista/colegiados` |
| `senado_obter_comissao` | Committee details: chair, vice-chair, member counts. Resolves sigla to numeric code internally. |
| `senado_membros_comissao` | Current committee members via `/composicao/comissao/{codigo}` |
| `senado_reunioes_comissao` | Committee meetings from `/comissao/agenda` filtered by sigla. Handles cross-year date ranges automatically. |
| `senado_agenda_comissoes` | Committee meeting schedule for a specific date |

### Group F — Plenary (1 tool)

| Tool | Description |
|------|-------------|
| `senado_agenda_plenario` | Plenary session schedule via `/plenario/agenda/dia/{data}` |

### Group G — e-Cidadania (11 tools)

| Tool | Description |
|------|-------------|
| `senado_ecidadania_listar_consultas` | Public consultations with citizen voting |
| `senado_ecidadania_obter_consulta` | Consultation details: votes, author, comments |
| `senado_ecidadania_consultas_polarizadas` | Consultations with balanced (~50/50) voting — polarized topics |
| `senado_ecidadania_consultas_consensuais` | Consultations with high agreement (>85%) — consensus topics |
| `senado_ecidadania_listar_ideias` | Citizen-proposed legislative ideas |
| `senado_ecidadania_obter_ideia` | Idea details: description, endorsements, conversion status |
| `senado_ecidadania_ideias_populares` | Most endorsed citizen ideas |
| `senado_ecidadania_listar_eventos` | Interactive events: public hearings, confirmations, lives |
| `senado_ecidadania_obter_evento` | Event details: agenda, guests, video link |
| `senado_ecidadania_eventos_populares` | Events with most citizen comments and questions |
| `senado_ecidadania_sugerir_tema_enquete` | Suggests monthly poll topics based on configurable criteria |

### Group I — Speeches (4 tools)

| Tool | Description |
|------|-------------|
| `senado_discursos_senador` | Speeches by a specific senator, filterable by period and house (SF/CN) |
| `senado_discursos_plenario` | All plenary speeches in a date range |
| `senado_discurso_texto` | Full text of a specific speech (plain-text endpoint) |
| `senado_tipos_uso_palavra` | Available speech types ("tipos de uso da palavra") |

### Group J — Blocs & Leadership (5 tools)

| Tool | Description |
|------|-------------|
| `senado_listar_blocos` | Parliamentary blocs and their member parties |
| `senado_obter_bloco` | Details of a specific parliamentary bloc |
| `senado_liderancas` | Senate/Congress leaderships (leaders, vice-leaders), filterable |
| `senado_mesa_senado` | Senate directing board (Mesa Diretora) members |
| `senado_mesa_congresso` | National Congress directing board members |

### Group K — Budget (2 tools)

| Tool | Description |
|------|-------------|
| `senado_orcamento_emendas` | Budget amendment batches |
| `senado_orcamento_oficios` | Support letters (ofícios) for budget amendments |

### Group L — Federal Law (3 tools)

| Tool | Description |
|------|-------------|
| `senado_buscar_legislacao` | Search federal legal norms by type, number, year, or date (at least one required) |
| `senado_obter_legislacao` | Details of a specific federal norm |
| `senado_tipos_norma` | Available norm types (LEI, DEC, LCP, EMC, etc.) |

### Group M — Committee Voting (2 tools)

| Tool | Description |
|------|-------------|
| `senado_votacao_comissao` | Votes held in a specific committee, filterable by period |
| `senado_votacao_comissao_senador` | A senator's committee votes, filterable by committee and period |

**Total: 53 tools**

## Project Structure

```
src/
├── index.ts              # Worker entrypoint (fetch handler)
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
├── utils/
│   ├── logger.ts         # Structured JSON logging
│   └── validation.ts     # toolResult, toolError, errorFrom, buildParams, ensureArray helpers
└── tools/
    ├── referencia.ts        # Group H — 4 reference/metadata tools
    ├── senadores.ts         # Group A — 5 senator tools
    ├── materias.ts          # Group B — 4 bill/matter tools
    ├── processos.ts         # Group C — 2 process tools
    ├── votacoes.ts          # Group D — 5 vote tools
    ├── comissoes.ts         # Group E — 5 committee tools
    ├── plenario.ts          # Group F — 1 plenary tool
    ├── ecidadania.ts        # Group G — 11 e-Cidadania tools
    ├── discursos.ts         # Group I — 4 speech tools
    ├── composicao.ts        # Group J — 5 bloc/leadership tools
    ├── orcamento.ts         # Group K — 2 budget tools
    ├── legislacao.ts        # Group L — 3 federal law tools
    └── votacao-comissao.ts  # Group M — 2 committee voting tools
tests/                    # Vitest unit tests mirroring src/ (parsers, cache, throttle, auth, utils)
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SENADO_BASE_URL` | No | `https://legis.senado.leg.br/dadosabertos` | Senate API base URL |
| `ALLOWED_ORIGIN` | No | `*` | CORS allowed origin |
| `API_KEY` | No (secret) | — | When set, requires `Authorization: Bearer <key>` on all requests except `/health`, `/metrics`, and CORS preflight |
| `CACHE_KV` | Yes (binding) | — | KV namespace for L2 cache |

## Connecting MCP Clients

### Claude Desktop / Claude Code

Add to your MCP configuration:

```json
{
  "mcpServers": {
    "senado-br": {
      "url": "https://senado-br-mcp.<your-subdomain>.workers.dev/mcp"
    }
  }
}
```

If `API_KEY` is configured, add the auth header:

```json
{
  "mcpServers": {
    "senado-br": {
      "url": "https://senado-br-mcp.<your-subdomain>.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer <your-api-key>"
      }
    }
  }
}
```

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector https://senado-br-mcp.<your-subdomain>.workers.dev/mcp
```

## License

MIT
