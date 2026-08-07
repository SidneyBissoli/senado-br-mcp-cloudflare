# Eval harness — seleção de tool (Sessão 1 do ROADMAP)

Harness reaproveitável que mede a **acurácia com que um modelo escolhe a tool certa** entre as
~67 tools do MCP senado-br, dada uma consulta em pt-BR de jornalista/pesquisador.

É o *linchpin* da Sessão 1 do ROADMAP CIENTIFICO (planejamento local, `docs/_local/`): o resultado decide se o catálogo precisa de
refatoração (deferred loading / Code Mode / agrupamento). O item *"rodar evals após mudança de
tool"* do bloco **Contínuo** depende deste harness ser barato de reexecutar — por isso o núcleo
(catálogo + fixtures + scorer) roda **offline em `npm test`**, sem rede e sem modelo.

O motor do harness (extrator de catálogo, validação de fixtures, scorer, gate, retry e
runner) vive no pacote **`@sbissoli/mcp-evals`** (monorepo `mcp-br-commons`, adoção da
Fase 1); este diretório guarda só o que é específico do senado.

## Arquivos

| Arquivo | Papel |
|---|---|
| `evals/catalog.ts` | **GROUPS do senado** (um por grupo de `src/server.ts` — grupo faltando encolhe o eval em silêncio) → `CATALOG = buildCatalog(GROUPS)` do pacote. Fonte de verdade das 67 tools (nome, descrição, JSON-schema do input). |
| `evals/fixtures/queries.ts` | **47 consultas pt-BR** (persona jornalista/pesquisador), cada uma com `{ id, query, expectedTools, note }`. Cobre 16 áreas e inclui casos "vizinhos"/ambíguos (ex.: `senado_search_votacoes` vs `senado_obter_votacao`). |
| `evals/run.ts` | **Runner com modelo real** — `runEval({ catalog, fixtures, systemPrompt })` do pacote: manda cada query + as 67 tools para a Anthropic Messages API (`tool_choice: any`), registra a tool escolhida, e imprime o relatório agregado + decisão de gate. |
| `tests/evals/fixtures.test.ts` | Testes específicos do senado (contagem exata de 67 tools, prefixo `senado_`, spot-checks de schema) + `validateFixtures` do pacote (contagem 30–50, ids/queries únicos, tools existentes, >= 12 áreas). |

O scorer, o gate, o retry e o runner são testados no próprio pacote (61 testes offline,
incluindo compatibilidade byte-a-byte das mensagens de gate com o harness original).

## Como rodar

### Offline (CI, sem rede) — sempre

```bash
npm test            # inclui tests/evals/* (catálogo + fixtures + scorer)
npm run typecheck   # cobre evals/** (tsconfig.json inclui "evals/**/*.ts")
```

### Com modelo real (mede a acurácia de seleção)

```bash
ANTHROPIC_API_KEY=sk-ant-... npx tsx evals/run.ts
```

Sem `ANTHROPIC_API_KEY` o runner imprime instruções e sai com código 0 — **nunca quebra CI nem
exige rede**.

Variáveis opcionais:

| Var | Padrão | Efeito |
|---|---|---|
| `EVAL_MODEL` | `claude-opus-4-8` | Modelo da seleção (ex.: `claude-sonnet-4-6`). |
| `EVAL_CONCURRENCY` | `4` | Requisições paralelas. |
| `EVAL_LIMIT` | (todas) | Roda só as N primeiras fixtures (smoke rápido). |

## Lógica de gate (ROADMAP — Sessão 1)

A partir da **acurácia top-1** (`evaluateGate` do pacote, com `toolCount` preenchido do
catálogo pelo runner):

| Acurácia top-1 | Decisão | Recomendação |
|---|---|---|
| `< 85%` | `remediar` | Abrir **sessão de remediação** (deferred loading / Code Mode / agrupamento por sessão). |
| `85%–90%` | `zona-cinzenta` | Manter sob observação; reavaliar após a próxima mudança de tool/descrição. |
| `>= 90%` | `despriorizar-refatoracao` | **Despriorizar** refatoração de catálogo; seguir só consolidando via enums. |

## Por que o núcleo é offline

Renomear/remover uma tool em `src/tools/*` muda o catálogo extraído; qualquer fixture apontando
para o nome antigo **falha imediatamente** em `tests/evals/fixtures.test.ts`, de graça e sem rede.
Esse é o valor reaproveitável: o sinal de regressão de seleção fica acoplado à realidade do código,
e a rodada cara (modelo) só é necessária quando você quer o número de acurácia em si.
