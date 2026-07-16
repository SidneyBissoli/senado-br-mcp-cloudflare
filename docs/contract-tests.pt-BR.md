# Contract tests — detecção de *shape drift* do upstream

Tier de testes que detecta quando as APIs do Senado mudam a **forma** dos
campos dos quais os parsers dependem (renomeação, mudança de casing, wrapper
diferente). É o pior modo de falha para o público-alvo (jornalistas e
pesquisadores): um campo renomeado que não zera o total produz número
silenciosamente errado.

## Como funciona

- **Fixtures** (`tests/contract/fixtures/<família>/<nome>.json`): capturas
  reais das respostas upstream, commitadas no repositório. Normalizadas para
  diffs estáveis: chaves ordenadas recursivamente e arrays truncados aos 3
  primeiros itens. Famílias: `legado` (PascalCase — `/senador`, `/comissao`,
  `/plenario`, `/taquigrafia`…), `v3` (camelCase — `/processo`, `/votacao`),
  `adm` (snake_case — `adm.senado.gov.br`) e `financeiro` (feeds Arquimedes
  em `www.senado.gov.br`).
- **Testes** (`tests/contract/*.contract.test.ts`): para cada endpoint,
  afirmam (a) que a fixture bruta ainda carrega o caminho do wrapper e as
  chaves que o parser lê, e (b) que o **parser real exportado** de
  `src/tools/*.ts` produz saída sã a partir da fixture. Presença/forma, nunca
  valores exatos.
- A cobertura da família **e-Cidadania** (REST de listas + HTML de detalhe)
  vive em `tests/scraper/ecidadania-contract.test.ts`, que já rodava offline
  na suíte padrão — foi mantida lá.

## Comandos

```bash
npm run test:contract      # roda o tier contra as fixtures COMMITADAS (offline, determinístico)
npm run contract:refresh   # recaptura TODAS as fixtures do upstream vivo
npm run contract:refresh -- ceaps votacoes   # recaptura só as fixtures nomeadas
```

O tier é **separado** do `npm test` (config própria em
`vitest.contract.config.ts`; a suíte padrão exclui `tests/contract/**`) para
preservar a convenção da suíte unitária sem rede.

O manifesto de captura fica em `scripts/contract/manifest.ts` — um spec por
endpoint, com resolução encadeada de IDs (ex.: o detalhe de processo resolve
um `id` vivo a partir da fixture da lista). O script respeita o throttle
global (`upstreamFetch`/`admFetch`) e roda sequencial com pausa entre
capturas.

## CI noturno

`.github/workflows/contract-tests.yml` roda toda noite (03:20 Brasília):

1. `npm run test:contract` contra as fixtures **commitadas** — falha aqui é
   bug do repo (teste/fixture dessincronizados), não drift.
2. `npm run contract:refresh` contra o upstream **vivo** (working tree,
   nada é commitado).
3. `npm run test:contract` de novo — **falha aqui significa drift real**: o
   upstream mudou a forma de um campo que algum parser lê.

## O que fazer quando falhar

1. Identifique o teste/fixture que falhou e compare a fixture recapturada com
   a commitada (`git diff tests/contract/fixtures/`).
2. Se o upstream mudou de forma: ajuste o parser em `src/tools/*.ts` (e os
   testes unitários dele), recapture a fixture (`npm run contract:refresh --
   <nome>`) e commite parser + fixture juntos.
3. Se foi mudança benigna (amostra diferente, campo opcional ausente):
   recapture a fixture e ajuste a asserção para o invariante correto.

## Como adicionar cobertura para uma tool nova

1. Adicione um spec ao manifesto (`scripts/contract/manifest.ts`) com params
   mínimos que garantam amostra não-vazia.
2. `npm run contract:refresh -- <nome>` para capturar a fixture.
3. Escreva o bloco de asserções em `tests/contract/<módulo>.contract.test.ts`
   usando o parser exportado (convenção existente: parsers são exportados
   justamente para teste direto).
