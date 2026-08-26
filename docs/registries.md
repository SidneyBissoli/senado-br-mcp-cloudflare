# Registries e diretórios MCP

Verificação de propriedade da listagem deste servidor em diretórios de terceiros.

## MseeP.ai

[![Verified on MseeP](https://mseep.ai/badge.svg)](https://mseep.ai/app/cf092e90-b2cc-4322-8bb9-0f5a835377d6)

Badge da listagem
[mseep.ai/app/sidneybissoli-senado-br-mcp-cloudflare](https://mseep.ai/app/sidneybissoli-senado-br-mcp-cloudflare)
(diretório com scan de segurança automatizado de servidores MCP).

**Correção de 2026-08-26.** Este arquivo afirmava que o badge era "o mecanismo
de verificação de propriedade" e que não devia ser removido. A visão de
PROPRIETÁRIO do MseeP não sustenta isso: a página da listagem atribui a
propriedade à CONTA ("Owners: Sidney Bissoli", com os controles de edição
liberados) e em lugar nenhum condiciona isso a um badge no README. Não é prova
de que o badge seja irrelevante — é que a afirmação anterior não tinha apoio, e
foi escrita com força de regra ("não remover"), o que travaria decisão de layout
de README sem motivo verificado.

O que se sabe hoje, sem inferir:

- a nota da listagem é o **trust rating**, e ele sai do `npm audit` do
  repositório — inclusive de advisories que só existem em `devDependencies`.
  Medido no ibge-br-mcp em 26/08/2026: 5 advisories transitivas do eslint
  derrubaram a nota para 2,7 ("Moderate Risk"), com `npm audit --omit=dev`
  limpo. A defesa é o passo de audit do CI reprovar de verdade, sem
  `continue-on-error`;
- o avatar da listagem é uma figura de animal atribuída pelo diretório (aqui um
  lagarto, no ibge-br-mcp um macaco) e o badge embute essa figura;
- a "Detailed Description" da listagem é uma CÓPIA do README guardada pelo
  MseeP, editável na página e que **não** acompanha o repositório sozinha —
  a do ibge-br-mcp seguia mostrando o README pré-v3. Vale reconferir esta aqui
  a cada release que mude o README.
