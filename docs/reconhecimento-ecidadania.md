# Reconhecimento — e-Cidadania (dados abertos do Senado)

**Documento canônico de reconhecimento do e-Cidadania.** Consolida as sessões de recon de
escopo fechado conduzidas em **30/06 e 01/07/2026**. Substitui e encerra os arquivos
`achados-ecidadania-reconhecimento-2026-06-30.md` e `reconhecimento-data-abertura-consulta.md`,
agora removidos do repo.

**Base D1:** `senado-ecidadania` (`6d23ebdb-92b1-4112-9a8b-0d1597c589d9`, criada 14/06/2026) —
tabelas `ecidadania_current`, `ecidadania_history`, `ecidadania_scrape_runs`.
**Repositório inspecionado:** `senado-br-mcp-cloudflare`.
**Disciplina:** somente reconhecimento — nenhuma escrita de pipeline/código de produção; nenhum
arquivo do repo modificado além de documentação. Achados verificados no vivo (curl, 30/06 e
01/07/2026) e contra o corpus D1 persistido.

## Sumário executivo

- **Corpus saudável e recuperado** (última carga completa 29/06): as quatro entidades (consultas,
  ideias, eventos, consultas_votos) batem com o upstream vivo. Piso duro da série = **14/06/2026**;
  `consultas_votos` é **acervo de vintage único** (profundidade de série = 1), não série temporal.
- **Data de abertura da consulta: não existe upstream.** A consulta "Apoie" **não é objeto datado
  discreto**; todas as candidatas (tramitação, REST/Plone, sub-recursos `/materia`|`/processo`,
  catálogo Arquimedes exaustivamente varrido) reprovadas. `dataApresentacao` é proxy **enviesado**,
  reprovado como achado.
- **Ritmo de entrada não é mensurável retrospectivamente**, mas há proxy **prospectivo validado**:
  first-seen via `MIN(scraped_at)` no `ecidadania_history` — **cobertura 100%, sem schema novo**,
  censurado à esquerda, com cauda pós-baseline **provada sinal genuíno** (não backfill).

---
---

# PARTE I — Reconhecimento amplo (30/06/2026)

Duas frentes: (a) sondagem empírica dos endpoints upstream **vivos** (curl); (b) inspeção do
**corpus D1 persistido** (`ecidadania_current` / `ecidadania_history` / `ecidadania_scrape_runs`).

## 1. Superfície de endpoints por entidade

Cada entidade consome fontes distintas para **descoberta**, **status** e **detalhe**. O REST
`/restcolecaomais*` só retorna ~5 destaques (splice de métrica de 2h); o corpus completo vem das
listagens HTML paginadas; votos vêm de um CSV separado.

| Entidade | Descoberta (corpus) | Métrica 2h (REST) | Status | Detalhe |
|---|---|---|---|---|
| consultas | `pesquisamateria?p=1..N` (HTML) | `/restcolecaomaismateria` | `/processo.json?sigla=X&tramitando=S` | `visualizacaomateria?id=` (HTML) |
| ideias | `pesquisaideia?situacao=S&p=1..N` (HTML) | `/restcolecaomaisideia` | classe `situacao` (dropdown) | `visualizacaoideia?id=` (HTML) |
| eventos | `principalaudiencia?p=1..N` (HTML) | `/restcolecaomaisaudiencia` | sufixo de classe `resumo-audiencia-STATUS` | `visualizacaoaudiencia?id=` (HTML) |
| consultas_votos | CSV Arquimedes (`Proposições-com-votos.csv`) | — (sem 2h) | `STATUS ATUAL` = "Descontinuado" (acervo) | — |

Todos responderam **HTTP 200** na sondagem de 30/06 (exceto o content-negotiation do CSV — §4.4).

## 2. Forma real do dado (verificada no vivo, 30/06/2026)

### 2.1 consultas
- **REST** `/restcolecaomaismateria` (5 itens): `id`, `identificacaoBasica` ("PL 1338/2022"),
  `ementa`, `votosFavor`/`votosContra`/`totalVotos` (número BR com ponto de milhar, ex. `"85.470"`),
  `porcentagemFavor`, `totalVotosRecentes`. Casam com `listarConsultasInternal`.
- **Listagem** `pesquisamateria`: bloco `<div class="resumo-materia">`, **100 itens/página, 77
  páginas ⇒ ~7.686**. `id` na âncora = `codigoMateria`. Votos nos dois `<span>` do `<header>` do
  `<figure class="grafico-consulta-publica">` (SIM, NÃO). Estrutura íntegra.
- **Detalhe**: seletores `materia-identificacao`, `grafico-consulta-publica` +
  `contabilizacao-favor`/`contabilizacao-contra`, `Ementa:`, `Autoria:` — **todos presentes**.

### 2.2 ideias
- **REST** `/restcolecaomaisideia` (5 itens): `id`, `titulo`, `apoiamentos` ("14.698"),
  `porcentagemFavor`, `count`. Casam com o parser.
- **Listagem** `pesquisaideia`: bloco `<article class="resumo-ideia">`, apoios em
  `<footer><span>253.804 apoios</span>…`. **100/página, 1.137 páginas ⇒ ~113,6 mil** (sem filtro).
- **Dropdown `situacao`** casa **exatamente** com `SITUACAO_STATUS`: `5/6/8 → aberta`,
  `7/9 → encerrada`, `10 → convertida`.
- **Detalhe**: `id="ideia-legislativa"`, `class="contabilizacao"`, `Situação da Ideia`,
  `Ideia proposta por` — **todos presentes**.

### 2.3 eventos
- **REST** `/restcolecaomaisaudiencia` (5 itens): `id`, `tituloAbreviado`, `situacaoAudienciaId`
  (2=agendado, 3/4=encerrado), `qtdComentario`, `dataPublicacao`.
  - ⚠️ **Quirk:** `dataPublicacao` carrega a **data/hora do evento** (`"01/07/26 14:00"`), não uma
    data de publicação. O parser trata corretamente como data do evento; o nome upstream é enganoso.
- **Listagem** `principalaudiencia`: bloco `<article class="resumo-audiencia resumo-audiencia-STATUS">`.
  **100/página, 55 páginas ⇒ ~5.441**. Classes internas `descricao`/`data`/`sigla`/`comissao`
  presentes (100 cada).
- **Detalhe**: `audiencia-titulo`, `audiencia-finalidade`, `audiencia-data`, `audiencia-tag`,
  `situacao-audiencia-`, `audiencia-comissao` — **todos presentes**.

### 2.4 consultas_votos (acervo Arquimedes)
- CSV servido como `application/octet-stream`, encoding **windows-1252**, **~33 MB**,
  `Last-Modified` diário (arquivo republicado ~diariamente).
- Linha 1 = carimbo `"Dados atualizados até 29/06/2026"` ⇒ `referencePeriod = 2026-06-29`.
- Linha 2 = header `"CÓD. MATÉRIA";"NOME DA MATÉRIA";"EMENTA";"AUTORIA";"STATUS ATUAL";"UF DO
  CIDADÃO";"VOTO SIM";"VOTO NÃO";"TOTAL"` — casa com `HEADER_KEYS`. **Sem coluna de data**
  (relevante à Parte II).
- `STATUS ATUAL` uniformemente "Descontinuado" (acervo congelado, corretamente não usado como
  opinião atual).

## 3. Cobertura temporal e rupturas de série

### 3.1 Piso da série
- **consultas / eventos / ideias:** piso = **2026-06-14T22:57** (dia de criação da base). Série de
  ~16 dias no momento do recon. Consultas/ideias/eventos encerrados **antes de 14/06** e ausentes da
  listagem atual **não são capturáveis** — caveat estrutural, com data concreta.
- **consultas_votos:** **vintage único 2026-06-29** (floor = top no histórico). É **acervo
  congelado, não série temporal** — exatamente 1 snapshot. "Atualizado semanalmente" na descrição da
  tool é aspiracional: a profundidade de série é 1.

### 3.2 Estado do corpus (`ecidadania_current`, 30/06)

| Entidade | Total | Distribuição de status |
|---|---:|---|
| consultas | 7.765 | 7.686 aberta · **79 encerrada** |
| eventos | 5.443 | 5.041 encerrado · 393 cancelado · **9 agendado** |
| ideias | 113.598 | 109.699 encerrada · 3.822 aberta · 77 convertida |
| consultas_votos | 15.085 | 15.085 Descontinuado |

- As **79 `encerrada`** de consultas são os *linger re-status* (matéria saiu de tramitação, consulta
  caiu da listagem). Retêm o `scraped_at` do **momento do flip** (22/06–29/06); não são refrescadas
  depois (congelam com votos finais) — comportamento correto.
- Freshness: o *long tail* congela em **29/06 ~13:57** (última carga de corpus completo); só os
  destaques quentes são refrescados pelo splice de 2h.

### 3.3 Rupturas datadas (`ecidadania_scrape_runs`)

**Cluster 24/06 (~02:00):**
| Entidade | Erro | Natureza |
|---|---|---|
| eventos (#339) | `crawl incompleto: 54 páginas (2..55)` | **Ruptura estrutural**: swap `<div>`→`<article>` zerou o crawl |
| consultas_votos (#341) | `cabeçalho do CSV não encontrado` | Decode UTF-8 manglava `CÓD. MATÉRIA` (charset) |
| ideias (#340) | `crawl incompleto: 2 páginas (s5:p39,p40)` | Transiente de rede (112.795 raspadas); **não** estrutural |

**29/06 manhã:** eventos (#532, 09:24) ainda `54 páginas` — a ruptura do container persistiu até a
manhã de 29/06. consultas_votos (#534, 10:00): **HTTP 406** (content-negotiation); depois (#544,
13:01) `cabeçalho não encontrado` — fix em **dois passos** (Accept, depois charset).

**29/06 13:43–13:51 — blip upstream:** consultas/eventos/ideias/consultas_votos (#549–552) todos com
`fatal: fetch failed`. Falha **simultânea nas 4 entidades** = transiente de rede do portal, não parser.

**30/06 02:00 (#575):** `erro-metrica` em consultas — timeout (10s) ao `/restcolecaomaismateria`.
Splice de 2h; **recuperou** no tick seguinte.

### 3.4 Recuperação — confirmada

Últimos `ok` de corpus (todos **29/06**), com `rows_scraped` batendo com o vivo:

| Entidade | rows_scraped | Confere |
|---|---:|---|
| consultas (#553, 13:56) | 7.686 | 77 págs × 100 ✓ |
| eventos (#554, 13:57) | **5.441** | 0 → cheio, **pós-fix container** ✓ |
| ideias (#558, 13:58) | 113.597 | 1.137 págs × 100 ✓ |
| consultas_votos (#559, 14:10) | 15.085 | ~15 mil matérias ✓ |

**As quatro entidades recuperaram em 29/06.** Os dois fixes do cron de 29/06 estão no código e
validados contra o HTML/CSV vivo.

## 4. Achados acionáveis (priorizados)

### 4.1 [P1 — fidelidade de status] `resumo-audiencia-REGISTRADO` diluído em "agendado"
A página de eventos emite hoje **três** sufixos — `AGENDADO`, `ENCERRADO` e **`REGISTRADO`** (na p1:
5/94/1). O bloco `REGISTRADO` é uma **Sabatina** com `<span class="data">Sem data prevista</span>`.
`extractDate("Sem data prevista") → null` ⇒ `mapEventoStatus` cai em `"agendado"`. Empiricamente, os
REGISTRADO/sem-data ficam **indistinguíveis** dos 9 eventos genuinamente `agendado`. Semanticamente,
"registrado sem data" é o **oposto** de "agendado". Mesmo gap no detalhe (`obterEventoInternal`).
*Impacto:* pequeno em volume (~1–2%), mas perda de fidelidade num campo consultável. Decisão pendente:
status `registrado`/`sem_data` vs. manter o fold (documentando).

### 4.2 [P1 — honestidade de cobertura] Overclaim "~150 mil ideias"
A descrição da tool `senado_ecidadania_listar_ideias` afirma "~150 mil ideias". O corpus real é
**113.598** (1.137 × 100). Discrepância ~32%. Corrigir para "~114 mil".
*(Claims corretos: consultas "~7,7 mil" ✓; votos "~15 mil" ✓; eventos "~milhares" ✓.)*

### 4.3 [P2 — enum/doc] Filtro de status de eventos não cobre "cancelado"
Corpus tem **393 eventos `cancelado`**, mas o `status` da tool `listar_eventos` é
`enum(["agendado","encerrado","todos"])` — **sem `cancelado`**. Só alcançáveis via `todos`;
incoerente com a própria descrição do retorno.

### 4.4 [P3 — nota, não-bug] O 406 do CSV é específico de GET-completo
O **HTTP 406** só se reproduz no **GET sem Range** com `Accept: text/html`. Com `Range` a
content-negotiation é bypassada (206). Fix (`Accept: text/csv, */*`) necessário e correto. Um teste de
sanidade com Range **não** reproduz o 406 — não confundir com "resolvido".

### 4.5 [P3 — dívida conhecida] `consultas_votos` sem série
Só 1 vintage (29/06). O `contentHash` sobre `consultaVotoCore` (exclui `referencePeriod`) já garante
que um bump semanal do carimbo sobre votos congelados **não** gera ruído em `history` — design
correto, ainda não exercitado.

## 5. O que **não** é problema (verificado)

- **Parsers de detalhe (`obter_*`):** todos os seletores presentes no HTML vivo de 30/06. Sem ruptura.
- **Fix do container de eventos:** `parseEventoListingPage` aceita `<div|article … class="resumo-audiencia">`;
  o vivo é `<article>` e o crawl voltou a 5.441. Validado.
- **Fix do CSV:** `Accept: text/csv, */*` + decode `windows-1252` resolvem 406 e header-not-found.
- **Derivação de status por `/processo`:** o campo vem como `tramitando:"Sim"` (não `"S"`), mas
  `status.ts` coleta `codigoMateria` de **todos** os itens de `?tramitando=S` sem reconferir o campo —
  **robusto**. Sem bug latente.
- **Guardas do pipeline:** o cluster de 24–29/06 comprovou o design — todo `erro`/`crawl incompleto`
  gravou **apenas** uma linha em `scrape_runs`, sem sobrescrever `current`. Perda de freshness, zero
  corrupção. É o contrato de guarda pretendido.

## 6. Síntese (Parte I)

O corpus está **saudável e recuperado** (29/06), com as quatro entidades batendo com o upstream vivo.
As rupturas conhecidas (container de eventos, 406/charset do CSV) estão **fechadas e validadas**. Os
achados novos são de **fidelidade e honestidade**, não de quebra: (1) o estado `REGISTRADO` de eventos,
(2) o overclaim de ~150 mil ideias, (3) o enum de status sem `cancelado`. A série tem piso duro em
**14/06/2026**; `consultas_votos` é acervo de vintage único (**29/06**), não série.

---
---

# PARTE II — Data de abertura da consulta pública

**Pergunta única:** existe uma fonte que exponha a *data de abertura da consulta pública* (Apoie),
presente e consistente na maioria das matérias do corpus, e **distinta** de `dataApresentacao`?

## Veredito

**NÃO ACHOU.** Nenhuma fonte upstream expõe uma data de abertura da consulta como dado próprio. Toda
data recuperável pertence à *família apresentação* (`dataApresentacao` / `dataInicioEfetivo`), que
**falha** o critério de aceite em dois eixos: (i) não é semanticamente a abertura da consulta e (ii) é
comprovadamente enviesada. Adicionalmente, a consulta "Apoie" **não é modelada como objeto datado
discreto** — o que explica a ausência estrutural da data.

Achado semântico central: a matéria/consulta **não é um objeto de conteúdo Plone** (`/ecidadania/materia/{id}` → 404).
Os votos são tabulados contra `codigoMateria` por *views*; o status `aberta`/`encerrada` acompanha o
estado de **tramitação** da matéria, não uma janela de consulta com abertura própria. Não há, portanto,
"data de abertura da consulta" a recuperar — apenas proxies.

## Amostra (Fase 0)

Estratificada por `sigla × status × ano-da-matéria`, determinística por `entity_id`, **N=99**.
`ecidadania_current`, `entidade='consultas'`. Cobertura: 11 siglas (MPV, PDL, PDS, PEC, PL, PLC, PLP,
PLS, PRS, SCD, SUG); anos 1984–2026; 20 encerradas + 79 abertas.

```sql
WITH base AS (
  SELECT entity_id, status,
    json_extract(payload_json,'$.materia') materia,
    TRIM(SUBSTR(json_extract(payload_json,'$.materia'),1,INSTR(json_extract(payload_json,'$.materia'),' ')-1)) sigla,
    CAST(SUBSTR(json_extract(payload_json,'$.materia'), INSTR(json_extract(payload_json,'$.materia'),'/')+1) AS INT) ano
  FROM ecidadania_current WHERE entidade='consultas'
),
ranked AS (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY sigla, status, ano ORDER BY (entity_id*2654435761)%2147483647) rn
  FROM base
)
SELECT entity_id, materia, sigla, ano, status FROM ranked WHERE rn<=1 ORDER BY sigla, ano, status;
```

Nota de estrutura: o `payload_json` do corpus contém apenas `id, materia, ementa, votosSim/Nao,
percentuais, status, url`. **Sem nenhum campo de data** — a data de abertura já é ausente no corpus.

## Evidência por candidata

### C1 — Eventos de tramitação (`/materia/movimentacoes/{id}` e `/processo/{id}` v3) — REPROVADA
- `/materia/movimentacoes/{codigoMateria}` → `InformesLegislativos[].{Data, Descricao}`
- `/processo/{idProcesso}` → `autuacoes[].informesLegislativos[].{data, descricao}`

Teste de cheiro em 8 ids diversos (`174687, 173162, 137498, 165436, 156489, 174149, 48198,
3054533(proc)`). Busca por `cidadan | e-cidad | consulta pública | apoie | apoio popular | portal e`:
**0 eventos de abertura de consulta** em todos os ids.

| id | rótulo | nº informes | hits consulta-abertura |
|----|--------|-------------|------------------------|
| 174687 | PL 3166/2026 aberta | 1 | 0 |
| 173162 | PDL 446/2025 aberta | 95 | 0 |
| 137498 | PL 3799/2019 encerrada | 12 | 0 |
| 165436 | PDL 363/2023 encerrada | 134 | 0 |
| 156489 | SUG 2/2023 aberta | 4 | 0 |
| 174149 | MPV 1358/2026 aberta | 4 | 0 |

Ocorrências de "consulta"/"pública" na tramitação referem-se a publicações no DOU/avulsos e ao
boilerplate *"As consultas sobre a tramitação…"* — nunca à consulta e-Cidadania. A consulta automática
"Apoie" **não gera informe legislativo**.

### C2 — REST por item / JSON embutido no HTML / objeto Plone — REPROVADA
HTML de detalhe `visualizacaomateria?id=173162` (155 KB):
- Única data `dd/mm/aaaa` na página: `30/06/2026` (data de geração — hoje). **Nenhuma data de abertura.**
- Ocorrências ocultas (raw) de `abertura, datainicio, datafim, dtinicio, dtfim, iniciovigencia,
  fimvigencia, dataConsulta, periodo` → **todas 0**.
- Portal é **Plone**; JS custom não expõe endpoint de dados (votos são server-side).

REST/Plone:
- `restcolecaomaismateria` → widget "mais votadas": só `votos/ementa/id/identificacaoBasica`, **zero
  datas**; ignora `id`/`b_size`.
- `/ecidadania/materia/{id}` → **404** (não é objeto de conteúdo; sem `created`/`effective`/`modified`).
- `/ecidadania/@search` (plone.restapi) → **401** (fechado ao público).
- Brute de endpoints por-id (`restmateria, restconsulta, detalhemateria, getmateria, consultamateria,
  apoio, ajaxvotos, restvotos, votos`) → **todos 404**. Só `qrcode-consulta-publica?id=` responde 200
  (imagem, sem dados).

### C3 — Sub-recursos de `/materia` e `/processo` (dados abertos) — REPROVADA
- `/materia/{id}` (legado): datas = `DataApresentacao` + metadados do dataset (`DataDepreciacao,
  DataVersaoServico…`). `consulta/cidadania/ecidadania` = **0**.
- `/processo/{idProcesso}` (v3): `dataApresentacao, dataInicioEfetivo, dataSituacaoAtual, dataEnvio,
  dataRecebimento`. `dataInicioEfetivo` = `dataApresentacao` (início do processo, não da consulta).
  Nenhum nó "consulta pública".

### C4 — Companheiro Arquimedes (metadados de consulta) — NÃO ACHOU (varredura exaustiva 01/07/2026)

O catálogo real de exports do e-Cidadania **não** é `dados/pacotes` (404) — é a landing de Resultados
`www12.senado.leg.br/ecidadania/documentos/home/resultados`: **7 famílias de relatório**, cada link um
redirect 302 para um arquivo Arquimedes em `www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/` (autoindex
403, sem listing). As 7 foram resolvidas e inspecionadas:

| # | Relatório | Arquivo Arquimedes | Tipo | Coluna de data por consulta? |
|---|---|---|---|---|
| 1 | Consulta pública | `rel-consulta-publica-pdf.pdf` (39p) | PDF agregado | **não** — só data de geração; tabelas `MATÉRIA/SIM/NÃO/TOTAL` |
| 2 | Votos na CP por autor | `Rel-autores-pdf.pdf` (5p) | PDF | **não** — nenhuma data no doc |
| 3 | Prontas p/ deliberação | `rel-prontos-deliberacao-plenario-pdf.pdf` (19p) | PDF | **não** — `Matéria/Ementa/Autoria/Favor/Contra/Total` |
| 4 | Votos por UF | `dwweb`/BOE `docId=…` + CSV `Proposições-com-votos.csv` | PDF/CSV | **não** — header sem data; ver §2.4 |
| 5 | Ideias legislativas | `rel-ideia-legislativa-completo-pdf.pdf` | PDF | n/a (ideias) |
| 6 | Eventos interativos | `rel-evento-Interativo-completo-pdf.pdf` | PDF | n/a (eventos) |
| 7 | Simplificado do portal | `relatorio-simplificado-pdf.pdf` (9p) | PDF | **não** — só data de geração |

- O `rel-consulta-publica-pdf.pdf` é agregado institucional (`TOTAL ACUMULADO DESDE 2013`, `VOTOS POR
  ESTADO`, `VOTOS POR MÊS`, `MATÉRIAS MAIS VOTADAS`). Único `dd/mm/aaaa` em 39 páginas = data de geração
  (rodapé). O tipo `ConsultaVotoResumo` no repo (`src/scraper/ecidadania.ts`) corrobora: único campo
  temporal é `referencePeriod` (vintage do arquivo), não a abertura.
- **Sonda dirigida** de export de metadados (`consultas.csv`, `proposicoes.csv`, `materias-consulta.csv`,
  `consultas-metadados.csv`, `*.zip`, etc.) no dir Arquimedes → **todos 404**.
- **Sub-hipótese "primeira data de voto" (rejeitada):** o portal registra timestamp de voto (alimenta
  `VOTOS POR MÊS`), mas só em **agregado mensal global**; o único arquivo *por matéria* (votos.csv) é
  **sem timestamp**. Nem o proxy "primeiro voto" é recuperável por consulta.
- **Fronteira residual (estreita, não acionável):** o gerador `dwweb` é SAP BusinessObjects (BOE
  OpenDocument, token de sessão); documentos BOE não publicados em Resultados são auth-gated, fora da
  superfície de dados abertos. Sem indício de um oitavo documento de consulta com datas.

## Prova de viés de `dataApresentacao` (por que não conta como achado)

Cobertura na amostra: **99/99 = 100%** (via `/processo?codigoMateria={id}`).
Distinção/viés: **18/99** consultas com status `aberta` têm matéria apresentada **≤ 2015**:

| matéria | dataApresentacao | status consulta |
|---------|------------------|-----------------|
| PDS 16/1984 | 1949-05-31 | aberta |
| MPV 2215/2001 | 2001-09-01 | aberta |
| PDS 445/2004 | 2004-04-22 | aberta |
| PDS 31/2006 | 2006-01-03 | aberta |
| PDS 77/2007 | 2007-04-23 | aberta |
| PDS 247/2008 | 2008-11-04 | aberta |
| PDS 61/2009 | 2009-02-18 | aberta |
| PDS 93/2011 | 2011-04-01 | aberta |

A apresentação da proposição pode anteceder a consulta ativa em **décadas** (até ~77 anos no extremo).
Usar `dataApresentacao` para "ritmo de entrada de novas consultas" concentraria a série em anos antigos,
invertendo a métrica-alvo. **Reprovado como achado.**

## Recomendação de fallback (insumo para a Parte III)

A métrica "ritmo de entrada por ano/mês" não tem lastro numa data de abertura upstream. Duas opções:

**Opção A — proxy `dataApresentacao` com viés declarado.** 100% de cobertura e retrospectivo, mas
**semanticamente errado** e severamente enviesado para matérias antigas. Admissível só como esboço com
*caveat* forte; **não** como métrica de calibração.

**Opção B — delta de corpus prospectivo (first-seen no D1)** ← recomendada. `min(scraped_at)` por
`entity_id` como "data de entrada no universo observável". Deterministicamente correto para "ritmo de
entrada" **de agora em diante**; sem inventar semântica inexistente. Contra: **censura à esquerda** (ids
já existentes entram com first-seen = início do histórico); sem série retroativa real.

**Síntese:** adotar **B** como sinal real prospectivo; tratar **A** apenas como contexto histórico
rotulado. **Não misturar as duas numa mesma série.** → *A viabilidade da Opção B foi validada
empiricamente na Parte III.*

---
---

# PARTE III — Ritmo de entrada / first-seen no D1 (01/07/2026)

**Pergunta:** o first-seen prospectivo (Opção B) já está sendo gravado de graça no corpus, ou exige
schema novo? E a série resultante é confiável?

## Viabilidade — cobertura (PASS)

```sql
SELECT
  (SELECT COUNT(DISTINCT entity_id) FROM ecidadania_current WHERE entidade='consultas') AS distinct_current,
  (SELECT COUNT(DISTINCT entity_id) FROM ecidadania_history WHERE entidade='consultas') AS distinct_history,
  (SELECT COUNT(*)                  FROM ecidadania_history WHERE entidade='consultas') AS rows_history;
-- → distinct_current=7765, distinct_history=7765, rows_history=9688
```

Os **7.765** ids distintos do `current` têm **todos** linha no `history` (7765 = 7765): a primeira
aparição gravou history para o corpus inteiro. Logo, **`MIN(scraped_at)` por `entity_id` é o first-seen,
derivável para 100% do corpus, sem `ALTER TABLE`**. (As 9.688 linhas para 7.765 ids ⇒ ~1.923 ids com
mudança de conteúdo ao longo do tempo — votos/status.)

Schema confirmado: `ecidadania_history` = `(entidade, entity_id, scraped_at, content_hash,
payload_json)`, PK `(entidade, entity_id, scraped_at)` → append por mudança de conteúdo.

## Distribuição temporal do first-seen (censura à esquerda confirmada)

```sql
WITH firstseen AS (
  SELECT entity_id, MIN(scraped_at) AS fs
  FROM ecidadania_history WHERE entidade='consultas' GROUP BY entity_id
)
SELECT substr(fs,1,10) AS dia, COUNT(*) AS n FROM firstseen GROUP BY dia ORDER BY dia;
```

| dia | n | leitura |
|---|---:|---|
| 2026-06-14 | 5 | destaques REST (pipeline pré-expansão) |
| 2026-06-16 | 7.659 | **bulk da expansão do corpus** |
| 2026-06-22 | 89 | cauda pós-baseline |
| 2026-06-24 | 7 | cauda pós-baseline |
| 2026-06-29 | 5 | cauda pós-baseline |

**7.659 de 7.765 (98,6%) entram num único dia (16/06)** = censura à esquerda. Não há série
retrospectiva — como previsto.

## Desambiguação da cauda (sinal genuíno, não artefato)

A cauda de 101 ids (89+7+5) pós-16/06 admitia duas leituras: **(A) entradas novas reais** vs.
**(B) ids perdidos no crawl de 16/06 e capturados depois**. Teste decisivo nos `scrape_runs` de
`consultas` (runs de corpus completo, `ok`, distintos dos `ok-metrica` de 5 linhas):

| run corpus | rows_scraped | rows_changed | first-seen no dia |
|---|---:|---:|---:|
| 16/06 13:15 (#61) | **7.664** | 7.664 | 7.659 |
| 22/06 10:33 (#277) | 7.707 | 395 | 89 |
| 24/06 02:00 (#338) | 7.713 | 257 | 7 |
| 29/06 09:22 (#531) | 7.686 | 304 | 5 |

**Reconciliação exata:** o censo de 16/06 raspou **7.664**; first-seen 16/06 (7.659) + já-vistos de
14/06 (5) = **7.664**. O crawl de 16/06 foi **completo**, não um censo parcial. Todo crawl subsequente
foi `ok` na faixa 7.664–7.713; o único `erro` (29/06 13:43, "fatal: fetch failed") gravou 0 linhas e,
pela guarda, não sobrescreveu nada. ⇒ as 101 consultas de first-seen tardio estavam **genuinamente
ausentes** de um t0 completo e apareceram em crawls completos posteriores = **entradas novas reais**.
Interpretação (B) descartada com evidência.

## Veredito (Parte III)

- **first-seen é derivável de graça** do `ecidadania_history` via `MIN(scraped_at)` — cobertura 100%,
  **sem schema novo, sem código de produção**. A Opção B (Parte II) é implementável como *query*.
- **Censura à esquerda confirmada** (98,6% em 16/06) — sem série retrospectiva.
- **Cauda prospectiva já acumula e é limpa** (101 entradas novas em ~13 dias).

**Limitações registradas (não bloqueiam; são honestidade metodológica):**
1. **Resolução = cadência do crawl de corpus completo**, hoje **irregular** (gaps de 2–6 dias:
   16→22→24→29). Novas consultas só entram no `history` via crawl completo (os `ok-metrica` de 2h não
   geram first-seen). **Travar a cadência do cron de corpus é pré-requisito** para uma série mensal
   defensável.
2. **Censura no meio:** consultas que abrem *e* saem de tramitação entre dois crawls completos nunca
   são vistas. Risco baixo (consulta acompanha tramitação, frequentemente lenta), cresce se a cadência
   for esparsa.
3. **Penhasco de t0:** a série só tem valor interpretativo de 16/06 em diante; o primeiro ponto confunde
   "novo" com "baseline". Tratamento: iniciar a série no primeiro crawl **pós-baseline** (22/06).

---
---

# Endpoints e fontes tocados (referência consolidada)

| uso | endpoint / arquivo |
|-----|--------------------|
| corpus consultas (HTML) | `GET www12.senado.leg.br/ecidadania/pesquisamateria?p=1..N` |
| corpus ideias (HTML) | `GET www12.senado.leg.br/ecidadania/pesquisaideia?situacao=S&p=1..N` |
| corpus eventos (HTML) | `GET www12.senado.leg.br/ecidadania/principalaudiencia?p=1..N` |
| métrica 2h (REST) | `GET www12.senado.leg.br/ecidadania/restcolecaomais{materia,ideia,audiencia}` |
| status consultas | `GET www12.senado.leg.br/ecidadania/processo.json?sigla=X&tramitando=S` |
| detalhe (HTML) | `GET www12.senado.leg.br/ecidadania/visualizacao{materia,ideia,audiencia}?id={id}` |
| widget mais votadas | `GET www12.senado.leg.br/ecidadania/restcolecaomaismateria` |
| Plone restapi (fechado) | `GET www12.senado.leg.br/ecidadania/@search` → 401 |
| proxy dataApresentacao | `GET legis.senado.leg.br/dadosabertos/processo?codigoMateria={id}` (campo `[0].dataApresentacao`) |
| tramitação (legado) | `GET legis.senado.leg.br/dadosabertos/materia/movimentacoes/{id}` |
| processo v3 (detalhe) | `GET legis.senado.leg.br/dadosabertos/processo/{idProcesso}` |
| matéria (detalhe legado) | `GET legis.senado.leg.br/dadosabertos/materia/{id}` |
| catálogo de relatórios (C4) | `GET www12.senado.leg.br/ecidadania/documentos/home/resultados` (7 links → 302) |
| dir Arquimedes (autoindex) | `GET www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/` → 403 |
| relatório de consulta (C4) | `GET www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/rel-consulta-publica-pdf.pdf` |
| votos por UF (gerador BOE) | `GET www8.senado.gov.br/dwweb/ecidadaniaPdf.html?docId=…` (SAP BusinessObjects OpenDocument) |
| votos CSV (acervo) | `Proposições-com-votos.csv` (~33 MB, windows-1252, republicado ~diário) |

---

# Decisões da ETAPA 2 — recorte e cadência (registradas em 01/07/2026)

Sessão de decisão (sem implementação). Insumos: veredito da Parte III e reprovação do proxy
`dataApresentacao`. Três decisões fechadas:

**D1 — Recorte do dataset: corpus completo (consultas + consultas_votos + ideias + eventos), um
único data package por release.** Motivo: o ativo científico defensável é a cobertura integral do
e-Cidadania — camada que o `congressbr` nunca cobriu; excluir ideias (maior componente) ou fragmentar
em módulos com DOIs separados enfraqueceria o argumento central e multiplicaria overhead de
mantenedor único. Condição: documentação e caveats por entidade — em particular, `consultas_votos`
rotulado explicitamente como **acervo de vintage único** (sem série temporal).

**D2 — Cadência de release congelado: anual (janeiro, cobrindo o ano-calendário anterior), com
cláusula de release extraordinário** apenas para correção de defeito de dados ou mudança de schema
upstream (versionado como patch/minor, com version-DOI próprio). Motivo: o ritmo histórico é
não-mensurável (Parte III), então a cadência vem de custo de manutenção, previsibilidade para a
comunidade e alinhamento com o ciclo acadêmico/sessão legislativa. Anual é sustentável para
mantenedor único; migrar para semestral depois não quebra promessa — o inverso quebraria. A
defasagem do congelado é mitigada pelo trilho vivo (MCP).

**D3 — Série first-seen adotada como série oficial do pacote; cadência do crawl das entidades
vivas (consultas, ideias, eventos) travada em diária.** *(Precisão de 01/07/2026, na implementação:
"corpus completo" não inclui `consultas_votos` — acervo de vintage único por D1, fora da série
first-seen; permanece **semanal**, como verificação de integridade: hash do CSV comparado ao vintage
registrado; idêntico ⇒ skip logado, divergente ⇒ **alerta + decisão humana** — nunca re-ingestão
silenciosa, pois divergência falsificaria a premissa de acervo congelado e acionaria emenda de D1
ou release extraordinário via D2.)* Motivo: `MIN(scraped_at)` é o único sinal de ritmo de entrada
existente ou possível; cada dia de atraso encurta a série permanentemente. Crawl diário dá
resolução de 1 dia
(a melhor defensável), reduz censura no meio e formaliza o pré-requisito da Limitação 1 da Parte III.
Compromissos metodológicos vinculados: (a) censura à esquerda declarada — piso 14/06/2026, vintage
de baseline (16/06) rotulado e excluído de análises de ritmo, série interpretável a partir de
22/06/2026; (b) falhas de crawl (`erro` em `ecidadania_scrape_runs`) registradas como **lacunas
conhecidas da série**, nunca silenciadas; (c) a cadência diária integra o contrato metodológico
declarado na documentação do dataset.

Implementação (travar o cron diário, montar o data package) fica para sessão própria, fora deste
documento.

---

# Disposição dos achados da Parte I §4 (registrada em 02/07/2026, sessão C1)

Os três achados de fidelidade são **dívida de tool** — permanecem não corrigidos no servidor MCP,
fora do escopo do dataset. No dataset, o §4.1 (fold REGISTRADO→agendado) entrou como **caveat
documentado** em `docs/dataset-dictionary.md`; §4.2 (overclaim "~150 mil ideias") e §4.3 (enum de
status sem `cancelado`) são exclusivamente descrição/interface de tool e não tocam o dataset.
Correção das tools fica para sessão própria de manutenção do servidor.

---

*Fim do documento canônico de reconhecimento do e-Cidadania.*
