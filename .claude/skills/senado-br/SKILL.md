---
name: senado-br
description: >-
  Pesquisa de dados abertos do Senado Federal do Brasil via o MCP senado-br (66 ferramentas):
  senadores, matérias e projetos de lei, votações nominais, comissões, plenário, discursos, blocos e
  lideranças, legislação federal, vetos, e o portal e-Cidadania (consultas públicas, ideias legislativas,
  eventos), além de dados administrativos — CEAPS (cota parlamentar), contratos, licitações, servidores,
  terceirizados e execução orçamentária. Use ao responder perguntas sobre o Senado brasileiro, processo
  legislativo, como um senador votou, gastos/transparência parlamentar ou participação cidadã, em português
  ou inglês (Brazilian Federal Senate, legislation, senators, roll-call votes, CEAPS expenses, e-Cidadania).
  Requer o servidor MCP "senado-br" conectado (hospedado em senado.sidneybissoli.com/mcp ou via npx senado-br-mcp).
---

# Senado BR — dados abertos do Senado Federal

Playbook para usar bem o servidor MCP **senado-br**: 66 ferramentas (somente leitura) sobre os dados
abertos oficiais do Senado Federal — API legislativa, API administrativa e portal e-Cidadania. Toda
resposta vem com **proveniência** (fonte oficial + `retrieved_at`), porque o público-alvo são
jornalistas e pesquisadores: cite a fonte ao reportar números.

> **Pré-requisito:** o servidor precisa estar conectado como MCP. Se as ferramentas `senado_*` não
> aparecerem, oriente o usuário a conectar `https://senado.sidneybissoli.com/mcp` (hospedado, sem setup)
> ou rodar `npx senado-br-mcp` (local/stdio). As ferramentas são apenas leitura — nunca alteram dados.

## Quando usar

Use sempre que a pergunta envolver o **Senado Federal do Brasil**: senadores e sua atuação, projetos/matérias
e tramitação, votações e como cada senador votou, comissões e CPIs, plenário, vetos, discursos, legislação,
gastos parlamentares (CEAPS), contratos/licitações da Casa, servidores/terceirizados, orçamento, ou o
e-Cidadania (consultas públicas, ideias, audiências/eventos).

**Não** use para a Câmara dos Deputados, assembleias estaduais, ou tribunais — o escopo é o Senado.

## Mapa de ferramentas (qual chamar)

Não liste o catálogo inteiro ao usuário; escolha a ferramenta pelo tema. Para a referência completa,
leia o recurso `senado://catalogo` do próprio servidor.

| Tema | Ferramentas principais |
|------|------------------------|
| **Senadores** | `senado_listar_senadores` (filtros nome/uf/partido), `senado_obter_senador`, `senado_votacoes_senador`, `senado_senador_historico`, `senado_senadores_afastados` |
| **Matérias / projetos** | `senado_buscar_materias`, `senado_obter_materia`, `senado_search_processos`, `senado_obter_processo`, `senado_processo_detalhe`, `senado_distribuicao_materias` |
| **Votações** | `senado_search_votacoes`, `senado_obter_votacao`, `senado_votos_materia`, `senado_votacao_comissao`, `senado_orientacao_bancada` |
| **Comissões / CPIs** | `senado_listar_comissoes`, `senado_obter_comissao`, `senado_reunioes_comissao`, `senado_reuniao_comissao`, `senado_agenda_comissoes`, `senado_requerimentos_cpi` |
| **Plenário / vetos** | `senado_agenda_plenario`, `senado_resultado_plenario`, `senado_encontro_plenario`, `senado_vetos`, `senado_resultado_veto`, `senado_mesa`, `senado_liderancas` |
| **Discursos / taquigrafia** | `senado_discursos_senador`, `senado_discursos_plenario`, `senado_discurso_texto`, `senado_notas_taquigraficas`, `senado_videos_taquigrafia` |
| **Blocos / lideranças** | `senado_listar_blocos`, `senado_obter_bloco`, `senado_orientacao_bancada`, `senado_autores_atuais` |
| **Legislação federal** | `senado_buscar_legislacao`, `senado_obter_legislacao` |
| **Gastos / transparência** | `senado_ceaps` (cota parlamentar), `senado_contratos`, `senado_contratacoes_lista`, `senado_contratacao_detalhe`, `senado_licitacoes`, `senado_empresas_contratadas`, `senado_suprimento_fundos`, `senado_execucao_orcamentaria`, `senado_orcamento_parlamentar` |
| **Pessoal** | `senado_servidores`, `senado_remuneracoes_servidores`, `senado_terceirizados`, `senado_horas_extras`, `senado_pessoal_tabelas` |
| **e-Cidadania** | `senado_ecidadania_listar_consultas`, `senado_ecidadania_obter_consulta`, `senado_ecidadania_consultas_analise`, `senado_ecidadania_consultas_votos`, `senado_ecidadania_listar_ideias`, `senado_ecidadania_obter_ideia`, `senado_ecidadania_listar_eventos`, `senado_ecidadania_obter_evento`, `senado_ecidadania_sugerir_tema_enquete` |
| **Tabelas de referência** | `senado_tabelas_referencia`, `senado_tabelas_processo`, `senado_tabelas_plenario` (param `tipo`/`tabela` enum) |

## Playbooks (pergunta → sequência)

- **"Como o senador X votou na matéria Y?"** → `senado_buscar_materias` (achar o código) → `senado_votos_materia`
  ou `senado_votacoes_senador`. Para o resultado geral da votação: `senado_obter_votacao`.
- **"Qual a tramitação da PEC/PL N/AAAA?"** → `senado_buscar_materias` → `senado_obter_materia` →
  `senado_processo_detalhe` (movimentações/documentos).
- **"Quanto o senador X gastou com a cota (CEAPS)?"** → `senado_ceaps` (filtra por senador/ano/mês; o dataset
  é grande e já vem agregado — peça o período).
- **"Panorama do e-Cidadania / consultas mais votadas"** → `senado_ecidadania_listar_consultas` ou
  `senado_ecidadania_consultas_analise`; votos por UF em `senado_ecidadania_consultas_votos`.
- **"Quem são os senadores de SP?"** → `senado_listar_senadores` com `uf:"SP"`.

Os mesmos workflows existem como **prompts** do servidor (`senado_gastos_senador`, `senado_tramitacao_materia`,
`senado_votos_senador`, `senado_panorama_ecidadania`) — use-os quando o cliente os oferecer.

## Gotchas (importantes)

- **Proveniência:** cada resposta traz `structuredContent.provenance` (source, source_url, dataset_id,
  reference_period, **retrieved_at**, attribution, license). Ao reportar um número, **cite a fonte e a data**.
- **Datas:** as ferramentas aceitam `YYYYMMDD`; as de backend v3 (votações/processos) também `YYYY-MM-DD` e
  convertem sozinhas. Passe a data no formato pedido pela descrição da ferramenta.
- **Matérias legadas:** o backend migrou para `/processo` e `/votacao`; código de matéria antigo é aceito via
  o parâmetro `codigoMateria` (a ponte é automática).
- **e-Cidadania consultas:** a listagem cobre as consultas **ABERTAS** (em tramitação). `status=encerrada`
  tende a vir vazio; o acervo histórico de votos por UF é só via `senado_ecidadania_consultas_votos`.
- **Respostas grandes** (transcrições, listas, buscas) têm `limite`/paginação com teto padrão e um campo
  `aviso` quando truncadas — aumente o `limite` ou pagine se precisar de mais.
- **Erros:** vêm como `{ error, retryable, hint }`. Se `retryable:true` (falha transitória da fonte oficial),
  repita a chamada em alguns segundos; o `hint` traz a orientação.

## Recursos do próprio servidor (leia se precisar de detalhe)

O servidor expõe **resources** MCP que dispensam adivinhação — prefira-os a inferir:
`senado://guia` (guia de uso), `senado://catalogo` (catálogo completo das 66 tools), `senado://glossario`
(termos do processo legislativo), `senado://tabelas/tipos-materia` e `senado://tabelas/ufs`.
