# Pacote de submissao OpenAI Apps SDK / ChatGPT App

Atualizado: 2026-06-28.

Status: **pronto para submeter apos deploy e smoke hospedado aprovados**. Este documento nao indica que o app
foi submetido ou aprovado.

## Fontes oficiais consultadas em 2026-06-28

- OpenAI Apps SDK overview: `https://developers.openai.com/apps-sdk/`
- MCP Apps in ChatGPT: `https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt`
- MCP server: `https://developers.openai.com/apps-sdk/concepts/mcp-server`
- Optimize metadata: `https://developers.openai.com/apps-sdk/guides/optimize-metadata`
- Reference: `https://developers.openai.com/apps-sdk/reference`
- Security and privacy: `https://developers.openai.com/apps-sdk/guides/security-privacy`
- Submit and maintain your app: `https://developers.openai.com/apps-sdk/deploy/submission`
- App submission guidelines: `https://developers.openai.com/apps-sdk/app-submission-guidelines`
- Codex manual, fetched by the OpenAI docs helper on 2026-06-28: `https://developers.openai.com/codex/codex-manual.md`

## Requisitos oficiais e estado do repo

| Requisito | Estado em 2026-06-28 |
| --- | --- |
| Endpoint MCP remoto HTTPS | Implementado: `https://senado.sidneybissoli.com/mcp`. |
| Endpoint curado para ChatGPT App | Implementado: `https://senado.sidneybissoli.com/mcp/openai-app`. |
| Superficie revisavel | Implementado: 25 tools de alto sinal no perfil OpenAI; endpoint completo preservado. |
| Instructions no handshake MCP | Implementado em `SERVER_INSTRUCTIONS` e `OPENAI_APP_SERVER_INSTRUCTIONS`. |
| Metadados de tools | Implementado: tools read-only, non-destructive, idempotent, open-world, com template UI compartilhado. |
| Widget MCP Apps / Apps SDK | Implementado: recurso `ui://senado-br-mcp/openai-app-dashboard-v1.html`, MIME `text/html;profile=mcp-app`, CSP sem dominios externos, dominio dedicado e bridge ChatGPT/MCP Apps. |
| Privacidade e termos publicos | Implementado: `/privacy` e `/terms`. |
| Sem falsa afiliacao | Implementado em instructions, docs, legal pages e textos de submissao abaixo. |
| Review por Dashboard | Depende de acao manual no OpenAI Dashboard. |
| Verificacao de identidade | Depende de acao manual no OpenAI Dashboard, quando solicitado. |
| Publicacao em ChatGPT catalog / Codex Plugin Directory | Depende de aprovacao da OpenAI. A documentacao atual diz que apps publicados podem aparecer nesses destinos; nao ha publicacao direta por commit neste repo. |

## Textos finais de listing

Nome sugerido:

```text
Dados Abertos Senado BR
```

Descricao curta:

```text
Pesquise dados publicos do Senado Federal do Brasil com fontes, datas de coleta e proveniencia estruturada.
```

Descricao longa:

```text
Dados Abertos Senado BR e um app independente para consultar, cruzar e citar informacoes publicas do Senado Federal do Brasil. Ele cobre senadores, materias legislativas, votacoes, comissoes, plenario, notas taquigraficas, e-Cidadania, CEAPS e contratacoes, usando um endpoint MCP somente leitura hospedado em Cloudflare Workers.

Cada resposta prioriza proveniencia: quando disponivel, os resultados incluem fonte oficial, URL de origem, periodo de referencia e data de coleta. O objetivo e ajudar jornalistas, pesquisadores, estudantes, equipes civicas e cidadaos a verificar dados legislativos e administrativos sem depender de numeros inferidos pelo modelo.

Este app nao altera sistemas externos, nao executa acoes transacionais e nao exige login ou chave de API do usuario final no endpoint publico submetido para revisao. Os dados retornados podem mudar porque as fontes publicas do Senado e do e-Cidadania sao atualizadas ao longo do tempo.
```

Politica de independencia institucional:

```text
Este app e independente. Nao e afiliado, mantido ou endossado pelo Senado Federal, pela OpenAI ou pelo ChatGPT. Ele consulta fontes publicas oficiais e apresenta proveniencia para apoiar verificacao pelo usuario.
```

Categorias sugeridas, se o formulario oferecer categorias equivalentes:

```text
Research
Government / Public Data
News / Civic Information
Education
Productivity
```

Evitar no formulario:

- "oficial do Senado", "oficial da OpenAI", "oficial do ChatGPT", "certificado" ou "aprovado".
- Brasao, marca institucional ou identidade visual que sugira manutencao pelo Senado Federal.
- Promessas de aconselhamento juridico, politico, financeiro, jornalistico ou de compliance.

## Instrucoes para review da OpenAI

Endpoint MCP para o app:

```text
https://senado.sidneybissoli.com/mcp/openai-app
```

Privacidade:

```text
https://senado.sidneybissoli.com/privacy
```

Termos:

```text
https://senado.sidneybissoli.com/terms
```

Icone:

```text
https://senado.sidneybissoli.com/icon.jpg
```

Repositorio:

```text
https://github.com/SidneyBissoli/senado-br-mcp-cloudflare
```

Notas para reviewer:

```text
This is an independent, read-only public-data app for Brazilian Federal Senate datasets. It is not affiliated with, maintained by, or endorsed by the Brazilian Federal Senate, OpenAI, or ChatGPT.

The submitted endpoint is /mcp/openai-app, a curated profile with 25 read-only tools and one shared MCP Apps widget. The full public MCP endpoint remains available at /mcp for technical users, but it is not the endpoint intended for ChatGPT App review.

Suggested review prompts:
1. Liste os senadores em exercicio por UF e cite a fonte.
2. Busque materias recentes sobre inteligencia artificial e mostre a proveniencia.
3. Consulte votacoes recentes de uma materia e explique de onde veio o resultado.
4. Liste consultas publicas do e-Cidadania e destaque a data de coleta.
5. Pesquise contratos do Senado relacionados a tecnologia e indique a fonte.

The app does not write to external systems, does not require end-user login, and does not store a database of user prompts. Tool outputs include structured provenance and attribution where available.
```

## Screenshots e checklist visual

A documentacao publica consultada em 2026-06-28 nao expunha requisito publico obrigatorio de screenshot. Se o
Dashboard pedir screenshots durante a submissao, capturar manualmente:

- tela de teste do app no ChatGPT usando o endpoint `https://senado.sidneybissoli.com/mcp/openai-app`;
- uma resposta com proveniencia visivel;
- o widget `Dados Abertos Senado BR` renderizando metricas, itens e fonte;
- a tela/listing sem qualquer alegacao de status oficial.

Checklist visual:

- O nome do app nao inclui "oficial".
- A descricao inclui independencia institucional.
- A resposta mostra fonte/proveniencia quando disponivel.
- O widget nao mostra conteudo HTML vindo dos dados; renderiza texto via `textContent`.
- O app nao solicita login, OAuth ou chave de API do usuario final.

## Acoes manuais no Dashboard OpenAI

1. Acessar `https://platform.openai.com/apps`.
2. Criar ou abrir o app MCP.
3. Informar o endpoint `https://senado.sidneybissoli.com/mcp/openai-app`.
4. Preencher nome, descricoes, politica de privacidade, termos e contatos usando os textos acima.
5. Concluir verificacao de identidade/perfil de builder, se o Dashboard solicitar.
6. Aceitar as politicas e termos aplicaveis da OpenAI, se o fluxo solicitar.
7. Rodar o teste manual no ChatGPT/App tester do Dashboard.
8. Submeter para review.
9. Apos envio, registrar neste repo o status real: "submetido em AAAA-MM-DD". Nao registrar "aprovado" antes da aprovacao da OpenAI.

## Caminhos Codex e diretorios OpenAI

Em 2026-06-28, a documentacao oficial atual indica estes caminhos:

- ChatGPT Apps sao submetidos pelo OpenAI Dashboard.
- Apps publicados e aprovados podem ser expostos no ChatGPT catalog e no Codex Plugin Directory conforme o fluxo da OpenAI.
- O Codex tambem aceita plugins via marketplaces locais/de repo (`.agents/plugins/marketplace.json`) e compartilhamento de workspace, mas isso nao publica o app no diretorio publico curado pela OpenAI.
- Nao foi encontrada, nas fontes oficiais consultadas, uma submissao publica separada de "MCP para Codex" fora do fluxo de ChatGPT Apps ou dos marketplaces/plugins locais do Codex.

