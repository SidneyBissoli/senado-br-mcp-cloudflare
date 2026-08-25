# Senado-BR-MCP — Migração para Cloudflare Workers (Spec Consolidada)

> **Documento histórico.** É a especificação que originou este repositório: o plano da
> migração do senado-br-mcp (Railway/Node.js) para Cloudflare Workers. Ficou até 25/08/2026
> no repositório `senado-br-mcp`, hoje arquivado e somente leitura, onde ninguém o
> procuraria. Foi movido para cá sem alteração de conteúdo.

## Visão Geral

Reconstruir o conector **senado-br-mcp** como um **Cloudflare Workers MCP Server** que faz proxy da API de Dados Abertos do Senado Federal, **preservando integralmente todas as 33+ tools existentes** e incorporando melhorias arquiteturais propostas.

- **Swagger UI:** <https://legis.senado.leg.br/dadosabertos/api-docs/swagger-ui/index.html>
- **OpenAPI JSON:** <https://legis.senado.leg.br/dadosabertos/v3/api-docs>

### Objetivos

1. Migrar a infraestrutura de Railway/Node.js para Cloudflare Workers (ESM)
2. Manter **cobertura funcional completa** — todas as tools existentes permanecem
3. Adicionar cache em 3 camadas (L0/L1/L2) e rate limiting robusto
4. Operação enxuta, free-tier viable, latência mínima

---

## 1. Hard Constraints

| Regra | Detalhe |
|-------|---------|
| **Runtime** | Cloudflare Workers (ESM). **SEM** Node.js assumptions. **SEM** Express. |
| **Linguagem** | TypeScript |
| **Dependências permitidas** | `@modelcontextprotocol/sdk` (SDK oficial MCP), `agents` (Cloudflare — `createMcpHandler`), `zod` (validação de schemas). Minimizar qualquer dependência além destas três. |
| **Arquitetura** | Single Worker entrypoint usando `createMcpHandler` do pacote `agents/mcp` com `McpServer` do SDK oficial. Padrão: `export default { fetch: (req, env, ctx) => createMcpHandler(server)(req, env, ctx) }` |
| **Transporte MCP** | **Streamable HTTP** (spec MCP 2025-03-26) — substitui SSE (deprecated). O `createMcpHandler` gerencia o transporte automaticamente via endpoint único `/mcp`. |
| **CORS** | Suporte a clientes WebLLM no browser; implementar preflight `OPTIONS`. |
| **Proibições** | NÃO usar Durable Objects, Agent class stateful (`McpAgent`), containers ou databases. O uso de `createMcpHandler` (função leve do Agents SDK) **É permitido** — ele não requer Durable Objects. |
| **Proxy aberto** | NÃO criar open proxy. Apenas rotas mapeadas para tools via allowlist estrita. |

### 1.1 Safeguards de segurança e performance

- Max inbound JSON body size: **256 KB**
- Max upstream response size: **2 MB** (rejeitar se maior)
- Upstream timeout: **10 segundos** (via `AbortController`)
- Output: request/return JSON. Forçar `Accept: application/json`. Se endpoint suportar sufixo `.json`, preferir.

---

## 2. Environment

Base upstream default: `https://legis.senado.leg.br/dadosabertos`

```typescript
interface Env {
  CACHE_KV: KVNamespace;
  ALLOWED_ORIGIN?: string;      // default "*"
  SENADO_BASE_URL?: string;     // default como acima
}
```

---

## 3. Routing

| Método | Path | Ação |
|--------|------|------|
| `GET` | `/health` | Retorna `"ok"` |
| `POST` | `/mcp` | Streamable HTTP — envio de mensagens MCP (initialize, tools/list, tools/call, etc.) |
| `GET` | `/mcp` | Streamable HTTP — estabelece stream SSE para notificações server→client (gerenciado pelo `createMcpHandler`) |
| `DELETE` | `/mcp` | Streamable HTTP — encerramento de sessão (opcional, gerenciado pelo `createMcpHandler`) |
| `OPTIONS` | `/*` | CORS preflight |

> **Nota:** O `createMcpHandler` gerencia internamente o roteamento de POST/GET/DELETE em `/mcp`, incluindo session management via header `Mcp-Session-Id`. O Worker só precisa delegar para o handler.

**Nenhum outro endpoint público.**

---

## 4. Upstream Throttle + Retries

A API do Senado documenta restrição de requisições: >10 req/s pode gerar 429; alta demanda pode gerar 503.

### 4.1 Global Limiter (por isolate)

- Token bucket + max concurrent upstream in-flight (4–8)

### 4.2 Per-Client Limiter

- Token bucket keyed por hash da identidade do client
- Storage primário: **in-memory `Map`** (evitar writes no KV)
- Em caso de abuso repetido **apenas**: write de flag coarse `cooldownUntil` no KV (writes raros)

### 4.3 Retry / Backoff em 429/503

- Bounded exponential backoff + jitter
- Max **2 retries** total
- Respeitar timeout total upstream de 10s
- Retornar MCP errors retryable quando esgotado

---

## 5. Caching — Estratégia em 3 Camadas

> **Princípio:** Cache API primário, KV secundário. Cache API não replica fora do datacenter de origem — design deve funcionar corretamente com hit rate best-effort.

### L0 — In-memory Isolate Cache

- `Map` com TTL para hot keys
- Zero operações externas

### L1 — Cloudflare Cache API (`caches.default`) — **PRIMÁRIO**

Cache principal para respostas de tools e para caching nativo de `POST /mcp`.

#### A) Para upstream GETs de tools

1. Construir URL upstream canônica com query params sorted
2. Criar um `Request` cache key sintético (método `GET`) mesmo que a chamada interna use fetch
3. `cache.match(cacheKey)` → se miss, fetch upstream, então `cache.put(cacheKey, response.clone())`
4. Setar `Cache-Control`/TTL no cached Response (ex: `max-age=30..120`)

#### B) Para caching de `POST /mcp`

Cachear **apenas** quando a request for segura para cache:

- `tools/list`
- `tools/call` onde a tool é GET-like e considerada cacheável (pública, determinística, TTL curto)

**Procedimento:**

1. Computar hash SHA-256 do body (ou de `{method, toolName, canonicalized args}`)
2. Construir URL sintética de cache: `https://<host>/__mcp_cache/<tool>/<hash>`
3. Criar `cacheKey = new Request(cacheUrl, { method: "GET", headers: request.headers })`
4. Usar `caches.default.match/put` para cachear a response
5. **TTL curto obrigatório** para evitar dados legislativos stale (15–60s para maioria das tools)
6. **NÃO** cachear error responses nem responses oversized

### L2 — Cloudflare KV — **MÍNIMO e FREE-TIER FRIENDLY**

**Limites free-tier KV:** Reads 100k/dia, Writes 1k/dia, Deletes 1k/dia, Lists 1k/dia, Storage 1 GB.

Usar KV **apenas** para itens LOW-WRITE:

1. Cache do OpenAPI JSON (TTL ~10–60 minutos)
2. Cache da lista derivada de tool metadata (TTL ~10–60 minutos)
3. Flags raras de cooldown por abuso (write apenas em abuso repetido)

**Proibições KV:**

- NÃO fazer per-request counters no KV
- NÃO usar `list`/`delete` em operação normal

---

## 6. MCP Protocol — Streamable HTTP

### 6.1 Transporte

O servidor utiliza **Streamable HTTP** (spec MCP 2025-03-26), o padrão atual que substituiu SSE. O transporte opera via endpoint único `/mcp` que aceita POST, GET e DELETE.

O `createMcpHandler` do pacote `agents/mcp` (Cloudflare) gerencia todo o protocolo automaticamente — incluindo JSON-RPC, inicialização, session management e streaming de respostas via SSE quando necessário.

### 6.2 Implementação base

```typescript
import { createMcpHandler } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const server = new McpServer({
  name: "senado-br-mcp",
  version: "2.0.0",
});

// Registrar cada tool via server.registerTool()
server.registerTool(
  "senado_listar_senadores",
  {
    description: "Lista senadores em exercício...",
    inputSchema: {
      uf: z.string().optional(),
      partido: z.string().optional(),
    },
  },
  async (args) => {
    // implementação com cache + upstream fetch
    return { content: [{ type: "text", text: JSON.stringify(result) }] };
  },
);

// Worker entrypoint
export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => {
    // Rota /health separada
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response("ok", { status: 200 });
    }
    // Delegar todo o resto ao MCP handler (inclui CORS, /mcp POST/GET/DELETE)
    return createMcpHandler(server)(request, env, ctx);
  },
};
```

### 6.3 Compatibilidade

- **Claude, Cursor, Windsurf, VS Code, AI Playground** — todos suportam Streamable HTTP nativamente
- **Clients legados (SSE only)** — o `createMcpHandler` oferece backward compatibility automática conforme documentação da Cloudflare. Verificar via Context7 se suporte a SSE legado está incluso ou requer `McpAgent`.

### 6.4 Operações MCP suportadas

- `initialize` / `initialized` (handshake)
- `tools/list` (listagem das 37 tools)
- `tools/call` (execução de tool com validação via zod)
- Session management via `Mcp-Session-Id` header

---

## 7. Tools — Inventário Completo

> **REGRA FUNDAMENTAL:** Todas as 33 tools existentes do projeto atual devem ser preservadas. A migração é de infraestrutura, não de funcionalidade. Além disso, tools novas propostas na revisão arquitetural devem ser incorporadas quando trazem valor adicional.
>
> **OBRIGATÓRIO:** Consultar <https://legis.senado.leg.br/dadosabertos/v3/api-docs> para confirmar endpoints, parâmetros e formatos de response.

### 7.0 Diretrizes gerais para todas as tools

Para **cada** tool, implementar:

- `name`, `description` (incluir exemplos de uso), `inputSchema` (JSON Schema)
- Validação estrita + allowlist de params; rejeitar keys desconhecidas
- Mapping de implementação para endpoint upstream + query param mapping
- Marcar se tool é `cacheable` e seu TTL
- Classificar a tool em uma categoria (ver abaixo)

### Categorias de cache por tipo de dado

| Categoria | TTL L0 | TTL L1 | Exemplos |
|-----------|--------|--------|----------|
| **Estática** (muda raramente) | 5 min | 10 min | `senado_partidos`, `senado_ufs`, `senado_tipos_materia`, `senado_legislatura_atual` |
| **Semi-estática** (muda diariamente) | 2 min | 5 min | `senado_listar_senadores`, `senado_listar_comissoes`, `senado_obter_comissao`, `senado_membros_comissao` |
| **Dinâmica** (muda frequentemente) | 30s | 60s | Agendas, votações recentes, tramitações, e-Cidadania |
| **Sob demanda** (parametrizada) | 30s | 60s | Buscas por matéria, votações de senador, detalhes específicos |

---

### GRUPO A — Senadores (5 tools)

#### A1. `senado_listar_senadores` *(existente — manter)*

- **Descrição:** Lista senadores em exercício ou de uma legislatura específica. Pode filtrar por UF e partido.
- **Endpoint:** `GET /senador/lista/atual` (ou `/senador/lista/legislatura/{legislatura}`)
- **Parâmetros:** `emExercicio` (boolean, default true), `legislatura` (int), `partido` (string), `uf` (string, 2 chars)
- **Cache:** Semi-estática (2 min L0, 5 min L1)
- **Nota de melhoria:** Aplicar filtragem server-side (name contains, UF, party) sobre a lista base cacheada, conforme sugerido na revisão, para reduzir chamadas upstream.

#### A2. `senado_buscar_senador_por_nome` *(existente — manter)*

- **Descrição:** Busca senadores por nome (útil quando não se tem o código). Retorna lista de correspondentes.
- **Endpoint:** `GET /senador/lista/atual` com filtragem server-side por nome
- **Parâmetros:** `nome` (string, required, minLength 2)
- **Cache:** Reutilizar cache da lista base de A1 + cache L1 do resultado filtrado (30s)

#### A3. `senado_obter_senador` *(existente — manter)*

- **Descrição:** Informações detalhadas de um senador específico, incluindo dados biográficos, mandatos e comissões.
- **Endpoint:** `GET /senador/{codigo}`
- **Parâmetros:** `codigoSenador` (int, required)
- **Cache:** Sob demanda (30s L0, 120s L1)
- **Nota de melhoria:** Considerar agregar dados de endpoints auxiliares (`/mandatos`, `/filiacoes`, `/profissao`) numa response enriquecida, conforme sugerido na revisão. Implementar como campos opcionais adicionais se os endpoints existirem.

#### A4. `senado_votacoes_senador` *(existente — manter)*

- **Descrição:** Lista votações de um senador específico, mostrando como votou em cada matéria.
- **Endpoint:** `GET /senador/{codigo}/votacoes`
- **Parâmetros:** `codigoSenador` (int, required), `ano` (int), `dataInicio` (YYYYMMDD), `dataFim` (YYYYMMDD)
- **Cache:** Dinâmica (30s L0, 60s L1)

#### A5. `senado_senador_detail` *(NOVA — adicionar)*

- **Descrição:** Visão agregada e enriquecida de um senador, combinando mandatos, filiações e profissão numa única chamada. Complementa `senado_obter_senador` com dados que exigiriam múltiplas chamadas separadas.
- **Endpoints agregados:**
  - `GET /senador/{codigo}/mandatos`
  - `GET /senador/{codigo}/filiacoes`
  - `GET /senador/{codigo}/profissao` (se disponível na API)
- **Parâmetros:** `codigoSenador` (int, required)
- **Cache:** Sob demanda (30s L0, 120s L1)
- **Nota:** Verificar existência real desses endpoints na OpenAPI. Se `/profissao` não existir, omitir gracefully.

---

### GRUPO B — Matérias Legislativas (5 tools)

#### B1. `senado_buscar_materias` *(existente — manter)*

- **Descrição:** Busca matérias legislativas por diversos critérios: tipo (PEC, PL, PLP, MPV), número, ano, palavras-chave, autor ou relator.
- **Endpoint:** `GET /materia/pesquisa/lista` (ou endpoint equivalente confirmado na OpenAPI)
- **Parâmetros:** `sigla` (string), `numero` (int), `ano` (int), `palavraChave` (string), `autorNome` (string), `relatorNome` (string), `tramitando` (boolean)
- **Cache:** Sob demanda (30s L0, 60s L1), canonicalizar query params

#### B2. `senado_obter_materia` *(existente — manter)*

- **Descrição:** Detalhes completos de uma matéria legislativa, incluindo ementa, autoria, situação atual e relator.
- **Endpoint:** `GET /materia/{codigo}`
- **Parâmetros:** `codigoMateria` (int, required)
- **Cache:** Sob demanda (30s L0, 120s L1)

#### B3. `senado_tramitacao_materia` *(existente — manter)*

- **Descrição:** Histórico de tramitação de uma matéria, mostrando todas as movimentações em ordem cronológica.
- **Endpoint:** `GET /materia/movimentacoes/{codigo}` (ou extrair da response de detalhe se o endpoint for deprecated)
- **Parâmetros:** `codigoMateria` (int, required)
- **Cache:** Dinâmica (30s L0, 60s L1)
- **Nota de melhoria:** Conforme revisão, preferir extrair a seção de tramitação/movimentações do endpoint de detalhe do processo se disponível, evitando endpoints deprecated.

#### B4. `senado_textos_materia` *(existente — manter)*

- **Descrição:** Obtém textos disponíveis de uma matéria (inicial, substitutivo, final) com URLs para download.
- **Endpoint:** `GET /materia/textos/{codigo}`
- **Parâmetros:** `codigoMateria` (int, required)
- **Cache:** Sob demanda (60s L0, 120s L1) — textos mudam pouco

#### B5. `senado_tipos_materia` *(existente — manter)*

- **Descrição:** Lista os tipos de matérias legislativas válidos com sigla, nome completo e descrição. Útil para usar em buscas.
- **Endpoint:** `GET /materia/tipos`
- **Parâmetros:** nenhum
- **Cache:** Estática (5 min L0, 10 min L1)

---

### GRUPO C — Matérias via Processo (2 tools — NOVAS)

> **Nota:** A revisão arquitetural propõe usar endpoints de `/processo` (operationId `processos` e `detalhesProcesso`) como alternativa ou complemento aos endpoints de `/materia`. Verificar na OpenAPI se esses endpoints existem e qual o mapeamento correto. Se `/processo` não existir como rota válida, adaptar para o endpoint correto.

#### C1. `senado_search_processos` *(NOVA — adicionar)*

- **Descrição:** Busca processos legislativos usando o endpoint de processos da API. Oferece parâmetros de busca diferentes/complementares ao `senado_buscar_materias`.
- **Endpoint:** `GET /processo` (`operationId: "processos"`) — **verificar na OpenAPI**
- **Parâmetros (subset seguro):**
  - `sigla` (string), `numero` (int), `ano` (int)
  - `autor` (string), `codigoParlamentarAutor` (int)
  - `tramitando` (`"S"`/`"N"`)
  - `dataInicioApresentacao`/`dataFimApresentacao` (date string)
  - `dataInicioDeliberacao`/`dataFimDeliberacao` (date string)
  - `idProcesso` (array of int, max 100)
- **Cache:** Sob demanda (15s L0, 60s L1), canonicalizar query params
- **Nota:** Se `/processo` não existir na API, **não implementar** esta tool.

#### C2. `senado_obter_processo` *(NOVA — adicionar)*

- **Descrição:** Detalhes de um processo legislativo específico, incluindo tramitação completa.
- **Endpoint:** `GET /processo/{id}` (`operationId: "detalhesProcesso"`) — **verificar na OpenAPI**
- **Parâmetros:** `idProcesso` (int, required)
- **Cache:** Sob demanda (30s L0, 120s L1)
- **Nota:** Se `/processo/{id}` não existir na API, **não implementar** esta tool.

---

### GRUPO D — Votações (5 tools)

#### D1. `senado_listar_votacoes` *(existente — manter)*

- **Descrição:** Lista votações do plenário do Senado por ano, podendo filtrar por mês ou período específico.
- **Endpoint:** `GET /votacao/lista/{ano}` (ou equivalente)
- **Parâmetros:** `ano` (int, required), `mes` (int, 1-12), `dataInicio` (YYYYMMDD), `dataFim` (YYYYMMDD)
- **Cache:** Dinâmica (30s L0, 60s L1)

#### D2. `senado_votacoes_recentes` *(existente — manter)*

- **Descrição:** Obtém as votações mais recentes do plenário (últimos N dias).
- **Endpoint:** Derivado de `senado_listar_votacoes` com cálculo de datas ou endpoint específico
- **Parâmetros:** `dias` (int, default 7, max 365)
- **Cache:** Dinâmica (30s L0, 60s L1)

#### D3. `senado_obter_votacao` *(existente — manter)*

- **Descrição:** Detalhes de uma votação específica, incluindo votos nominais de cada senador.
- **Endpoint:** `GET /votacao/{codigo}`
- **Parâmetros:** `codigoVotacao` (int, required)
- **Cache:** Sob demanda (30s L0, 120s L1)

#### D4. `senado_votos_materia` *(existente — manter)*

- **Descrição:** Resultado de votações de uma matéria, incluindo placar e votos nominais quando disponíveis.
- **Endpoint:** `GET /materia/{codigo}/votacoes` (ou equivalente)
- **Parâmetros:** `codigoMateria` (int, required)
- **Cache:** Sob demanda (30s L0, 120s L1)

#### D5. `senado_search_votacoes` *(NOVA — adicionar)*

- **Descrição:** Busca votações por múltiplos critérios combinados: período, processo, matéria, parlamentar e tipo de voto. Mais flexível que `senado_listar_votacoes`.
- **Endpoint:** `GET /votacao` (`operationId: "votacoes"`) — **verificar na OpenAPI**
- **Parâmetros (subset seguro):**
  - `dataInicio`, `dataFim` (date string)
  - `idProcesso` (int64), `codigoMateria` (int64)
  - `sigla` (string), `numero` (int), `ano` (int)
  - `codigoParlamentar` (int64), `siglaVotoParlamentar` (string)
- **Cache:** Sob demanda (15s L0, 60s L1)
- **Nota:** Se este endpoint não existir separado de `/votacao/lista/{ano}`, **não implementar** e manter apenas D1.

---

### GRUPO E — Comissões (5 tools)

#### E1. `senado_listar_comissoes` *(existente — manter)*

- **Descrição:** Lista comissões do Senado. Pode filtrar por tipo (permanente, temporária, CPI, mista) e status (ativa/inativa).
- **Endpoint:** `GET /comissao/lista`
- **Parâmetros:** `tipo` (enum: permanente, temporaria, cpi, mista), `ativa` (boolean)
- **Cache:** Semi-estática (2 min L0, 5 min L1)

#### E2. `senado_obter_comissao` *(existente — manter)*

- **Descrição:** Detalhes de uma comissão, incluindo presidente, vice-presidente e finalidade.
- **Endpoint:** `GET /comissao/{sigla}`
- **Parâmetros:** `sigla` (string, required, minLength 2)
- **Cache:** Semi-estática (2 min L0, 5 min L1)

#### E3. `senado_membros_comissao` *(existente — manter)*

- **Descrição:** Lista membros atuais de uma comissão, incluindo cargo (presidente, vice, titular, suplente).
- **Endpoint:** `GET /comissao/{sigla}/membros`
- **Parâmetros:** `sigla` (string, required, minLength 2)
- **Cache:** Semi-estática (2 min L0, 5 min L1)

#### E4. `senado_reunioes_comissao` *(existente — manter)*

- **Descrição:** Lista reuniões agendadas ou realizadas de uma comissão, com data, hora, local e pauta.
- **Endpoint:** `GET /comissao/{sigla}/reunioes`
- **Parâmetros:** `sigla` (string, required), `dataInicio` (YYYYMMDD), `dataFim` (YYYYMMDD)
- **Cache:** Dinâmica (30s L0, 60s L1)

#### E5. `senado_agenda_comissoes` *(existente — manter)*

- **Descrição:** Obtém agenda de reuniões das comissões do Senado. Pode filtrar por data e comissão específica.
- **Endpoint:** `GET /agendaReuniao/lista`
- **Parâmetros:** `data` (YYYYMMDD), `siglaComissao` (string, minLength 2)
- **Cache:** Dinâmica (30s L0, 60s L1)

---

### GRUPO F — Plenário e Agenda (1 tool)

#### F1. `senado_agenda_plenario` *(existente — manter)*

- **Descrição:** Obtém agenda de sessões do plenário do Senado, incluindo pauta com matérias a serem votadas.
- **Endpoint:** `GET /plenario/agenda/lista` (ou equivalente)
- **Parâmetros:** `data` (YYYYMMDD), `dataInicio` (YYYYMMDD), `dataFim` (YYYYMMDD)
- **Cache:** Dinâmica (30s L0, 60s L1)

---

### GRUPO G — e-Cidadania (11 tools)

#### G1. `senado_ecidadania_listar_consultas` *(existente — manter)*

- **Descrição:** Lista consultas públicas do e-Cidadania com votação cidadã sobre matérias em tramitação.
- **Parâmetros:** `limite` (int, default 20, max 100), `pagina` (int, default 1), `status` (enum: aberta, encerrada, todas)
- **Cache:** Dinâmica (30s L0, 60s L1)

#### G2. `senado_ecidadania_obter_consulta` *(existente — manter)*

- **Descrição:** Detalhes de uma consulta pública específica, incluindo votos, autor e comentários.
- **Parâmetros:** `id` (int, required)
- **Cache:** Sob demanda (30s L0, 60s L1)

#### G3. `senado_ecidadania_consultas_consensuais` *(existente — manter)*

- **Descrição:** Retorna consultas com alta concordância (>85% em uma direção), útil para identificar temas de consenso.
- **Parâmetros:** `limite` (int, default 10, max 50), `minimoVotos` (int, default 1000), `percentualMinimo` (int, default 85, 50-100)
- **Cache:** Dinâmica (30s L0, 60s L1)

#### G4. `senado_ecidadania_consultas_polarizadas` *(existente — manter)*

- **Descrição:** Retorna consultas com votação equilibrada (~50/50), útil para identificar temas polarizados na sociedade.
- **Parâmetros:** `limite` (int, default 10, max 50), `margemPolarizacao` (int, default 15, 0-50), `minimoVotos` (int, default 1000)
- **Cache:** Dinâmica (30s L0, 60s L1)

#### G5. `senado_ecidadania_listar_ideias` *(existente — manter)*

- **Descrição:** Lista ideias legislativas propostas por cidadãos no e-Cidadania.
- **Parâmetros:** `limite` (int, default 20, max 100), `pagina` (int), `status` (enum: aberta, encerrada, convertida, todas), `ordenarPor` (enum: apoios, data, comentarios), `ordem` (enum: asc, desc)
- **Cache:** Dinâmica (30s L0, 60s L1)

#### G6. `senado_ecidadania_obter_ideia` *(existente — manter)*

- **Descrição:** Detalhes de uma ideia legislativa, incluindo descrição completa, apoios e se foi convertida em PL.
- **Parâmetros:** `id` (int, required)
- **Cache:** Sob demanda (30s L0, 60s L1)

#### G7. `senado_ecidadania_ideias_populares` *(existente — manter)*

- **Descrição:** Retorna as ideias legislativas mais apoiadas pelos cidadãos.
- **Parâmetros:** `limite` (int, default 10, max 50), `apenasAbertas` (boolean, default true)
- **Cache:** Dinâmica (30s L0, 60s L1)

#### G8. `senado_ecidadania_listar_eventos` *(existente — manter)*

- **Descrição:** Lista eventos interativos (audiências públicas, sabatinas, lives) do e-Cidadania.
- **Parâmetros:** `limite` (int, default 20, max 100), `status` (enum: agendado, encerrado, todos), `comissao` (string)
- **Cache:** Dinâmica (30s L0, 60s L1)

#### G9. `senado_ecidadania_obter_evento` *(existente — manter)*

- **Descrição:** Detalhes de um evento interativo, incluindo pauta, convidados e link para vídeo.
- **Parâmetros:** `id` (int, required)
- **Cache:** Sob demanda (30s L0, 60s L1)

#### G10. `senado_ecidadania_eventos_populares` *(existente — manter)*

- **Descrição:** Retorna eventos com mais comentários e perguntas dos cidadãos.
- **Parâmetros:** `limite` (int, default 10, max 50), `apenasAgendados` (boolean, default false)
- **Cache:** Dinâmica (30s L0, 60s L1)

#### G11. `senado_ecidadania_sugerir_tema_enquete` *(existente — manter)*

- **Descrição:** Analisa e sugere temas para enquete mensal baseado em critérios configuráveis. Evita temas muito polarizados ou com consenso total.
- **Parâmetros:** `criterios` (object com: `minimoParticipacao` int, `evitarPolarizacao` boolean, `evitarConsenso` boolean, `apenasEmTramitacao` boolean)
- **Cache:** Dinâmica (30s L0, 60s L1)

---

### GRUPO H — Referência e Metadados (4 tools)

#### H1. `senado_legislatura_atual` *(existente — manter)*

- **Descrição:** Informações sobre a legislatura vigente, incluindo número, período e datas de início/fim.
- **Endpoint:** `GET /legislatura/atual`
- **Parâmetros:** nenhum
- **Cache:** Estática (5 min L0, 10 min L1)

#### H2. `senado_partidos` *(existente — manter)*

- **Descrição:** Lista partidos com representação atual no Senado, incluindo sigla, nome completo e número de senadores.
- **Endpoint:** `GET /senador/partidos`
- **Parâmetros:** nenhum
- **Cache:** Estática (5 min L0, 10 min L1)

#### H3. `senado_ufs` *(existente — manter)*

- **Descrição:** Lista unidades federativas com número de senadores atualmente em exercício por estado.
- **Endpoint:** `GET /senador/ufs` (ou derivado da lista de senadores)
- **Parâmetros:** nenhum
- **Cache:** Estática (5 min L0, 10 min L1)

#### H4. `senado_tipos_materia` *(existente — já listada em B5)*

- Referência cruzada: ver **B5** acima.

---

## 8. Resumo do Inventário de Tools

| Status | Qtd | Tools |
|--------|-----|-------|
| **Mantidas** (existentes) | 33 | Todas as tools atuais do projeto |
| **Novas** (da revisão) | Até 4 | `senado_senador_detail` (A5), `senado_search_processos` (C1), `senado_obter_processo` (C2), `senado_search_votacoes` (D5) |
| **Condicionais** | 3 | C1, C2, D5 — implementar **apenas se** os endpoints existirem na OpenAPI real |
| **Total máximo** | 37 | |

### Tabela consolidada de mapeamento

| # | Tool | Grupo | Status | Cacheable | TTL L1 |
|---|------|-------|--------|-----------|--------|
| 1 | `senado_listar_senadores` | A | mantida | sim | 5 min |
| 2 | `senado_buscar_senador_por_nome` | A | mantida | sim | 30s |
| 3 | `senado_obter_senador` | A | mantida | sim | 120s |
| 4 | `senado_votacoes_senador` | A | mantida | sim | 60s |
| 5 | `senado_senador_detail` | A | **NOVA** | sim | 120s |
| 6 | `senado_buscar_materias` | B | mantida | sim | 60s |
| 7 | `senado_obter_materia` | B | mantida | sim | 120s |
| 8 | `senado_tramitacao_materia` | B | mantida | sim | 60s |
| 9 | `senado_textos_materia` | B | mantida | sim | 120s |
| 10 | `senado_tipos_materia` | B/H | mantida | sim | 10 min |
| 11 | `senado_search_processos` | C | **NOVA** (condicional) | sim | 60s |
| 12 | `senado_obter_processo` | C | **NOVA** (condicional) | sim | 120s |
| 13 | `senado_listar_votacoes` | D | mantida | sim | 60s |
| 14 | `senado_votacoes_recentes` | D | mantida | sim | 60s |
| 15 | `senado_obter_votacao` | D | mantida | sim | 120s |
| 16 | `senado_votos_materia` | D | mantida | sim | 120s |
| 17 | `senado_search_votacoes` | D | **NOVA** (condicional) | sim | 60s |
| 18 | `senado_listar_comissoes` | E | mantida | sim | 5 min |
| 19 | `senado_obter_comissao` | E | mantida | sim | 5 min |
| 20 | `senado_membros_comissao` | E | mantida | sim | 5 min |
| 21 | `senado_reunioes_comissao` | E | mantida | sim | 60s |
| 22 | `senado_agenda_comissoes` | E | mantida | sim | 60s |
| 23 | `senado_agenda_plenario` | F | mantida | sim | 60s |
| 24 | `senado_ecidadania_listar_consultas` | G | mantida | sim | 60s |
| 25 | `senado_ecidadania_obter_consulta` | G | mantida | sim | 60s |
| 26 | `senado_ecidadania_consultas_consensuais` | G | mantida | sim | 60s |
| 27 | `senado_ecidadania_consultas_polarizadas` | G | mantida | sim | 60s |
| 28 | `senado_ecidadania_listar_ideias` | G | mantida | sim | 60s |
| 29 | `senado_ecidadania_obter_ideia` | G | mantida | sim | 60s |
| 30 | `senado_ecidadania_ideias_populares` | G | mantida | sim | 60s |
| 31 | `senado_ecidadania_listar_eventos` | G | mantida | sim | 60s |
| 32 | `senado_ecidadania_obter_evento` | G | mantida | sim | 60s |
| 33 | `senado_ecidadania_eventos_populares` | G | mantida | sim | 60s |
| 34 | `senado_ecidadania_sugerir_tema_enquete` | G | mantida | sim | 60s |
| 35 | `senado_legislatura_atual` | H | mantida | sim | 10 min |
| 36 | `senado_partidos` | H | mantida | sim | 10 min |
| 37 | `senado_ufs` | H | mantida | sim | 10 min |

---

## 9. Error Handling

Mapear erros upstream para MCP tool errors significativos:

| Upstream Status | Ação MCP |
|-----------------|----------|
| `400` | Erro de validação/parâmetro |
| `429` / `503` | Erro retryable com mensagem curta e wait recomendado |
| Outros | Erro genérico upstream |

**Regras:**

- **Nunca** vazar HTML upstream completo; sempre retornar JSON error envelopes
- Manter mensagens de erro informativas mas seguras

---

## 10. Logging

- Logging estruturado mínimo: tool name, latência, upstream status, cache hit/miss (L0/L1/L2), retry count
- **NÃO** logar payloads completos ou dados pessoais

---

## 11. Deliverables — Estrutura do Repositório

```
senado-br-mcp-cloudflare/
├── wrangler.toml              # KV binding CACHE_KV
├── package.json               # deps: @modelcontextprotocol/sdk, agents, zod
├── tsconfig.json
├── src/
│   ├── index.ts               # Worker entrypoint (createMcpHandler + McpServer)
│   ├── server.ts              # McpServer instance + registro de todas as tools
│   ├── tools/
│   │   ├── registry.ts        # Tool registry helper (todas as 37 tools)
│   │   ├── senadores.ts       # Grupo A — registerTool() para cada tool
│   │   ├── materias.ts        # Grupo B
│   │   ├── processos.ts       # Grupo C (condicional)
│   │   ├── votacoes.ts        # Grupo D
│   │   ├── comissoes.ts       # Grupo E
│   │   ├── plenario.ts        # Grupo F
│   │   ├── ecidadania.ts      # Grupo G
│   │   └── referencia.ts      # Grupo H
│   ├── cache/
│   │   ├── l0-memory.ts       # In-memory isolate cache
│   │   ├── l1-cache-api.ts    # Cloudflare Cache API
│   │   ├── l2-kv.ts           # Cloudflare KV
│   │   └── manager.ts         # Cache orchestrator (L0 → L1 → L2)
│   ├── throttle/
│   │   ├── token-bucket.ts    # Token bucket implementation
│   │   ├── global-limiter.ts  # Global rate limiter
│   │   ├── client-limiter.ts  # Per-client rate limiter
│   │   └── retry.ts           # Retry with backoff logic
│   └── utils/
│       ├── cors.ts            # CORS headers (se necessário além do createMcpHandler)
│       ├── validation.ts      # Input validation helpers
│       ├── upstream.ts        # Upstream fetch wrapper
│       └── logger.ts          # Structured logging
└── README.md
```

> **Nota sobre CORS:** Verificar na documentação atualizada se o `createMcpHandler` já gerencia CORS internamente. Se sim, `cors.ts` pode ser simplificado ou removido.

---

## 12. README.md — Conteúdo Obrigatório

O README deve incluir:

1. **Visão geral** — o que é, quantas tools, o que cobre
2. **KV creation/binding steps** — comandos `wrangler` para criar o namespace e bindar
3. **Deploy steps** — `wrangler deploy` e configuração
4. **Exemplos de MCP requests:**
   - `tools/list`
   - `tools/call` (ao menos 3 tools de grupos diferentes)
5. **Notas sobre caching layers** — explicação das 3 camadas (L0/L1/L2)
6. **Notas sobre a abordagem de POST caching** — como funciona o hash + synthetic GET key
7. **Inventário completo de tools** com grupo e descrição resumida

---

## 13. Nota Importante de Implementação

### 13.1 Caching de respostas upstream (dentro das tools)

O cache L0/L1/L2 deve ser implementado **dentro da lógica de cada tool** (no callback de `registerTool`), envolvendo as chamadas upstream à API do Senado. O `createMcpHandler` gerencia o protocolo MCP; o caching é responsabilidade da camada de aplicação.

```
tool callback → verifica cache (L0 → L1) → se miss, fetch upstream → armazena no cache → retorna resultado
```

### 13.2 Caching de POST /mcp (opcional, avançado)

Para cachear respostas completas do endpoint `/mcp`, pode-se envolver o `createMcpHandler` num wrapper que intercepta a request antes de delegar ao handler:

```
hash body → synthetic GET cacheKey → caches.default.match → se hit, retorna cached → se miss, delega ao handler → cache.put
```

Fazer isso **apenas** para operações seguras e cacheáveis (`tools/list`, `tools/call` de tools GET-like), com TTL curto.

> **Nota:** Verificar na documentação atualizada se o `createMcpHandler` oferece hooks ou middleware para caching. Se sim, preferir a abordagem nativa.

---

## 14. Regras de Implementação para o Claude Code

> Estas instruções devem ser seguidas pelo Claude Code ao implementar este spec.

### 14.0 Consultar documentação atualizada ANTES de implementar

> **REGRA OBRIGATÓRIA — EXECUTAR ANTES DE QUALQUER CÓDIGO**

As bibliotecas e APIs utilizadas neste projeto evoluem rapidamente. O Claude Code **DEVE** consultar a documentação mais recente antes de planejar ou escrever qualquer código de implementação, para evitar usar APIs obsoletas, padrões deprecated ou configurações incompatíveis.

**Como consultar:**

1. **Via Context7 MCP** (preferencial, se disponível): Adicionar `use context7` ao prompt, ou usar diretamente as tools `resolve-library-id` e `get-library-docs` para obter documentação atualizada.

2. **Via fetch direto** (alternativa): Acessar as páginas de documentação oficial das bibliotecas.

**Bibliotecas/plataformas que DEVEM ser consultadas antes da implementação:**

| Biblioteca / Plataforma | Context7 ID (se disponível) | Documentação oficial | O que verificar |
|---|---|---|---|
| **Cloudflare Workers** | `/cloudflare/workers-sdk` | https://developers.cloudflare.com/workers/ | Runtime APIs, compatibilidade, ESM format |
| **Cloudflare KV** | (mesmo acima) | https://developers.cloudflare.com/kv/ | API de get/put, TTL, limites free tier |
| **Cloudflare Cache API** | (mesmo acima) | https://developers.cloudflare.com/workers/runtime-apis/cache/ | `caches.default`, match/put, limitações |
| **Cloudflare Agents / MCP** | `/cloudflare/agents` | https://developers.cloudflare.com/agents/model-context-protocol/ | `createMcpHandler`, transporte Streamable HTTP, `McpServer` |
| **MCP Protocol** | `/modelcontextprotocol/specification` | https://modelcontextprotocol.io/specification/ | Transporte atual (Streamable HTTP vs SSE deprecated), JSON-RPC |
| **MCP TypeScript SDK** | `/modelcontextprotocol/typescript-sdk` | https://github.com/modelcontextprotocol/typescript-sdk | `McpServer`, `registerTool`, input schema com `zod` |
| **Zod** | `/colinhacks/zod` | https://zod.dev/ | Definição de schemas para inputSchema das tools |
| **Wrangler CLI** | (via Cloudflare Workers) | https://developers.cloudflare.com/workers/wrangler/ | `wrangler.toml`, bindings, deploy |

**Fluxo obrigatório antes de cada fase de implementação:**

```
1. Consultar Context7 (ou docs oficiais) para cada lib relevante à fase
2. Verificar se houve breaking changes ou deprecações desde a escrita deste spec
3. Se houver conflito entre este spec e a documentação atual, SEGUIR A DOCUMENTAÇÃO ATUAL
4. Documentar no código (comentário) qualquer divergência encontrada
```

**Exemplo de uso com Context7:**
```
"Preciso implementar um MCP server em Cloudflare Workers com createMcpHandler. use context7"
```

**Exemplo de uso com fetch direto:**
```
Acessar https://developers.cloudflare.com/agents/model-context-protocol/transport/
para verificar o padrão atual de transporte MCP em Cloudflare Workers.
```

> **IMPORTANTE:** Se a documentação atualizada indicar que alguma decisão deste spec está obsoleta (por exemplo, se o transporte MCP mudou, se `createMcpHandler` substituiu handlers customizados, ou se novas dependências são necessárias), o Claude Code deve **informar a divergência no output** e **seguir a documentação atual**, adaptando a implementação conforme necessário.

---

### 14.1 Ler a OpenAPI primeiro

Antes de implementar qualquer tool, fazer `fetch` do OpenAPI JSON em `https://legis.senado.leg.br/dadosabertos/v3/api-docs` e confirmar os endpoints reais, parâmetros e response shapes.

### 14.2 Tools condicionais

As tools C1 (`senado_search_processos`), C2 (`senado_obter_processo`) e D5 (`senado_search_votacoes`) só devem ser implementadas se os endpoints correspondentes existirem na OpenAPI. Se não existirem, ignorar gracefully e documentar no README.

### 14.3 Prioridade de implementação

- **Fase 1:** Infraestrutura (Worker entrypoint, CORS, routing, cache layers, throttle)
- **Fase 2:** Grupo H (referência/metadados — mais simples, bom para validar a infra)
- **Fase 3:** Grupos A e B (senadores e matérias — core)
- **Fase 4:** Grupos D e E (votações e comissões)
- **Fase 5:** Grupo G (e-Cidadania — 11 tools, maior volume)
- **Fase 6:** Grupo C (processos — condicional) e Grupo F (plenário)
- **Fase 7:** README, testes, polish

### 14.4 Não inventar dados

Se um endpoint retornar formato inesperado, retornar erro claro em vez de tentar adaptar.

### 14.5 Modularidade

Cada tool deve ser auto-contida no seu arquivo de grupo, com: definição do schema, implementação, e metadata de cache.

---

## 15. Checklist Final

- [ ] Worker entrypoint ESM com `createMcpHandler(server)(request, env, ctx)`
- [ ] Dependências oficiais: `@modelcontextprotocol/sdk`, `agents`, `zod`
- [ ] Transporte **Streamable HTTP** (spec MCP 2025-03-26) via `createMcpHandler`
- [ ] Endpoint `/mcp` aceita POST, GET e DELETE (gerenciado pelo handler)
- [ ] CORS com preflight (verificar se `createMcpHandler` já gerencia)
- [ ] `McpServer` com `registerTool()` para cada tool usando schemas `zod`
- [ ] **33 tools existentes preservadas integralmente**
- [ ] Até 4 tools novas adicionadas (condicionais à API real)
- [ ] Tools organizadas em 8 grupos (A–H)
- [ ] Validação estrita de input via `zod` schemas
- [ ] Rate limiting global + per-client (in-memory)
- [ ] Retry com backoff em 429/503
- [ ] Cache L0 (memory), L1 (Cache API), L2 (KV)
- [ ] POST caching via SHA-256 hash → synthetic GET
- [ ] Error handling com JSON envelopes
- [ ] Logging estruturado mínimo
- [ ] Safeguards: 256KB body, 2MB response, 10s timeout
- [ ] `wrangler.toml`, `package.json`, `tsconfig.json` configurados
- [ ] README completo com inventário de tools e exemplos
- [ ] Endpoints verificados contra OpenAPI real antes da implementação
- [ ] Documentação das libs consultada via Context7 ou fetch direto antes de cada fase
- [ ] Compatibilidade testada com ao menos 1 MCP client (Claude, Cursor ou MCP Inspector)
