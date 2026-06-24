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

🇺🇸 [Read in English](README.md)

Um servidor MCP **público e hospedado** que dá aos assistentes de IA acesso ao vivo e estruturado aos **dados abertos do Senado Federal do Brasil** — **sem instalação, sem conta, sem chave de API**. Aponte o seu cliente MCP para o endpoint hospedado e comece a perguntar sobre senadores, matérias, votações, despesas e muito mais. Roda em Cloudflare Workers via Streamable HTTP.

Expõe **66 ferramentas**, **4 prompts** e **5 recursos** em dois domínios:

- **Legislativo** — senadores; matérias e sua tramitação; votações; comissões; sessões plenárias, resultados e vetos presidenciais; orientação de bancada nas votações; discursos e notas taquigráficas; blocos e lideranças; legislação federal; e participação cidadã pelo portal e-Cidadania.
- **Administrativo** — despesas da cota parlamentar (CEAPS); auxílio-moradia; servidores e remunerações; horas extras; estagiários; contratos e licitações; terceirizados; suprimento de fundos; e execução orçamentária.

Os dados vêm de três fontes oficiais — a [API de dados abertos legislativos](https://legis.senado.leg.br/dadosabertos/), a [API de dados abertos administrativos](https://adm.senado.gov.br/adm-dadosabertos/swagger-ui/index.html) e o portal e-Cidadania. Todas as respostas das ferramentas são em português (pt-BR). Veja o [CHANGELOG.md](CHANGELOG.md) para o histórico de versões.

## Veja na prática

Aponte um cliente para o endpoint e pergunte, em português:

- *"Como os senadores de São Paulo votaram nas últimas votações do plenário?"* → `senado_search_votacoes`
- *"Mostre a tramitação da PEC 45/2019."* → `senado_buscar_materias` + `senado_obter_materia`
- *"Quanto foi gasto com a cota parlamentar (CEAPS) em 2024, por tipo de despesa?"* → `senado_ceaps`

As respostas vêm ao vivo das APIs oficiais de dados abertos do Senado — valores exatos com procedência, não números chutados a partir do treino.

## Como usar (hospedado — sem configuração)

Este é um servidor **remoto, hospedado e de acesso aberto**. Para usá-lo, aponte qualquer cliente MCP para o endpoint
Streamable HTTP — **sem instalação, sem conta, sem chave de API, sem configuração**:

```
https://senado.sidneybissoli.com/mcp
```

### Instalação (qualquer cliente)

Para clientes que iniciam servidores MCP como um comando — e para uma configuração de um único comando — use a
ponte [`mcp-remote`](https://www.npmjs.com/package/mcp-remote). **Sem build, sem config, sem chave:**

```bash
npx -y mcp-remote https://senado.sidneybissoli.com/mcp
```

- **Um clique (LobeHub):** abra a [página do servidor](https://lobehub.com/mcp/sidneybissoli-senado-br-mcp-cloudflare) e clique em **Install**.
- **URL remota nativa** (Claude Desktop/Code e outros clientes Streamable HTTP): veja [Conectando clientes MCP](#conectando-clientes-mcp).

Tudo abaixo de *Arquitetura* (Pré-requisitos, Configuração, Deploy) é **apenas para opcionalmente auto-hospedar a sua
própria instância** — **não** é necessário para usar este servidor público.

## Rodar localmente (npx · stdio)

Prefere não rotear suas consultas por um servidor de terceiros (ex.: política de uma redação)? O **mesmo
servidor** também roda como um **processo local stdio** que bate **direto nas APIs oficiais do governo** —
as mesmas 66 ferramentas, o mesmo envelope de proveniência, sem Cloudflare no caminho. É o canal npm/stdio.

> **Atenção:** o atalho `npx senado-br-mcp` **ainda não está publicado** — o nome no npm está sendo
> reclaimado de um pacote antigo e sem manutenção (sem proveniência). Até lá, rode a partir do fonte:

```bash
git clone https://github.com/SidneyBissoli/senado-br-mcp-cloudflare
cd senado-br-mcp-cloudflare
npm install
npm run build
node dist/cli.js   # serve o MCP por stdio (Ctrl+C para parar)
```

Aponte um cliente baseado em comando para o entrypoint compilado:

```json
{
  "mcpServers": {
    "senado-br": {
      "command": "node",
      "args": ["/caminho/absoluto/para/senado-br-mcp-cloudflare/dist/cli.js"]
    }
  }
}
```

Quando o pacote npm for publicado, isto vira a forma sem instalação:

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

**Paridade com o servidor hospedado:** as ferramentas legislativas e administrativas são **idênticas**
(mesmas APIs de origem, mesmo throttle/cache/proveniência) — localmente o cache L1 do Cloudflare vira
no-op, mas o L0 em memória continua funcionando, então o resultado é o mesmo. A **única** diferença são
as ferramentas de lista/corpus do e-Cidadania: sem D1, elas caem no scraping ao vivo dos ~5 destaques
REST, sinalizado por `meta.fonte` / `possivelDesatualizacao`; as de detalhe (`obter_*`) são idênticas.
Os logs vão para o **stderr** — o stdout carrega apenas o fluxo do protocolo JSON-RPC.

## Arquitetura

- **Runtime:** Cloudflare Workers (ESM)
- **Transporte:** Streamable HTTP (spec MCP 2025-03-26) via `createMcpHandler` de `agents/mcp`
- **Protocolo:** MCP sobre JSON-RPC — um único endpoint `/mcp` trata POST, GET, DELETE
- **SDK:** `@modelcontextprotocol/sdk` 1.26.0+ (instâncias de McpServer por requisição)
- **Validação:** schemas Zod para todas as entradas das ferramentas
- **Cache:** 2 camadas (L0 memória + L1 Cache API) com chaveamento SHA-256
- **Store do e-Cidadania:** banco D1 atualizado por um Cron Trigger (a cada 2h) — as ferramentas de listagem leem do D1 com fallback de scraping ao vivo e flag de desatualização; as de detalhe ficam ao vivo com write-through (veja [e-Cidadania](#e-cidadania-em-d1-atualizado-por-cron))
- **Rate limiting:** Token bucket — global (8 req/s) + por cliente (2 req/s)
- **Throttle de upstream:** Máx. 6 requisições simultâneas, timeout de 10s, retry com backoff exponencial
- **Auth:** Bearer token opcional (defina o secret `API_KEY`; acesso aberto quando ausente). Comparação em tempo constante.
- **Observabilidade:** Logging estruturado em JSON + contadores em memória expostos em `/metrics`
- **Testes:** testes unitários Vitest para parsers, helpers, cache, throttle e auth

## Auto-hospedagem (opcional)

> **Não é necessário para usar o servidor** — ele já está hospedado em `https://senado.sidneybissoli.com/mcp`
> (acesso aberto). Siga esta seção apenas se quiser rodar a sua **própria** instância privada.

### Pré-requisitos

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) v4+
- Conta Cloudflare

### Configuração

#### 1. Instalar dependências

```bash
npm install
```

#### 2. Criar o namespace KV

```bash
# Cria o namespace KV
wrangler kv namespace create CACHE_KV

# Anote o ID da saída, ex.:
# { binding = "CACHE_KV", id = "abc123..." }
```

#### 3. Configurar o wrangler.toml

Substitua o ID placeholder do namespace KV:

```toml
[[kv_namespaces]]
binding = "CACHE_KV"
id = "YOUR_KV_NAMESPACE_ID_HERE"
```

Opcionalmente, defina `ALLOWED_ORIGIN` para restringir o CORS:

```toml
[vars]
ALLOWED_ORIGIN = "https://your-app.example.com"
```

O pipeline do e-Cidadania precisa de um **banco D1** e de um **Cron Trigger** (ambos já declarados no `wrangler.toml` — substitua o ID do banco):

```toml
[[d1_databases]]
binding = "ECIDADANIA_DB"
database_name = "senado-ecidadania"
database_id = "YOUR_D1_DATABASE_ID_HERE"

[triggers]
crons = ["0 */2 * * *"]
```

Crie o banco (cole o ID retornado acima) e aplique o schema:

```bash
npx wrangler d1 create senado-ecidadania
npx wrangler d1 migrations apply senado-ecidadania --remote
```

As ferramentas de listagem caem para scraping ao vivo quando o D1 está vazio, então o servidor funciona antes da primeira execução do Cron.

#### 4. (Opcional) Habilitar autenticação

```bash
wrangler secret put API_KEY
# Os clientes passam a enviar: Authorization: Bearer <key>
# Quando API_KEY não está definido, o servidor é de acesso aberto.
```

#### 5. Desenvolvimento local

```bash
npm run dev
# O servidor de dev roda localmente na porta 8787 (apenas local).
# O endpoint MCP público é https://senado.sidneybissoli.com/mcp
```

#### 6. Testes e typecheck

```bash
npm test             # roda todos os testes uma vez
npm run test:watch   # modo watch
npm run typecheck    # tsc --noEmit
```

#### 7. Deploy

```bash
npm run deploy
# Servido em https://senado.sidneybissoli.com (domínio próprio) e
# https://senado-br-mcp.sidneybissoli.workers.dev (fallback workers.dev)
```

## Endpoints

| Caminho | Métodos | Descrição |
|------|---------|-------------|
| `/mcp` | POST, GET, DELETE, OPTIONS | Endpoint MCP Streamable HTTP (gerenciado por `createMcpHandler`) |
| `/health` | GET | Health check — retorna `ok` (sempre público) |
| `/metrics` | GET | Contadores em JSON: requisições, chamadas de ferramentas, acertos/erros de cache, chamadas/retries/erros de upstream, falhas de auth (sempre público) |

## Exemplos de requisição MCP

Todas as requisições vão para `POST /mcp` no formato JSON-RPC 2.0.

### Listar as ferramentas disponíveis

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list"
}
```

### Chamar uma ferramenta — Listar senadores de SP

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

### Chamar uma ferramenta — Buscar matérias por palavra-chave

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

### Chamar uma ferramenta — Votações recentes do plenário

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

### Chamar uma ferramenta — Ideias de cidadãos mais populares

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

## Endpoints da API de origem (upstream)

O servidor consome duas classes de endpoints upstream da API do Senado:

### Endpoints legados (sufixo `.json`, respostas em PascalCase)

Usados pelos Grupos A, E, F, H, I, J, K, L, M, N. O sufixo `.json` é anexado automaticamente por `upstream.ts`. Nenhum deles está marcado como deprecated no upstream.

| Caminho upstream | Usado por |
|---------------|---------|
| `/senador/lista/atual` | `senado_listar_senadores` |
| `/senador/lista/legislatura/{legislatura}` | `senado_listar_senadores` (param `legislatura`) |
| `/senador/{codigo}` | `senado_obter_senador` |
| `/senador/{codigo}/licencas`, `/comissoes`, `/cargos`, `/historicoAcademico`, `/filiacoes`, `/profissao` | `senado_senador_historico` (`tipo` enum) |
| `/senador/afastados` | `senado_senadores_afastados` |
| `/senador/{codigo}/apartes` | `senado_discursos_senador` (`tipo=apartes`) |
| `/comissao/lista/colegiados` | `senado_listar_comissoes` (+ resolução sigla→código) |
| `/comissao/{codigo}` | `senado_obter_comissao` (`secao=resumo`; código numérico, não sigla) |
| `/composicao/comissao/{codigo}` | `senado_obter_comissao` (`secao=membros`) |
| `/comissao/agenda/{data}` | `senado_agenda_comissoes` |
| `/comissao/agenda/{dataInicio}/{dataFim}` | `senado_reunioes_comissao` |
| `/comissao/reuniao/{codigoReuniao}` | `senado_reuniao_comissao` |
| `/comissao/cpi/{sigla}/requerimentos` | `senado_requerimentos_cpi` (corpo vazio = sem requerimentos) |
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
| `/discurso/texto-integral/{codigo}` | `senado_discurso_texto` (texto puro, buscado diretamente) |
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

### Endpoints v3 (arrays/objetos JSON planos, camelCase)

Usados pelos Grupos B, C, D. As datas devem estar em **formato ISO** (`YYYY-MM-DD`) — as ferramentas aceitam `YYYYMMDD` e convertem. O query param `codigoMateria` faz a ponte de códigos de matéria legados para processos v3.

| Caminho upstream | Usado por |
|---------------|---------|
| `/votacao` | `senado_obter_votacao`, `senado_search_votacoes`, `senado_votos_materia`, `senado_votacoes_senador` |
| `/processo` | `senado_search_processos`, `senado_buscar_materias` |
| `/processo/{id}` | `senado_obter_processo`, `senado_obter_materia` (`secao=detalhe`/`tramitacao`) |
| `/processo/documento` | `senado_obter_materia` (`secao=textos`) |
| `/processo/emenda` | `senado_processo_detalhe` (`secao=emendas`) |
| `/processo/relatoria` | `senado_processo_detalhe` (`secao=relatorias`), `senado_obter_materia` (relator) |
| `/processo/prazo` | `senado_processo_detalhe` (`secao=prazos`) |
| `/processo/{siglas,assuntos,classes,destinos,entes,tipos-*}` | `senado_tabelas_processo` (12 tabelas de referência) |

### API administrativa (adm.senado.gov.br/adm-dadosabertos, JSON plano em snake_case)

Usada pelos Grupos O, P, Q, R via `admFetch` (sem sufixo `.json`; HTTP 404 tratado como coleção vazia). URL base configurável via `SENADO_ADM_BASE_URL`.

| Caminho upstream | Usado por |
|---------------|---------|
| `/api/v1/senadores/despesas_ceaps/{ano}` | `senado_ceaps` (~10 MB/ano, cacheado + agregado no Worker) |
| `/api/v1/senadores/{auxilio-moradia,escritorios,aposentados}` | `senado_senadores_admin` (`tipo` enum) |
| `/api/v1/servidores/servidores/{ativos,efetivos,comissionados,inativos}` | `senado_servidores` |
| `/api/v1/servidores/remuneracoes/{ano}/{mes}` | `senado_remuneracoes_servidores` (~5.5 MB/mês) |
| `/api/v1/servidores/horas-extras/{ano}/{mes}` | `senado_horas_extras` |
| `/api/v1/servidores/quantitativos/*`, `/previsao-aposentadoria`, `/api/v1/senadores/quantitativos/senadores` | `senado_pessoal_tabelas` (quantitativos) |
| `/api/v1/servidores/{estagiarios,pensionistas,lotacoes,cargos}` | `senado_pessoal_tabelas` (listas nominais) |
| `/api/v1/contratacoes/contratos` (+ `/{id}/aditivos`) | `senado_contratos`, `senado_contratacao_detalhe` |
| `/api/v1/contratacoes/{tipo}/{id}/{itens,pagamentos,garantias}` | `senado_contratacao_detalhe` |
| `/api/v1/contratacoes/licitacoes` | `senado_licitacoes` |
| `/api/v1/contratacoes/terceirizados` | `senado_terceirizados` |
| `/api/v1/contratacoes/empresas` | `senado_empresas_contratadas` (~13 MB, exige filtro) |
| `/api/v1/contratacoes/{atas_registro_preco,notas_empenho,menores_aprendizes}` | `senado_contratacoes_lista` |
| `/api/v1/supridos/{ano}` (+ atosConcessao, empenhos, movimentacoes, transacoes) | `senado_suprimento_fundos` |
| `senado.gov.br/bi-arqs/Arquimedes/Financeiro/{Despesa,Receitas}SenadoDadosAbertos.json` | `senado_execucao_orcamentaria` (feeds JSON diários, strings decimais brasileiras normalizadas) |

### e-Cidadania (em D1, atualizado por Cron)

Os dados de **listagem** do e-Cidadania são persistidos em um **banco D1** (`ecidadania_current/_history/_scrape_runs`, discriminado por `entidade`) e lidos de lá em vez de raspados a cada chamada. **Duas cadências** escrevem nele:

- uma **GitHub Action semanal fora do Worker** é dona do **corpus completo** de cada entidade (veja abaixo) — a fonte da verdade;
- um **Cron Trigger** in-Worker (`0 */2 * * *`, `src/scraper/pipeline.ts → refreshEcidadania`) faz apenas um **splice de métrica direcionado** dos ~5 destaques REST por entidade ao vivo (`restcolecaomaismateria/ideia/audiencia` — votos/comentários/apoios), registrado como `ok-metrica` para nunca re-quebrar a baseline do corpus nem tocar a cauda longa.

Ambos os escritores constroem os payloads pelos builders canônicos `buildXResumo` + `contentHash` compartilhado, então suas linhas são byte-idênticas. Cada escrita:

- faz **upsert** em `ecidadania_current` (uma linha por item — o que as ferramentas leem),
- **anexa** em `ecidadania_history` apenas quando o `content_hash` de um item muda (pronto para série temporal),
- registra cada execução em `ecidadania_scrape_runs`.

Um **guard de anomalia** (`src/scraper/anomaly.ts`, `classifyRun`) garante que uma execução de corpus falha ou anômala (zero linhas, ou menos que `ECIDADANIA_CORPUS_MIN_PCT`% da última boa) **nunca sobrescreva** o último bom estado.

As **ferramentas de listagem/análise** (`listar_*`, `consultas_analise`, `sugerir_tema_enquete`, `consultas_votos`) leem do D1 via `resolveList` (`src/scraper/store.ts`): D1 primeiro. Como toda entidade agora é um corpus completo, um corpus velho é servido do D1 **com flag** (`possivelDesatualizacao: true`) em vez de colapsar para os ~5 destaques ao vivo (o bug de cobertura original); o scraping ao vivo fica reservado a um D1 vazio (cold start, antes da 1ª carga semanal). O frescor usa `ECIDADANIA_CORPUS_STALE_MAX_MIN` (~10 dias). Toda resposta de listagem carrega um `meta` aditivo (`fonte`, `lastScrapedAt`, `possivelDesatualizacao`) para que os chamadores sempre vejam a idade real dos dados e nunca recebam dados velhos silenciosamente.

As **ferramentas de detalhe** (`obter_*`) ficam **ao vivo** (HTML raspado com regex direcionado por classe CSS) por frescor, e gravam o payload mais rico em `ecidadania_detalhe` em fire-and-forget (deduplicado por `content_hash`), para que o histórico de detalhe se acumule sem adicionar latência à resposta.

#### Ingestão do corpus completo (fora do Worker, semanal)

As quatro entidades do e-Cidadania são corpora completos, cada um dono de um orquestrador `scripts/ingest-ecidadania/index-*.ts` executado pela Action semanal (`.github/workflows/ingest-ecidadania.yml`), emitindo `out-*.sql` em lotes que o passo de apply carrega:

- **`consultas`** — consultas abertas (detalhado abaixo).
- **`eventos`** — audiências/eventos da listagem HTML `principalaudiencia?p=N`; o status vem direto do bloco da listagem (sem ponte por `/processo`).
- **`ideias`** — ideias legislativas (~150 mil) de `pesquisaideia?situacao=N&p=M`, varridas **por bucket de `situacao`** (a listagem não traz status inline) e emitidas em lotes de ~10k statements.
- **`consultas_votos`** — acervo **histórico** separado de votos por UF, lido do CSV Arquimedes de ~33 MB (`Proposições-com-votos.csv`), agregado a uma linha por matéria com quebra `votosPorUf`. O carimbo "dados atualizados até" do CSV vira o `reference_period` da proveniência; fica **fora** do hash da linha (`consultaVotoCore`) para que um bump semanal do carimbo sobre esses votos congelados não suje o `_history`. `STATUS ATUAL` é uniformemente "Descontinuado" — por isso é acervo, não migração das consultas abertas. Servido por `senado_ecidadania_consultas_votos` com proveniência apontando para o CSV (`ECIDADANIA_ARQUIMEDES`).

O job de `consultas` é a implementação de referência:

`consultas` cobre o **conjunto completo de consultas ABERTAS** — toda matéria atualmente em tramitação (~7,7 mil), não apenas os ~5 destaques. Confirmado na primeira execução: a listagem `pesquisamateria` é **apenas de em-tramitação**, então consultas encerradas/históricas **não** são capturadas por essa fonte (um backfill histórico pré-ingestão está fora de escopo). Três decisões de design já assentadas:

1. **Ingestão desacoplada.** O conjunto aberto é obtido por um **job TypeScript fora do Worker** (`scripts/ingest-ecidadania/`, executado por uma GitHub Action semanal — `.github/workflows/ingest-ecidadania.yml`) que pagina a listagem HTML (`pesquisamateria?p=1..N`, a única fonte de cobertura completa para consultas abertas) buscando ids + contagens de votos e faz **bulk-load no D1**; o Worker apenas lê. O crawl frágil e longo fica fora do caminho de requisição/Cron.
2. **Status a partir de `/processo`, não do HTML.** Uma consulta corre da apresentação até o fim da tramitação, então o `status` é função da matéria: **aberta ⟺ o `codigoMateria` está no conjunto `tramitando=S` de `/processo`**, derivado de JSON robusto (nunca raspado). Toda consulta entra como `aberta` (a listagem só traz matérias em tramitação); a cada execução **completa** o job re-deriva o status de **todas as linhas armazenadas** por presença em `/processo` (não por ausência na listagem, que pode ser transitória), de modo que uma consulta cuja matéria deixa a tramitação vira `encerrada`. Os conjuntos `encerrada`/`todas` portanto crescem com o tempo; consultas que encerraram **antes** da primeira ingestão não são capturadas (fora de escopo). As ferramentas de listagem/análise usam `status: aberta` por padrão.
3. **Duas cadências reconciliadas (um único contrato de escrita).** O job **reutiliza** `contentHash` + o builder `ConsultaResumo` + `classifyRun` de `src/scraper/`, então suas linhas são byte-idênticas às do Cron. O job semanal cuida da cauda longa; o **Cron de 2h** mantém os ~5 destaques quentes/abertos frescos via um *splice de métrica direcionado* (registrado como `ok-metrica`, ignorando a baseline `classifyRun` do corpus). O frescor do corpus (`possivelDesatualizacao`) é calculado a partir da última execução `status='ok'` e usa uma janela maior (`ECIDADANIA_CORPUS_STALE_MAX_MIN`); um corpus de consultas velho é servido do D1 com flag em vez de colapsar de volta para os destaques ao vivo.

Guards de escrita na carga: um **crawl incompleto** (qualquer página falhou) ou um universo de status `/processo` incompleto grava apenas uma linha de execução `erro`; mesmo um crawl completo é rejeitado por um **piso catastrófico** (`ECIDADANIA_CORPUS_MIN_PCT`, padrão 80% do último bom corpus) para proteger contra uma página degradada — sobreponível com `--force` / `INGEST_FORCE=1` para uma redução grande legítima. Execute semanalmente via Action, ou manualmente:

```bash
CLOUDFLARE_API_TOKEN=… npm run ingest:ecidadania                 # escreve scripts/ingest-ecidadania/out.sql
npx wrangler d1 execute senado-ecidadania --remote --file=scripts/ingest-ecidadania/out.sql
```

## Cache

### Arquitetura de camadas

| Camada | Armazenamento | Escopo | Faixa de TTL | Finalidade |
|-------|---------|-------|-----------|---------|
| **L0** | `Map` em memória | Por isolate | 30-300s | Ultrarrápido, elimina requisições redundantes dentro de um isolate do Worker |
| **L1** | Cloudflare Cache API (`caches.default`) | Por colo (PoP) | 60-600s | Compartilhado entre requisições no mesmo edge |
| **L2** | KV (opcional) | Global | Variável | Reservado para dados raros e de baixa escrita |

### Categorias de cache

| Categoria | L0 TTL | L1 TTL | Usado para |
|----------|--------|--------|----------|
| **STATIC** | 300s | 600s | Tipos de legislação, referência estática |
| **SEMI_STATIC** | 120s | 300s | Lista de partidos, lista de UFs, detalhes de comissão |
| **DYNAMIC** | 30s | 60s | Agendas, votações recentes, listas de reuniões |
| **ON_DEMAND** | 30s | 120s | Consultas específicas de matéria/senador/votação |

### Abordagem de cache de POST

O MCP usa POST para todas as requisições `tools/call`. Cachear respostas de POST não é nativamente suportado pela Cache API, que requer requisições GET. A solução:

1. **Hash dos parâmetros** — Nome da ferramenta + parâmetros ordenados são hasheados com SHA-256
2. **Chave GET sintética** — Uma URL sintética `https://senado-br-mcp.internal/__cache/{tool}/{hash}` é construída
3. **match/put na Cache API** — A URL GET sintética é usada com `caches.default.match()` e `caches.default.put()`, permitindo operações padrão da Cache API sobre dados originados de POST

Esse cache acontece no **nível da ferramenta** (dentro do callback de cada ferramenta), não no nível do transporte MCP.

## Proveniência

**Toda ferramenta** anexa um **envelope de proveniência** para que qualquer resultado seja rastreável até sua fonte oficial — a proveniência é parte essencial da resposta, não um extra opcional (o público são jornalistas e pesquisadores em ciência política, para quem um número sem fonte é inutilizável). O envelope fica em `structuredContent.provenance` (parseável e validado pelo output schema da ferramenta) e é espelhado como um rodapé compacto de fonte no texto, para clientes que só renderizam texto — o JSON dos dados **não** é duplicado com o envelope, mantendo o custo de tokens por resposta baixo (≈170 chars fixos).

Campos (por resposta — uma ferramenta, uma fonte): `source`, `source_url` (URL canônica consultada), `dataset_id`, `reference_period` (competência/vintage do dado), `retrieved_at` (ISO-8601 da extração no upstream — preservado mesmo em cache-hit, o diferenciador nível-1), `attribution` (citação pronta) e `license`.

A cobertura abrange as quatro fontes upstream: **Dados Abertos Legislativo** (`legis.senado.leg.br`), **Dados Abertos Administrativo** (`adm.senado.gov.br`), **Execução Orçamentária** (feed Arquimedes/Financeiro em `senado.gov.br`) e **Portal e-Cidadania** (`www12.senado.leg.br/ecidadania`). Nas listas do e-Cidadania (lidas do D1) o `retrieved_at` é o `lastScrapedAt` do corpus — a idade real do dado; nos detalhes (raspados ao vivo) é o instante da chamada, com a URL canônica do item. A fidelidade do `retrieved_at` vem da camada de cache (`cachedFetchWithMeta`), que persiste o timestamp junto ao valor.

## Inventário de ferramentas

### Grupo H — Referência/Metadados (1 ferramenta)

| Ferramenta | Descrição |
|------|-------------|
| `senado_tabelas_referencia` | Tabelas de referência via `tabela` enum: tipos-materia, partidos, ufs, legislatura-atual, tipos-norma, tipos-uso-palavra |

### Grupo A — Senadores (5 ferramentas)

| Ferramenta | Descrição |
|------|-------------|
| `senado_listar_senadores` | Lista senadores em exercício/por legislatura, com filtros `nome` (busca parcial sem acento), `uf` e `partido` |
| `senado_obter_senador` | Detalhe biográfico de um senador: bio, mandatos, partido, contato |
| `senado_votacoes_senador` | Como um senador votou em cada matéria (via v3 `/votacao`) |
| `senado_senador_historico` | Histórico funcional via `tipo` enum: licencas, comissoes, cargos, historico-academico, filiacoes, profissoes |
| `senado_senadores_afastados` | Senadores atualmente afastados (fora de exercício) |

### Grupo B — Matérias (2 ferramentas, backend v3)

| Ferramenta | Descrição |
|------|-------------|
| `senado_buscar_materias` | Busca matérias por tipo, número, ano, palavra-chave, autor ou tramitação (via v3 `/processo`) |
| `senado_obter_materia` | Dados de uma matéria via `secao` enum: detalhe (situação/relator), tramitacao (histórico) ou textos (documentos) |

### Grupo C — Processos (5 ferramentas)

| Ferramenta | Descrição |
|------|-------------|
| `senado_search_processos` | Busca processos legislativos (complementar à busca de matérias) |
| `senado_obter_processo` | Detalhes completos de um processo legislativo específico |
| `senado_processo_detalhe` | Aspecto de um processo via `secao` enum: emendas, relatorias ou prazos |
| `senado_autores_atuais` | Parlamentares autores de processos em tramitação, ordenados por produção |
| `senado_tabelas_processo` | 12 tabelas de referência (siglas, assuntos, classes, tipos-*) via `tabela` enum |

### Grupo D — Votações (3 ferramentas)

| Ferramenta | Descrição |
|------|-------------|
| `senado_obter_votacao` | Detalhes de uma votação com votos nominais. Aceita `codigoVotacao` (codigoSessao da sessão plenária). |
| `senado_votos_materia` | Votações de uma matéria (via v3 `/votacao?codigoMateria`), com votos nominais opcionais |
| `senado_search_votacoes` | Busca/listagem flexível de votações do plenário por `dias`, período, processo, matéria ou senador |

### Grupo E — Comissões (7 ferramentas)

| Ferramenta | Descrição |
|------|-------------|
| `senado_listar_comissoes` | Lista comissões (colegiados) ativas, filtráveis por tipo |
| `senado_obter_comissao` | Dados de uma comissão via `secao` enum: resumo (mesa/totais) ou membros (composição). Resolve sigla para código internamente. |
| `senado_reunioes_comissao` | Reuniões de uma comissão num período (lida com intervalos entre anos) |
| `senado_agenda_comissoes` | Agenda de reuniões de todas as comissões numa data |
| `senado_reuniao_comissao` | Detalhe completo de uma reunião: partes, itens, convidados, resultados, links pauta/ata |
| `senado_requerimentos_cpi` | Requerimentos protocolados numa CPI em atividade, paginados |
| `senado_distribuicao_materias` | Estatísticas de carga por senador numa comissão: autoria ou relatoria |

### Grupo F — Plenário (7 ferramentas)

| Ferramenta | Descrição |
|------|-------------|
| `senado_agenda_plenario` | Agenda do plenário — por dia, mês ou Congresso (escopo dia/mes/cn) |
| `senado_resultado_plenario` | Resultados de sessão: itens deliberados, pareceres, desfechos (SF/CN/mês) |
| `senado_orientacao_bancada` | Orientações de voto das lideranças por votação, com placar |
| `senado_vetos` | Vetos presidenciais por ano ou situação de tramitação |
| `senado_resultado_veto` | Resultados nominais de votação de veto (por veto, matéria vetada ou dispositivo) |
| `senado_encontro_plenario` | Detalhe de sessão legislativa, itens de pauta, resultados ou resumo |
| `senado_tabelas_plenario` | Tipos de sessão, tipos de comparecimento, lista de legislaturas |

### Grupo G — e-Cidadania (9 ferramentas)

| Ferramenta | Descrição |
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

### Grupo I — Discursos (3 ferramentas)

| Ferramenta | Descrição |
|------|-------------|
| `senado_discursos_senador` | Pronunciamentos de um senador via `tipo` enum: discursos (próprios) ou apartes (intervenções) |
| `senado_discursos_plenario` | Todos os discursos em plenário num intervalo de datas |
| `senado_discurso_texto` | Texto integral de um pronunciamento/discurso específico |

### Grupo J — Blocos e Lideranças (4 ferramentas)

| Ferramenta | Descrição |
|------|-------------|
| `senado_listar_blocos` | Blocos parlamentares do Senado e seus partidos membros |
| `senado_obter_bloco` | Detalhes de um bloco parlamentar específico |
| `senado_liderancas` | Lideranças do Senado/Congresso (líderes, vice-líderes), filtráveis |
| `senado_mesa` | Membros da Mesa Diretora via `casa` enum: senado (Mesa do SF) ou congresso (Mesa do CN) |

### Grupo K — Orçamento (1 ferramenta)

| Ferramenta | Descrição |
|------|-------------|
| `senado_orcamento_parlamentar` | Dados de emendas orçamentárias via `tipo` enum: emendas (lotes) ou oficios (ofícios de apoio) |

### Grupo L — Legislação Federal (2 ferramentas)

| Ferramenta | Descrição |
|------|-------------|
| `senado_buscar_legislacao` | Busca normas jurídicas federais por tipo, número, ano ou data (ao menos um obrigatório) |
| `senado_obter_legislacao` | Detalhes de uma norma jurídica federal específica |

### Grupo M — Votação em Comissão (1 ferramenta)

| Ferramenta | Descrição |
|------|-------------|
| `senado_votacao_comissao` | Votações em comissões via `por` enum: comissao, senador ou materia; período opcional |

### Grupo N — Taquigrafia (2 ferramentas)

| Ferramenta | Descrição |
|------|-------------|
| `senado_notas_taquigraficas` | Notas taquigráficas oficiais de sessões plenárias ou reuniões de comissão — modo resumo com trechos, modo texto integral paginado em blocos, filtro por orador |
| `senado_videos_taquigrafia` | Unidades de vídeo/áudio por sessão ou reunião, com orador e links de mídia |

### Grupo O — Senadores/Administrativo (2 ferramentas)

| Ferramenta | Descrição |
|------|-------------|
| `senado_ceaps` | Despesas da cota parlamentar (CEAPS) por ano — agregadas por senador, tipo de despesa, mês ou fornecedor, ou detalhe item a item; filtros por senador/mês/tipo/fornecedor |
| `senado_senadores_admin` | Dados administrativos dos senadores via `tipo` enum: auxilio-moradia, escritorios-apoio ou aposentados |

### Grupo P — Servidores / Gestão de Pessoas (4 ferramentas)

| Ferramenta | Descrição |
|------|-------------|
| `senado_servidores` | Servidores por situação (ativos/efetivos/comissionados/inativos), filtráveis por nome, unidade, cargo |
| `senado_remuneracoes_servidores` | Folha mensal — resumo por tipo de folha ou composição por pessoa com bruto calculado |
| `senado_horas_extras` | Pagamentos de horas extras por mês, com totais |
| `senado_pessoal_tabelas` | Tabelas de pessoal via `tabela` enum: quantitativos (pessoal, cargos-funcoes, previsao-aposentadoria, senadores) e listas (estagiarios, pensionistas, lotacoes, cargos) |

### Grupo Q — Contratações (6 ferramentas)

| Ferramenta | Descrição |
|------|-------------|
| `senado_contratos` | Contratos com filtros no servidor: fornecedor, CNPJ, ano, número, objeto, mão de obra |
| `senado_contratacao_detalhe` | Itens, pagamentos, garantias, aditivos ou ativações de um contrato/ata/empenho |
| `senado_licitacoes` | Licitações por número ou texto do objeto |
| `senado_terceirizados` | Colaboradores terceirizados por nome, empresa ou unidade |
| `senado_empresas_contratadas` | Empresas que contratam com o Senado (exige filtro por nome/CNPJ) |
| `senado_contratacoes_lista` | Atas de registro de preço, notas de empenho, menores aprendizes |

### Grupo R — Suprimento de Fundos (1 ferramenta)

| Ferramenta | Descrição |
|------|-------------|
| `senado_suprimento_fundos` | Adiantamentos de suprimento de fundos por ano: beneficiários, atos de concessão, empenhos, movimentações, transações de cartão |

### Grupo S — Orçamento do Senado (1 ferramenta)

| Ferramenta | Descrição |
|------|-------------|
| `senado_execucao_orcamentaria` | Execução orçamentária desde 2013 (dotação, empenhado/liquidado/pago) e receitas próprias desde 2012 (previsto vs. arrecadado) — agregadas por ano, ação, grupo de despesa, fonte ou origem de receita |

**Total: 66 ferramentas**

### Prompts (4)

Templates de workflow reutilizáveis em pt-BR (capacidade MCP `prompts`), definidos em `src/prompts.ts`:

| Prompt | Args | O que orienta |
| --- | --- | --- |
| `senado_gastos_senador` | `senador`, `ano` | Resolve o senador e agrega/detalha despesas CEAPS. |
| `senado_tramitacao_materia` | `sigla`, `numero`, `ano` | Obtém situação atual + histórico de tramitação da matéria. |
| `senado_votos_senador` | `senador`, `periodo?` | Lista os votos nominais do senador no período. |
| `senado_panorama_ecidadania` | — | Consolida consultas (consenso/polarização), ideias e eventos populares. |

### Recursos (5)

Documentos/tabelas de contexto estáticos (capacidade MCP `resources`), definidos em `src/resources.ts`:

| URI | Tipo | Conteúdo |
| --- | --- | --- |
| `senado://guia` | markdown | Visão geral e qual ferramenta usar por objetivo. |
| `senado://catalogo` | markdown | As 66 ferramentas agrupadas por domínio. |
| `senado://glossario` | markdown | Siglas e termos do Senado (PEC, CEAPS, CCJ, RCN…). |
| `senado://tabelas/tipos-materia` | json | Tipos de proposição (sigla/nome/descrição). |
| `senado://tabelas/ufs` | json | As 27 unidades federativas. |

## Estrutura do projeto

```
src/
├── index.ts              # Entrypoint do Worker (handler de fetch + handler scheduled/Cron)
├── server.ts             # Fábrica do McpServer (cria instância por requisição)
├── auth.ts               # Auth Bearer token opcional (comparação em tempo constante)
├── metrics.ts            # Contadores em memória servidos em /metrics
├── types.ts              # Env, categorias de cache, constantes de salvaguarda
├── cache/
│   ├── l0-memory.ts      # Cache Map em memória com TTL + evicção LRU
│   ├── l1-cache-api.ts   # Wrapper da Cloudflare Cache API (chaves GET sintéticas)
│   └── manager.ts        # Orquestrador de cache (L0 → L1 → upstream)
├── throttle/
│   ├── token-bucket.ts   # Rate limiter token bucket (global + por cliente)
│   └── upstream.ts       # Fetch upstream com limite de concorrência, retry, timeout
├── scraper/
│   ├── ecidadania.ts     # Scraper isolado do e-Cidadania (listas REST + detalhe HTML por regex; buildConsultaResumo)
│   ├── pipeline.ts       # Cron de 2h: splice de métrica direcionado (consultas/eventos/ideias); corpora são dos jobs semanais
│   ├── anomaly.ts        # Classificação de execução (execução anômala nunca sobrescreve current)
│   └── store.ts          # Leituras D1 (resolveList + staleness por entidade, lastGoodRunAt) + write-through de detalhe
├── instrument.ts         # Telemetria de chamadas por ferramenta (memória + Analytics Engine)
├── utils/
│   ├── logger.ts         # Logging estruturado em JSON
│   └── validation.ts     # helpers toolResult, toolError, errorFrom, buildParams, ensureArray
└── tools/
    ├── referencia.ts        # Grupo H — 1 ferramenta de referência/metadados
    ├── senadores.ts         # Grupo A — 5 ferramentas de senadores
    ├── materias.ts          # Grupo B — 2 ferramentas de matérias (backend v3)
    ├── processos.ts         # Grupo C — 5 ferramentas de processos
    ├── votacoes.ts          # Grupo D — 3 ferramentas de votações
    ├── comissoes.ts         # Grupo E — 7 ferramentas de comissões
    ├── plenario.ts          # Grupo F — 7 ferramentas de plenário
    ├── ecidadania.ts        # Grupo G — 9 ferramentas do e-Cidadania (leem do D1; veja scraper/)
    ├── discursos.ts         # Grupo I — 3 ferramentas de discursos
    ├── composicao.ts        # Grupo J — 4 ferramentas de blocos/lideranças
    ├── orcamento.ts         # Grupo K — 1 ferramenta de orçamento
    ├── legislacao.ts        # Grupo L — 2 ferramentas de legislação federal
    ├── votacao-comissao.ts  # Grupo M — 1 ferramenta de votação em comissão
    ├── taquigrafia.ts       # Grupo N — 2 ferramentas de notas taquigráficas
    ├── senadores-admin.ts   # Grupo O — 2 ferramentas administrativas de senadores (CEAPS, moradia)
    ├── servidores.ts        # Grupo P — 4 ferramentas de pessoal
    ├── contratacoes.ts      # Grupo Q — 6 ferramentas de contratações
    ├── supridos.ts          # Grupo R — 1 ferramenta de suprimento de fundos
    └── orcamento-senado.ts  # Grupo S — 1 ferramenta de execução orçamentária
scripts/
└── ingest-ecidadania/    # Ingestão semanal do corpus completo de consultas, fora do Worker (via `npm run ingest:ecidadania`)
    ├── index.ts          # Orquestrador: crawl → status (/processo) → normaliza → guards → out.sql
    ├── listing.ts        # Parser puro da listagem (parseConsultaListingPage, findLastPage)
    ├── status.ts         # conjunto tramitando=S de /processo → aberta/encerrada (deriveStatus)
    ├── restatus.ts       # Correção de linger: re-status das linhas armazenadas por presença em /processo (fecha zumbis)
    ├── http.ts           # Fetch educado (retry/backoff) para o crawl não supervisionado
    ├── d1.ts             # Pré-leituras do D1 (meta existente, payloads, últimas boas linhas) via wrangler
    └── sql.ts            # Geração do out.sql (espelha SQL.upsert/SQL.history; reusa SyncRecord)
.github/workflows/        # publish-mcp.yml (registry) + ingest-ecidadania.yml (carga semanal do corpus no D1)
migrations/               # Schema D1 (0001 tabelas, 0002 índices) para o pipeline do e-Cidadania
tests/                    # Testes unitários Vitest espelhando src/ (parsers, cache, throttle, auth, scraper,
                          # pipeline/anomaly/store, listing/sql/highlights, além de testes de contrato do e-Cidadania)
```

## Variáveis de ambiente

| Variável | Obrigatória | Padrão | Descrição |
|----------|----------|---------|-------------|
| `SENADO_BASE_URL` | Não | `https://legis.senado.leg.br/dadosabertos` | URL base da API legislativa |
| `SENADO_ADM_BASE_URL` | Não | `https://adm.senado.gov.br/adm-dadosabertos` | URL base da API administrativa |
| `ALLOWED_ORIGIN` | Não | `*` | Origem permitida no CORS |
| `API_KEY` | Não (secret) | — | Quando definido, exige `Authorization: Bearer <key>` em todas as requisições exceto `/health`, `/metrics` e preflight CORS |
| `CACHE_KV` | Sim (binding) | — | Namespace KV para o cache L2 |
| `ECIDADANIA_DB` | Sim (binding) | — | Banco D1 para o pipeline do e-Cidadania (persistência de listas + histórico) |
| `ECIDADANIA_CORPUS_STALE_MAX_MIN` | Não | `14400` | Janela de desatualização (minutos, ~10d) para os corpora semanais completos (todas as entidades do e-Cidadania) — servido com flag, nunca colapsado para destaques |
| `ECIDADANIA_CORPUS_MIN_PCT` | Não | `80` | Piso catastrófico para os jobs de corpus fora do Worker: um crawl/parse completo abaixo desse % do último bom corpus é rejeitado |
| `CLOUDFLARE_API_TOKEN` | Não (secret) | — | Secret do GitHub Actions (escopo de edição D1) para o job semanal de ingestão do corpus; não usado pelo Worker |
| `CLOUDFLARE_ACCOUNT_ID` | Não (var do Actions) | — | Variável de repositório do GitHub Actions para o wrangler pular o auto-discovery de conta via `/memberships` (um token com escopo só de D1 não consegue lê-lo); obrigatória junto com `CLOUDFLARE_API_TOKEN` no job de ingestão |
| `SENADO_ANALYTICS` | Não (binding) | — | Dataset do Analytics Engine para telemetria de chamadas por ferramenta |

## Conectando clientes MCP

Este é um servidor **remoto** (Streamable HTTP, sem instalação, acesso aberto) — aponte qualquer cliente MCP para
`https://senado.sidneybissoli.com/mcp`. Além das 66 ferramentas, ele expõe **prompts** (workflows prontos em pt-BR:
`senado_gastos_senador`, `senado_tramitacao_materia`, `senado_votos_senador`,
`senado_panorama_ecidadania`) e **recursos** (`senado://guia`, `senado://catalogo`,
`senado://glossario`, `senado://tabelas/tipos-materia`, `senado://tabelas/ufs`).

### Um clique (LobeHub)

Instale pelo marketplace do LobeHub — abra a
[página do servidor](https://lobehub.com/mcp/sidneybissoli-senado-br-mcp-cloudflare) e clique em **Install**
(ele pré-preenche o endpoint remoto, sem config necessária).

### Claude Desktop / Claude Code

Adicione à sua configuração MCP:

```json
{
  "mcpServers": {
    "senado-br": {
      "url": "https://senado.sidneybissoli.com/mcp"
    }
  }
}
```

Para clientes baseados em comando (ou qualquer cliente sem suporte remoto nativo), use a ponte `mcp-remote`:

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

## Licença

MIT

## Créditos

Ícone: *"Amanhecer no Congresso Nacional"* — fotografia do Congresso Nacional
brasileiro, usada sob licença Creative Commons. (Se você é o autor, abra uma
issue para adicionarmos a atribuição completa / o link da licença.)
