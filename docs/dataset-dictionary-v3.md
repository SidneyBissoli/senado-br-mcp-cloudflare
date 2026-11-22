# Dicionário do dataset 3.0.0 — participação no e-Cidadania (Senado Federal)

> **Gerado automaticamente** de `scripts/publicacao/dicionario.ts` (fonte única). Não editar à mão.

- **Esquema:** `3.0.0` (MAJOR sobre o 2.0.0: fim do envelope por célula, tabelas tidy, séries no tempo, nome do autor da ideia).
- **Licença do dado:** Dados Abertos do Senado Federal — uso livre com atribuição da fonte.
- **Valores puros**, um por célula. Datas em `AAAA-MM-DD`; instantes em UTC; horas `HH:MM` locais de Brasília, como publicadas.
- ⚙️ = coluna **calculada** pelo projeto (não lida da fonte), mantida por conveniência e marcada.

## De onde vêm os valores

Três camadas: o **arquivo de páginas** (cada página baixada, guardada inteira, endereçada pelo sha256; privado), as **observações** (o que cada página mostrou e quando) e estas **tabelas**. Cada valor vem da leitura mais recente do arquivo; o que o arquivo ainda não leu — ou nunca vai ler, como as consultas encerradas que saíram da listagem e as ideias removidas — vem do **corpus**, o banco que o projeto mantém desde 14/06/2026. As colunas `origem<Bloco>` e `coletadoEm<Bloco>` dizem, por bloco de página, de onde e de quando veio cada linha.

## `ideias/ideias` — Ideias legislativas

Uma linha por ideia legislativa, com o estado mais recente lido. Bloco RESUMO (título, apoios): a leitura mais recente da listagem de qualquer situação ou do detalhe. Bloco DETALHE (o resto): a última página de detalhe que o leitor abriu.

**Uma linha por:** `id`

| Coluna | Tipo | Descrição | Fonte | Nota |
|---|---|---|---|---|
| `id` | integer | Id da ideia no portal. | parâmetro `id` da URL da página | — |
| `titulo` | string | Título da ideia. | bloco resumo: listagem `https://www12.senado.leg.br/ecidadania/pesquisaideia?situacao={S}&p={N}` ou detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}`; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco) | — |
| `descricao` | string | Texto da ideia, escrito pelo cidadão. | bloco detalhe: detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}`; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco) | No corpus o texto foi cortado em 2.000 caracteres; do arquivo vem inteiro. |
| `status` ⚙️ | string | Classificação do projeto: aberta | encerrada | convertida | removida. | corpus (classificação calculada a partir da situação do portal, da linha do tempo e da resposta 410) | Não é a situação do portal: para ela, ver `situacoes-portal` e `historico-situacao`. |
| `dataProposta` | date | Data em que a ideia foi proposta. | bloco detalhe: detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}`, data do acontecimento "Ideia proposta por NOME (UF)" da linha do tempo | Null quando o detalhe ainda vem do corpus (o corpus não a guardava). |
| `autorNome` | string | Nome do cidadão autor, como o portal o publica (já abreviado, ex.: "PEDRO H. S. V."). | bloco detalhe: detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}` | Decisão do dono de 17/10/2026. Null quando o detalhe ainda vem do corpus (o corpus nunca guardou o nome). Comentaristas de eventos seguem sem nome. |
| `autorUf` | string | Localidade do autor como publicada: sigla da UF ou "Exterior". | bloco detalhe: detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}`, o parêntese depois do nome; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco) | Null = a página não publica localidade (há páginas de autor "USUARIO …" sem parêntese). |
| `oficinaNivel` | string | Nível da Oficina Legislativa, quando a ideia veio de uma. | bloco detalhe: detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}`, acontecimento da oficina | — |
| `oficinaDataCadastro` | string | Data e hora do cadastro na Oficina Legislativa, como publicada (AAAA-MM-DDTHH:MM, hora local, SEM fuso). | bloco detalhe: detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}`, acontecimento da oficina | Texto, não instante: a página não diz o fuso. |
| `apoios` | integer | Número de apoios confirmados. | bloco resumo: listagem `https://www12.senado.leg.br/ecidadania/pesquisaideia?situacao={S}&p={N}` (span.contabilizacao) ou detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}`; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco) | — |
| `prazoApoios` | date | Último dia para receber apoios. | bloco detalhe: detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}`, "Essa ideia pode receber apoios até DD/MM/AAAA"; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco) | Em ideia aberta está no futuro. Regra do portal medida (C4): prazo = proposta + 120 dias. |
| `data20mil` | date | Data em que a ideia atingiu 20.000 apoios. | bloco detalhe: detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}`, acontecimento da meta | — |
| `dataSugestao` | date | Data em que a ideia virou Sugestão na CDH. | bloco detalhe: detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}`, "Essa ideia gerou a Sugestão nº N, de AAAA" | — |
| `sugestaoNumero` | integer | Número da Sugestão gerada. | bloco detalhe: detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}`, mesmo acontecimento; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco) (campo `plConvertido` do 2.0.0) | — |
| `sugestaoAno` | integer | Ano da Sugestão gerada. | bloco detalhe: detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}`, mesmo acontecimento; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco) | — |
| `dataDecisaoCdh` | date | Data da decisão da CDH sobre a Sugestão. | bloco detalhe: detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}`, acontecimento da decisão | — |
| `decisaoCdh` | string | Decisão da CDH: transformou | não transformou. | bloco detalhe: detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}`, acontecimento da decisão | — |
| `dataPublicacao` | date | LEGADO do 2.0.0, igual a `prazoApoios`. | cópia de `prazoApoios` | Nome histórico enganoso (não é a data de publicação); mantido para quem já usa. |
| `url` ⚙️ | string | Endereço da página no portal, para conferir a linha na fonte. | montada pelo projeto: `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={id}` | Montada a partir do id, não lida da página; se o portal mudar o padrão de endereço, as antigas deixam de abrir. |
| `firstSeenAt` ⚙️ | datetime | Primeira vez que o robô do projeto viu o registro (UTC). | MIN(scraped_at) no histórico do corpus (`ecidadania_history`) | Observação do robô, não data do Senado. Censurada à esquerda: o corpus começa em 14/06/2026 e a primeira varredura completa de cada entidade (16/06 consultas; 29/06 ideias e eventos) marca quase todo o acervo antigo; exclua essas datas de análises de ritmo de entrada. |
| `origemResumo` ⚙️ | string | De onde vieram as colunas do bloco resumo: listagem | detalhe (arquivo de páginas) | corpus. | projeto (decisão 2 da fase D) | "corpus" = o arquivo de páginas (desde 30/10/2026 nas ideias, 20/11/2026 nas demais) ainda não leu título e apoios deste registro, ou nunca vai ler (fora da listagem, removido); vale o último valor que o corpus guardou. |
| `coletadoEmResumo` ⚙️ | datetime | Quando foi lida a página de onde veio o bloco resumo (UTC). | índice do arquivo de páginas, ou `scraped_at` do corpus | Na origem corpus é o instante da última gravação da linha no corpus, que pode ser posterior à leitura daquele bloco. |
| `origemDetalhe` ⚙️ | string | De onde vieram as colunas do bloco detalhe: arquivo | corpus. | projeto (decisão 2 da fase D) | "corpus" = o arquivo de páginas (desde 30/10/2026 nas ideias, 20/11/2026 nas demais) ainda não leu a página de detalhe deste registro, ou nunca vai ler (fora da listagem, removido); vale o último valor que o corpus guardou. |
| `coletadoEmDetalhe` ⚙️ | datetime | Quando foi lida a página de onde veio o bloco detalhe (UTC). | índice do arquivo de páginas, ou `scraped_at` do corpus | Na origem corpus é o instante da última gravação da linha no corpus, que pode ser posterior à leitura daquele bloco. |

## `ideias/proposicoes` — Proposições geradas por ideias

Uma linha por proposição em que a ideia foi transformada (pela CDH ou adotada por parlamentar), na ordem cronológica da linha do tempo.

**Uma linha por:** `id` × `data` × `tipoSigla` × `numero` × `ano`

| Coluna | Tipo | Descrição | Fonte | Nota |
|---|---|---|---|---|
| `id` | integer | Id da ideia. | parâmetro `id` da URL da página | — |
| `data` | date | Data do acontecimento de transformação. | detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}` | — |
| `transformadaPor` | string | Quem transformou, como publicado: Comissão | Senador | Deputado. | detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}` | — |
| `sexo` | string | Gênero gramatical do cargo publicado: feminino (Senadora, Deputada) | masculino | null (Comissão). | detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}` | Lido do cargo, não de cadastro. |
| `parlamentar` | string | Nome do parlamentar (agente público). | detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}` | — |
| `parlamentarUf` | string | UF do parlamentar. | detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}` | — |
| `tipoSigla` | string | Sigla do tipo de proposição (PL, PEC, PLP…). | detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}` | — |
| `tipoNome` | string | Nome do tipo, como publicado. | detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}` | — |
| `numero` | string | Número da proposição. | detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}` | — |
| `ano` | integer | Ano da proposição. | detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}` | — |
| `complemento` | string | Complemento publicado (ex.: casa de origem). | detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}` | — |
| `url` | string | Link da proposição publicado na linha do tempo (Senado ou Câmara). | detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}` | — |
| `origem` ⚙️ | string | arquivo | corpus. | projeto | — |

## `ideias/linha-do-tempo` — Linha do tempo das ideias

Uma linha por acontecimento da linha do tempo da página de detalhe, da última leitura aberta. Só ideias com detalhe no arquivo de páginas (o corpus nunca guardou a linha do tempo).

**Uma linha por:** `id` × `ordem`

| Coluna | Tipo | Descrição | Fonte | Nota |
|---|---|---|---|---|
| `id` | integer | Id da ideia. | parâmetro `id` da URL da página | — |
| `ordem` | integer | Posição na página: 0 = o do topo (o mais recente). | detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}` | — |
| `data` | date | Data do acontecimento. | detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}` | — |
| `tipo` ⚙️ | string | Tipo, pelo vocabulário fechado do leitor: proposta, prazo, oficina, meta, prazoEncerrado, sugestao, cdhNaoTransformou, cdhTransformou, adocao, transformadaEm, naoReconhecido. | leitor do projeto (`lerIdeiaDetalhe`) | "naoReconhecido" = texto fora do vocabulário; o texto vai inteiro. |
| `texto` | string | Texto do acontecimento, verbatim. | detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}` | — |

## `ideias/situacoes-portal` — Situação atual das ideias no portal

A(s) situação(ões) do portal em que a ideia está agora: as vistas no DIA da sua avistagem mais recente em qualquer listagem. Duas ao mesmo tempo = duas linhas (o portal lista a mesma ideia em duas situações).

**Uma linha por:** `id` × `situacaoCodigo`

| Coluna | Tipo | Descrição | Fonte | Nota |
|---|---|---|---|---|
| `id` | integer | Id da ideia. | parâmetro `id` da URL da página | — |
| `situacaoCodigo` ⚙️ | string | Código da situação no portal (5, 6, 7, 8, 9, 10, 99). | listagem `https://www12.senado.leg.br/ecidadania/pesquisaideia?situacao={S}&p={N}` | Regra do projeto (decisão 6 da fase D). As encerradas (7) são varridas aos poucos, não todo dia: veja `vistaEm`. As 30 ideias da 99 também estão na 7 no portal, mas aparecem só como 99. |
| `situacaoNome` | string | Nome da situação, como no menu do portal. | listagem `https://www12.senado.leg.br/ecidadania/pesquisaideia?situacao={S}&p={N}` | — |
| `vistaEm` | datetime | Última vez que a ideia foi vista nessa listagem (UTC). | arquivo de páginas | — |

## `ideias/historico-situacao` — Histórico de situação das ideias

Situação ao longo do tempo, de duas origens que não se misturam: a situação do PORTAL vista no arquivo de páginas (desde 30/10/2026) e o status de 3 valores do corpus (desde 14/06/2026, um ponto por mudança).

**Uma linha por:** `entity_id` × `origem` × `desde`

| Coluna | Tipo | Descrição | Fonte | Nota |
|---|---|---|---|---|
| `entity_id` | string | Id da ideia. | parâmetro `id` | — |
| `origem` ⚙️ | string | listagem (arquivo) | corpus. | projeto | — |
| `situacao_codigo` | string | Código da situação do portal (só origem listagem). | listagem `https://www12.senado.leg.br/ecidadania/pesquisaideia?situacao={S}&p={N}` | — |
| `situacao_nome` | string | Nome da situação do portal (só origem listagem). | listagem `https://www12.senado.leg.br/ecidadania/pesquisaideia?situacao={S}&p={N}` | — |
| `status` ⚙️ | string | Status de 3 valores do projeto (só origem corpus). | corpus | — |
| `desde` | datetime | Primeira vez vista (UTC). | arquivo de páginas ou corpus | — |
| `ate` | datetime | Última vez vista (UTC). | arquivo de páginas ou corpus | A ausência de uma listagem não é leitura: se a ideia some de uma situação e volta, o intervalo cobre o meio. |
| `leituras` | integer | Leituras que a sustentam. | arquivo de páginas (1 no corpus) | — |
| `sha` | string | sha256 da primeira página que a mostrou. | arquivo de páginas (null no corpus) | — |

## `ideias/serie-apoios` — Série de apoios das ideias

Apoios ao longo do tempo: do arquivo de páginas por série (listagem de cada situação, detalhe) e do corpus (um ponto por mudança, desde 14/06/2026), lado a lado.

**Uma linha por:** `entity_id` × `origem` × `desde`

| Coluna | Tipo | Descrição | Fonte | Nota |
|---|---|---|---|---|
| `entity_id` | string | Id da ideia. | parâmetro `id` | — |
| `origem` ⚙️ | string | A série: listagem-sN (listagem da situação N), detalhe, ou corpus. | projeto | — |
| `apoios` | integer | Apoios vistos. | listagem `https://www12.senado.leg.br/ecidadania/pesquisaideia?situacao={S}&p={N}` | detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoideia?id={ID}` | corpus | No corpus, antes de 18/10/2026, 0 pode ser contagem AUSENTE lida como 0 (38.454 pontos). |
| `desde` | datetime | Primeira leitura com esse valor (UTC). | arquivo de páginas ou corpus | — |
| `ate` | datetime | Última leitura seguida com esse valor (UTC). | arquivo de páginas ou corpus | — |
| `leituras` | integer | Leituras seguidas com esse valor. | arquivo de páginas (1 no corpus) | — |
| `sha` | string | sha256 da primeira página com esse valor. | arquivo de páginas (null no corpus) | — |

## `consultas/consultas` — Consultas públicas

Uma linha por consulta pública. Bloco RESUMO: a listagem (matéria, ementa, votos). Bloco DETALHE: a página da consulta (autoria). As encerradas saíram da listagem e vêm do corpus.

**Uma linha por:** `id`

| Coluna | Tipo | Descrição | Fonte | Nota |
|---|---|---|---|---|
| `id` | integer | Código da matéria em consulta. | parâmetro `id` da URL da página | — |
| `materia` | string | Identificação da matéria (ex.: "PL 5064/2023"). | bloco resumo: listagem `https://www12.senado.leg.br/ecidadania/pesquisamateria?p={N}`; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco) | — |
| `ementa` | string | Ementa da matéria. | bloco resumo: listagem `https://www12.senado.leg.br/ecidadania/pesquisamateria?p={N}`; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco) | — |
| `votosSim` | integer | Votos SIM. | bloco resumo: listagem `https://www12.senado.leg.br/ecidadania/pesquisamateria?p={N}`; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco) | — |
| `votosNao` | integer | Votos NÃO. | bloco resumo: listagem `https://www12.senado.leg.br/ecidadania/pesquisamateria?p={N}`; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco) | — |
| `totalVotos` ⚙️ | integer | votosSim + votosNao. | soma das duas colunas | — |
| `percentualSim` ⚙️ | number | Percentual de SIM, com uma casa decimal. | votosSim / totalVotos × 100 | Null sem votos (0/0 não é 0%). No 2.0.0 era inteiro e 0 sem votos. |
| `percentualNao` ⚙️ | number | Percentual de NÃO, com uma casa decimal. | votosNao / totalVotos × 100 | Null sem votos. |
| `autoria` | string | Autoria da matéria (agente público). | bloco detalhe: detalhe `https://www12.senado.leg.br/ecidadania/visualizacaomateria?id={ID}`; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco) | — |
| `relator` | string | SEMPRE null: a página da consulta não publica relatoria. | detalhe `https://www12.senado.leg.br/ecidadania/visualizacaomateria?id={ID}` | Mantida pelo formato. O relator está na API legislativa (/processo/relatoria). Não use como dado. |
| `status` ⚙️ | string | aberta | encerrada (a matéria está ou não em tramitação). | corpus, derivado de `/processo?tramitando=S` da API legislativa | — |
| `url` ⚙️ | string | Endereço da página no portal, para conferir a linha na fonte. | montada pelo projeto: `https://www12.senado.leg.br/ecidadania/visualizacaomateria?id={id}` | Montada a partir do id, não lida da página; se o portal mudar o padrão de endereço, as antigas deixam de abrir. |
| `firstSeenAt` ⚙️ | datetime | Primeira vez que o robô do projeto viu o registro (UTC). | MIN(scraped_at) no histórico do corpus (`ecidadania_history`) | Observação do robô, não data do Senado. Censurada à esquerda: o corpus começa em 14/06/2026 e a primeira varredura completa de cada entidade (16/06 consultas; 29/06 ideias e eventos) marca quase todo o acervo antigo; exclua essas datas de análises de ritmo de entrada. |
| `origemResumo` ⚙️ | string | De onde vieram as colunas do bloco resumo: arquivo | corpus. | projeto (decisão 2 da fase D) | "corpus" = o arquivo de páginas (desde 30/10/2026 nas ideias, 20/11/2026 nas demais) ainda não leu a listagem deste registro, ou nunca vai ler (fora da listagem, removido); vale o último valor que o corpus guardou. |
| `coletadoEmResumo` ⚙️ | datetime | Quando foi lida a página de onde veio o bloco resumo (UTC). | índice do arquivo de páginas, ou `scraped_at` do corpus | Na origem corpus é o instante da última gravação da linha no corpus, que pode ser posterior à leitura daquele bloco. |
| `origemDetalhe` ⚙️ | string | De onde vieram as colunas do bloco detalhe: arquivo | corpus. | projeto (decisão 2 da fase D) | "corpus" = o arquivo de páginas (desde 30/10/2026 nas ideias, 20/11/2026 nas demais) ainda não leu a página da consulta deste registro, ou nunca vai ler (fora da listagem, removido); vale o último valor que o corpus guardou. |
| `coletadoEmDetalhe` ⚙️ | datetime | Quando foi lida a página de onde veio o bloco detalhe (UTC). | índice do arquivo de páginas, ou `scraped_at` do corpus | Na origem corpus é o instante da última gravação da linha no corpus, que pode ser posterior à leitura daquele bloco. |

## `consultas/serie-votos` — Série de votos das consultas

Votos SIM e NÃO de cada consulta ao longo do tempo, em formato longo: arquivo de páginas (desde 20/11/2026) e corpus (desde 14/06/2026, um ponto por mudança).

**Uma linha por:** `id` × `voto` × `origem` × `desde`

| Coluna | Tipo | Descrição | Fonte | Nota |
|---|---|---|---|---|
| `id` | integer | Código da matéria. | parâmetro `id` da URL da página | — |
| `voto` | string | SIM | NAO. | listagem `https://www12.senado.leg.br/ecidadania/pesquisamateria?p={N}` | — |
| `votos` | integer | Contagem vista. | listagem `https://www12.senado.leg.br/ecidadania/pesquisamateria?p={N}` | corpus | O corpus também recebe a contagem dos destaques a cada 2 h sem guardar a página: pode ter pontos que o arquivo não tem. |
| `desde` | datetime | Primeira leitura em que o valor foi visto (UTC). | arquivo de páginas ou corpus | — |
| `ate` | datetime | Última leitura seguida em que o mesmo valor foi visto (UTC). | arquivo de páginas ou corpus | Entre `desde` e `ate` o valor foi visto em todas as leituras daquela série; fora delas, nada se afirma. No corpus, `desde = ate` (um ponto por mudança). |
| `leituras` | integer | Quantas leituras seguidas mostraram o valor. | arquivo de páginas (1 no corpus) | — |
| `sha` | string | sha256 da primeira página guardada que mostrou o valor (o arquivo bruto é privado; o hash prova a leitura). | arquivo de páginas (null no corpus) | — |
| `origem` ⚙️ | string | De onde vem a linha: listagem (arquivo) | corpus. | projeto | — |

## `eventos/eventos` — Eventos interativos (audiências)

Uma linha por evento. Bloco RESUMO (título, comissão, situação): a leitura mais recente da listagem ou do detalhe. Bloco DETALHE: a página do evento. Bloco COMENTÁRIOS: o fragmento de comentários.

**Uma linha por:** `id`

| Coluna | Tipo | Descrição | Fonte | Nota |
|---|---|---|---|---|
| `id` | integer | Id do evento. | parâmetro `id` da URL da página | — |
| `titulo` | string | Título do evento. | bloco resumo: listagem `https://www12.senado.leg.br/ecidadania/principalaudiencia?p={N}` ou detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id={ID}`; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco) | — |
| `data` | date | Data do evento (canônica, do detalhe). | bloco detalhe: detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id={ID}`; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco) | No corpus, eventos nunca enriquecidos carregam a data da listagem (provisória; estudo A3). |
| `hora` | time | Hora do evento, HH:MM (canônica, do detalhe). | bloco detalhe: detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id={ID}`; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco) | A hora da listagem é degradada (estudo A3); no corpus pode ser ela. |
| `comissao` | string | Sigla da comissão. | bloco resumo: listagem `https://www12.senado.leg.br/ecidadania/principalaudiencia?p={N}` ou detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id={ID}`; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco) | — |
| `comissaoNomeCompleto` | string | Nome da comissão por extenso. | bloco detalhe: detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id={ID}`; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco) | — |
| `local` | string | Local do evento. | bloco detalhe: detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id={ID}`; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco) | — |
| `descricao` | string | Finalidade do evento. | bloco detalhe: detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id={ID}`; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco) | — |
| `videoUrl` | string | Vídeo do evento (YouTube), quando houver. | bloco detalhe: detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id={ID}`; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco) | — |
| `comentarios` | integer | Número de comentários (contagem canônica, do fragmento). | bloco comentários: fragmento `https://www12.senado.leg.br/ecidadania/ajaxcolecaocomentarioaudiencia?audienciaId={ID}`; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco) | — |
| `status` ⚙️ | string | agendado | encerrado | cancelado. | bloco resumo: classe da listagem ou do detalhe; sem leitura no arquivo, o valor guardado no corpus (ver a coluna de origem do bloco) | REGISTRADO ("sem data prevista") é dobrado em agendado (Recon §4.1). |
| `url` ⚙️ | string | Endereço da página no portal, para conferir a linha na fonte. | montada pelo projeto: `https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id={id}` | Montada a partir do id, não lida da página; se o portal mudar o padrão de endereço, as antigas deixam de abrir. |
| `firstSeenAt` ⚙️ | datetime | Primeira vez que o robô do projeto viu o registro (UTC). | MIN(scraped_at) no histórico do corpus (`ecidadania_history`) | Observação do robô, não data do Senado. Censurada à esquerda: o corpus começa em 14/06/2026 e a primeira varredura completa de cada entidade (16/06 consultas; 29/06 ideias e eventos) marca quase todo o acervo antigo; exclua essas datas de análises de ritmo de entrada. |
| `origemResumo` ⚙️ | string | De onde vieram as colunas do bloco resumo: listagem | detalhe (arquivo de páginas) | corpus. | projeto (decisão 2 da fase D) | "corpus" = o arquivo de páginas (desde 30/10/2026 nas ideias, 20/11/2026 nas demais) ainda não leu título, comissão e situação deste registro, ou nunca vai ler (fora da listagem, removido); vale o último valor que o corpus guardou. |
| `coletadoEmResumo` ⚙️ | datetime | Quando foi lida a página de onde veio o bloco resumo (UTC). | índice do arquivo de páginas, ou `scraped_at` do corpus | Na origem corpus é o instante da última gravação da linha no corpus, que pode ser posterior à leitura daquele bloco. |
| `origemDetalhe` ⚙️ | string | De onde vieram as colunas do bloco detalhe: arquivo | corpus. | projeto (decisão 2 da fase D) | "corpus" = o arquivo de páginas (desde 30/10/2026 nas ideias, 20/11/2026 nas demais) ainda não leu a página do evento deste registro, ou nunca vai ler (fora da listagem, removido); vale o último valor que o corpus guardou. |
| `coletadoEmDetalhe` ⚙️ | datetime | Quando foi lida a página de onde veio o bloco detalhe (UTC). | índice do arquivo de páginas, ou `scraped_at` do corpus | Na origem corpus é o instante da última gravação da linha no corpus, que pode ser posterior à leitura daquele bloco. |
| `origemComentarios` ⚙️ | string | De onde vieram as colunas do bloco comentarios: arquivo | corpus. | projeto (decisão 2 da fase D) | "corpus" = o arquivo de páginas (desde 30/10/2026 nas ideias, 20/11/2026 nas demais) ainda não leu o fragmento de comentários deste registro, ou nunca vai ler (fora da listagem, removido); vale o último valor que o corpus guardou. |
| `coletadoEmComentarios` ⚙️ | datetime | Quando foi lida a página de onde veio o bloco comentarios (UTC). | índice do arquivo de páginas, ou `scraped_at` do corpus | Na origem corpus é o instante da última gravação da linha no corpus, que pode ser posterior à leitura daquele bloco. |

## `eventos/pauta` — Pauta dos eventos

Uma linha por item de pauta, na ordem da página.

**Uma linha por:** `id` × `ordem`

| Coluna | Tipo | Descrição | Fonte | Nota |
|---|---|---|---|---|
| `id` | integer | Id do evento. | parâmetro `id` da URL da página | — |
| `ordem` | integer | Posição na página (0 = o primeiro). | detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id={ID}` | — |
| `texto` | string | Item de pauta. | detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id={ID}` | — |
| `origem` ⚙️ | string | arquivo | corpus. | projeto | — |

## `eventos/convidados` — Convidados dos eventos

Uma linha por convidado (agente público na função; nome mantido), na ordem da página.

**Uma linha por:** `id` × `ordem`

| Coluna | Tipo | Descrição | Fonte | Nota |
|---|---|---|---|---|
| `id` | integer | Id do evento. | parâmetro `id` da URL da página | — |
| `ordem` | integer | Posição na página (0 = o primeiro). | detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id={ID}` | — |
| `texto` | string | Convidado, como publicado (nome e cargo). | detalhe `https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id={ID}` | — |
| `origem` ⚙️ | string | arquivo | corpus. | projeto | — |

## `eventos/comentarios` — Comentários dos eventos

Um comentário por linha, da última leitura do fragmento. Conteúdo de cidadão: só UF e texto, SEM nome.

**Uma linha por:** `eventoId` × `comentarioId`

| Coluna | Tipo | Descrição | Fonte | Nota |
|---|---|---|---|---|
| `eventoId` | integer | Id do evento. | parâmetro `audienciaId` | — |
| `comentarioId` | integer | Id do comentário no portal. | fragmento `https://www12.senado.leg.br/ecidadania/ajaxcolecaocomentarioaudiencia?audienciaId={ID}`, atributo data-id | — |
| `uf` | string | UF do comentarista. | fragmento `https://www12.senado.leg.br/ecidadania/ajaxcolecaocomentarioaudiencia?audienciaId={ID}` | O nome é descartado na origem (nunca gravado). |
| `data` | date | Data do comentário. | fragmento `https://www12.senado.leg.br/ecidadania/ajaxcolecaocomentarioaudiencia?audienciaId={ID}` | — |
| `hora` | time | Hora do comentário, HH:MM. | fragmento `https://www12.senado.leg.br/ecidadania/ajaxcolecaocomentarioaudiencia?audienciaId={ID}` | — |
| `texto` | string | Texto do comentário, verbatim. | fragmento `https://www12.senado.leg.br/ecidadania/ajaxcolecaocomentarioaudiencia?audienciaId={ID}` | — |
| `momentoVideoUrl` | string | Momento do vídeo a que o comentário se ancora, quando houver. | fragmento `https://www12.senado.leg.br/ecidadania/ajaxcolecaocomentarioaudiencia?audienciaId={ID}` | — |
| `convidadoAssociado` | string | Convidado a quem o comentário se dirige, quando houver. | fragmento `https://www12.senado.leg.br/ecidadania/ajaxcolecaocomentarioaudiencia?audienciaId={ID}` | — |
| `origem` ⚙️ | string | arquivo | corpus. | projeto | — |

## `consultas_votos/materias` — Matérias do acervo de votos por UF

Uma linha por matéria do acervo histórico (CSV Arquimedes), na versão mais recente do CSV.

**Uma linha por:** `codigo`

| Coluna | Tipo | Descrição | Fonte | Nota |
|---|---|---|---|---|
| `codigo` | integer | Código da matéria. | CSV Arquimedes `https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv` (windows-1252, lido como UTF-8), coluna CÓD. MATÉRIA | — |
| `materia` | string | Identificação da matéria. | CSV Arquimedes `https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv` (windows-1252, lido como UTF-8), coluna NOME DA MATÉRIA | — |
| `ementa` | string | Ementa. | CSV Arquimedes `https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv` (windows-1252, lido como UTF-8), coluna EMENTA | — |
| `autoria` | string | Autoria. | CSV Arquimedes `https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv` (windows-1252, lido como UTF-8), coluna AUTORIA | — |
| `status` | string | Situação segundo o CSV (uniformemente "Descontinuado"). | CSV Arquimedes `https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv` (windows-1252, lido como UTF-8), coluna STATUS ATUAL | — |
| `referencePeriod` | date | Carimbo "Dados atualizados até" da versão do CSV. | CSV Arquimedes `https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv` (windows-1252, lido como UTF-8), linha 1 | — |
| `votosSim` ⚙️ | integer | SIM somados sobre as UFs. | soma da tabela `votos-uf` na versão mais recente | Null se alguma UF não traz o número. |
| `votosNao` ⚙️ | integer | NÃO somados sobre as UFs. | soma da tabela `votos-uf` na versão mais recente | — |
| `totalVotos` ⚙️ | integer | votosSim + votosNao. | soma | — |
| `url` ⚙️ | string | Endereço da página no portal, para conferir a linha na fonte. | montada pelo projeto: `https://www12.senado.leg.br/ecidadania/visualizacaomateria?id={codigo}` | Montada a partir do id, não lida da página; se o portal mudar o padrão de endereço, as antigas deixam de abrir. |
| `origem` ⚙️ | string | csv (arquivo de páginas) | corpus. | projeto | — |
| `coletadoEm` | datetime | Quando a versão do CSV foi baixada (UTC). | índice do arquivo de páginas, ou `scraped_at` do corpus | — |

## `consultas_votos/votos-uf` — Votos por UF do acervo

Formato longo: uma linha por matéria × UF × valor visto, com o intervalo de versões do CSV em que ele valeu.

**Uma linha por:** `codigo` × `uf` × `desde`

| Coluna | Tipo | Descrição | Fonte | Nota |
|---|---|---|---|---|
| `codigo` | integer | Código da matéria. | CSV Arquimedes `https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv` (windows-1252, lido como UTF-8), coluna CÓD. MATÉRIA | — |
| `uf` | string | UF do cidadão votante. | CSV Arquimedes `https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv` (windows-1252, lido como UTF-8), coluna UF DO CIDADÃO | — |
| `sim` | integer | Votos SIM dessa UF. | CSV Arquimedes `https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv` (windows-1252, lido como UTF-8), coluna VOTO SIM | — |
| `nao` | integer | Votos NÃO dessa UF. | CSV Arquimedes `https://www.senado.gov.br/bi-arqs/Arquimedes/ecidadania/DadosAbertos/Proposi%C3%A7%C3%B5es-com-votos.csv` (windows-1252, lido como UTF-8), coluna VOTO NÃO | — |
| `desde` | datetime | Primeira leitura em que o valor foi visto (UTC). | arquivo de páginas ou corpus | — |
| `ate` | datetime | Última leitura seguida em que o mesmo valor foi visto (UTC). | arquivo de páginas ou corpus | Entre `desde` e `ate` o valor foi visto em todas as leituras daquela série; fora delas, nada se afirma. No corpus, `desde = ate` (um ponto por mudança). |
| `leituras` | integer | Quantas leituras seguidas mostraram o valor. | arquivo de páginas (1 no corpus) | — |
| `sha` | string | sha256 da primeira página guardada que mostrou o valor (o arquivo bruto é privado; o hash prova a leitura). | arquivo de páginas (null no corpus) | — |
| `origem` ⚙️ | string | De onde vem a linha: csv (arquivo de páginas) | corpus. | projeto | — |
