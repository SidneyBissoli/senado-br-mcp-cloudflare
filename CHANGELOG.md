# Changelog

All notable changes to this project are documented here. Format based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project follows
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [3.18.0] - 2026-10-09

### Fixed

- **A "data de publicação" de uma ideia legislativa era a data limite dos apoios.** A
  página de detalhe do e-Cidadania publica UMA data só, "Data limite para receber 20.000
  apoios", e é ela que o campo `dataPublicacao` sempre guardou (o dicionário do dataset já
  dizia isso; as descrições de `senado_ecidadania_listar_ideias` e
  `senado_ecidadania_obter_ideia` não). Para ideia aberta a data cai no futuro (ideia
  223676 → `2026-11-04`) e o leitor conclui que o servidor errou. Decisão do dono
  (09/10/2026): manter o nome do campo — é o payload persistido do corpus e o esquema v2
  do dataset no Zenodo — e dizer a verdade ao lado dele. As duas tools passam a devolver
  `dataCriacaoEstimada` (data limite − 120 dias) e `avisoDatas` (o que cada data é, e que
  a criação é estimativa); as descrições, o esquema do dataset (`src/dataset/schema.ts`),
  o dicionário e as tabelas do README/LEIA-ME dizem o mesmo. O prazo é de **120 dias
  exatos, não "4 meses" de calendário**: medido contra a data de proposição de 4 ideias
  convertidas de 2017-2020 (base de Pereira, UFPE 2024) — 4 meses de calendário erraria em
  2 a 3 dias em todas. A derivação (`estimarCriacaoIdeia`) é pura, em UTC, e devolve
  `null` para data ausente ou inválida; o corpus e o write-through do detalhe não mudam
  (o campo derivado entra só na resposta, para não reescrever ~118 mil linhas como
  "alteradas"). Teste com as 4 ideias medidas, bissexto e datas inválidas.

## [3.17.0] - 2026-10-08

Proveniência: tempo 2 do contrato v1.2 e tempo 1 do v1.3 (`@sbissoli/mcp-provenance`
0.4.0, `@sbissoli/mcp-upstream` 0.4.2).

### Fixed

- **Duas tools cairiam ao ligar a v1.2.** A partir da v1.2 a lib exige que o
  `retrieved_at` do bloco seja o MAIS ANTIGO entre as sub-fontes (`field_sources`) e
  lança `ProvenanceContractError` quando não é — o erro derrubaria a tool. Montavam o
  topo à mão: `senado_servidores` com `subordinadasA` (topo = instante da folha, mais
  novo que o snapshot do organograma) e `senado_obter_materia` na seção `detalhe`
  (topo = leitura de `/processo/{id}`, feita DEPOIS da ementa e da relatoria). Conserto
  na causa: o adaptador (`src/utils/provenance.ts`, `oldestRetrievedAt`) deriva o topo
  como o mais antigo das sub-fontes em todo caminho que monta `field_sources`, e
  nenhuma tool escolhe mais esse instante. A parte que era o topo (a folha; o detalhe
  do processo) passa a ser sub-fonte própria, para que o seu instante não suma do
  bloco. O instante do organograma continua o da extração real no portal
  (`extraidoEm` do crawler), não `null` nem o da folha.

### Changed

- **Contrato v1.2 emitido** (`contractVersion: "1.2"`): as respostas que fundem
  sub-fontes (as duas acima) passam a levar `field_sources` no bloco concise. As
  demais seguem com as mesmas 7 chaves.
- **Esquema declara as chaves da v1.3** (`notices`, `derived`, `derivation_note`,
  `revision`), opcionais, vindas do `ConciseBlockSchema` do pacote — o servidor ainda
  não as emite.
- **`revision` informada por fonte** (vai ao fio quando o servidor emitir a v1.3):
  `current` em todas; nas fontes administrativas (folha, CEAPS, contratos, execução
  orçamentária) com a nota que as instructions já publicam — "podem ser corrigidos
  depois"; nas demais, `note: null`.
- Superfície declarada nova: trava, `server.json` e `lhm.plugin.json` regravados.

## [3.16.0] - 2026-10-08

O que cada número é, e até quando. Um leitor do artigo do bcb no dev.to (Daniel
Oliveira, sobre os dados XBRL da SEC) apontou que o período de cada número precisa vir
com ele, inclusive quando ele é acumulado no ano, e que o servidor tem de dizer se o
número pode ser revisto. Medido aqui, contra os feeds do Arquimedes:

### Fixed

- **`senado_execucao_orcamentaria`: o `data_vintage` não dizia até quando.** As despesas
  são uma linha por ação no exercício, com dotação, empenhado, liquidado e pago
  ACUMULADOS até a data de posição do arquivo (em 08/10/2026 o exercício 2026 trazia
  empenhado abaixo da dotação); o corpo não traz a data, e o vintage dizia só "2026".
  Agora ele traz a posição lida do `Last-Modified` do feed, em horário de Brasília:
  `2026 (posição de 2026-10-07)`. O `upstreamFetch` ganhou o gancho opcional
  `onHeaders`; o valor em cache passa a guardar corpo + `Last-Modified` (chave nova
  `v: 2`, para não ler entrada antiga sem a data).

### Changed

- A descrição de `senado_execucao_orcamentaria` diz o que cada número é: despesas
  acumuladas no exercício até a posição (o exercício corrente é parcial e cresce);
  `arrecadada` é o valor do mês e `prevista` vem lançada inteira no mês 1. A hipótese de
  previsão anual repetida por mês (somada 12 vezes) foi medida e NEGADA.
- `senado_remuneracoes_servidores`: o `campo` padrão diz que a remuneração bruta é
  calculada por este servidor, como soma das 7 verbas.
- `instructions`: dados administrativos (CEAPS, remunerações, execução) são os que o
  Senado publica no instante da extração e podem ser corrigidos depois.
- Superfície declarada nova: trava, `server.json` e `lhm.plugin.json` regravados.

## [3.15.3] - 2026-10-07

A impressão digital da superfície passa a ir **na entrada do MCP Registry**, para o
cliente conferir. **Nenhuma tool, resource, prompt ou resposta muda** — os dois
perfis conferem com a trava de 3.15.0 (`full` `49fa35df0589`, `openai-app`
`586481daa5c8`), medido ao vivo em 07/10/2026. Esta release também leva as
limpezas de dependência que estavam em Unreleased (abaixo).

### Added

- `server.json` publica, sob `_meta["io.modelcontextprotocol.registry/publisher-provided"]`,
  o sha256 da superfície declarada do perfil `full` (o servido em `/mcp`, o endpoint
  dos `remotes`) e quem responde sem credencial ali (forma `mcp-surface/1`, SPEC.md
  do `@sbissoli/mcp-surface` 0.5.0). Um host pode recalcular na primeira conexão e
  recusar, ou pedir nova aprovação, se divergir. Ideia de dois leitores do artigo do
  replay (Mike Dabydeen e Valentina Koniukhova, dev.to).
- `npm run surface:lock` grava o bloco (`mcp-surface registro --perfil full`); o teste
  da trava reprova `server.json` que publique outra coisa que a trava.
- `publish.yml`: depois do `mcp-publisher publish`, `mcp-surface conferir-registro` lê
  a entrada desta versão no registro e a compara com o endpoint no ar, como um
  cliente faria, sem ler a trava.
- README / LEIA-ME: como conferir por conta própria (`verify.mjs`, sem dependência).

### Removed

- **devDependency `@modelcontextprotocol/sdk` (v1).** Declarada desde o commit
  inicial só para satisfazer o peer do `agents`, nunca importada; com o
  `legacy-peer-deps` da 3.15.2 ela deixa de ser necessária. Saem 78 pacotes
  da árvore (express, hono, ajv e o resto do fecho dela; nenhum outro muda de
  versão) e, com eles, a segunda implementação do protocolo que convivia com
  o `/server` v2. Só desenvolvimento: o pacote publicado e o Worker não a
  carregavam — o `wrangler deploy --dry-run` empacota sem resolvê-la, e o
  dump de superfície segue idêntico.
- **Seis `overrides` órfãos:** `fast-uri`, `hono`, `@hono/node-server`,
  `express-rate-limit`, `ip-address` e `qs`. Cada um corrigia um alerta de uma
  dependência do sdk v1 (o `qs`, por exemplo, via sdk → express) e, com ele
  fora, nenhum casa mais pacote algum da árvore. O lock não muda e o
  `npm audit` segue com 0 vulnerabilidades.
- **`overrides` de `lodash` e `js-yaml`**, de 25/06/2026 (#41), para
  transitivas profundas do sdk e do `agents` que já tinham saído da árvore
  antes mesmo do sdk v1: nenhum pacote os instala nem depende deles.

## [3.15.2] - 2026-10-06

Só dependências: SDK do MCP 2.0.0 → 2.3.0 e `agents` 0.24.0 → 0.26.0.
**Nenhuma resposta e nenhum esquema mudam** — o dump de superfície
(`scripts/dump-surface.mjs --stdio`) saiu idêntico byte a byte entre o master
anterior e o PR (956 683 bytes).

### Security

- **GHSA-6qxp-vccf-f47h (high)** em `@modelcontextprotocol/client` 2.0.0
  e em `@modelcontextprotocol/sdk` 1.30.0 ("OAuth client could send
  credentials to an authorization server chosen by the MCP server"): sobem a
  2.3.0 e 1.32.0. Os dois são devDependencies, importados só pelos testes e
  pelo juiz do eval (nenhum `src/` de runtime), sem OAuth — o pacote
  publicado e o Worker nunca os carregaram.
- `sharp` 0.35.4 → 0.35.5 (GHSA-wq5f-xc86-pv6w, librsvg), transitivo do
  `wrangler`/`miniflare`, só de desenvolvimento.

### Changed

- **`@modelcontextprotocol/server` 2.0.0 → 2.3.0 e `agents` 0.24.0 →
  0.26.0**; `wrangler` 4.140.0 → 4.147.0.
- **`.npmrc` com `legacy-peer-deps=true`** (#114). O `agents` declara o SDK
  2.0.0 e o `sdk` 1.30.0 como peers EXATOS; sem a flag, o PR de grupo do
  Dependabot se dizia "server 2.0.0 → 2.3.0" mas o lock só subia o `agents`
  e deixava o SDK travado em 2.0.0 — mesclar não curaria o alerta acima. Com
  a flag o SDK vem do que o `package.json` declara e o `agents` resolve a
  MESMA cópia 2.3.0, conferido em runtime antes do merge (mesma decisão do
  ilo e do uis).


Primeira publicação no npm desde a 3.14.0. A **3.15.0 foi numerada e nunca
publicada** (subiu só para o Worker): quem atualiza da 3.14.0 recebe as duas
seções, esta e a de baixo — o crawl incremental de ideias, o status
`removida` e este conserto.

### Fixed

- **O erro de ideia removida (410) ainda mandava "verificar os parâmetros".**
  Medido no ar logo após o deploy da 3.15.0: a mensagem nova saía certa, mas
  o campo `hint` ao lado continuava o genérico ("verifique os parâmetros …
  a fonte oficial pode estar indisponível"), e a junção com o sufixo da
  `ecidadaniaError` produzia ponto duplo. Causa: `errorFrom` herdava o
  `retryable` da exceção, mas nunca o `hint`. Agora herda os dois, e o 410
  traz o seu: não repetir nem corrigir o id; o último estado está em
  `listar_ideias` com `status: "removida"`. O teste passa o erro real pelo
  mesmo caminho da tool e confere o envelope inteiro (falha no código
  anterior). Sem mudança de superfície.

## [3.15.0] - 2026-10-06

Muda a superfície: `senado_ecidadania_listar_ideias` ganha o valor
`removida` no filtro `status`, e a descrição dela muda (cadência diária,
~118 mil ideias, o significado de `removida`). Mudança aditiva: nenhum valor
antigo deixa de valer.

### Added

- **Status `removida` para ideias retiradas do portal.** O primeiro run do
  crawl incremental (abaixo) leu o detalhe de 110 ideias que tinham saído das
  listas vivas, e 32 responderam **HTTP 410**, de forma estável, com "Ideia
  Legislativa não encontrada!". O crawl antigo nunca percebia isso: uma ideia
  que sumia de todas as listas ficava `aberta` no D1 para sempre, e a
  `listar_ideias` a servia como aberta. Agora o 410 é tratado como
  **resposta** do portal (não como falha a repetir):
  - as transições do crawl diário gravam `removida` na hora;
  - o backfill de detalhe (que passa por todas as ~118 mil ideias, 3×/dia)
    também grava `removida` ao encontrar 410, cobrindo as encerradas
    removidas, que as transições nunca veem;
  - registro e histórico ficam no banco com o último estado conhecido
    (decisão do dono: ideias retiradas são dado de pesquisa que só este
    banco preserva). O 410 é reconhecido pelo tipo e código do erro
    (`ehRecursoRemovido`), não pelo texto.
- O dicionário do dataset (`status`) passa a documentar o valor.

### Fixed

- **`senado_ecidadania_obter_ideia` numa ideia removida** dizia "erro não
  recuperável; verifique os parâmetros" e que "a fonte pode estar
  indisponível". As duas coisas eram falsas. O 410 agora produz uma
  mensagem própria: o recurso existiu e foi removido do portal (classe
  `nao_encontrado`, sem repetição).

- **Ingestão das ideias do e-Cidadania parada desde 02/10/2026.** O crawl
  relia as ~1185 páginas da listagem todo dia, 1126 delas da situação 7
  (encerradas sem apoio suficiente). O portal ficou ~6× mais lento para
  montar página fria: em 06/10, 60 páginas da s7 deram média de 23,7 s
  (julho: ~3,9 s), 23% acima de 30 s (média dessas 81,8 s, máx. 111,8 s), e
  toda página lenta respondia em <0,75 s na repetição (cache do servidor).
  Não é bloqueio de IP (o IP residencial vê o mesmo) nem crescimento do
  corpus (+4% de páginas desde julho). A s7 sozinha passou a custar ~7,5 h
  num job de 200 min: 03/10 e 05/10 cancelados no teto, 04/10 com o portal
  fora (disjuntor, correto). O crawl passa a ser **incremental**:
  - as situações vivas (5, 6, 8, 9, 10; ~60 páginas) seguem lidas inteiras
    todo dia, então a trajetória diária de apoios em `_history` continua
    completa;
  - ideia `aberta` no D1 que sumiu das listas vivas tem a página de detalhe
    lida (total final de apoios + situação); falha de leitura se repete no
    run seguinte, sem estado extra;
  - a s7 é varrida por cursor de página (`ideias-s7` em
    `ecidadania_detalhe_cursor`), 100 páginas por run, só upsert;
  - o piso catastrófico passa a comparar as abertas lidas com as abertas do
    próprio D1; e se o portal cair depois do crawl vivo completo, o vivo é
    gravado mesmo assim (antes um run era tudo ou nada sobre o acervo).
- **`senado_ecidadania_obter_ideia` dizia "aberta" para ideia "Não
  acatada"** (situação 9, que a listagem trata como encerrada). A tool e o
  crawl passam a usar um só mapeamento, `statusFromSituacaoIdeia`, testado
  contra os seis textos reais do portal (antes os testes usavam textos
  inventados). `parseIdeiaDetalheCorpus` passa a devolver também `apoios` e
  `status`.

## [3.14.0] - 2026-10-05

Muda a superfície (o `outputSchema` das 69 tools, nos dois perfis), mas
NENHUMA resposta muda. É o tempo 1 da subida para o contrato v1.2 da
proveniência: o schema passa a aceitar a versão nova; ligá-la é o tempo 2.

### Changed

- **Proveniência 0.3.0 (contrato v1.2) no tempo 1.**
  `@sbissoli/mcp-provenance` sobe de `^0.2.0` para `^0.3.0` e
  `@sbissoli/mcp-upstream` de `^0.3.0` para `^0.4.0` (que aceita a
  proveniência 0.2 ou 0.3; cópia única no `npm ls`). O pacote 0.3.0 continua
  EMITINDO a v1.1 por padrão, byte a byte o que a 0.2.0 emitia, e o servidor
  não liga `contractVersion: "1.2"`: o bloco concise segue com as mesmas 7
  chaves e o `field_sources` que `senado_obter_materia` já calcula continua
  só no bloco canônico validado, como antes.
- O que muda é o schema publicado: o `ConciseBlockSchema` importado do pacote
  passa a declarar a chave OPCIONAL `field_sources` (itens com `fields`,
  `source_url`, `dataset_id`, `data_vintage`, `retrieved_at` e
  `served_from_cache` opcional). Ela não entra em `required`, então toda
  resposta atual continua válida. Na `surface.lock.json`, a única diferença
  além da versão e do sha256 são essas 192 inserções (69 tools no perfil
  `full` e 27 no `openai-app`, nas variantes objeto e lista do bloco); no
  `lhm.plugin.json`, regenerado pelo script, as mesmas 138 do perfil `full`.
- O bloco canônico em memória (não emitido: o servidor só emite `concise`)
  passa a carregar `served_from_cache: null` em cada item de `field_sources`;
  o teste que prende esse bloco foi ajustado. Conferido byte a byte contra a
  0.2.0: `result()` e rodapé idênticos, com e sem `field_sources`.
- Ligar a v1.2 (emitir `field_sources` no concise e acertar o `retrieved_at`
  de topo de `senado_obter_materia`) fica para o tempo 2.

### Added

- **Server card em `/.well-known/mcp/server-card.json`** (antes 404), público
  como o `/status`. Gerado por `@sbissoli/mcp-surface/card` (devDependency
  subiu para `^0.3.0`) a partir do `initialize` e das listagens reais do mesmo
  `createServer` que a trava captura (perfil `full`), no formato da Smithery
  (`serverInfo` com a versão); `authentication.required` sai da seção
  `semToken` do `surface.lock.json`, a única parte da trava que entra no bundle.
  `tests/server-card.test.ts` prova que o card normalizado tem o mesmo sha256 do
  perfil `full` na seção `declarada`. Rota fora do MCP: a superfície e a trava
  não mudam.

## [3.13.0] - 2026-10-04

Muda a superfície: o `outputSchema` das 69 tools (os dois perfis). Os dados
continuam sem contrato de forma; o que passa a ser contrato é o envelope que
toda resposta de sucesso já carregava.

### Changed

- **O schema de saída é o ENVELOPE COMUM, não mais um objeto vazio.** Até a
  3.12.1 as 69 tools anunciavam `z.object({}).passthrough()`, sem campo
  obrigatório nenhum, e o teste de contrato de saída não tinha o que quebrar
  além de "structuredContent ausente". Agora o schema continua ABERTO no nível
  de cima (a forma dos dados de cada tool segue sem contrato, como decidido
  antes), mas exige `provenance` (o bloco concise do `@sbissoli/mcp-provenance`,
  objeto com uma fonte e lista quando a chamada passa várias, como o índice do
  Deep Research) e `attribution` (lista de URLs). O bloco é o schema IMPORTADO
  do pacote (`ConciseBlockSchema`), nunca transcrito: a cópia à mão de um bloco
  selado derrubou quatro irmãos quando o contrato ganhou `retrieval`. Decisão
  do dono em 04/10/2026, entre envelope, envelope + schemas por tool nas mais
  usadas, só as tools de dinheiro, e não mexer.
- Consequência em runtime: o SDK v2 valida a saída do servidor, então
  resultado de sucesso sem proveniência vira `isError`. Auditado antes:
  todo sucesso das 69 passa por `resultWithProvenance` (92 chamadas) ou por
  `provenanceExtras` (`search`/`fetch`); nenhum módulo de tool chama
  `toolResult()`, e um teste agora prende isso.

### Tests

- `tests/output-contract.test.ts` prende o envelope: UM schema nas 69 tools e
  nos dois perfis, exatamente `provenance` + `attribution` obrigatórios, nível
  de cima aberto, e o bloco de `provenance` igual ao do pacote convertido pelo
  mesmo zod (deriva da fonte; subir o contrato muda os dois lados juntos).
- Os controles negativos passam de 1 quebra para 7: `provenance` e
  `attribution` ausentes, `attribution` de tipo errado, um bloco de
  proveniência sem `citation` e um campo a mais dentro do bloco selado, além de
  `structuredContent` ausente e da armadilha do `tools/list`.
- Prova de que o portão pode falhar: trocar o `resultWithProvenance` de
  `senado_tabelas_referencia` por um resultado sem proveniência faz o próprio
  servidor responder `isError` ("provenance: Invalid input, attribution:
  expected array, received undefined") e dois testes ficarem vermelhos.
- Baseline de superfície `baselines/surface-stdio-3.13.0.json` (substitui o da
  3.11.0); `surface.lock.json` e `lhm.plugin.json` regravados pelos scripts.

### Tests — contrato com forma de cliente (mesclado depois da 3.12.1)

- **O contrato de saída tem forma de cliente** (ideia de leitor,
  https://dev.to/arhancanli/comment/3g4i4). `tests/output-contract.test.ts`
  conecta o servidor de verdade (`createServer`) ao `Client` do SDK pelo
  `@sbissoli/mcp-surface/cliente` 0.2.0, comum aos sete servidores: `tools/list`
  antes do `tools/call`, cada mensagem do servidor passando por JSON como na
  rede, e o resultado reprovado contra o schema LISTADO, como a sessão do
  usuário reprovaria. As chamadas que têm de dar certo passam por
  `chamarComoCliente`; entra um caso no perfil `openai-app`, cujo
  `structuredContent` é reescrito pelo minimizador depois do handler.
- Controles negativos em `senado_tabelas_referencia` (na época só
  `structuredContent` ausente e a armadilha do `tools/list`; o envelope acima
  os ampliou). Prova de que o portão pode falhar: anunciar no schema listado
  `tabela` como número (só no JSON Schema, sem o zod do servidor ver) faz o
  próprio `Client` recusar o resultado.

## [3.12.1] - 2026-10-02

Só documentação e empacotamento; superfície inalterada (`surface.lock.json`
intacto).

### Fixed

- **A página do npm mostrava o README em PORTUGUÊS** (`readmeFilename:
  README.pt-BR.md` no registro). O npm empacota SEMPRE todo `README*` da raiz,
  ignorando o campo `files` (a negação `!README.pt-BR.md` foi testada e não
  funciona), e entre dois escolheu o par traduzido. O par em português passa a
  se chamar `LEIA-ME.md`, na mesma raiz (os links relativos dele seguem
  valendo); o link do `README.md` e as constantes de
  `tests/contagem-nos-textos.test.ts` acompanham.

### Added

- `tests/pacote-npm-readme.test.ts`: prende o tarball real (`npm pack
  --dry-run`) a um README só, o `README.md`. Provado vermelho com uma cópia
  `README.pt-BR.md` de volta na raiz.

## [3.12.0] - 2026-10-02

Bump MINOR porque `search` e `fetch` passam a RECUSAR parâmetro que não
existe — a única mudança de superfície desde a 3.11.0 (última publicada no
npm; nenhuma versão foi numerada sem ser publicada). O resto é telemetria do
canal hospedado e uma trava de CI que torna toda mudança de superfície
afirmada por teste (`surface.lock.json`).

### Changed

- **`search` e `fetch` estritas: chave desconhecida vira erro que a NOMEIA**
  (`@sbissoli/mcp-search` 0.9.0, `searchInputSchema`/`fetchInputSchema` como
  `z.strictObject`). Eram as duas exceções da classe fechada em 11/09/2026
  para as outras 67 tools: abertas por serem contrato da OpenAI, descartavam
  em silêncio o que não conheciam — `search({ query: "reforma", ano: 2023 })`
  buscava sem o ano e respondia como se o filtro tivesse valido. Agora
  publicam `additionalProperties: false` e respondem `Unrecognized key:
  "ano"` antes do handler. Aqui a estrição se perdia DUAS vezes: o registrador
  passa só a `.shape` do contrato e o funil `esquemaDeEntrada` isentava os
  dois nomes (`TOOLS_DE_CONTRATO_ALHEIO`); a isenção saiu, e o funil aplica
  `.strict()` a todas as 69. `surface.lock.json`: só `search`/`fetch` do
  perfil `full` ganham `additionalProperties: false` (o mesmo em
  `lhm.plugin.json`, regenerado). Gate invertido em
  `tests/output-contract.test.ts` (reprova com a isenção de volta).

### Added

- **Impressão digital da superfície: mudou sem subir a versão = build vermelho
  e deploy recusado** (`@sbissoli/mcp-surface`). `surface.lock.json` trava o
  sha256 de `initialize` (instructions, capabilities, identidade sem a versão)
  + tools/resources/templates/prompts dos DOIS perfis (`full` e `openai-app`)
  e, numa segunda seção, QUAIS MÉTODOS RESPONDEM SEM TOKEN nas quatro rotas
  MCP, com e sem `API_KEY` — este é o único servidor do portfólio em que a
  chave é uma possibilidade real de configuração. O `deploy-worker.yml` passou
  a rodar a suíte ANTES do wrangler (até aqui só checava tipos) e termina
  conferindo os dois perfis no ar contra a trava (`mcp-surface verificar
  --perfil`). Replay das versões publicadas em
  `baselines/replay-2026-10-02.md`: o ar (3.11.0) serve a superfície da 3.11.0
  publicada; nenhuma remoção fora de major; e as **1.1.0 e 1.1.2 do npm não
  sobem** (`Dynamic require of "events" is not supported`, bundle do esbuild).
  Proposta de um leitor (dev.to, 3g5m4 e 3g607); molde no bcb-br-mcp.

### Fixed

- **Falha da origem gravada como erro de classe `outro`.** Medido em
  30/09/2026 rodando o classificador sobre as mensagens de falha: "Erro de
  rede: ..." (base legislativa), o 429 do nosso próprio balde ("Taxa de
  requisições excedida") e, no e-Cidadania, "falha de rede ao acessar" e
  "retornou HTTP 429/400/403" caíam em `outro`. O tipo existia no `catch`; só
  o texto chegava ao `instrumentTool`. Agora `UpstreamError` e o erro do
  e-Cidadania nascem com a classe (404 → `nao_encontrado`, o resto →
  `fonte`; rota inexistente segue `defeito` e corpo vazio segue
  `nao_encontrado`, explícitos), `errorFrom`/`ecidadaniaError` a anexam numa
  chave-símbolo fora do fio e `instrumentTool` a lê antes da frase. Mesmo
  conserto do bcb-br-mcp (#45), ilo-mcp-server (#24), uis-mcp-server (#22),
  ibge-br-mcp (#62) e medical-terminologies-mcp (#58). Gate em
  `tests/classe-do-erro.test.ts`.

## [3.11.0] - 2026-09-27

Bump MINOR porque o bloco de proveniência de TODA resposta ganha uma chave:
`retrieval` — o diagnóstico da ida à origem, contrato v1.1 do portfólio
(`@sbissoli/mcp-provenance` 0.2.0). É a sexta adoção do fetch comum
`@sbissoli/mcp-upstream` (depois de bcb, ibge, ilo, uis e medical), e a
resposta ao item "Diagnóstico de origem na proveniência" do roadmap técnico:
um sucesso obtido depois de duas respostas anômalas da fonte deixa de ser
indistinguível de um sucesso de primeira. A superfície de `tools/list` NÃO
muda (`baselines/surface-stdio-3.11.0.json` é byte-idêntico ao dump da
3.10.0): as 69 tools anunciam um `outputSchema` permissivo.

### Added

- **`provenance.retrieval` em toda resposta** — `{ requests, attempts,
  anomalies, unstable }`: quantas idas à fonte a chamada fez, quantas
  tentativas somaram (repetições incluídas), que classes de anomalia foram
  vistas (`timeout`, `network`, `http_4xx`, `http_5xx`, `rate_limited`,
  `malformed_body`) e se a resposta é instável. **Medido, nunca inventado**:
  o coletor abre em `instrumentTool` — o único lugar em que uma chamada de
  tool começa, stdio e Worker — e toda ida pelo `upstreamFetch` cai nele.
  Resposta servida inteira do cache (nenhuma ida) sai `retrieval: null`, como
  o contrato manda; fora de uma chamada de tool (cron do e-Cidadania) a ida
  ganha um coletor descartável e a política vale igual. Um servidor com UMA
  origem não precisa do coletor por origem do medical: os dois blocos do
  `search` (senadores + colegiados, mesma API) carregam a medição da chamada.
- **Os três `fetch` crus entram no funil.** `senado_requerimentos_cpi`
  (`/comissao/cpi/{sigla}/requerimentos`), `senado_discurso_texto`
  (`/discurso/texto-integral/{codigo}`, o único endpoint que só fala
  `text/plain` — `upstreamFetch` ganhou `accept` e `text`) e o scraper do
  e-Cidadania (`fetchPage`/`fetchEcidadaniaJson`, 10 sítios) faziam a ida por
  conta própria, sem retry e fora de qualquer contagem — o `retrieval` mentiria
  por omissão. Agora passam pelo mesmo fetch comum, com a mesma política. O
  e-Cidadania continua fora do token bucket (é outro host, e nunca passou por
  ele); as mensagens de erro e o `retryable` que `ecidadaniaError` lê são os
  mesmos.

### Changed

- **A ida à origem é feita pelo `@sbissoli/mcp-upstream` 0.3.0**, no modo
  `response`: timeout, retry, `Retry-After`, orçamento e contagem são do
  pacote; o corpo continua sendo lido no senado — guardas de 5/20 MB, os DOIS
  404 da fonte (`rotaInexistente` × chave ausente, `on404`), corpo vazio e
  JSON inválido são semântica medida deste servidor e ficam nele. O pacote
  classifica; o servidor decide. Token bucket e limite de 6 em voo continuam
  ANTES da ida, fora do pacote — o balde passa a ser consumido uma vez por
  ida, não por tentativa (as repetições já são limitadas em número e em
  orçamento). A classe `UpstreamError` local, as mensagens ("Timeout na
  requisição upstream (10s)", "Erro de rede: …", "Upstream retornou HTTP N",
  "Resposta upstream vazia", "não é JSON válido") e a flag `transport` que o
  disjuntor do contrato noturno lê não mudam.
- **Política MEDIDA em 27/09/2026** (`curl` com o User-Agent do portfólio): a
  API legislativa responde em 0,3–1 s (uma cauda fria de 7,4 s na busca de
  matérias por palavra-chave, depois 0,4–1 s); a administrativa entrega 2,7 MB
  de contratos em 1,5 s e 9 MB de CEAPS em 1,9 s; o texto integral de um
  discurso sai em 0,35 s; o detalhe do e-Cidadania em 1,3 s. Nenhuma origem
  chegou perto dos 10 s. Números preservados: teto de uma tentativa =
  orçamento total da ida = **10 s** (cada tentativa recebe o que sobra),
  2 retries, backoff 1 s → 2 s → 4 s + jitter de até 500 ms.
- **500 e 502 genéricos passam a repetir.** Até a 3.10.0 o servidor marcava
  todo 5xx como `retryable: true` para o agente mas só repetia 429 e 503 — o
  agente pagava a repetição. Agora 429, 503, demais 5xx e falha de rede
  repetem (paridade com os cinco irmãos). **Timeout continua NÃO repetindo**
  (a tentativa pendurada gastou o orçamento inteiro), 4xx não repete, e
  **corpo vazio e JSON inválido continuam sem repetir**: há endpoint em que o
  corpo vazio é determinístico (`/comissao/reuniao/{codigo}` inexistente —
  `ehReuniaoInexistente`), e repetir só atrasaria a resposta certa.
- **A proveniência do `search` é montada por chamada**, não guardada com o
  índice de 24 h: um bloco guardado repetiria por um dia a contagem de idas
  da chamada que construiu o índice. Quem só acha o índice pronto recebe
  `retrieval: null` nos dois blocos.
- Dependências: `@sbissoli/mcp-provenance` `^0.1.0` → `^0.2.0` (contrato
  1.0 → 1.1), `@sbissoli/mcp-upstream` `^0.3.0` (nova).

### Tests

- `tests/throttle/upstream.test.ts`: os testes de `parseRetryAfterMs` e
  `computeRetryWaitMs` saem (a lógica vive no pacote, provada lá por 42 testes
  offline) e entram os da política DESTE servidor — 503 repete, 500 passa a
  repetir, rede repete, timeout não, 4xx não, corpo vazio não — e os do
  coletor (`retrieval` medido dentro de `withUpstreamCall`, `null` fora,
  chamada aninhada reusa, 404 conta como ida e não como anomalia).
  `upstreamIo.sleep`/`random` são o ponto de injeção para calar esperas e
  jitter. Os dois `vi.mock` do módulo (`deep-research`, `comissoes`) viraram
  parciais. 1049 testes.

## [3.10.0] - 2026-09-25

Numerada em 24/09 e publicada em 25/09; a tag leva o master inteiro, então a
seção "Também nesta tag", no fim, cobre o que entrou depois do bump.

Bump MINOR porque a superfície publicada muda: cinco descrições, dois esquemas
de entrada e dois formatos de saída (item `mcp:zero-em-sub-recurso` do
portfólio). O item nasceu como "duas ferramentas devolvem `count: 0` para id
inexistente"; a medição de 24/09/2026 mostrou que uma delas estava **quebrada
para a entrada que ela própria documentava** e que a outra tinha a causa na
borda da rede, herdada por 16 pontos de chamada.

### Fixed

- **`senado_obter_votacao` respondia `count: 0` para votação que EXISTE.** A
  API do Senado publica DOIS códigos no mesmo item de `/votacao` —
  `codigoSessao` (581816, a sessão plenária) e `codigoSessaoVotacao` (7101, a
  votação dentro dela) — e o handler enfiava o parâmetro `codigoVotacao` no
  filtro `codigoSessao`. Como só o primeiro é filtrável, quem casava nome com
  nome e passava 7101 recebia `{count: 0, votacoes: []}`, com bloco de
  proveniência completo, para o PLP 124/2022 (12/08/2026, 69 Sim x 0 Não).
  Pior que zero calado: **indistinguível do zero de um id inventado**.

  O funil medido em produção era total. Três portas entregam um campo chamado
  `codigoVotacao`, e as três alimentavam essa tool com um valor que ela
  recusava em silêncio:

  | porta | campo que ela chamava de `codigoVotacao` | valor (PLP 124/2022) |
  |---|---|---|
  | `senado_search_votacoes` | `codigoSessaoVotacao` (expõe também `codigoSessao`) | 7101 |
  | `senado_votacoes_senador` | `codigoSessaoVotacao` | 7101 — **48 de 48** |
  | `senado_orientacao_bancada` | `codigoVotacaoSve` (TERCEIRO espaço) | 13059 |

  `senado_votacoes_senador` ainda dizia na descrição "para detalhes use
  `senado_obter_votacao`": 100% do que ela entregava era recusado.

  Consertos: `codigoVotacao` **aceita os dois espaços** (resolve o código de 4
  dígitos varrendo a janela temporal, com `ano` opcional para votação antiga) e
  código de nenhum dos dois retorna **erro classificável**, nunca lista vazia;
  `senado_votacoes_senador` passa a emitir o **par** `codigoSessao` +
  `codigoVotacao`, o que faz a resolução acertar de primeira; e
  `senado_orientacao_bancada` renomeia sua saída para `codigoVotacaoSve`, o
  nome da fonte — é um identificador do sistema de votação eletrônica que não
  aparece uma vez em `/votacao`, e chamá-lo de `codigoVotacao` convidava ao
  erro.

- **`treat404AsEmpty` transformava TODO 404 da API administrativa em `[]`, em
  16 pontos de chamada.** A flag existia desde sempre, com o comentário "some
  collections 404 instead of returning an empty array". A medição derrubou a
  premissa: a fonte responde **`200 []`** quando a chave é válida e ainda não
  há dado (`/servidores/horas-extras/2026/10`, mês futuro), então o 404 só
  sobra para chave **fora da cobertura publicada** — e aí o `[]` virava uma
  afirmação falsa. `/supridos/2005` e `/senadores/despesas_ceaps/2007`
  respondem 404, e o servidor dizia `count: 0`: leia-se "o Senado não gastou
  nada".

  A medição também achou um discriminador que existia e era jogado fora, igual
  nas duas APIs: o 404 de **rota inexistente** traz `detail: "No static
  resource …"` no corpo, enquanto o de **chave ausente** vem com corpo vazio ou
  problem+json sem `detail`. A borda (`src/throttle/upstream.ts`) passa a
  separar os três casos: rota inexistente é **defeito nosso** e falha alto
  (classe `defeito`); chave ausente é ausência tipada (`nao_encontrado`); e
  `[]` só sai onde alguém pedir explicitamente.

- **`senado_contratacao_detalhe` não distinguia contratação inexistente de
  seção vazia** — e não tinha como, porque a fonte usa o MESMO 404 de corpo
  vazio para os dois (`/contratos/99999999/itens` e `/contratos/541/itens`, pai
  real com seção vazia; 17 de 20 pares contrato × seção dão 404, então o caso
  ambíguo é a norma, não a exceção). Não existe rota de item único: conferido
  no Swagger, `/contratos/632` dá 404 e `?id=632` é ignorado. A tool agora
  confere o `id` na **lista-pai que `senado_contratos` /
  `senado_contratacoes_lista` já baixam e cacheiam** — acerto de cache, custo
  zero na prática — e só paga essa conferência quando a seção veio vazia. Pai
  ausente vira erro; pai presente faz do `count: 0` uma verdade.

- **`senado_suprimento_fundos` anunciava `ano >= 2010` para uma fonte que
  publica de 2013 em diante** (medido: 2009 a 2012 respondem 404). Com a flag
  antiga, pedir 2011 devolvia `count: 0`. O limite do esquema passa a 2013,
  fechando a porta antes da rede.

### Unchanged, e de propósito

- As duas ferramentas de `taquigrafia` continuam devolvendo resultado vazio no
  404, porque **o zero delas fala**: vem com um `aviso` que nomeia os buracos
  estruturais da cobertura (sessões conjuntas do CN, canceladas, algumas
  solenes) e manda conferir o `tipo`. Elas herdam de graça a proteção nova
  contra rota montada errada.

### Superfície

Descrições: `senado_obter_votacao`, `senado_votacoes_senador`,
`senado_orientacao_bancada`, `senado_contratacao_detalhe`,
`senado_suprimento_fundos`. Entrada: `senado_obter_votacao` ganha `ano`
(opcional) e reescreve `codigoVotacao`; `senado_suprimento_fundos` sobe o
mínimo de `ano` para 2013. Saída: `senado_votacoes_senador` ganha
`codigoSessao`; `senado_orientacao_bancada` renomeia `codigoVotacao` para
`codigoVotacaoSve`.

### Tests

18 guardas novas (1021 → 1039). A borda não tinha **nenhum** teste cobrindo o
`treat404AsEmpty` — foi por isso que o defeito sobreviveu. As novas fixam os
três casos de 404 com corpos copiados literalmente da fonte, e a de votações
fixa o **par** (7101 e 581816 levam à mesma votação), não o valor. Uma delas
pegou um defeito real durante a escrita.

### Também nesta tag (depois do bump)
- **A recusa de esquema não era contada — nem como chamada nem como erro
  (só o Worker; o canal stdio não muda).** A reconciliação entre a
  `instrumentTool` e a camada HTTP era por status e supunha que 200 implica
  linha gravada; a recusa do zod é respondida pelo SDK antes do callback,
  então o `finally` que grava nunca rodava. Medido em produção em 24/09/2026
  pela rota do dono. Agora a reconciliação é por NOME contra o recibo da
  própria `instrumentTool`, e o desfecho sai do envelope da resposta casado
  por `id` JSON-RPC — erro JSON-RPC dentro de um 200 deixa de sair `ok`.
  Sexto e último dos seis servidores (conserto nascido no ilo-mcp-server).
- **A ficha do LobeHub passa a ser presa por teste.**
  `tests/lhm-manifest.test.ts` compara `lhm.plugin.json` com o servidor real
  (`npm run manifest:lhm` o regenera). Medido em 25/09/2026: a ficha publicada
  estava na 3.7.0 com o npm em 3.9.0 — o LobeHub só ingere o que
  `lhm plugin update` publica.

## [3.9.0] - 2026-09-24

Bump MINOR porque a superfície publicada muda: a descrição de
`senado_obter_senador` passa a documentar `emExercicio` e a dizer que código
inexistente retorna erro. A tag leva o master inteiro, e a **3.8.0 foi numerada
no `package.json` e nunca virou release** — quem estiver na 3.7.0 do npm recebe
as duas entradas abaixo de uma vez.

### Fixed

- **`senado_obter_senador` inventava um senador para código inexistente, e
  afirmava `emExercicio: true` sobre gente real.** Duas faces do mesmo defeito,
  medidas em 24/09/2026 (item `mcp:ausencia-com-200` do portfólio):

  1. **Ausência com HTTP 200.** Para `/senador/999999` o upstream responde
     **200 com 304 bytes**: o envelope `DetalheParlamentar` e os `Metadados`
     estão lá, o nó `Parlamentar` não. O código fazia
     `response.DetalheParlamentar || response` e deixava o parser montar um
     registro inteiro a partir do nada — `codigo: 0`, `nome: ""`, bloco de
     proveniência e tudo. Quem perguntasse por um código errado recebia uma
     **afirmação falsa**, não um erro. A defesa foi para a BORDA, com a peça
     que o repo já tinha: `digObjectRoot`, que num detalhe por identificador
     único trata nó ausente como ausência e nunca como "vazio legítimo". A
     mensagem (`Senador com código N não encontrado.`) é classificável — cai
     em `nao_encontrado` na telemetria, não em `outro`.
  2. **`emExercicio` estava FIXO em `true` no código.** O detalhe
     `/senador/{codigo}` não carrega exercício nenhum (medido: só
     `IdentificacaoParlamentar`, `DadosBasicosParlamentar` e
     `OutrasInformacoes`), então o campo era invenção. O servidor se
     contradizia sobre a **mesma pessoa real**: o código 6358 saía
     `emExercicio: true` aqui e `false` em `senado_senadores_afastados`. Agora
     é derivado do dado, pelo sub-endpoint `/mandatos` que a tool **já
     buscava**: está em exercício quem tem um `Exercicio` já iniciado e ainda
     não encerrado. A regra foi validada contra as duas listas oficiais —
     `/senador/lista/atual` (81) e `/senador/afastados` (42): **123 de 123
     acertos**. Quando os mandatos não podem ser lidos o campo vem `null`,
     nunca `false` — campo que não se sabe não pode sair afirmado.

  `fetch` do Deep Research traduz a nova exceção no `null` do contrato
  ("documento não encontrado"), que já era a forma de ausência dali.
  **Mudança de superfície:** a descrição de `senado_obter_senador` passa a
  documentar `emExercicio` e a dizer que código inexistente retorna erro.

## [3.8.0] - 2026-09-23

O que estava acumulado em `[Unreleased]` desde a 3.7.0 sai nesta versão: a tag
leva o master inteiro, e o endpoint hospedado já vinha recebendo estas mudanças
por deploy contínuo enquanto o pacote continuava dizendo 3.7.0.

### Added

- **Classe `defeito` na telemetria, e `classifyThrown()`.** `classifyError`
  classifica pela MENSAGEM, e a frase de uma exceção de runtime não casa com
  padrão nenhum do vocabulário: um `TypeError` ia para `outro`, a classe que a
  própria definição do tipo descreve como alarme — *se esta classe crescer, é
  sinal de que falta uma classe*. O sinal honesto é o TIPO do erro (`TypeError`,
  `RangeError`, `ReferenceError`, `SyntaxError` são bug NOSSO, não condição da
  fonte); caçar por texto fossilizaria a mensagem do V8, que muda entre versões
  de Node. `classifyThrown(e)` entra só no `catch` de `instrument.ts`, onde o
  objeto do erro existe; o sítio do `isError` continua em `classifyError`,
  porque ali só há o texto do envelope. **`classifyError` fica INTACTA.** Sem
  mudança de superfície: nenhuma tool, nenhum esquema e nenhuma resposta mudam.
  Conserto nascido no `ibge-br-mcp` 5.1.2 e portado igual aos cinco irmãos.

### Fixed

- **`senado_buscar_materias` com palavra-chave sem achado devolvia zero,
  calado.** A busca por `palavraChave` é remota: casa contra as palavras-chave
  que o próprio Senado atribui a cada processo, no vocabulário dele. Medido na
  produção em 16/09/2026: "maconha" e "cannabis" acham as mesmas 6 matérias (o
  tesauro do Senado cobre), mas "remédio" acha **0** contra 16 de
  "medicamento" e "carro" acha 5 contra 151 de "veículo". É a mesma classe
  consertada com tabela de tradução no ilo, uis, ibge, medical e bcb (item
  `mcp:vocabulario-da-pergunta` do portfólio) — aqui, como o casamento é da
  fonte, o conserto é a saída: zero resultado por palavra-chave vem com
  `dica` dizendo que o vocabulário é o do Senado, com os pares medidos e a
  alternativa (`ano`/`sigla`). Sem mudança de superfície.

### Changed

- **Telemetria: sessão e cliente (blobs 9 e 10).** O servidor passa a emitir
  `Mcp-Session-Id` (UUID v4 aleatório) na resposta ao `initialize` e a gravar,
  em cada linha da telemetria, o id que o cliente devolve — o elo que faltava
  para o funil de sessão do painel contar sessões de verdade, e não a razão
  "chamadas por initialize". O handler continua stateless (o SDK não valida
  o cabeçalho nesse modo, conferido em 16/09/2026 nos sete servidores); nada é
  armazenado e o id não identifica pessoa nem máquina. O nome do software
  cliente declarado no `initialize` (`clientInfo.name`, normalizado) vai na
  linha do aperto de mão.

### Fixed

- **Causa das noites perdidas da tier de contrato, medida: o Senado descarta
  pacotes de alguns IPs de origem.** 20 runners do GitHub dispararam no mesmo
  instante contra `201.54.48.132` (que atende `legis.senado.leg.br` E
  `adm.senado.gov.br`) e `201.54.48.99` (www12). Dezoito conectaram normal.
  Dois — `20.64.173.130` e `52.154.19.227` — não receberam **nenhuma resposta
  de TCP** em nenhum endereço do Senado, com o nosso User-Agent e com um
  `curl/8.5.0` genérico igualmente, enquanto buscavam um site de controle em
  menos de 60 ms. Vizinhos nas mesmas faixas da Azure passaram, então é lista
  por endereço, não faixa de nuvem recusada. É exatamente o que as noites
  ruins mostram por dentro: cerca de 264 requisições, 100% timeout, nenhum
  RST, nenhum erro de DNS, nenhum status HTTP, e a PRIMEIRA já morta — silêncio
  é assinatura de descarte em firewall; host derrubado responde com reset e
  host sobrecarregado responde com 5xx. Consequência prática: a espera de 10
  min do retry nasceu da hipótese de upstream sobrecarregado, que a medição
  derrubou, e caiu para 60 s. Esperar não desbloqueia endereço; só runner novo
  resolve. Com os 10% bloqueados medidos, três tentativas põem a chance de
  perder uma noite perto de uma em mil.

- **A tier noturna de contrato não acusa mais deriva quando o upstream está
  fora.** Nas noites de 02, 04, 08 e 11/09/2026 as 66 specs deram timeout
  contra os DOIS hosts do Senado — `0 ok` — e o job seguiu percorrendo o
  manifesto até o teto de 30 min cortá-lo. O painel do portfólio leu a
  conclusão e anunciou "a fonte mudou". Não tinha mudado: nenhuma asserção
  chegou a ser avaliada. Um detector de deriva que dá alarme falso em apagão
  é um detector que ninguém lê mais. As noites intercaladas fecharam verdes em
  86 a 116 s, e os mesmos endpoints respondem em menos de 1 s de uma conexão
  residencial, então o upstream está intermitentemente não atendendo o runner.
  Três mudanças: `UpstreamError` ganhou a bandeira `transport`, verdadeira só
  quando nenhuma resposta chegou (DNS, TCP, TLS, abort, orçamento) — o status
  sozinho não servia, porque 502 é usado tanto para Bad Gateway de verdade
  quanto para corpo que não parseia, que é justamente deriva; o refresher abre
  um disjuntor depois de 5 falhas de transporte seguidas sem nada capturado,
  saindo com código 3 em ~3 min e dizendo em letras claras que a deriva NÃO
  foi medida; e o workflow novo `Contract tests retry` re-roda só os jobs
  vermelhos num runner novo, até 3 tentativas. O IP de saída do runner passou
  a ser registrado, para a próxima noite ruim ser diagnosticável. Dependência
  faltando virou `MissingDependencyError`: não conta a favor nem contra o
  upstream, e deixou de ser repetida 3 vezes à toa.

- **As 67 tools `senado_*` recusam parâmetro que não existe.** Com o esquema
  aberto, o zod descartava a chave desconhecida em silêncio, o parâmetro que o
  chamador queria usar ficava com o default e a tool respondia OUTRA pergunta
  com cara de resposta. Medido no irmão `ibge-br-mcp` em 11/09/2026: `periodo`
  no singular, que o esquema não tem, devolveu a população de **2026** para uma
  pergunta sobre 2023, sem nenhum aviso — um agente reporta isso como o número
  de 2023. Resposta errada é pior que erro: erro o modelo corrige na chamada
  seguinte, resposta errada vira número em relatório. Aqui o campo minado é o
  maior do portfólio: 67 ferramentas, muitas com pares quase homônimos
  (`codigoSenador`/`codigoParlamentar`, `sigla`/`siglaComissao`).

  O conserto é de uma linha porque todas as tools passam por um funil só
  (`host.tool` em `src/server.ts`), que recebia a shape crua e a entregava ao
  SDK como objeto aberto. Agora ela vira `z.object(shape).strict()`, o que
  publica `additionalProperties: false` e faz o SDK responder
  `Unrecognized key: "<nome>"` — nomeando a chave, para o modelo se corrigir
  sozinho. **Mudança de superfície** nas 67.

  `search` e `fetch` continuam ABERTAS de propósito: entram pelo mesmo funil
  (`registerDeepResearchToolsSenado`), mas o contrato é da OpenAI e fechá-las
  seria mexer num contrato que não é nosso. Guarda em
  `tests/output-contract.test.ts`, nos dois sentidos.

  Preço consciente: erro de validação de esquema é respondido pelo SDK ANTES do
  callback, então não passa pela instrumentação e não aparece na telemetria.
  Troca-se visibilidade por prevenção.

## [3.7.0] - 2026-09-03

**`search` e `fetch` — o contrato Deep Research da OpenAI.** O deep research
do ChatGPT (e o company knowledge, e os workflows de pesquisa da API Responses)
só usa um servidor MCP que exponha EXATAMENTE essas duas tools; sem elas o
servidor era conector de chat e de diretório, mas não fonte de pesquisa. 67 →
**69 tools**. Nada muda nas 67 `senado_*`.

### Added

- **Grupo U — Deep Research (2 tools)**, `src/tools/deep-research.ts`, sobre
  `@sbissoli/mcp-search` 0.3.0 (dep nova). Acervo: senadores em exercício
  (`sen:<código>`, `/senador/lista/atual`) e colegiados ativos do Senado e do
  Congresso (`com:<código>`, `/comissao/lista/colegiados`) — as duas listas
  fechadas que a API publica inteiras; matérias ficam de fora (não há dump).
  Índice em memória construído no 1º uso (mesmas chaves de cache das
  `senado_listar_*`) e mantido por 24 h. `fetch` reusa as leituras reais de
  `senado_obter_senador` e `senado_obter_comissao` (extraídas em
  `fetchSenadorDetalhe`/`fetchComissaoColegiado`), com o mesmo cache e a mesma
  proveniência. `url` é sempre a página pública humana — perfil do senador em
  `www25.senado.leg.br` e a página da comissão em
  `legis.senado.leg.br/comissoes/comissao?codcol=<código>` (padrão verificado ao
  vivo: CAE, CCJ e CCAI respondem 200; código inexistente, 404).
- Desenho "coletor + shim": a fábrica do pacote é apontada para um coletor que
  só colhe `description` e `callback`; o registro passa pelo shim `host.tool`
  de `createServer` como o dos outros 20 grupos — filtro de perfil, título de
  `tool-titles.ts`, annotations, `outputSchema` permissivo ÚNICO (o gate de
  `output-contract` fica intacto) e `instrumentTool`. As duas ficam SÓ em
  `/mcp`; o perfil curado `/mcp/openai-app-v2` continua com 27.
- `provenanceExtras()` em `src/utils/provenance.ts`: os canais
  `structuredContent`/`_meta` do envelope sem o rodapé de texto — para tools
  cujo `content` é ditado por contrato externo.
- `npm run smoke:stdio` (o script existia sem entrada em `scripts`).
- Seção "ChatGPT (Deep Research)" nos dois READMEs; Grupo U no inventário.

### Changed

- Superfície: +2 tools (`search`, `fetch`); recurso `senado://catalogo` passa
  a listar o Grupo U e a dizer 69. Baselines `surface-*-3.6.0` → `3.7.0`.
- `parseComissaoItem` exportada de `comissoes.ts` (era mapeamento inline em
  `senado_listar_comissoes`).

### Fixed

- `scripts/smoke-stdio.mjs` pinava **66** tools — já estava errado (o servidor
  registrava 67) e ninguém viu porque nada o executava. Agora deriva a contagem do baseline
  `surface-stdio-<v>.json` mais recente e exercita `search` → `fetch` +
  id desconhecido ao vivo.
- README pt-BR dizia "25 ferramentas" no perfil curado do ChatGPT App
  (são 27; a frase quebrava linha e escapava do teste de contagem).

## [3.6.0] - 2026-08-30

Migra para o **MCP SDK v2** (`@modelcontextprotocol/server` 2.0.0) e fecha os
achados de conformidade. Produção de **114/122 (93,4%) para 173/173 = 100%**.

O NÚMERO ANTIGO MEDIA UM UNIVERSO MENOR, e é isso que a migração revelou: o
denominador foi de 122 para 173. Na v1 o ciclo 2026-07-28 não existe, então o
auditor pulava dezenas de regras — a nota de 93,4% escondia que o servidor não
falava a versão corrente.

Nada muda para quem usa: as mesmas 67 tools, os mesmos schemas, o mesmo
comportamento. O pacote é só binário (`npx senado-br-mcp`), sem API exportada.

### Changed

- **SDK v2.** O que tornou a migração contida foi o shim: os 20 módulos de grupo
  nunca chamaram o SDK direto, chamam `server.tool()` instalado por
  `createServer`. Trocar imports foi mecânico em 27 arquivos; o trabalho real foi
  declarar o tipo do que os módulos consomem (`src/tool-host.ts`) — até então
  diziam receber `McpServer` e chamavam um método que a v1 expunha e a v2 não.
  De quebra, o `params` de 65 callbacks deixou de ser `any` implícito.
- `createMcpHandler` passa a receber FÁBRICA e não instância (a v2 exige um
  `McpServer` novo por request).
- **O bundle do Worker caiu de 3794 para 1803 KiB** — o SDK v1 não é mais
  empacotado.
- TypeScript 7.0.2, `zod` 4.5.4, `agents` 0.5 -> 0.22, `wrangler` 4.127,
  `@cloudflare/workers-types` v5 e `@sbissoli/mcp-stats` 0.2.0.

### Added

- `title` no `serverInfo` do handshake, e `server/discover` anunciando todas as
  revisões atendidas.
- Cursor de paginação inválido recusado com JSON-RPC `-32602` nos quatro
  endpoints de lista, nas duas bordas por onde a mensagem entra.

### Fixed

- `cli.ts` conectava o transporte à mão (`server.connect`), o que atende só o
  ciclo legado. Com `serveStdio` o stdio foi de 127/144 para 146/148 — **sem uma
  falha de diferença nos dois casos**: eram 19 pontos de regras que sequer
  chegavam a ser avaliadas.
- O `websiteUrl` do handshake apontava para o repositório enquanto o manifesto
  apontava para o domínio próprio, que é quem serve o ícone.
- O stderr do wrangler em `d1.ts` e `d1-read.ts` usava `toString()`, que num
  `Uint8Array` devolveria "104,101,..." em vez do texto — mensagem de erro
  ilegível sem ninguém notar.

### CI

- Catraca do `mcpscore` em 98 (stdio) e 100 (produção).
- O `output-contract` deixou de pinar a string do dialeto de JSON Schema: a v2
  emite `2020-12` onde a v1 emitia `draft-07`, e o teste reprovava uma troca de
  biblioteca como se fosse regressão. Agora guarda a FORMA e exige só que o
  `$schema` exista.

## [3.5.1]

### Added
- **`icons` declared in `server.json`.** The server already served a 512×512 icon
  at `/icon.jpg` and already advertised it in the MCP handshake (`serverInfo.icons`,
  `src/server.ts`), but the registry manifest never declared it — and the registry
  is what directories snapshot. The mcpindex.ai Quality Score awards 5 completeness
  points for a declared icon, so the server sat at 95/100 while owning a perfectly
  good icon. Same URL as `serverInfo`, so the two cannot drift; hosted on the
  server's own domain, which is what the MCP schema recommends over a third-party
  host. A published version is immutable in the MCP Registry, so metadata only
  reaches it through a release.

## [3.5.0]

### Changed
- **Provenance envelope migrated to the portfolio-wide contract v1.0** ([`@sbissoli/mcp-provenance`](https://www.npmjs.com/package/@sbissoli/mcp-provenance)). The server now builds a validated canonical provenance model per response and emits its **`concise` projection**: a fixed 6-key block — `source`, `source_url`, `data_vintage`, `retrieved_at`, `citation`, `license` — with explicit `null` for unknown values, in `structuredContent.provenance` and mirrored under the same namespaced `_meta` keys. Visible changes for consumers: `reference_period` is renamed **`data_vintage`** (also inside the canonical `field_sources`); previously-omitted optional fields now appear as explicit `null`; `dataset_id`, `api_version` and `field_sources` left the emitted block (they live in the canonical model, are validated on every build, and keep informing the `attribution` URL list, which is unchanged); and the text footer follows the contract's fixed wording — source line ("Fonte: … · url · dados de … · extraído em …"), license line, and a closing reader notice that the full reference can be requested in the conversation. Timestamps remain Brasília time (-03:00), preserved through the cache. The ChatGPT-App widget now reads `data_vintage`.

## [3.4.4]

### Changed
- **Fase-1 adoption of the portfolio packages** (behavior-preserving): the statistics core of `src/utils/estatisticas.ts` now comes from [`@sbissoli/mcp-stats`](https://www.npmjs.com/package/@sbissoli/mcp-stats) (the module remains as a pt-BR adapter; responses are byte-identical) and the eval harness (`evals/`) now imports [`@sbissoli/mcp-evals`](https://www.npmjs.com/package/@sbissoli/mcp-evals) (`evals/catalog.ts` keeps only the server's GROUPS; `score.ts`/`retry.ts` were removed in favor of the package, which reproduces the gate messages byte-for-byte).
- **Purge internal vocabulary from statistics responses.** Live testing showed the model transcribing raw field names, parameter names, enum values and technical `aviso` messages into user-facing prose (`valorTotalTransacoes`, `regimeEspecial = true`, "caiu no default", `tipo=supridos`) — jargon meaningful only to someone who knows the MCP internals. Across all five statistics tools: (1) `aviso` messages rewritten in plain language, with no raw field/param names (e.g. "A medida solicitada não está disponível para esta relação; a estatística usa: total gasto no cartão."); (2) a human `campoAnalisado` label accompanies the raw `campo` (e.g. `valorTotalTransacoes` → "total gasto no cartão"); (3) `agrupadoPorRotulo` accompanies the raw `agrupadoPor`; (4) in `senado_suprimento_fundos`, the raw `regimeEspecial` flag (boolean/`S`/`N`) becomes plain text ("regime especial"/"regime comum") in both ranking entries and group keys; (5) a strong new server-instruction forbids transcribing any internal field/param/enum name or technical aviso, directing the model to the human labels. A follow-up round closed two further leak sources found in live testing: the raw `campo`/`agrupadoPor` echoes were removed from the statistics output entirely (only the human `campoAnalisado`/`agrupadoPorRotulo` remain — the fallback logic is still covered by tests via those labels), and the tool descriptions were cleaned of the "cai no default com aviso" mechanic and the field-name-heavy prose (the `z.enum` values the model needs to call the tool are kept). A second server-instruction now also forbids narrating the internal mechanism (which field/param was requested, defaults, avisos, endpoints) — the model should state only what the data is and is not, in plain terms. The previously-deferred gap is now closed: `atos-concessao` statistics join the supridos registry (`tipo=supridos`, ~1 MB, cached by year) so each ranking entry carries the beneficiary's `suprido` NAME — the response can now say "Francisco …" instead of "suprido 14568" — and a new `agruparPor='suprido'` ranks beneficiaries by name. The registry fetch degrades gracefully to name = null on failure.
- **Reader-facing verbalization of statistics.** The `estatisticas: true` envelope no longer surfaces builder shorthand to the user. `percentis` changed from a `{ p25…p99 }` object to a self-documenting list of `{ percentil, valor, rotulo }`, where `rotulo` reads in plain Portuguese (e.g. `"99% dos valores são iguais ou inferiores a R$ 90.026,29"`, median flagged as such) — so the model verbalizes the meaning instead of parroting "p99". In `senado_remuneracoes_servidores`, the internal payroll row id previously exposed as `sequencial` in ranking/extreme entries is now `idInternoFolha` and flagged (in the server instructions) as disambiguation-only, never to be cited as a public identifier. Likewise in `senado_suprimento_fundos` (tipo `atos-concessao`), the raw `codigo_suprido` is renamed `codigoInternoSuprido` and the citable `codigoAtoConcessao`/`data` are now carried so ranking entries have a public reference (the array-valued `elementoDespesa`, useless as an identifier, was dropped from those entries — the `agruparPor` path is unchanged). Two new server-instruction lines codify this for all clients. Affects the five `estatisticas` tools. Internally, the four byte-identical `arredondarEstatisticas`/`arredondarEntradas` copies were consolidated into shared helpers in `src/utils/estatisticas.ts` (`formatarBRL`, `rotularPercentis`, `arredondarEstatisticas`, `arredondarEntradas`).

## [3.4.0]

### Added
- **`estatisticas: true` mode** on five administrative tools (`senado_remuneracoes_servidores`, `senado_ceaps`, `senado_execucao_orcamentaria`, `senado_horas_extras`, `senado_suprimento_fundos`) — returns a quantitative envelope (min/max/mean/median/percentiles plus top/bottom ranking, with optional `campo`/`agruparPor`/`topN`) so max/min/median/ranking questions no longer require paginating the detail mode.

### Changed
- Enriched tool descriptions (Parameters/Behavior/Usage) on 12 tools: `senado_buscar_legislacao`, `senado_obter_legislacao`, `senado_discursos_senador`, `senado_discurso_texto`, `senado_notas_taquigraficas`, `senado_videos_taquigrafia`, `senado_distribuicao_materias`, `senado_resultado_veto`, `senado_tabelas_plenario`, `senado_tabelas_processo`, `senado_contratacao_detalhe`, `senado_ecidadania_obter_evento` — they now disclose pagination/empty/error behavior, parameter semantics (AND filters, internal id vs. law number, enum-by-value), and when-not-to-use guidance. Descriptions only; no logic change.
- Node 20 is now the project baseline (vitest 4 requires ≥20); CI runs a Node 20/22 test matrix on push/PR, with a typecheck+test workflow and README badge.
- Release versioning is now single-source: `package.json` is authoritative and `npm version <bump>` mirrors it into `server.json` and `src/version.ts` via a `version` lifecycle hook.

### Fixed
- Bug-sweep (38 fixes) across pt-BR money parsing, upstream root realignment for the migrated `/processo`/`/votacao` endpoints, senator/plenary/veto field mapping, e-Cidadania anti-injection wrapping and comment-source correction, and orçamento ofícios projection/pagination.

## [3.3.1]

### Changed
- `agents` moved from `dependencies` to `devDependencies` — it is only used by the Worker entrypoint (`src/index.ts`), which the npm/stdio build excludes, so `npx senado-br-mcp` no longer downloads it (~1.1 MB + transitive deps). The hosted Worker still bundles it at build time; no behavior change.

## [3.3.0]

### Added
- Error envelope is now richer and symmetric with successful results: every tool error carries an actionable `hint` (derived from `retryable`) alongside `error`/`retryable`, and the same payload is returned as `structuredContent` so clients can parse errors deterministically. Additive — existing `{ error, retryable }` consumers are unaffected.

### Fixed
- e-Cidadania (which uses its own fetch, not the shared upstream throttle) now marks transient failures (HTTP 5xx/429, timeouts, network errors) as `retryable: true`; only 4xx stay non-retryable.

## [3.2.0]

### Added
- **npm/stdio channel** — the same server now runs locally via `npx senado-br-mcp` (stdio transport), published to npm and advertised in the official MCP Registry alongside the hosted remote. Reaches the official government APIs directly.
- **Provenance** — the level-1 provenance envelope (source, source_url, dataset_id, reference_period, retrieved_at, attribution) now covers all tools, not just the initial pilot set.
- Public `GET /status` endpoint (version + last-deploy id/timestamp) and per-tool usage telemetry in Cloudflare Analytics Engine (PII-free).

## [3.1.0]

### Added
- **Prompts** capability — 4 reusable pt-BR workflow templates: CEAPS expenses, bill tracking, senator votes, and an e-Cidadania overview.
- **Resources** capability — 5 static context docs: usage guide, tool catalog, glossary, and the tipos-matéria / UFs reference tables.
- `LICENSE` file (MIT).

## [3.0.0]

### Changed (BREAKING)
- Consolidated 90 → 65 tools by merging near-duplicate tools into enum parameters (e.g. reference tables → `senado_tabelas_referencia`; per-process sub-resources → `senado_processo_detalhe`; `senado_mesa` with a `casa` param; `senado_search_votacoes` absorbing the recent-votes/list tools). Several tool names were removed or renamed.

## [2.3.0]

### Added
- Every tool now declares MCP annotations (`readOnlyHint`, `openWorldHint`) and a structured-output schema.

### Changed
- Canonical endpoint moved to the custom domain `https://senado.sidneybissoli.com/mcp` (the `*.workers.dev` URL still works as a fallback).

## [2.2.0]

### Added
- Administrative domain (groups O, P, Q, R — 16 tools) consuming `adm.senado.gov.br`. Large datasets (CEAPS ≈ 10 MB/year, payroll ≈ 5.5 MB/month) are fetched once, cached, and filtered/aggregated inside the Worker — tools never return raw dumps.

## [2.1.0]

### Changed
- Migrated all tools that consumed upstream-deprecated endpoints (the legacy `/materia/*` family and `/senador/{codigo}/votacoes`) to the v3 `/processo` and `/votacao` APIs, keeping tool names and output keys stable.
