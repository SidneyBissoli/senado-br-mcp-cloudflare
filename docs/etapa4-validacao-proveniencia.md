# ETAPA 4 - Validação manual de proveniência (worksheet)

**Build validado**: `dataset/1.0.0/` (`generatedAt: 2026-07-02T16:14:00.182Z`, schemaVersion `1.0.0`, build completo, `sample: null`).  
**Amostra**: 19 registros, sorteio determinístico `(entity_id*2654435761)%2147483647` por estrato, extraída do D1 em 02/07/2026.  
**Valores esperados abaixo** = `payload_json`/`scraped_at`/`MIN(scraped_at)` do D1 no momento do sorteio.  

## Regras de veredito

| Situação | Veredito |
|---|---|
| `sourceField` aponta campo errado / seletor inexistente / semântica trocada | **REPROVA** (C1-fix + amostra nova) |
| Valor no NDJSON != valor esperado (D1) | **REPROVA** (bug de pipeline) |
| Valor == D1, mas != upstream vivo | **OK** - freshness (upstream mudou após `retrievedAt`), não é falha |
| Um único ponteiro errado | reprova a etapa inteira |

Notas de freshness (para não gerar falso REPROVA):  
- Votos/apoios/comentários são voláteis: no vivo, espere valor >= snapshot, mesma ordem de grandeza.  
- `referencePeriod` do acervo = 2026-06-28 (carimbo do CSV baixado em 29/06). O CSV vivo de hoje terá carimbo mais novo na linha 1 - as linhas de dados é que devem ser idênticas (acervo congelado).  
- Evento 39710 tinha data = 02/07 10:00; ao validar, o vivo pode já ter flipado para `encerrado` - freshness.  

## Conferências por registro (A, B, C)

- **A - Pipeline fiel ao corpus:** extrair a linha do NDJSON e conferir `value` de cada campo == esperado e `retrievedAt` == `scraped_at` esperado. PowerShell:
  `Select-String -Path dataset\1.0.0\consultas.ndjson -Pattern '"entityId":155307\b' | % Line`
- **B - Ponteiro estrutural (o guardrail):** abrir a listagem viva (p1 serve) com DevTools e confirmar que cada seletor declarado no dicionário existe e carrega a semântica declarada (SIM no `span[1]`, NÃO no `span[2]`, apoios no `footer`, sigla após `|`, sufixo de classe `resumo-audiencia-STATUS`).
- **C - Sanidade viva + derivados:** abrir o `url` do registro; recomputar à mão `totalVotos`/percentuais; conferir status contra a fonte declarada.

Checagem de status por registro:   
- **consultas**: `https://legis.senado.leg.br/dadosabertos/processo?codigoMateria={id}` -> `tramitando: "Sim"` equivale a `aberta`; `"Não"` equivale a `encerrada` (linger).  
- **ideias**: página de detalhe (`Situação da Ideia`) coerente com o mapa `{5,6,8}->aberta, {7,9}->encerrada, 10->convertida`.  
- **eventos**: classe `situacao-audiencia-*` no detalhe.  

## Verificação estrutural única (1x por entidade, na p1 viva)

| Feito | Página | O que inspecionar |
|:-:|:-:|--------------------------------------------------------------|
| [x] | `pesquisamateria?p=1` | `div.resumo-materia > header > a` = identificação; `> section > a` = ementa; `figure.grafico-consulta-publica > header > span[1]` = SIM, `span[2]` = NÃO (confirmado via querySelector em 02/07; span[0]=714.851 SIM, span[1]=1.005.522 NÃO no PL 5064/2023) |
| [x] | `pesquisaideia?situacao=6&p=1` | `article.resumo-ideia > section > a` = título (OK); apoios em `article.resumo-ideia > figure.grafico-ideia-legislativa > footer > span[1]` (ver A2: dicionário omitia o nível figure; parser regex correto) |
| [x] | `principalaudiencia?p=1` | `article.resumo-audiencia-{STATUS}`; `.descricao > a` = título; `span.data` = "DD/MM/AA \| HH:MM"; `em.sigla` = token após `\|` (confirmado 02/07: classe `...-AGENDADO`, `span.data`="06/07/26 \| 09:30", `em.sigla`="\| CCS" → split descarta o pipe; `sourceField` fiel, sem A3) |
| [x] | Constantes | 1a linha de cada `.ndjson`: envelope com exatamente 6 campos; `license` e `schemaVersion` = dicionário (conferido programaticamente via etapa4-extract.R nos 19 registros) |

## Consultas (6 registros)

| entity_id | matéria | status | votosSim | votosNao | total/pct (derivar à mão) | retrievedAt esperado | firstSeenAt esperado | Estrato |
|:-:|:-:|:-:|:-:|:-:|:-:|---|---|:-:|
| 155307 | PL 4606/2019 | aberta | 13.386 | 2.103 | 15.489 / 86-14 | 2026-07-02T08:11:09.537Z | 2026-06-16T13:15:49.544Z | grande |
| 141006 | PL 573/2020 | aberta | 457 | 2 | 459 / **100-0** (edge de arredondamento) | 2026-07-02T08:11:09.537Z | 2026-06-16T13:15:49.544Z | média |
| 135228 | PL 726/2019 | aberta | 9 | 0 | 9 / 100-0 | 2026-07-02T08:11:09.537Z | 2026-06-16T13:15:49.544Z | pequena |
| 169214 | PDL 453/2024 | encerrada | 0 | 0 | 0 / **0-0** (edge totalVotos=0) | **2026-06-29T09:22:43.983Z** (congelado no flip) | 2026-06-16T13:15:49.544Z | linger |
| 167850 | PLP 73/2025 | encerrada | 42 | 7 | 49 / 86-14 | **2026-06-22T10:33:42.692Z** (congelado no flip) | 2026-06-16T13:15:49.544Z | linger |
| 174759 | PDL 618/2026 | aberta | 0 | 0 | 0 / 0-0 | 2026-07-02T08:11:09.537Z | **2026-06-22T10:33:42.692Z** (cauda pós-baseline) | cauda |

| entity_id | A | B | C | Obs. |
|:-:|:-:|:-:|:-:|---|
| 155307 | [x] | [x] | [x] | vivo confere; `tramitando:"Sim"` |
| 141006 | [x] | [x] | [x] | vivo confere; `tramitando:"Sim"` |
| 135228 | [x] | [x] | [x] | vivo confere; `tramitando:"Sim"` |
| 169214 | [x] | [x] | [x] | `tramitando:"Não"` confirmado (linger ok) |
| 167850 | [x] | [x] | [x] | `tramitando:"Não"` confirmado (linger ok) |
| 174759 | [x] | [x] | [x] | vivo confere; `tramitando:"Sim"` |

## Ideias (5 registros) - `dataPublicacao` e `autor` esperados **null** em todos (detail-only)

| entity_id | título | status | apoios | retrievedAt esperado | firstSeenAt esperado |
|:-:|----------------------------------------|:-:|:-:|---|---|
| 218615 | Aumento de Pena para Produção e Distribuição de Conteúdo Abusivo | aberta | 0 | 2026-07-02T08:13:51.918Z | 2026-06-29T09:25:21.812Z |
| 216031 | Escuta do acusado de violência doméstica nas primeiras 48h pelo judiciário | aberta | 3 | 2026-07-02T08:13:51.918Z | 2026-06-29T09:25:21.812Z |
| 177199 | Garantir banheiros separados por sexo de nascimento para mulheres e crianças do Brasil. | convertida | 21.524 | 2026-07-02T08:13:51.918Z | 2026-06-29T09:25:21.812Z |
| 90152 | Lei Rouanet | encerrada | 12 | 2026-07-02T08:13:51.918Z | 2026-06-29T09:25:21.812Z |
| 135228 | Direitos iguais. | encerrada | 1 | 2026-07-02T08:13:51.918Z | 2026-06-29T09:25:21.812Z |

Acentuação (Produção, violência, crianças...) deve estar íntegra no NDJSON (UTF-8).

| entity_id | A | B | C | Obs. |
|:-:|:-:|:-:|:-:|---|
| 218615 | [x] | [x] | [ ] | |
| 216031 | [x] | [x] | [ ] | |
| 177199 | [x] | [x] | [ ] | |
| 90152 | [x] | [x] | [ ] | |
| 135228 | [x] | [x] | [ ] | id repete o de consultas - namespaces distintos, sem colisão |

## Eventos (5 registros)

| entity_id | título (abrev.) | status | data | hora | comissão | coment. | retrievedAt esperado | firstSeenAt esperado | Estrato |
|:-:|---|---|---|---|---|---|---|---|---|
| 39710 | Impactos... apostas esportivas ("bets") | agendado | 2026-07-02 | 10:00 | CDH | 119 | 2026-07-02T16:00:13.820Z | **2026-06-30T20:00:13.654Z** (cauda) | agendado genuíno |
| 39349 | Sabatina de Pedro Marcos de Castro Saldanha... | **agendado** | **null** | **null** | CRE | 16 | 2026-07-02T12:00:13.817Z | 2026-06-16T20:00:49.525Z | **fold REGISTRADO** |
| 38311 | Rotulagem nutricional de ultraprocessados... | cancelado | 2026-05-28 | 09:30 | CAS | 0 | 2026-07-02T08:12:45.622Z | 2026-06-29T12:49:11.266Z | cancelado |
| 15127 | 2a Reunião do Conselho de Comunicação Social | encerrado | 2019-03-18 | 10:16 | CCS | 0 | 2026-07-02T08:12:45.622Z | 2026-06-29T12:49:11.266Z | encerrado |
| 13835 | A situação ambiental dos assentamentos rurais... | encerrado | 2018-06-26 | 10:58 | CMA | 0 | 2026-07-02T08:12:45.622Z | 2026-06-29T12:49:11.266Z | encerrado |

Nota: os títulos acima são rótulos abreviados; a comparação exata de valor (conferência A) é
NDJSON vs D1/detalhe, não vs este worksheet. O título do 39710 contém aspas curvas no dado
upstream - íntegras no NDJSON.

Ponto central do 39349: no vivo, o bloco deve ter classe `resumo-audiencia-REGISTRADO` e `span.data` = "Sem data prevista" - e o dataset o mostra como `agendado` com data null. É o fold do par. 4.1 **declarado como caveat**: confirmar que o caveat descreve fielmente o que se observa.

| entity_id | A | B | C | Obs. |
|:-:|:-:|:-:|:-:|---|
| 39710 | [x] | [x] | [x] | vivo 120 coment. vs 119 (freshness, +1); resto ok |
| 39349 | [x] | [x] | [x] | vivo mostra "sem data prevista" = fold REGISTRADO->agendado confirmado |
| 38311 | [x] | [x] | [x] | coment. 0 no dataset vs 62 no detalhe (ver A3); resto ok |
| 15127 | [x] | [x] | [x] | hora 10:16 (listagem) vs 10:00 (detalhe); coment. 0 vs 8 (ver A3) |
| 13835 | [x] | [x] | [x] | hora 10:58 (listagem) vs 10:30 (detalhe); coment. 0 vs 1 (ver A3) |

## consultas_votos (3 registros) - todos com `retrievedAt` = 2026-06-29T14:10:26.338Z e `referencePeriod` = 2026-06-28

| entity_id | matéria | autoria | votosSim | votosNao | total | n. chaves UF | Estrato |
|:-:|---|---|:-:|:-:|:-:|---|---|
| 135228 | PL 726/2019 | Veneziano Vital Do Rêgo | 9 | 0 | 9 | 4 (CE, MG, RJ, SP) | acentos + cruzamento |
| 122990 | PEC 119/2015 | Dalirio Beber | 1 | 50 | 51 | 11 | acentos |
| 132598 | SUG 9/2018 (Voto impresso) | Programa E-cidadania | 1.768.436 | 1.477.955 | 3.246.391 | **29** (incl. `N/INF` e `ZZ` verbatim) | máx. UFs |

Conferência no CSV vivo: script `etapa4-consultas-votos-csv.R` (nesta pasta) - download único,
carimbo, guardrail de colunas, somas com testemunha `TOTAL` e detalhe por UF do 135228. Notas de
leitura: célula vazia nas colunas de voto codifica zero (provado pela coluna `TOTAL` do próprio
CSV); o parse BR exige `grouping_mark = "."` E `decimal_mark = ","` definidos (só o primeiro gera
erro no readr).

Conferir também: (i) linhas por UF do 135228 batem com `votosPorUf` do NDJSON; (ii) acentos de ementa/autoria íntegros no NDJSON (transcodificação win-1252->UTF-8); (iii) carimbo da linha 1 do CSV **de hoje** != 28/06 é esperado (freshness) - o que reprova é linha de dados divergente.

| entity_id | A | B | C | Obs. |
|:-:|:-:|:-:|:-:|---|
| 135228 | [x] | n/a | [x] | CSV vivo confere (9/0; UF a UF exato); cruzamento com consultas 135228 fecha (9 votos nos dois trilhos); "Rêgo" íntegro no NDJSON |
| 122990 | [x] | n/a | [x] | CSV vivo confere (1/50; 11 UFs); "Constituição" íntegra na ementa |
| 132598 | [x] | n/a | [x] | CSV vivo confere (1.768.436/1.477.955; 29 UFs) |

## Achado pré-registrado A1 - caveat de baseline generalizado indevidamente

Levantado no sorteio da amostra (02/07/2026), antes da conferência manual. Distribuição real do
`MIN(scraped_at)` por entidade:

| Entidade | Baseline (bulk) | % do corpus | Série interpretável a partir de |
|---|---|:-:|:-:|
| consultas | 16/06/2026 | 98,6% | 22/06/2026 |
| ideias | **29/06/2026** (113.571) | 99,9% | **30/06/2026** |
| eventos | **29/06/2026** (5.414) | 99,5% | **30/06/2026** |

O caveat do dicionário e do `datapackage.json` ("baseline 16/06 ~ 98,6%; série interpretável a
partir de 22/06") descrevia **apenas consultas** e estava generalizado para o pacote.

**Status: CORRIGIDO na fonte (02/07/2026)** - caveats por entidade em `src/dataset/schema.ts`
(ideias e eventos), bullet global em `src/dataset/dictionary.ts` e array de caveats do manifesto em
`scripts/build-dataset/index.ts`. **Não** refazer `build:dataset` agora -
o NDJSON de 16:14 é o objeto desta validação e um rebuild deslocaria o `retrievedAt` dos registros
quentes em relação aos valores esperados deste worksheet; o texto de caveat desatualizado dentro de
`dataset/1.0.0/{datapackage.json,dictionary.md}` é artefato de build (não versionado) e será
regenerado correto na C2.

## Achado A2 - sourceField de `ideias.apoios` com nível intermediário omitido

Levantado na conferência B de ideias (02/07/2026, DevTools na listagem viva). O `innerHTML` do
bloco `article.resumo-ideia` revela a árvore real:
`article.resumo-ideia > figure.grafico-ideia-legislativa > footer > span[1]` ("N apoios") + span[2]
(limiar 20.000, ignorado). O `sourceField` declarado no `schema.ts` era
`article.resumo-ideia > footer > span[1]`, omitindo o nível `figure.grafico-ideia-legislativa` -
seletor CSS que retorna `null` se copiado por um auditor.

Classe: defeito de **fidelidade documental** do `sourceField` (mesma natureza do A1), NÃO de dado. O
parser real (`scripts/ingest-ecidadania/ideias-listing.ts`) usa regex `/<footer>\s*<span>([\d.]+)\s*apoios/`
que casa o span correto e ignora o limiar; a conferência A já provou os valores de `apoios` idênticos
ao D1. Nenhum valor do dataset muda.

**Status: CORRIGIDO na fonte (02/07/2026)** - `sourceField` e `operationalization` de `apoios` em
`src/dataset/schema.ts` agora incluem o nível `figure.grafico-ideia-legislativa`. Sem rebuild.

Nota de escopo: a varredura dos demais `sourceField` cobriu consultas (seletores resolvem como
escritos - markup usa `header`, confirmado no teste de 02/07), ideias (A2) e eventos (confirmado
02/07: classe/descricao/data/sigla fiéis, sem achado). `consultas_votos` aponta para colunas de
CSV, não seletores HTML. **Bloco B completo para as 3 entidades vivas.**

## Achado A3 (PROVISÓRIO) - campos de eventos empobrecidos pela coleta só-listagem

Levantado na conferência C de eventos (02/07/2026). Confirmado no D1: os valores do dataset
reproduzem fielmente a **listagem** `principalaudiencia` (o `sourceField` está correto), mas a
listagem é fonte empobrecida frente à página de **detalhe** `visualizacaoaudiencia`. NÃO reprova
a ETAPA 4 (proveniência fiel), mas dois campos ficam de qualidade rebaixada:

| Campo | Sintoma observado (amostra) | Natureza |
|---|---|---|
| `comentarios` | dataset 0 vs detalhe 62 (38311), 8 (15127), 1 (13835); +1 de freshness em 39710 (119 vs 120) | subcontagem sistemática: a listagem raramente expõe a contagem -> 0 espúrio |
| `hora` (e possivelmente `data`) | 15127: 10:16 (listagem/dataset) vs 10:00 (detalhe); 13835: 10:58 vs 10:30 | divergência listagem↔detalhe de minutos; fonte canônica não caracterizada |

Causa raiz única: a decisão arquitetural "crawl só da listagem" (custo: evita ~5.400 requisições de
detalhe por ciclo). O caveat atual de `comentarios` no `schema.ts` ("frequentemente 0 na listagem")
**subdimensiona** o problema; `hora`/`data` **não têm caveat**.

Distância dos A1/A2: aqueles eram fidelidade documental (corrigíveis em texto). A3 é **limitação de
cobertura do dado** cuja causa é do upstream (Senado expõe horas diferentes em páginas diferentes) +
da arquitetura de coleta. Não há correção trivial na fonte; a decisão é metodológica (documentar vs.
re-arquitetar a coleta) e pertence à C2, não à ETAPA 4.

**Ação nesta ETAPA (provisória):** caveats honestos em `schema.ts` para `comentarios`, `hora` e
`data` declarando a origem só-listagem e a divergência observada, com a magnitude/fonte canônica
registradas como **não caracterizadas**. Marcados como caveat provisório até o estudo de
reconciliação listagem×detalhe (item aberto na ETAPA 5 / C2, amostra n=100). Sem rebuild.

## Registro final

- **Data da validação:** 02-03/07/2026
- **Registros conferidos:** 19 x (A, B, C) + 4 verificações estruturais. Conferência A programática
  (`etapa4-extract.R`, 162/162); B via DevTools nas 3 listagens; C contra o upstream vivo
  (consultas: página + `/processo`; eventos: página de detalhe; consultas_votos: CSV oficial via
  `etapa4-consultas-votos-csv.R`, rodado em 03/07/2026 com carimbo vivo de 02/07 - somas SIM/NÃO,
  totais e nº de UFs idênticos nos 3 registros, detalhe por UF do 135228 exato, acentos íntegros
  no NDJSON).
- **Achados:** A1 (baseline por entidade) e A2 (`sourceField` de apoios) corrigidos na fonte;
  A3 (eventos empobrecidos: `comentarios`, `hora`, `data`) documentado como caveat provisório +
  item aberto na C2. Nenhum é inversão de ponteiro nem valor inventado.
- **Reprovações (ponteiro invertido / valor != D1):** 0.
- **Veredito: [x] APROVADA.** A proveniência (`sourceField`) é fiel em todas as entidades vivas +
  acervo; divergências vivas são freshness ou limitação de cobertura declarada, não erro de pipeline.
- **Pendências operacionais: encerradas em 03/07/2026** - caveats do A3 aplicados no `schema.ts`
  (redação de `comentarios` revisada: magnitude declarada não caracterizada); CI do lote A1+A2+A3
  verde (dicionário regenerado, 542/542 testes, typecheck limpo).
