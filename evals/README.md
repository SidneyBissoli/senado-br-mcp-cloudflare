# Eval harness — seleção de tool (Sessão 1 do ROADMAP)

Harness reaproveitável que mede a **acurácia com que um modelo escolhe a tool certa** entre as
~66 tools do MCP senado-br, dada uma consulta em pt-BR de jornalista/pesquisador.

É o *linchpin* da Sessão 1 do ROADMAP CIENTIFICO (planejamento local, `docs/_local/`): o resultado decide se o catálogo precisa de
refatoração (deferred loading / Code Mode / agrupamento). O item *"rodar evals após mudança de
tool"* do bloco **Contínuo** depende deste harness ser barato de reexecutar — por isso o núcleo
(catálogo + fixtures + scorer) roda **offline em `npm test`**, sem rede e sem modelo.

## Arquivos

| Arquivo | Papel |
|---|---|
| `evals/catalog.ts` | **Extrator de catálogo.** Um "fake McpServer" captura cada `server.tool(name, desc, shape, cb)` ao rodar os `registerXTools` de `src/tools/*` — sem rede, sem runtime de Worker. Fonte de verdade das 66 tools (nome, descrição, JSON-schema do input). Também converte os shapes Zod → JSON-schema (sem dependência nova) e monta o array `tools` da Anthropic. |
| `evals/fixtures/queries.ts` | **45 consultas pt-BR** (persona jornalista/pesquisador), cada uma com `{ id, query, expectedTools, note }`. Cobre 16 áreas e inclui casos "vizinhos"/ambíguos (ex.: `senado_search_votacoes` vs `senado_obter_votacao`). |
| `evals/score.ts` | **Núcleo de scoring puro.** top-1 / top-k / por-área + a lógica de gate do ROADMAP. Sem rede, sem modelo — é o que os testes unitários exercitam. |
| `evals/run.ts` | **Runner com modelo real.** Manda cada query + as 66 tools para a Anthropic Messages API (`tool_choice: any`), registra a tool escolhida, e imprime o relatório agregado + decisão de gate. |
| `tests/evals/fixtures.test.ts` | Valida fixtures contra o catálogo real (pega regressão quando uma tool é renomeada), contagem 30–50, sem ids/queries duplicados, cobertura de áreas. |
| `tests/evals/score.test.ts` | Correção do scorer e do gate com casos sintéticos de acurácia conhecida. |

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

A partir da **acurácia top-1** (`evals/score.ts → evaluateGate`):

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
