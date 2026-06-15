# P2 — Fechamento (e-Cidadania como dataset soberano)

> 2026-06-15. P2 declarado concluído no Passo 4. Fechamento conforme `RESPOSTA_P2_PASSO4_POS_DEPLOY.md`.

## (a) O que o P2 entregou
Pipeline soberano do e-Cidadania, sobre a instrumentação da Fase A:
- **D1** `senado-ecidadania` com schema `current` / `history` (append-on-change) / `detalhe` / `scrape_runs`
  (migrations `0001`/`0002`).
- **Cron** `0 */2 * * *` → `scheduled()` → `refreshEcidadania()` (`src/scraper/pipeline.ts`): scrape das 3
  listas REST de destaque → upsert `current` + append-on-change `history` + `scrape_runs`, com **trava de
  anomalia** (run anômalo/erro nunca sobrescreve `current` — `src/scraper/anomaly.ts`).
- **Scraper isolado** (`src/scraper/ecidadania.ts`) + **contract tests com fixtures reais** (HTML/JSON).
- **Tools lendo do D1** (`src/scraper/store.ts`): `listar_*`/`consultas_analise`/`sugerir_tema` via
  `resolveList` (D1-first / live-fallback, nunca quebra, `meta` aditivo com `fonte`/`lastScrapedAt`
  SEMPRE/`possivelDesatualizacao`, limiar `ECIDADANIA_STALE_MAX_MIN`). `obter_*` ao vivo + **write-through
  fire-and-forget** (dedup por `content_hash`) em `ecidadania_detalhe`.
- Verificado em produção (worker `6067b97a`): `listar_*` → `fonte:"d1"`; `obter_*` → linha em `detalhe`;
  65 tools; run natural do cron confirmado. `prod == master` (`fb4c300`). 334 testes.

**Enquadramento honesto:** as listas vêm dos endpoints REST de **destaque** (~5/entidade), **não** o corpus
completo (REST sem paginação — verificado). É acompanhamento de destaques + série temporal, não corpus soberano.

## (b) Passo 5 (envelope de erro `{success,data,metadata,suggestion}`) — NÃO feito isolado
Dobrado no **reshape de portfólio deferido** (padronização do envelope nas 65 tools, uma vez). Razão: o
caminho de erro atual já é estruturado (`toolError` → `{error, retryable}` + sufixo "demais funcionalidades…
continuam operacionais") e o sucesso já entrega `structuredContent` + `meta`. O envelope acrescentaria pouco
(`success:false`≈`isError:true`; `suggestion`≈`retryable`+mensagem; `metadata`≈`meta`) e a única parte que
muda contrato (embrulhar sucesso sob `data`) não agrega p/ consumidor LLM — polish de baixo valor **com**
quebra. Fazê-lo parcial em 8 tools criaria inconsistência 8-vs-57 e retrabalho. Único item feito agora: **fix
de logging** (e-Cidadania passou a emitir `logger.error("tool_error", …)` como as demais; aditivo, sem bump).

## (c) Deferidos consolidados (pós-P2)
- **Padronização do envelope de erro nas 65 tools** (inclui as 8 do e-Cidadania) — quebra de contrato a
  fazer **uma vez**, com bump + nota de migração, quando o valor justificar. Notas para essa hora:
  verificar se o scraper seta `retryable:true` em falhas transitórias (senão o flag é peso morto);
  considerar campo `hint` aditivo em `{error, retryable, hint}` se quiser "suggestion" sem quebrar.
- **P2.6 — corpus completo do e-Cidadania via HTML `/pesquisa*`** (frágil; decisão estratégica à parte).
- Dual-build npx, extensão à Câmara, `SKILL.md`, re-arquitetura stateless (P0.1; gatilho "spec final 2026-07-28").
