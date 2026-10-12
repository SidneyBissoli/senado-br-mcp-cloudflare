# Comparativo: senado-br-mcp e as alternativas para dados do Senado Federal

**Quem quer dados do Senado Federal dentro de um assistente de IA** já tem opções:
os agregadores multifonte [mcp-brasil][mb] e [mcp-dados-br][md], o servidor dedicado
[mcp-senado][ms], o pacote R [congressbr][cb] e as próprias APIs de dados abertos do
Senado. Este documento diz, com números medidos na fonte, **o que cada um cobre do
Senado** e quando preferir cada um.

Resumo em uma linha: os agregadores tratam o Senado como **uma fonte entre dezenas** e
cobrem o núcleo legislativo; `senado-br-mcp` cobre o Senado **inteiro** — legislativo,
administrativo e e-Cidadania — com proveniência em toda resposta e um endpoint
hospedado que não pede instalação nem chave.

**Sobre o nome.** O servidor mora no repositório `senado-br-mcp-cloudflare` e é publicado
no npm como [`senado-br-mcp`][np] e no [MCP Registry][mr] como
`io.github.SidneyBissoli/senado-br-mcp-cloudflare`. O repositório antigo
`senado-br-mcp` está arquivado; o pacote npm de mesmo nome é este servidor.

Todos os números abaixo foram medidos em 11/10/2026 e podem ser remedidos com os passos
de [Como conferir os números](#como-conferir-os-números).

## A cadeia do dado, e onde cada ferramenta entra

```
Senado Federal
 ├── API legislativa  (legis.senado.leg.br/dadosabertos)     senadores, matérias, votações, comissões,
 │                                                            plenário, discursos, vetos, legislação
 ├── API administrativa (adm.senado.gov.br/adm-dadosabertos)  CEAPS, servidores e folha, horas extras,
 │                                                            contratos, licitações, suprimento, orçamento
 └── portal e-Cidadania (www12.senado.leg.br/ecidadania)      ideias legislativas, consultas públicas,
                                                              eventos interativos — SEM API oficial
        │
        ├── congressbr (R) .............. legislativo, para análise em R; arquivado no CRAN em 2020
        ├── mcp-brasil (Python) ......... 26 tools do Senado, só a API legislativa; o Senado é 1 de ~70 módulos
        ├── mcp-dados-br (Python) ....... 3 tools do Senado; o Senado é 1 de 5 fontes
        ├── mcp-senado (TypeScript) ..... dedicado ao legislativo
        │
        └── senado-br-mcp (este) ........ 69 tools nas TRÊS fontes, hospedado ou via npx
                 └── bloco de proveniência: URL da fonte, instante real da extração, citação e
                     licença em toda resposta
```

## Tabela

| | Linguagem / distribuição | Tools do Senado | Fontes do Senado cobertas | Onde roda | Proveniência na resposta |
| --- | --- | --- | --- | --- | --- |
| **senado-br-mcp** (este) | TypeScript, [npm][np] 3.18.0 + [MCP Registry][mr] | **69** (67 `senado_*` + `search`/`fetch`), 4 prompts, 5 resources | legislativa, administrativa e e-Cidadania | **Hospedado** em `https://senado.sidneybissoli.com/mcp`, sem chave; ou local, `npx senado-br-mcp` | **Sim**, em toda resposta |
| [mcp-brasil][mb] 0.14.0 | Python, PyPI | **26** | legislativa | Local (`uvx`/`pip`) ou auto-hospedado (HTTP, Docker); sem endpoint público | Não |
| [mcp-dados-br][md] 0.6.0 | Python, PyPI + MCP Registry | **3** | legislativa | Local (`uvx`, stdio); HTTP opcional em `127.0.0.1` | Não |
| [mcp-senado][ms] 0.2.1 | TypeScript, npm `@aredes.me/mcp-senado` | 56, segundo o README (não conferido no código) | legislativa | Local; há configuração para Cloudflare, sem endpoint público encontrado | — |
| [congressbr][cb] 0.2.2 | R — **arquivado no CRAN em 20/07/2020** | não é MCP (funções `sen_*`) | legislativa | R, local | Não |
| [APIs oficiais][api] | HTTP | — | cada API é uma fonte | Qualquer lugar | — |

O mcp-brasil é o maior projeto da lista (1.807 estrelas): um agregador com dezenas de
fontes do governo — Câmara, TSE, TCU, Portal da Transparência, IBGE, Banco Central — e é a
escolha natural quando a pergunta **cruza** o Senado com essas outras fontes. O
mcp-dados-br reúne IBGE, Banco Central, INMET, Câmara e Senado num servidor pequeno.

## O que cada um cobre do Senado

Medido lendo o código-fonte do módulo do Senado de cada projeto (mcp-brasil no commit
`2efb258`, mcp-dados-br no commit `0996182`) e o inventário de tools deste servidor.

| Área | senado-br-mcp | mcp-brasil | mcp-dados-br |
| --- | --- | --- | --- |
| Senadores (em exercício, histórico, afastados) | sim | sim | só em exercício |
| Matérias e tramitação | sim | sim (com emendas e relatorias) | só lista |
| Votação de plenário com voto nominal | sim | sim | só placar agregado |
| Votação em comissão | sim | não | não |
| Orientação de bancada | sim | não | não |
| Comissões, reuniões e CPIs | sim | sim (sem votação) | não |
| Agenda e resultado do plenário | sim | agenda | não |
| Discursos, apartes e notas taquigráficas | sim | não | não |
| Vetos | sim | não | não |
| Legislação federal (normas) | sim | não | não |
| CEAPS (cota parlamentar) | sim, com estatísticas e ranking | não (só a CEAP da Câmara) | não |
| Servidores, remuneração, horas extras, terceirizados | sim | não | não |
| Contratos, licitações, suprimento de fundos | sim | não | não |
| Execução orçamentária do Senado | sim | não | não |
| e-Cidadania: ideias, consultas públicas, eventos | sim | não | não |

## Dois exemplos, lado a lado

### 1. "Quanto os senadores gastaram com a cota parlamentar em 2025, e como se distribuem as despesas?"

*Aqui:* uma chamada a `senado_ceaps` com `ano: 2025` e `estatisticas: true`. A resposta
traz **23.808 despesas, somando R$ 37.349.995,72**; a despesa mediana é de **R$ 400,00**,
90% delas ficam em até R$ 3.800,00 e a maior despesa individual foi de R$ 175.000,00
(divulgação da atividade parlamentar). Vem também o bloco de proveniência: a URL exata
da fonte (`adm.senado.gov.br/adm-dadosabertos/api/v1/senadores/despesas_ceaps/2025`), o
instante real da extração e a citação.

*Nos agregadores:* nenhum dos dois tem tool de CEAPS do Senado. O caminho é a API
administrativa crua: um JSON de cerca de 10 MB por ano, que o cliente baixa, agrega e
resume por conta própria.

### 2. "Como votou o plenário na matéria X, e o que disseram os senadores?"

*Aqui:* `senado_votos_materia` traz o voto nominal de cada senador, `senado_orientacao_bancada`
a orientação de cada bloco, e `senado_discursos_plenario` + `senado_discurso_texto` o que
foi dito, com o texto integral.

*No mcp-brasil:* o voto nominal sai por `votos_materia`/`detalhe_votacao`; discursos e
orientação de bancada não estão cobertos. *No mcp-dados-br:* `senado_votacoes` devolve o
placar agregado por tipo de voto, sem o voto de cada senador.

## Quando preferir cada um

- **Este servidor:** a pergunta é sobre o Senado — inclusive gastos, pessoal, contratos,
  orçamento ou participação cidadã — e a resposta precisa ser auditável (fonte e instante
  da extração em toda resposta). Ou você não quer instalar nada: o endpoint hospedado
  funciona em Claude, ChatGPT e qualquer cliente MCP remoto.
- **mcp-brasil:** a pergunta cruza o Senado com outras fontes (Câmara, TSE, Portal da
  Transparência) e você prefere um servidor único em Python, rodando na sua máquina.
- **mcp-dados-br:** você quer um servidor pequeno, com poucas tools, para consultas
  rápidas a cinco fontes, e o Senado é secundário.
- **congressbr ou as APIs oficiais:** você quer a **base inteira** para análise própria
  (em R, Python ou SQL), não uma resposta dentro do assistente.

**Não use este servidor quando** precisar de dados da Câmara dos Deputados, do TSE ou de
outras fontes do governo (ele cobre só o Senado), ou quando precisar baixar séries
completas para análise estatística offline — aí o dado cru ou um pacote de análise
servem melhor. Para a participação cidadã do e-Cidadania em lote, há o
[dataset versionado no Zenodo][zen], construído pelo mesmo projeto.

## Como conferir os números

- **Este servidor:** `tools/list` no endpoint (`https://senado.sidneybissoli.com/mcp`) ou o
  arquivo [`surface.lock.json`][lock], que guarda a superfície declarada da versão.
- **mcp-brasil:** `src/mcp_brasil/data/senado/server.py` no [repositório][mb] — cada
  `mcp.tool(...)` registrado é uma tool (26 no commit `2efb258`).
- **mcp-dados-br:** `src/mcp_dados_br/tools/senado.py` no [repositório][md] (3 funções
  `senado_*` no commit `0996182`).
- **Versões e datas:** `https://pypi.org/pypi/<nome>/json`, `npm view <pacote>` e a
  API do GitHub.
- **congressbr:** a página do pacote no CRAN registra o arquivamento.

Encontrou um número desatualizado ou uma cobertura que mudou? Abra uma
[issue](https://github.com/SidneyBissoli/senado-br-mcp-cloudflare/issues) — a tabela é
corrigida, inclusive quando o erro favorece este servidor.

[mb]: https://github.com/Mcp-Brasil/mcp-brasil
[md]: https://github.com/lucianoon/mcp-dados-br
[ms]: https://github.com/cristianoaredes/mcp-senado
[cb]: https://cran.r-project.org/package=congressbr
[api]: https://legis.senado.leg.br/dadosabertos/
[np]: https://www.npmjs.com/package/senado-br-mcp
[mr]: https://registry.modelcontextprotocol.io/v0/servers?search=senado-br-mcp-cloudflare
[lock]: https://github.com/SidneyBissoli/senado-br-mcp-cloudflare/blob/master/surface.lock.json
[zen]: https://doi.org/10.5281/zenodo.21183940
