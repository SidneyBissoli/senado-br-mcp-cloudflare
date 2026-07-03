# Observabilidade — consultas de uso por tool (Vetor B)

Desenho da camada de **consumo** das métricas de uso do servidor. A coleta já existe
(`src/instrument.ts` grava em Analytics Engine, dataset `senado_mcp_tool_calls`, bindado em
`wrangler.toml` como `SENADO_ANALYTICS`); o que falta é consultar/expor essa série. Este doc
define o modelo de dados, o mecanismo para incluir a dimensão **cache-vs-live** (`fromCache`)
sem PII, e as consultas SQL.

Origem: guia §2 (`docs/_local/guia_melhorias_mcps.md`, planejamento local). Privacidade (LGPD) é bloqueante: só nome da
tool, desfecho ok/erro, classe de cache e contadores — nunca parâmetros, conteúdo de consulta
ou qualquer dado pessoal (ver `src/instrument.ts:18-20`).

## Modelo de dados

**Hoje** (`instrument.ts` → `writeDataPoint`): `indexes:[name]` · `blobs:[name, ok|error]` ·
`doubles:[isError]`.

**Proposta** (acrescenta a dimensão de cache — só contadores e rótulos, zero PII):

| Coluna AE | Conteúdo | Cardinalidade |
|---|---|---|
| `index1` / `blob1` | nome da tool | baixa |
| `blob2` | desfecho: `ok` \| `error` | 2 |
| `blob3` | classe de cache do call: `cached` \| `live` \| `partial` \| `none` | 4 |
| `double1` | flag de erro (0/1) | — |
| `double2` | nº de fetches upstream no call | — |
| `double3` | nº servidos do cache (`fromCache===true`) | — |

Classe de cache por chamada (uma tool pode fazer N fetches — ex.: `obter_materia/detalhe` faz 3):

- `none` — 0 fetches via cache (ex.: tools e-Cidadania que leem D1 direto)
- `cached` — todos os fetches vieram do cache
- `live` — nenhum veio do cache
- `partial` — misto

`double2`/`double3` permitem a razão **fetch-level** agregável (mais robusta que a categórica).

## Captura de `fromCache` (sem poluir a resposta)

`fromCache` nasce dentro de `cachedFetchWithMeta` (fundo da pilha); o `instrumentTool` só vê o
resultado MCP. A ponte é um acumulador por chamada via `AsyncLocalStorage` (`nodejs_compat` está
ligado), num módulo compartilhado para evitar ciclo `manager` ↔ `instrument`:

```ts
// src/observability/call-context.ts
import { AsyncLocalStorage } from "node:async_hooks";
export const callCache = new AsyncLocalStorage<{ fetches: number; hits: number }>();
```

- `instrumentTool` roda o callback dentro de `callCache.run({ fetches: 0, hits: 0 }, () => cb(...))`
  e, no `finally`, lê o acumulador → deriva `blob3`/`double2`/`double3`.
- `cachedFetchWithMeta`, antes de retornar:
  `const s = callCache.getStore(); if (s) { s.fetches++; if (fromCache) s.hits++; }`.

Como o `cachedFetch` data-only delega ao `cachedFetchWithMeta`, **todas** as tools que usam cache
passam a contabilizar automaticamente — não só as 8 da proveniência. É concurrency-safe (ALS é por
contexto async) e fora do caminho crítico (try/catch, como o resto de `instrument.ts`).

## Consultas (Analytics Engine SQL API)

Tabela = nome do dataset (`senado_mcp_tool_calls`). **Sempre pondere por `_sample_interval`** — o
AE amostra sob carga; `SUM(_sample_interval)` é a contagem real estimada.

### A) Uso por tool por dia + taxa de erro — roda já hoje

```sql
SELECT toStartOfDay(timestamp)                          AS day,
       blob1                                            AS tool,
       SUM(_sample_interval)                            AS calls,
       SUM(double1 * _sample_interval)                  AS errors,
       round(SUM(double1 * _sample_interval)
             / SUM(_sample_interval), 4)                AS error_rate
FROM senado_mcp_tool_calls
WHERE timestamp >= NOW() - INTERVAL '30' DAY
GROUP BY day, tool
ORDER BY day DESC, calls DESC
```

### B) Ranking de adoção + participação % — roda já hoje

Alimenta a decisão npm do Vetor D (§4.2) e a Δ-token amortizada do §1.7 (pesar o envelope de
proveniência pelo mix real de chamadas).

```sql
SELECT blob1                                            AS tool,
       SUM(_sample_interval)                            AS calls,
       round(100.0 * SUM(_sample_interval)
             / (SELECT SUM(_sample_interval) FROM senado_mcp_tool_calls
                WHERE timestamp >= NOW() - INTERVAL '30' DAY), 2) AS pct_share
FROM senado_mcp_tool_calls
WHERE timestamp >= NOW() - INTERVAL '30' DAY
GROUP BY tool
ORDER BY calls DESC
LIMIT 25
```

### C) Cache-vs-live por tool — requer a captura de `fromCache`

```sql
SELECT blob1                                            AS tool,
       SUM(_sample_interval)                            AS calls,
       SUM(double2 * _sample_interval)                  AS upstream_fetches,
       SUM(double3 * _sample_interval)                  AS cache_hits,
       round(SUM(double3 * _sample_interval)
             / nullIf(SUM(double2 * _sample_interval), 0), 4) AS cache_hit_ratio
FROM senado_mcp_tool_calls
WHERE timestamp >= NOW() - INTERVAL '7' DAY
GROUP BY tool
ORDER BY calls DESC
```

### D) Distribuição de classe de cache — requer a captura de `fromCache`

```sql
SELECT blob1 AS tool, blob3 AS cache_class, SUM(_sample_interval) AS calls
FROM senado_mcp_tool_calls
WHERE timestamp >= NOW() - INTERVAL '7' DAY
GROUP BY tool, cache_class
ORDER BY tool, calls DESC
```

### Runner pronto

`scripts/observability/usage-report.mjs` roda as 4 consultas e imprime tabelas. Lê o token de
`CF_API_TOKEN` ou de `.secrets/cf-analytics-token` (gitignored). Ex.: `node scripts/observability/usage-report.mjs`
(ou `... B C`, `... --days 7`, `... --selftest`).

> **Dialeto do AE SQL (achado ao executar, 2026-06-24):** o Analytics Engine aceita só um **subconjunto**
> do ClickHouse. **Sem subquery escalar** (`SELECT … (SELECT …)` → HTTP 422) e **sem `NULLIF`**. Por isso
> o runner tira ambos do SQL: o `pct_share` (B) vem de um `SELECT SUM(...) AS total` separado + divisão em
> JS, e o `cache_hit_ratio` (C) é calculado em JS com guarda de divisão-por-zero. As consultas A/B/C/D acima
> são a **forma conceitual**; a forma executável está no runner.

### Como executar (cru, via API)

Via API (substitua `{account_id}` e use um token com permissão de Account Analytics):

```bash
curl -s "https://api.cloudflare.com/client/v4/accounts/{account_id}/analytics_engine/sql" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  --data-binary "SELECT blob1 AS tool, SUM(_sample_interval) AS calls
                 FROM senado_mcp_tool_calls
                 WHERE timestamp >= NOW() - INTERVAL '7' DAY
                 GROUP BY tool ORDER BY calls DESC"
```

## Caveats

- **Amostragem:** toda contagem ponderada por `_sample_interval` (feito nas consultas). Sem isso,
  subcontagem sob carga.
- **Janela pós-deploy:** `blob3`/`double2`/`double3` só existem em linhas gravadas após o deploy da
  captura. Ao ler C/D, filtre `timestamp >= <deploy>` para a razão não vir diluída por linhas
  antigas (o `nullIf` evita divisão por zero, mas não corrige a janela mista).
- **PII:** nada além de nome da tool, desfecho, classe de cache e contadores. Mantém a garantia de
  `instrument.ts`.
- **Retenção AE:** ~3 meses por padrão.

## Estado

- Consultas **A** e **B**: executáveis desde sempre (a coleta de nome/desfecho já existia).
- Captura de `fromCache` **implementada**: `src/observability/call-context.ts` (ALS), `recordFetch`
  chamado em `cachedFetchWithMeta` e o wrap `callCache.run(...)` em `instrumentTool`, que grava
  `blob3`/`double2`/`double3`. Coberto por testes em `tests/instrument.test.ts`.
- Consultas **C** e **D**: válidas a partir do **deploy** dessa captura — filtre `timestamp >= <deploy>`
  (linhas anteriores não têm a dimensão de cache).
