/**
 * Human-readable pt-BR titles for every registered tool.
 *
 * The Anthropic Connectors Directory review requires a `title` annotation on
 * each tool (alongside `readOnlyHint`). The central shim in `server.ts` injects
 * `annotations.title = TOOL_TITLES[name]` for each tool, so this map must stay
 * in sync with the 66 registered tools — the coverage test in
 * `tests/tool-titles.test.ts` fails if a registered tool is missing an entry.
 *
 * Titles are short, user-facing display labels (pt-BR), not descriptions.
 */
export const TOOL_TITLES: Record<string, string> = {
  // Senadores
  senado_listar_senadores: "Listar senadores",
  senado_obter_senador: "Detalhar senador",
  senado_votacoes_senador: "Votações de um senador",
  senado_senador_historico: "Histórico do senador",
  senado_senadores_afastados: "Senadores afastados",

  // Matérias
  senado_buscar_materias: "Buscar matérias legislativas",
  senado_obter_materia: "Detalhar matéria legislativa",

  // Votações
  senado_obter_votacao: "Detalhar votação",
  senado_votos_materia: "Votos de uma matéria",
  senado_search_votacoes: "Pesquisar votações",

  // Processos
  senado_search_processos: "Pesquisar processos",
  senado_obter_processo: "Detalhar processo",
  senado_processo_detalhe: "Detalhes do processo",
  senado_autores_atuais: "Autores em exercício",
  senado_tabelas_processo: "Tabelas de referência de processos",

  // Comissões
  senado_listar_comissoes: "Listar comissões",
  senado_obter_comissao: "Detalhar comissão",
  senado_reunioes_comissao: "Reuniões de comissão",
  senado_agenda_comissoes: "Agenda das comissões",
  senado_reuniao_comissao: "Detalhar reunião de comissão",
  senado_requerimentos_cpi: "Requerimentos de CPI",
  senado_distribuicao_materias: "Ranking de autoria/relatoria por comissão",

  // Plenário
  senado_agenda_plenario: "Agenda do plenário",
  senado_resultado_plenario: "Resultados do plenário",
  senado_orientacao_bancada: "Orientação de bancada",
  senado_vetos: "Vetos presidenciais",
  senado_resultado_veto: "Resultado de veto",
  senado_encontro_plenario: "Sessões do plenário",
  senado_tabelas_plenario: "Tabelas de referência do plenário",

  // e-Cidadania
  senado_ecidadania_listar_consultas: "Listar consultas públicas",
  senado_ecidadania_obter_consulta: "Detalhar consulta pública",
  senado_ecidadania_consultas_analise: "Análise de consultas públicas",
  senado_ecidadania_listar_ideias: "Listar ideias legislativas",
  senado_ecidadania_obter_ideia: "Detalhar ideia legislativa",
  senado_ecidadania_listar_eventos: "Listar eventos interativos",
  senado_ecidadania_obter_evento: "Detalhar evento interativo",
  senado_ecidadania_sugerir_tema_enquete: "Sugerir tema de enquete",
  senado_ecidadania_consultas_votos: "Votos em consultas por UF",

  // Discursos
  senado_discursos_senador: "Discursos de um senador",
  senado_discursos_plenario: "Discursos no plenário",
  senado_discurso_texto: "Texto de um discurso",

  // Composição (blocos, lideranças, mesa)
  senado_listar_blocos: "Listar blocos parlamentares",
  senado_obter_bloco: "Detalhar bloco parlamentar",
  senado_liderancas: "Lideranças partidárias",
  senado_mesa: "Mesa Diretora",

  // Legislação
  senado_buscar_legislacao: "Buscar legislação federal",
  senado_obter_legislacao: "Detalhar norma legal",

  // Taquigrafia
  senado_notas_taquigraficas: "Notas taquigráficas",
  senado_videos_taquigrafia: "Vídeos da taquigrafia",

  // Votação em comissão
  senado_votacao_comissao: "Votações em comissão",

  // Referência
  senado_tabelas_referencia: "Tabelas de referência",

  // Senadores / Administrativo
  senado_ceaps: "Gastos CEAPS (cota parlamentar)",
  senado_senadores_admin: "Senadores (dados administrativos)",

  // Servidores / Gestão de pessoas
  senado_servidores: "Servidores do Senado",
  senado_remuneracoes_servidores: "Remuneração de servidores",
  senado_horas_extras: "Horas extras de servidores",
  senado_pessoal_tabelas: "Tabelas de gestão de pessoas",

  // Contratações
  senado_contratos: "Contratos do Senado",
  senado_contratacao_detalhe: "Detalhar contratação",
  senado_licitacoes: "Licitações do Senado",
  senado_terceirizados: "Terceirizados",
  senado_empresas_contratadas: "Empresas contratadas",
  senado_contratacoes_lista: "Listar contratações",

  // Suprimento de fundos
  senado_suprimento_fundos: "Suprimento de fundos",

  // Orçamento parlamentar (emendas)
  senado_orcamento_parlamentar: "Orçamento parlamentar (emendas)",

  // Orçamento do Senado
  senado_execucao_orcamentaria: "Execução orçamentária do Senado",

  // Estrutura organizacional
  senado_estrutura_organizacional: "Estrutura organizacional",
};

/**
 * Fallback title for a tool with no explicit entry — returns the tool name so a
 * newly added tool still ships a non-empty `title` while the map catches up.
 */
export function titleForTool(name: string): string {
  return TOOL_TITLES[name] ?? name;
}
