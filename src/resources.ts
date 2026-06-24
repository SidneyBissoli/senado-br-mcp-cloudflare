/**
 * MCP Resources — static contextual data a user/agent can attach: an overview guide,
 * the tool catalog, a glossary of Senate acronyms, and the fixed reference tables.
 *
 * All resources are static (no upstream calls) so they are always available — which
 * keeps them reliable for marketplace validation. Registered per-request in server.ts
 * via registerResources(server). Content builders are exported for tests.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TIPOS_MATERIA, UFS } from "./tools/referencia.js";

/** Overview guide: what the server does and which tool group to reach for. */
export function buildGuia(): string {
  return `# Senado BR MCP — guia de uso

Servidor MCP de dados abertos do Senado Federal (API legislativa, API administrativa e portal
e-Cidadania). 66 ferramentas, respostas em pt-BR. Abaixo, por onde começar conforme o objetivo.

## Senadores
- \`senado_listar_senadores\` — lista/busca por nome, UF ou partido (use o filtro \`nome\` quando só tiver o nome).
- \`senado_obter_senador\` — dossiê biográfico + mandatos.
- \`senado_senador_historico\` — \`tipo\`: licencas | comissoes | cargos | historico-academico | filiacoes | profissoes.
- \`senado_votacoes_senador\` — votos nominais do parlamentar.

## Matérias, processos e votações
- \`senado_buscar_materias\` / \`senado_obter_materia\` (\`secao\`: detalhe | tramitacao | textos).
- \`senado_search_processos\` / \`senado_obter_processo\` / \`senado_processo_detalhe\` (\`secao\`: emendas | relatorias | prazos).
- \`senado_search_votacoes\` (por período/\`dias\`), \`senado_obter_votacao\`, \`senado_votos_materia\`.
- \`senado_votacao_comissao\` (\`por\`: comissao | senador | materia).

## Comissões e plenário
- \`senado_listar_comissoes\` / \`senado_obter_comissao\` (\`secao\`: resumo | membros) / agenda e reuniões.
- \`senado_agenda_plenario\`, \`senado_resultado_plenario\`, \`senado_orientacao_bancada\`, \`senado_vetos\`.

## Composição, discursos e legislação
- \`senado_listar_blocos\`, \`senado_liderancas\`, \`senado_mesa\` (\`casa\`: senado | congresso).
- \`senado_discursos_senador\` (\`tipo\`: discursos | apartes), \`senado_discursos_plenario\`, \`senado_discurso_texto\`.
- \`senado_buscar_legislacao\` / \`senado_obter_legislacao\`.

## Administrativo (transparência)
- \`senado_ceaps\` (cota parlamentar), \`senado_senadores_admin\`, \`senado_servidores\`,
  \`senado_remuneracoes_servidores\`, \`senado_contratos\`, \`senado_licitacoes\`, \`senado_execucao_orcamentaria\`.

## e-Cidadania (participação cidadã)
- \`senado_ecidadania_listar_consultas\` / \`_consultas_analise\` (consenso/polarização),
  \`_listar_ideias\`, \`_listar_eventos\`, \`_sugerir_tema_enquete\`.
- Acervo **histórico** de votos por UF: \`senado_ecidadania_consultas_votos\` (ranking por estado).

## Tabelas de referência
- \`senado_tabelas_referencia\` (\`tabela\`: tipos-materia | partidos | ufs | legislatura-atual | tipos-norma | tipos-uso-palavra).
- \`senado_tabelas_processo\`, \`senado_tabelas_plenario\`.

Dica: vários tools usam um parâmetro enum (\`secao\`/\`tipo\`/\`por\`/\`modo\`/\`tabela\`) para cobrir variações —
leia a descrição do tool para os valores aceitos.`;
}

/** Compact grouped catalog of all 66 tools. */
export function buildCatalogo(): string {
  return `# Catálogo de ferramentas (66)

A — Senadores (5): senado_listar_senadores, senado_obter_senador, senado_votacoes_senador, senado_senador_historico, senado_senadores_afastados
B — Matérias (2): senado_buscar_materias, senado_obter_materia
C — Processos (5): senado_search_processos, senado_obter_processo, senado_processo_detalhe, senado_autores_atuais, senado_tabelas_processo
D — Votações (3): senado_search_votacoes, senado_obter_votacao, senado_votos_materia
E — Comissões (7): senado_listar_comissoes, senado_obter_comissao, senado_reunioes_comissao, senado_agenda_comissoes, senado_reuniao_comissao, senado_requerimentos_cpi, senado_distribuicao_materias
F — Plenário (7): senado_agenda_plenario, senado_resultado_plenario, senado_orientacao_bancada, senado_vetos, senado_resultado_veto, senado_encontro_plenario, senado_tabelas_plenario
G — e-Cidadania (9): senado_ecidadania_listar_consultas, senado_ecidadania_obter_consulta, senado_ecidadania_consultas_analise, senado_ecidadania_listar_ideias, senado_ecidadania_obter_ideia, senado_ecidadania_listar_eventos, senado_ecidadania_obter_evento, senado_ecidadania_sugerir_tema_enquete, senado_ecidadania_consultas_votos
H — Referência (1): senado_tabelas_referencia
I — Discursos (3): senado_discursos_senador, senado_discursos_plenario, senado_discurso_texto
J — Composição (4): senado_listar_blocos, senado_obter_bloco, senado_liderancas, senado_mesa
K — Orçamento (1): senado_orcamento_parlamentar
L — Legislação (2): senado_buscar_legislacao, senado_obter_legislacao
M — Votação em comissão (1): senado_votacao_comissao
N — Taquigrafia (2): senado_notas_taquigraficas, senado_videos_taquigrafia
O — Senadores/Admin (2): senado_ceaps, senado_senadores_admin
P — Servidores (4): senado_servidores, senado_remuneracoes_servidores, senado_horas_extras, senado_pessoal_tabelas
Q — Contratações (6): senado_contratos, senado_contratacao_detalhe, senado_licitacoes, senado_terceirizados, senado_empresas_contratadas, senado_contratacoes_lista
R — Suprimento de fundos (1): senado_suprimento_fundos
S — Orçamento do Senado (1): senado_execucao_orcamentaria`;
}

/** Glossary of common Senate acronyms and terms. */
export function buildGlossario(): string {
  return `# Glossário — siglas e termos do Senado

## Tipos de proposição
- PEC — Proposta de Emenda à Constituição
- PL — Projeto de Lei (ordinária)
- PLP — Projeto de Lei Complementar
- MPV — Medida Provisória
- PDL — Projeto de Decreto Legislativo
- PRS — Projeto de Resolução do Senado
- PLC/PLS — Projeto de Lei da Câmara / do Senado (nomenclatura antiga)
- REQ/RQS — Requerimento (do Senado)
- SUG — Sugestão Legislativa (sociedade civil, via e-Cidadania)

## Comissões e plenário
- CCJ — Comissão de Constituição, Justiça e Cidadania
- CAE — Comissão de Assuntos Econômicos
- CPI — Comissão Parlamentar de Inquérito
- Mesa Diretora — órgão de direção (presidente, vices, secretários); SF = Senado, CN = Congresso
- RCN — Resolução do Congresso Nacional (a RCN 1/2013 mudou o rito de apreciação de vetos)
- Veto — rejeição (total/parcial) de projeto pelo Executivo, apreciada pelo Congresso

## Administrativo / transparência
- CEAPS — Cota para o Exercício da Atividade Parlamentar dos Senadores (cota de gastos)
- IPC / PSSC — planos de previdência do Congresso (aposentadoria de ex-parlamentares)
- Ata de registro de preço — compromisso de preços para compras futuras
- Nota de empenho — reserva orçamentária de um gasto

## Participação
- e-Cidadania — portal de participação: consultas públicas (voto sim/não), ideias legislativas e eventos interativos
- Legislatura — período de 4 anos; a 57ª vai de 2023 a 2027`;
}

export function registerResources(server: McpServer) {
  server.registerResource(
    "guia",
    "senado://guia",
    {
      title: "Guia de uso do Senado BR MCP",
      description: "Visão geral do servidor e qual ferramenta usar para cada objetivo.",
      mimeType: "text/markdown",
    },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: buildGuia() }] }),
  );

  server.registerResource(
    "catalogo",
    "senado://catalogo",
    {
      title: "Catálogo de ferramentas",
      description: "Lista das 66 ferramentas agrupadas por domínio.",
      mimeType: "text/markdown",
    },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: buildCatalogo() }] }),
  );

  server.registerResource(
    "glossario",
    "senado://glossario",
    {
      title: "Glossário do Senado",
      description: "Siglas e termos do processo legislativo e da administração do Senado.",
      mimeType: "text/markdown",
    },
    (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/markdown", text: buildGlossario() }] }),
  );

  server.registerResource(
    "tipos-materia",
    "senado://tabelas/tipos-materia",
    {
      title: "Tabela: tipos de matéria",
      description: "Siglas, nomes e descrições dos tipos de proposição legislativa.",
      mimeType: "application/json",
    },
    (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(TIPOS_MATERIA, null, 2) }],
    }),
  );

  server.registerResource(
    "ufs",
    "senado://tabelas/ufs",
    {
      title: "Tabela: unidades federativas",
      description: "As 27 UFs do Brasil (sigla e nome).",
      mimeType: "application/json",
    },
    (uri) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(UFS, null, 2) }],
    }),
  );
}
