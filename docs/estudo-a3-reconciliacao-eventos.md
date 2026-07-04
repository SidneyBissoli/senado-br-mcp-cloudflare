# Estudo de reconciliação listagem × detalhe de EVENTOS (achado A3)

> **Escopo.** Achado A3 da ETAPA 4 (ROADMAP CIENTÍFICO, ETAPA 5, última linha da tabela). Este
> documento é **evidência reproduzível + recomendação**. **Não** altera `src/dataset/schema.ts` nem
> os caveats provisórios; **não** corta release; **não** mexe na máquina de releases (Fase 1.3) nem
> em contract tests (Fase 2.1/C3). A decisão por campo (documentar / coletar-do-detalhe / remover) é
> **👤**, à vista da evidência — guardrail, como a ETAPA 4. Se a decisão implicar mudança de
> dado/schema, ela vira um release (v1.1.0/v2.0.0) numa etapa posterior, pela máquina da Fase 1.3.

- **Data do estudo:** 2026-07-04 (vintage do corpus D1 no momento; ver limitações).
- **Pergunta:** os campos `data`, `hora` e `comentarios` de `eventos` vêm SÓ da listagem
  `principalaudiencia`. A página de detalhe `visualizacaoaudiencia?id=` diverge? Quanto, em que
  sinal, e qual fonte é canônica por campo?
- **Base factual:** `docs/reconhecimento-ecidadania.md`, `docs/etapa4-validacao-proveniencia.md`,
  e os parsers reais `scripts/ingest-ecidadania/eventos-listing.ts` + `src/scraper/ecidadania.ts`.

## Reprodutibilidade

- **Script:** `scripts/study-a3-eventos/index.ts` — `npx tsx scripts/study-a3-eventos/index.ts`
  (precisa de credencial `wrangler` para ler o D1 `--remote`; ~200 requisições vivas com throttle).
- **Saídas (versionadas):** `docs/estudo-a3/amostra.csv` (uma linha por evento: listagem, detalhe,
  contagem canônica de comentários, deltas) e `docs/estudo-a3/resumo.json` (estatística agregada).
- **Fonte da listagem** = corpus soberano D1 `ecidadania_current` (é exatamente o que o dataset
  harmonizado carrega — o pipeline apenas normaliza esse payload). **Fonte do detalhe** = fetch vivo
  do parser real `obterEventoInternal`. **Fonte canônica de comentários** = endpoint AJAX (abaixo).

## Desenho amostral

- **Frame:** 5.446 eventos em `ecidadania_current` (entidade `eventos`). Distribuição de status
  fortemente enviesada: **encerrado 5.047 · cancelado 392 · agendado 7**.
- **Sorteio determinístico:** chave `h(id) = (id·2654435761) mod (2³¹−1)` (mesma da ETAPA 4);
  dentro de cada célula, ordena por `h(id)` e toma os primeiros _k_. Reexecutar dá a mesma amostra.
- **Estratos:** status × época (ano do evento). Bins de época: `historico ≤2018 · intermediario
  2019–2022 · recente 2023–2027`. `agendado` é **censo** (só há 7). Alocação (n=100):

  | status | alocação | histórico | intermediário | recente |
  |---|---|:-:|:-:|:-:|
  | agendado | censo (7) | — | — | — |
  | cancelado | 23 | 11 | 7 | 5 |
  | encerrado | 70 | 28 | 20 | 22 |

  A sobre-amostragem das caudas raras (agendado, cancelado) é intencional — permite falar por status;
  as taxas por estrato estão reportadas abaixo, não agregadas cegamente.
- **Cobertura:** 100/100 detalhes obtidos, 0 erros; contagem canônica de comentários obtida em 100/100.

## Achado arquitetural (pré-requisito das recomendações)

A contagem de comentários **não está no HTML da página de detalhe**: o container
`<div id="comentarios"></div>` é populado por AJAX (`ajaxColecaoComentarioAudiencia`). Prova empírica:
a soma de `comentarios` lida do HTML de detalhe pelo parser (`obterEventoInternal`) na amostra é **0**.
A contagem **canônica** vem de:

```
GET /ecidadania/ajaxcolecaocomentarioaudiencia?audienciaId=<id>   (fragmento HTML, sem paginação)
→ nº de blocos <div class="comentario" id="comentario-N">
```

Validação contra a ETAPA 4 (conferência humana via DevTools): 38311 → 62 ✓ · 13835 → 1 ✓ ·
15127 → 7 (ETAPA 4 vira 8; +1 de freshness). Consequência de custo: "coletar comentários do detalhe"
é, na prática, **uma terceira requisição por evento** a um endpoint interno — não sai de graça no
mesmo fetch do detalhe.

## Resultados

### `data` — praticamente fiel

- **1 de 94** pares comparáveis divergem (**1,1 %**); o único caso (id 23201) difere de **−1 dia**
  (listagem 2022-05-11 vs detalhe 2022-05-12). Por época: sem concentração.
- **Fonte canônica:** detalhe (`span.audiencia-data`), mas a listagem concorda em 98,9 %.
- **Leitura:** o caveat provisório atual **superdimensiona** o problema de `data`.

### `hora` — divergência sistemática e grande

- **54 de 94** pares divergem (**57,4 %**). Por época: **histórico 29/36 (80,6 %) · intermediário
  14/26 (53,8 %) · recente 11/32 (34,4 %)**.
- **Duas divergências distintas:**
  1. **Placeholder `00:00` em eventos antigos.** Em 7 eventos históricos (2014–2016) a listagem traz
     `00:00` e o detalhe traz o horário real (10:00, 09:00, 14:30…). São os deltas grandes negativos
     (`−540`, `−600`, `−870`…). A listagem simplesmente **não tem** hora ali; o detalhe tem.
  2. **Offset de minutos.** Nos demais, a listagem fica **adiantada** frente ao detalhe: distribuição
     do delta (min→det, casos ≠0) mediana **+15 min**, p25 +2, p75 +28, máx +52 (ex. o clássico da
     ETAPA 4: 15127 listagem 10:16 vs detalhe 10:00). Há 1 outlier genuíno recente (31940: 09:35 vs
     14:00, −265).
- **Fonte canônica:** detalhe (`audiencia-data`) — carrega o horário real agendado; a listagem é uma
  renderização degradada (placeholder + offset). `hora` da listagem **não serve** para cruzamento fino.

### `comentarios` — 0 espúrio pervasivo; listagem cega ao engajamento

- Dos **94** eventos com `comentarios = 0` na listagem/dataset, **77 (81,9 %)** têm contagem canônica
  **> 0** ("0 espúrio"). Distribuição do canônico nesses 77: mediana **15**, p75 **49**, **máx 345**.
- Por época, o 0 espúrio **piora com a recência**: **histórico 27/39 (69 %) · intermediário 22/27
  (81 %) · recente 27/27 (100 %)**; canônico máximo por época 49 → 99 → **345**. Eventos recentes
  com `0` na listagem escondem **sempre** comentários reais.
- **Subcontagem total:** soma canônica na amostra **2.638** vs soma da listagem **176** — o dataset
  captura **≈6,7 %** do engajamento real.
- **Quando a listagem expõe a contagem, ela é exata.** Nos 6 eventos (todos recentes, alta id) com
  `comentarios > 0` na listagem, 5/6 batem exatamente com o canônico (17=17, 35=35, 38=38, 36=36,
  1=1) e 1 difere por freshness (49 vs 52). **O problema é cobertura, não acurácia:** a listagem só
  expõe a contagem para o punhado de eventos em destaque/ativos.
- **Fonte canônica:** endpoint AJAX `ajaxcolecaocomentarioaudiencia` — nem a listagem nem o HTML de
  detalhe servem. O valor é **volátil** (comentários acumulam ao longo do tempo).

### `status` (verificação lateral)

Os 7 `agendado` da amostra têm status coerente no detalhe (0 divergências); nenhum fold
REGISTRADO→agendado apareceu como inversão. Sem achado novo aqui.

## (a) Fonte canônica por campo

| Campo | Fonte canônica | A listagem é… |
|---|---|---|
| `data` | detalhe `audiencia-data` | fiel (98,9 %) |
| `hora` | detalhe `audiencia-data` | degradada (placeholder `00:00` em antigos + offset mediano +15 min) |
| `comentarios` | endpoint AJAX `ajaxcolecaocomentarioaudiencia` (contagem de blocos) | cega (0 espúrio em 82 %; capta ~6,7 % do total) |

## (b) Magnitude e sinal por campo

- `data`: 1,1 % divergente, magnitude 1 dia. Desprezível.
- `hora`: 57,4 % divergente; **sinal positivo** dominante (listagem adiantada, mediana +15 min) +
  cauda de placeholders `00:00` em eventos antigos. Pior no histórico (80,6 %), ainda material no
  recente (34,4 %).
- `comentarios`: 81,9 % de 0 espúrio, monotônico com a recência (recente = 100 %); subcontagem de
  ~93 % do volume. Acurácia perfeita **quando** presente (coberto em ~6 %).

## (c) Recomendação por campo — com custo/benefício

> Arquitetura atual de ingest: crawl **só da listagem** `principalaudiencia` (~55 páginas). Custo
> evitado hoje ≈ 5.446 req de detalhe por ciclo. Nota-chave de custo: `data`/`hora` são **imutáveis**
> depois que o evento passa → coletáveis **uma vez** (no first-seen) e nunca mais; `comentarios` é
> **volátil** → exigiria re-coleta a cada ciclo para permanecer fiel.

### `data` → **DOCUMENTAR** (caveat definitivo leve)

98,9 % fiel. O caveat provisório atual exagera. Rebaixar para nota curta ("detalhe é canônico;
divergência de borda de 1 dia possível"). *Opcional* e barato: preencher do detalhe no first-seen
para chegar a 100 %, já que é imutável (mesma requisição que resolveria `hora`). Benefício marginal;
não bloqueante.

### `hora` → **COLETAR-DO-DETALHE** (recomendado), com **DOCUMENTAR** como plano B

- **Coletar-do-detalhe:** custo é um **backfill único** (~5.446 req a `visualizacaoaudiencia?id=`,
  uma vez) + incremento diário desprezível (só eventos novos), porque a hora é imutável. Ganho:
  elimina placeholder `00:00` e o offset; entrega hora canônica permanente. Melhor relação
  custo/benefício dos três — a volatilidade zero amortiza o custo para ~0 após o backfill.
- **Documentar:** manter a hora da listagem com caveat forte ("não-canônica; 00:00 = ausente; use o
  detalhe para cruzamento"). Custo zero, mas embarca um campo sabidamente degradado em 57 % dos casos.
- **Remover:** desproporcional — descartaria um campo genuinamente útil e barato de corrigir.

### `comentarios` → decisão de fundo 👤: **REMOVER** (default honesto) **ou** **COLETAR-DO-DETALHE** (se engajamento for variável-título)

Este é o campo tenso, e é justamente o sinal de **participação** — o núcleo científico do dataset.

- **Documentar (não recomendado isolado):** um `0` que 82 % das vezes significa "não exposto", não
  "zero comentários", é enganoso por construção. Parece dado, mas não é — envenena exatamente a
  análise de engajamento que o dataset existe para viabilizar.
- **Coletar-do-detalhe:** +~5.446 req **recorrentes por ciclo** ao endpoint AJAX interno
  (`ajaxcolecaocomentarioaudiencia`) — custo contínuo real + fragilidade (endpoint não documentado,
  fora do contrato). Ganho: uma métrica de engajamento **verdadeira**, o diferencial frente ao
  `congressbr`. Se `comentarios` for headline, vale o investimento — e entra como contract test na C3.
- **Remover:** honesto e barato de manter; elimina o campo enganoso. É o default sob a disciplina de
  **mantenedor único + custo** que rege o roadmap (Etapa 2), a menos que engajamento seja promovido a
  variável central.

Recomendação sintetizada: **remover na arquitetura atual, ou promover a coleta-do-detalhe se e
somente se a participação por comentários for declarada variável-título do paper.** Não deixar em
"documentar-e-seguir" — é a pior opção para um dataset de participação.

## Limitações do estudo

- **Vintage único.** Compara um snapshot da listagem (corpus D1) contra o detalhe vivo de 2026-07-04.
  Para `comentarios`, parte da diferença é freshness (comentários acumulam) — mas o **0 espúrio** é
  estrutural: freshness só adiciona comentários, nunca cria um 0 falso. Para `hora`/`data` de eventos
  passados, os valores são imutáveis → divergência é estrutural, não freshness.
- **Amostra estratificada com sobre-amostragem das caudas** (agendado/cancelado). Taxas reportadas
  **por estrato**; não extrapolar a média simples da amostra para o corpus sem reponderar por status
  (o corpus é 92,7 % encerrado).
- **Contagem canônica de comentários** = nº de blocos no fragmento AJAX (sem paginação observada; o
  JS faz `.empty().append()` único). Se o endpoint truncar em algum teto não observado, o canônico
  seria piso — o que só reforçaria a subcontagem da listagem.

## Estado

Nenhuma alteração em `schema.ts` ou nos caveats. Os caveats provisórios de `data`/`hora`/`comentarios`
seguem no `schema.ts` aguardando a decisão 👤 (a/c acima). Se aprovada mudança de dado/schema, ela é
executada depois pela máquina de releases da Fase 1.3 (novo version-DOI).
