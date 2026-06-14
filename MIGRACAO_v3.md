# Migração v3 — consolidação de 90 → 65 tools

> Nota de migração para consumidores do endpoint `https://senado.sidneybissoli.com/mcp`.
> A superfície de tools foi consolidada de **90 tools granulares** para **65 tools faceadas**
> (mesmo conjunto de capacidades). Nenhuma capacidade foi removida — tools próximas foram
> fundidas sob parâmetros `secao`/`tipo`/`tabela`/`por`/`casa`/`modo`/`ordenarPor`.
>
> **Cada uma das 90 tools antigas tem um caminho 1:1 equivalente nas 65 novas**, auditado
> contra o código-fonte (coluna "Como"). Atualize chamadas que usem nomes removidos.

## O que muda para quem consome

- Tools com **mesmo nome** continuam funcionando igual (a maioria).
- Tools **removidas/renomeadas** passam a ser alcançadas por um parâmetro de outra tool.
  Ex.: `senado_mesa_senado` → `senado_mesa` com `casa: "senado"`.
- O **formato de saída** (chaves do JSON) de cada capacidade foi preservado; quando a tool
  consolidada agrega seções, a resposta inclui um campo que identifica a seção/modo escolhido.

## Mapa 1:1 — tool antiga → caminho novo

Apenas as tools **removidas/renomeadas** estão listadas (as de mesmo nome seguem inalteradas).

| Tool antiga (removida) | Caminho novo | Como |
|---|---|---|
| `senado_buscar_senador_por_nome` | `senado_listar_senadores` | parâmetro `nome` (busca parcial, acento-insensível) |
| `senado_senador_detail` | `senado_senador_historico` | parâmetro `tipo` (licencas, comissoes, cargos, filiacoes, profissoes) |
| `senado_apartes_senador` | `senado_discursos_senador` | parâmetro `tipo: "apartes"` |
| `senado_senadores_aposentados` | `senado_senadores_admin` | parâmetro `tipo: "aposentados"` |
| `senado_auxilio_moradia` | `senado_senadores_admin` | parâmetro `tipo: "auxilio-moradia"` |
| `senado_escritorios_apoio` | `senado_senadores_admin` | parâmetro `tipo: "escritorios-apoio"` |
| `senado_textos_materia` | `senado_obter_materia` | parâmetro `secao: "textos"` |
| `senado_tramitacao_materia` | `senado_obter_materia` | parâmetro `secao: "tramitacao"` |
| `senado_emendas_processo` | `senado_processo_detalhe` | parâmetro `secao: "emendas"` |
| `senado_relatorias_processo` | `senado_processo_detalhe` | parâmetro `secao: "relatorias"` |
| `senado_prazos_processo` | `senado_processo_detalhe` | parâmetro `secao: "prazos"` |
| `senado_listar_votacoes` | `senado_search_votacoes` | parâmetros `dataInicio`/`dataFim` (YYYYMMDD) |
| `senado_votacoes_recentes` | `senado_search_votacoes` | parâmetro `dias` (1–365) |
| `senado_votacao_comissao_senador` | `senado_votacao_comissao` | parâmetro `por: "senador"` |
| `senado_votacao_comissao_materia` | `senado_votacao_comissao` | parâmetro `por: "materia"` |
| `senado_membros_comissao` | `senado_obter_comissao` | parâmetro `secao: "membros"` |
| `senado_mesa_senado` | `senado_mesa` | parâmetro `casa: "senado"` (padrão) |
| `senado_mesa_congresso` | `senado_mesa` | parâmetro `casa: "congresso"` |
| `senado_orcamento_emendas` | `senado_orcamento_parlamentar` | parâmetro `tipo: "emendas"` |
| `senado_orcamento_oficios` | `senado_orcamento_parlamentar` | parâmetro `tipo: "oficios"` |
| `senado_partidos` | `senado_tabelas_referencia` | parâmetro `tabela: "partidos"` |
| `senado_ufs` | `senado_tabelas_referencia` | parâmetro `tabela: "ufs"` |
| `senado_legislatura_atual` | `senado_tabelas_referencia` | parâmetro `tabela: "legislatura-atual"` |
| `senado_tipos_materia` | `senado_tabelas_referencia` | parâmetro `tabela: "tipos-materia"` |
| `senado_tipos_norma` | `senado_tabelas_referencia` | parâmetro `tabela: "tipos-norma"` |
| `senado_tipos_uso_palavra` | `senado_tabelas_referencia` | parâmetro `tabela: "tipos-uso-palavra"` |
| `senado_pessoal_listas` | `senado_pessoal_tabelas` | parâmetro `tabela` (estagiarios, pensionistas, lotacoes, cargos) |
| `senado_quantitativos_pessoal` | `senado_pessoal_tabelas` | parâmetro `tabela` (pessoal, cargos-funcoes, previsao-aposentadoria, senadores) |
| `senado_ecidadania_consultas_consensuais` | `senado_ecidadania_consultas_analise` | parâmetro `modo: "consenso"` |
| `senado_ecidadania_consultas_polarizadas` | `senado_ecidadania_consultas_analise` | parâmetro `modo: "polarizada"` |
| `senado_ecidadania_ideias_populares` | `senado_ecidadania_listar_ideias` | parâmetro `ordenarPor: "apoios"` |
| `senado_ecidadania_eventos_populares` | `senado_ecidadania_listar_eventos` | parâmetro `ordenarPor: "comentarios"` |

As demais ~58 tools mantêm o nome (várias com novos parâmetros opcionais que absorvem
sub-recursos, p.ex. `senado_obter_materia` com `secao`, `senado_ceaps` com `modo`,
`senado_tabelas_processo`/`senado_tabelas_plenario` com `tabela`).

## Auditoria

A cobertura 1:1 foi verificada arquivo a arquivo em `src/tools/` (parâmetro + linha de
evidência) antes do deploy. Resultado: **0 capacidades perdidas**.
