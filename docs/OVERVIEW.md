# OVERVIEW - senado-br-mcp-cloudflare

> Documento de orientação (o "porque"). Estavel: o proposito e a tese quase nao mudam.
> Para o dado e sua proveniencia, ver `reconhecimento-ecidadania.md` e `dataset-dictionary.md`.

## Em uma frase

Produzir um **dataset cientifico citavel** da camada de participacao cidada do portal
e-Cidadania do Senado Federal (consultas publicas, ideias legislativas, eventos/audiencias,
votos por UF), publicado como objeto versionado com DOI e acompanhado de um paper.

## O objeto citavel (onde se chega)

O produto cientifico **nao e o servidor MCP**. E o **snapshot congelado e versionado**
(NDJSON/Parquet) consumido em R/Python, com DOI via Zenodo. O MCP e o mecanismo de coleta
e distribuicao; o dataset e o subproduto com valor cientifico. Ao final existem tres objetos:

1. **Dataset congelado + version-DOI** (Zenodo) - o que um pesquisador cita.
2. **Paper** - escrito pelo autor humano (nao delegavel), como *data descriptor*
   (p.ex. *Scientific Data*, *Data in Brief*) ou nota de pesquisa com analise-exemplo.
3. **Servico vivo** (MCP + cron diario) - mantem o dado atualizado e sustenta a afirmacao
   de "artefato mantido". Dai os **dois trilhos**: endpoint vivo (utilidade) + snapshots
   congelados (citabilidade).

## A tese (por que importa)

A lacuna-alvo tem ancora concreta: o pacote R **`congressbr`** (CRAN; publicado na *Latin
American Research Review*, 2019; DOI `10.25222/larr.447`) cobre a atividade legislativa do
Congresso, mas **nunca cobriu a camada de participacao do e-Cidadania**. Este projeto
preenche exatamente essa camada.

> ASSERCOES VERIFICADAS em 03/07/2026 (evidencia: `verificacao-tese-congressbr.md`):
> (i) CONFIRMADA, mais forte que o previsto: o `congressbr` foi ARQUIVADO no CRAN em
>     20/07/2020 (v0.2.2, violacao de politica CRAN), e seu escopo (`sen_*`/`cham_*`)
>     cobre apenas atividade legislativa - nenhuma funcao toca o e-Cidadania.
> (ii) SUSTENTADA APENAS COMO NEGATIVA CALIBRADA: busca sistematica (Zenodo, Harvard
>     Dataverse, CRAN, PyPI, web geral) nao localizou dataset versionado com DOI cobrindo
>     a participacao do e-Cidadania. Candidatos proximos (`senatebR`, `DadosAbertosBrasil`)
>     nao cobrem a lacuna; existe CSV oficial parcial de votos de consultas, sem
>     versionamento nem DOI. No paper, formular como "nao localizado", nunca "nao existe".

## O diferencial cientifico

O que separa este dado de "mais um scraping do Senado" e o **envelope de proveniencia por
campo**: cada valor carrega de onde veio (`sourceEndpoint`, `sourceField`), quando
(`retrievedAt`), sob qual licenca e versao de schema. E dado auditavel, nao apenas coletado.
A ETAPA 4 (validacao manual de proveniencia) existe para proteger esse diferencial - foi por
isso que se validou cada `sourceField` a mao, e nao por automacao.

## Limites de alcance (honestidade)

- **O impacto esta concentrado na Fase 1** (dataset + paper), nao na infraestrutura. O
  **Gate 3** (ROADMAP, ETAPA 10) questiona explicitamente se o *servidor* merece publicacao
  propria; a resposta provavel e nao (um "thin wrapper" seria rejeitado). Um paper de
  software so se justifica se proveniencia + participacao + integridade monitorada o
  elevarem acima de wrapper - e isso e condicional, nao garantido.
- O dataset tem **piso duro de serie em 14/06/2026** (criacao da base D1); nada anterior e
  capturavel. A serie first-seen e censurada a esquerda e so interpretavel a partir de
  22/06/2026. `consultas_votos` e **acervo de vintage unico**, nao serie temporal. Estes
  limites sao estruturais e declarados, nao defeitos a corrigir.

## Criterio que rege tudo

Impacto cientifico, nao numero de chamadas do servidor. Nada entra no projeto por ser
tecnicamente possivel; entra por servir ao objeto citavel ou a sua manutencao.
