# Dicionário de variáveis — dataset de participação do e-Cidadania

> **Gerado automaticamente** a partir de `src/dataset/schema.ts` (fonte única). Não editar à mão — rode `npm run dataset:dictionary`.

- **schemaVersion:** `2.0.0`
- **Licença do dado:** Dados Abertos do Senado Federal — uso livre com atribuição da fonte.

Cada valor no dataset vem embrulhado no envelope de proveniência por campo:

```
{ value, sourceEndpoint, sourceField, retrievedAt, license, schemaVersion }
```

`⚙️` marca variáveis **derivadas** (`sourceEndpoint: derived:*`) — computadas em código ou
observadas do nosso corpus, sem campo upstream discreto (ver convenção abaixo).

## Convenções de proveniência

- **`retrievedAt`** = o `scraped_at` da linha do corpus (D1) que produziu o valor, i.e. o instante real da extração no upstream — **não** o momento do build/deploy. Campos derivados herdam o mesmo `retrievedAt` do registro. Para `consultas.status`, isso é fiel porque a derivação via `/processo?tramitando=S` acontece **no mesmo run** do scrape da listagem.
- **`derived:ecidadania_history`** — variável observada do nosso crawler (ex.: `firstSeenAt`), **não** um dado do Senado. Quem audita vê de imediato que a série nasce da nossa observação.
- **`derived:calculo-local`** — valor computado em código a partir de outros campos do mesmo registro (somas, percentuais, URL canônica construída).
- **Codificação:** a saída é UTF-8. O CSV Arquimedes (`consultas_votos`) é servido em **windows-1252** (Latin-1) rotulado como octet-stream; o pipeline o **transcodifica para UTF-8** na leitura. Decisão de encoding registrada aqui, não implícita.
- **Ordenação:** registros ordenados por `entity_id` ascendente e chaves JSON em ordem estável — dois runs sobre o mesmo corpus produzem NDJSON byte-idêntico (diff entre vintages = mudança real).

## Caveats de cobertura temporal (Recon Partes I e III)

- **Piso duro da série = 14/06/2026** (criação da base D1). Consultas/ideias/eventos encerrados antes disso e ausentes da listagem atual **não são capturáveis**.
- **`firstSeenAt` é censurado à esquerda, com baseline POR ENTIDADE:** consultas = 16/06/2026 (98,6% do corpus; série interpretável a partir de **22/06/2026**); ideias = 29/06/2026 (~99,9%; a partir de **30/06/2026**); eventos = 29/06/2026 (~99,5%; a partir de **30/06/2026**). O vintage de baseline de cada entidade deve ser **excluído** de análises de ritmo de entrada. Resolução temporal = cadência do crawl de corpus completo.
- **Não existe data de abertura de consulta upstream** (Recon Parte II): `dataApresentacao` foi reprovado como proxy (enviesado); `firstSeenAt` é o único sinal prospectivo de ritmo.
- **`consultas_votos` é acervo de vintage único** (profundidade de série = 1): não é série temporal. O único campo temporal é `referencePeriod` (carimbo do CSV).
- **Fidelidade conhecida (não corrigida nesta fase — é dívida de tool, não de dataset):** o status de eventos dobra `REGISTRADO`/"sem data prevista" em `agendado` (Recon §4.1).

## `consultas` — Consultas públicas (Apoie)

**Fonte:** Listagem HTML paginada `pesquisamateria` (cobertura integral; votos no gráfico) + status derivado de `/processo?tramitando=S`.

| Variável | Tipo | Descrição | sourceEndpoint | sourceField | Operacionalização | Caveat |
|---|---|---|---|---|---|---|
| `materia` | string | Identificação da matéria em consulta (ex.: "PL 5064/2023"). | `GET https://www12.senado.leg.br/ecidadania/pesquisamateria?p={N}` | div.resumo-materia > header > a (texto da âncora) | Texto da âncora do cabeçalho do bloco de resultado, com entidades HTML decodificadas. | — |
| `ementa` | string | Ementa da matéria. | `GET https://www12.senado.leg.br/ecidadania/pesquisamateria?p={N}` | div.resumo-materia > section > a (texto da âncora) | Texto da âncora da seção do bloco, com entidades HTML decodificadas. | — |
| `votosSim` | integer (votos) | Total de votos SIM (favoráveis) na consulta. | `GET https://www12.senado.leg.br/ecidadania/pesquisamateria?p={N}` | figure.grafico-consulta-publica > header > span[1] (SIM) | Primeiro <span> do header do gráfico; número BR (ponto de milhar) via parseBrNum. | — |
| `votosNao` | integer (votos) | Total de votos NÃO (contrários) na consulta. | `GET https://www12.senado.leg.br/ecidadania/pesquisamateria?p={N}` | figure.grafico-consulta-publica > header > span[2] (NÃO) | Segundo <span> do header do gráfico; número BR via parseBrNum. | — |
| `totalVotos` ⚙️ | integer (votos) | Soma de votosSim + votosNao. | `derived:calculo-local` | votosSim + votosNao | Derivado em código: soma dos dois campos de voto do mesmo registro. | — |
| `percentualSim` ⚙️ | integer (%) | Percentual de votos SIM sobre o total. | `derived:calculo-local` | round(votosSim / totalVotos * 100) | Derivado em código; 0 quando totalVotos = 0. Math.round. | — |
| `percentualNao` ⚙️ | integer (%) | Percentual de votos NÃO sobre o total. | `derived:calculo-local` | round(votosNao / totalVotos * 100) | Derivado em código; 0 quando totalVotos = 0. Math.round. | — |
| `autoria` | string | Autoria da matéria em consulta (parlamentar/órgão — agente público). | `GET https://www12.senado.leg.br/ecidadania/visualizacaomateria?id={ID}` | página de detalhe: <b>Autoria:</b> <span>…</span> | Lido da página de detalhe (visualizacaomateria) no crawl enriquecido; null quando o detalhe não expõe. Nome MANTIDO (informação pública por função — ver postura de privacidade). | Detail-only (v2): populado pelo crawl de detalhe; null nas linhas ainda não enriquecidas. |
| `relator` | string | Relator(a) da matéria (agente público). | `GET https://www12.senado.leg.br/ecidadania/visualizacaomateria?id={ID}` | página de detalhe: <b>Relator(a):</b> <span>…</span> | Lido da página de detalhe (visualizacaomateria); null quando não há relatoria ou o detalhe não a expõe. Nome MANTIDO (público por função). | Detail-only (v2): populado pelo crawl de detalhe; null nas linhas ainda não enriquecidas. |
| `status` ⚙️ | string | Situação da consulta: "aberta" \| "encerrada". | `GET https://legis.senado.leg.br/dadosabertos/processo?sigla={SIGLA}&tramitando=S` | (derivado) presença de codigoMateria no conjunto tramitando=S | aberta ⟺ a matéria está no universo /processo?tramitando=S; senão encerrada. A derivação ocorre no MESMO run do scrape da listagem, então o retrievedAt do registro cobre também este campo. | Linger re-status: matéria que sai de tramitação vira "encerrada" e congela com os votos finais (nunca por mera ausência da listagem). |
| `url` ⚙️ | url | URL canônica da consulta no portal. | `derived:calculo-local` | visualizacaomateria?id={entityId} | Construída a partir do codigoMateria; não é lida do upstream. | — |
| `firstSeenAt` ⚙️ | date | Primeira vez que o registro foi observado no corpus (proxy prospectivo de ritmo de entrada). | `derived:ecidadania_history` | MIN(scraped_at) per entity_id | MIN(scraped_at) sobre ecidadania_history (Recon Parte III). Observação do nosso crawler — NÃO é data upstream do Senado. | Censura à esquerda: piso 14/06/2026; baseline 16/06 (98,6% do corpus) deve ser excluído de análises de ritmo; série interpretável a partir de 22/06/2026. Resolução = cadência do crawl de corpus completo. |

## `ideias` — Ideias legislativas

**Fonte:** Listagem HTML paginada `pesquisaideia`, varrida por valor de `situacao` (status vem do parâmetro).

| Variável | Tipo | Descrição | sourceEndpoint | sourceField | Operacionalização | Caveat |
|---|---|---|---|---|---|---|
| `titulo` | string | Título da ideia legislativa. | `GET https://www12.senado.leg.br/ecidadania/pesquisaideia?situacao={S}&p={N}` | article.resumo-ideia > section > a (texto da âncora) | Texto da âncora da seção, com entidades HTML decodificadas. | — |
| `apoios` | integer (apoios) | Número de apoios recebidos pela ideia. | `GET https://www12.senado.leg.br/ecidadania/pesquisaideia?situacao={S}&p={N}` | article.resumo-ideia > figure.grafico-ideia-legislativa > footer > span[1] ("N apoios") | Primeiro <span> do footer do figure.grafico-ideia-legislativa ("253.804 apoios"); número BR via parseBrNum. O span de meta (limiar) é ignorado. | — |
| `status` ⚙️ | string | Situação da ideia: "aberta" \| "encerrada" \| "convertida". | `GET https://www12.senado.leg.br/ecidadania/pesquisaideia?situacao={S}&p={N}` | (derivado) parâmetro GET situacao da listagem varrida | A listagem é varrida por situacao=N; o status é o mapa SITUACAO_STATUS ({5,6,8}→aberta, {7,9}→encerrada, 10→convertida) do valor usado no crawl. | — |
| `dataPublicacao` | date | Data limite para atingir os 20.000 apoios (única âncora temporal upstream da ideia). | `GET https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}` | página de detalhe: bloco "Data limite" (DD/MM/AAAA) | extractDate sobre a data-limite exibida no detalhe (visualizacaoideia) → ISO YYYY-MM-DD; lido no crawl de detalhe. Reaberto na v2 (era null por design na v1). | Detail-only (v2): null nas ideias ainda não enriquecidas pelo backfill de detalhe (censura à esquerda residual nesses campos até o backfill completar). |
| `autorUf` | string | UF do cidadão autor da ideia (SEM nome — conteúdo de cidadão). | `GET https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}` | página de detalhe: "Ideia proposta por … (UF)" — apenas o "(UF)" | Extrai só a sigla de UF entre parênteses; o NOME do cidadão é descartado NA ORIGEM (nunca gravado no corpus). Postura de privacidade: conteúdo de cidadão → só UF. | Detail-only (v2): null nas ideias ainda não enriquecidas. Nome do autor deliberadamente não coletado. |
| `descricao` | string | Texto/corpo da ideia legislativa (conteúdo deliberativo do cidadão). | `GET https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}` | página de detalhe: corpo da ideia (visualizacaoideia) | Texto do detalhe, com tags removidas; lido no crawl de detalhe. É conteúdo, não identidade. | Detail-only (v2): null nas ideias ainda não enriquecidas. |
| `plConvertido` | string | Proposição gerada pela ideia (ex.: "SUG 12/2024"), quando convertida. | `GET https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}` | página de detalhe: identificação da proposição (SUG/PL nº) | Regex de identificação de proposição no detalhe; null quando a ideia não gerou proposição. | Detail-only (v2): null nas ideias ainda não enriquecidas ou não convertidas. |
| `url` ⚙️ | url | URL canônica da ideia no portal. | `derived:calculo-local` | visualizacaoideia?id={entityId} | Construída a partir do id; não lida do upstream. | — |
| `firstSeenAt` ⚙️ | date | Primeira observação do registro no corpus (proxy prospectivo de ritmo de entrada). | `derived:ecidadania_history` | MIN(scraped_at) per entity_id | MIN(scraped_at) sobre ecidadania_history. Observação do crawler — NÃO é data upstream. | Censura à esquerda: piso 14/06/2026; baseline de ideias = 29/06/2026 (~99,9% do corpus — primeiro crawl completo da entidade) deve ser excluído de análises de ritmo; série interpretável a partir de 30/06/2026. Resolução = cadência do crawl de corpus completo. |

## `eventos` — Eventos interativos (audiências)

**Fonte:** Listagem HTML paginada `principalaudiencia` (status no sufixo de classe do bloco).

| Variável | Tipo | Descrição | sourceEndpoint | sourceField | Operacionalização | Caveat |
|---|---|---|---|---|---|---|
| `titulo` | string | Título/descrição do evento. | `GET https://www12.senado.leg.br/ecidadania/principalaudiencia?p={N}` | article.resumo-audiencia .descricao > a (texto da âncora) | Texto da âncora dentro de .descricao, com entidades HTML decodificadas. | — |
| `data` | date | Data do evento (canônica, da página de detalhe). | `GET https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id={ID}` | span.audiencia-data (parte DD/MM/AAAA) | extractDate sobre "DD/MM/AAAA - HH:MM" do detalhe → ISO YYYY-MM-DD. Corrigido do detalhe na v2 (estudo A3: listagem fiel em 98,9%, mas o detalhe é canônico). Fallback para a data da listagem nas linhas ainda não enriquecidas. | Detalhe é canônico (estudo A3). Divergência de borda de 1 dia possível vs. listagem; linhas pré-enriquecimento carregam a data da listagem como provisória. |
| `hora` | string | Hora do evento (HH:MM, canônica, da página de detalhe). | `GET https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id={ID}` | span.audiencia-data (parte HH:MM) | extractTime sobre a mesma célula do detalhe. Corrigido do detalhe na v2 — a listagem era degradada (placeholder 00:00 em eventos antigos + offset mediano +15 min; estudo A3: 57% divergente). Fallback para a hora da listagem nas linhas ainda não enriquecidas. | Detalhe é canônico (estudo A3). A hora da listagem não serve para cruzamento fino; linhas pré-enriquecimento carregam a hora da listagem como provisória. |
| `comissao` | string | Sigla da comissão promotora. | `GET https://www12.senado.leg.br/ecidadania/principalaudiencia?p={N}` | em.sigla (token após "\|") | Célula " \| CCT": mantém o token após o último "\|". | — |
| `comissaoNomeCompleto` | string | Nome completo da comissão promotora. | `GET https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id={ID}` | div.audiencia-comissao | Texto do bloco de comissão no detalhe; null nas linhas ainda não enriquecidas. | Detail-only (v2). |
| `local` | string | Local de realização do evento. | `GET https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id={ID}` | div.audiencia-local | Texto do bloco de local no detalhe; null quando ausente ou não enriquecido. | Detail-only (v2). |
| `descricao` | string | Finalidade/descrição do evento. | `GET https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id={ID}` | div.audiencia-finalidade | Texto do bloco de finalidade no detalhe; null quando ausente ou não enriquecido. | Detail-only (v2). |
| `pauta` | object | Itens de pauta do evento (lista de strings). | `GET https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id={ID}` | div.audiencia-pauta (itens) | Bloco de pauta do detalhe, dividido em itens; [] quando ausente ou não enriquecido. | Detail-only (v2). |
| `convidados` | object | Convidados do evento (nomes — agentes públicos por função). | `GET https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id={ID}` | p.titulo-convidados > span (nomes) | Lista de nomes dos convidados do detalhe; [] quando ausente ou não enriquecido. Nome MANTIDO (convidado é agente público na função — ver postura de privacidade). | Detail-only (v2). |
| `videoUrl` | url | URL do vídeo (embed do YouTube) do evento, quando houver. | `GET https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id={ID}` | embed YouTube (src do iframe) | URL do embed do YouTube no detalhe; null até haver vídeo ou nas linhas não enriquecidas. | Detail-only (v2); null é o estado comum (nem todo evento tem vídeo). |
| `comentarios` | integer (comentários) | Número CANÔNICO de comentários no evento. | `GET https://www12.senado.leg.br/ecidadania/ajaxcolecaocomentarioaudiencia?audienciaId={ID}` | nº de blocos <div class="comentario"> no fragmento AJAX | Contagem dos blocos de comentário retornados por ajaxcolecaocomentarioaudiencia (fragmento sem paginação) — a fonte canônica (estudo A3: a listagem tinha 0 espúrio em 82% dos eventos, captando só ~6,7% do engajamento). VOLÁTIL: recontado a cada ciclo de crawl. 0 nas linhas ainda não enriquecidas. | Contagem canônica via AJAX (estudo A3). Volátil (comentários acumulam) → re-crawl por ciclo. O nível-comentário está na entidade `eventos_comentarios`. |
| `status` ⚙️ | string | Situação do evento: "agendado" \| "encerrado" \| "cancelado". | `GET https://www12.senado.leg.br/ecidadania/principalaudiencia?p={N}` | sufixo da classe resumo-audiencia-STATUS (fallback por data) | mapEventoStatus: CANCELADO→cancelado; REALIZADO/ENCERRADO→encerrado; AGENDADO→agendado; sem classe → por data. | Fidelidade (Recon §4.1): o sufixo REGISTRADO (sabatina "sem data prevista") cai em "agendado" — indistinguível dos agendados genuínos. Não corrigido nesta fase (é dívida de tool, não de dataset); apenas declarado. |
| `url` ⚙️ | url | URL canônica do evento no portal. | `derived:calculo-local` | visualizacaoaudiencia?id={entityId} | Construída a partir do id; não lida do upstream. | — |
| `firstSeenAt` ⚙️ | date | Primeira observação do registro no corpus (proxy prospectivo de ritmo de entrada). | `derived:ecidadania_history` | MIN(scraped_at) per entity_id | MIN(scraped_at) sobre ecidadania_history. Observação do crawler — NÃO é data upstream. | Censura à esquerda: piso 14/06/2026; baseline de eventos = 29/06/2026 (~99,5% do corpus — primeiro crawl completo pós-ruptura do container) deve ser excluído de análises de ritmo; série interpretável a partir de 30/06/2026. Resolução = cadência do crawl de corpus completo. |

## `eventos_comentarios` — Comentários de audiências (nível-comentário)

**Fonte:** Fragmento AJAX `ajaxcolecaocomentarioaudiencia?audienciaId={ID}` (blocos `<div class="comentario">`). Nível-comentário das audiências; sem nome do comentarista (só UF).

| Variável | Tipo | Descrição | sourceEndpoint | sourceField | Operacionalização | Caveat |
|---|---|---|---|---|---|---|
| `eventoId` | integer | Id da audiência a que o comentário pertence (FK para a entidade `eventos`). | `GET https://www12.senado.leg.br/ecidadania/ajaxcolecaocomentarioaudiencia?audienciaId={ID}` | parâmetro audienciaId da chamada AJAX | audienciaId usado na requisição do fragmento de comentários; liga ao nível-evento. | — |
| `comentarioId` | integer | Id estável do comentário no portal. | `GET https://www12.senado.leg.br/ecidadania/ajaxcolecaocomentarioaudiencia?audienciaId={ID}` | atributo data-id do bloco <div class="comentario"> | Inteiro do data-id (equivalente ao sufixo de id="comentario-N"). | — |
| `uf` | string | UF do cidadão comentarista (SEM nome — conteúdo de cidadão). | `GET https://www12.senado.leg.br/ecidadania/ajaxcolecaocomentarioaudiencia?audienciaId={ID}` | div.titulo-comentarios, parte "(XX)" | Extrai só a sigla de UF entre parênteses de "NOME (XX)"; o NOME é descartado NA ORIGEM (nunca gravado). Postura de privacidade: conteúdo de cidadão → só UF. | Nome do comentarista deliberadamente não coletado; null quando o bloco não traz "(UF)". |
| `texto` | string | Texto do comentário (verbatim — conteúdo deliberativo). | `GET https://www12.senado.leg.br/ecidadania/ajaxcolecaocomentarioaudiencia?audienciaId={ID}` | div.texto-comentarios | Texto do bloco, com tags removidas; preservado verbatim. | — |
| `data` | date | Data do comentário. | `GET https://www12.senado.leg.br/ecidadania/ajaxcolecaocomentarioaudiencia?audienciaId={ID}` | div.horadata-comentarios (parte DD/MM/AAAA) | extractDate sobre "HHhMM - DD/MM/AAAA" → ISO YYYY-MM-DD. | — |
| `hora` | string | Hora do comentário (HH:MM). | `GET https://www12.senado.leg.br/ecidadania/ajaxcolecaocomentarioaudiencia?audienciaId={ID}` | div.horadata-comentarios (parte HHhMM) | Converte "HHhMM" da mesma célula em HH:MM. | — |
| `momentoVideoUrl` | url | URL do momento do vídeo ancorado ao comentário, quando houver. | `GET https://www12.senado.leg.br/ecidadania/ajaxcolecaocomentarioaudiencia?audienciaId={ID}` | momento-comentario / momento-por-link (quando presente) | Subconjunto: comentário ancorado a um instante do vídeo; null quando ausente. | Presente só em comentários ancorados a um momento do vídeo. |
| `convidadoAssociado` | string | Convidado a quem o comentário se dirige (nome — agente público), quando houver. | `GET https://www12.senado.leg.br/ecidadania/ajaxcolecaocomentarioaudiencia?audienciaId={ID}` | momento-convidado-nome / momento-convidado-cargo (quando presente) | Nome/cargo do convidado associado ao momento; null quando ausente. Convidado é público (nome mantido). | Presente só quando o comentário está associado a um convidado. |

## `consultas_votos` — Votos históricos por UF (acervo Arquimedes)

**Fonte:** CSV Arquimedes `Proposições-com-votos.csv` (~33 MB, windows-1252). Acervo de vintage ÚNICO — não é série temporal.

| Variável | Tipo | Descrição | sourceEndpoint | sourceField | Operacionalização | Caveat |
|---|---|---|---|---|---|---|
| `materia` | string | Identificação/nome da matéria. | `GET https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv` | coluna "NOME DA MATÉRIA" | Célula da coluna homônima; primeira linha da matéria vence (constante entre UFs). | — |
| `ementa` | string | Ementa da matéria. | `GET https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv` | coluna "EMENTA" | Célula da coluna EMENTA (parser RFC-4180 tolerante a quebras de linha embutidas). | — |
| `autoria` | string | Autoria da matéria. | `GET https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv` | coluna "AUTORIA" | Célula da coluna homônima. | — |
| `status` | string | Status atual segundo o CSV (uniformemente "Descontinuado"). | `GET https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv` | coluna "STATUS ATUAL" | Mantido verbatim; não usado como opinião atual (acervo congelado). | Uniformemente "Descontinuado" em todo o acervo. |
| `votosSim` ⚙️ | integer (votos) | Total de votos SIM somando todas as UFs. | `GET https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv` | soma da coluna "VOTO SIM" nas linhas matéria×UF | Agregação: soma de VOTO SIM (parseBrNum) sobre todas as linhas da matéria. | — |
| `votosNao` ⚙️ | integer (votos) | Total de votos NÃO somando todas as UFs. | `GET https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv` | soma da coluna "VOTO NÃO" nas linhas matéria×UF | Agregação: soma de VOTO NÃO (parseBrNum) sobre todas as linhas da matéria. | — |
| `totalVotos` ⚙️ | integer (votos) | Soma de votosSim + votosNao. | `derived:calculo-local` | votosSim + votosNao | Derivado em código. | — |
| `votosPorUf` ⚙️ | object | Detalhamento de votos SIM/NÃO por UF do cidadão (diferencial regional do acervo). | `GET https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv` | agregação por coluna "UF DO CIDADÃO" de "VOTO SIM"/"VOTO NÃO" | { UF: { sim, nao } } com chaves de UF ordenadas (JSON determinístico). | — |
| `url` ⚙️ | url | URL canônica da matéria no portal. | `derived:calculo-local` | visualizacaomateria?id={entityId} | Construída a partir do codigoMateria; não lida do upstream. | — |
| `referencePeriod` | date | Vintage do acervo: data do carimbo "dados atualizados até" do CSV. | `GET https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv` | linha 1 do CSV ("Dados atualizados até DD/MM/AAAA") | extractDate sobre o carimbo → ISO. É o ÚNICO campo temporal do acervo. | Acervo de vintage único (profundidade de série = 1): não há série temporal; este é o único carimbo de data. |
