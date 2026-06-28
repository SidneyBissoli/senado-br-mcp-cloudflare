/**
 * Eval fixtures — pt-BR queries from a journalist / researcher persona.
 *
 * Each fixture is a realistic question and the set of tool(s) that would correctly answer
 * its *first* step (the tool the model should pick first). `expectedTools` is a SET because
 * several queries have more than one defensible first call (e.g. a name-to-código lookup vs.
 * the detail tool); a prediction counts as correct if it lands on any member of the set.
 *
 * Coverage spans every functional area: senadores, votações nominais, matérias/processos,
 * CEAPS/gastos, comissões, plenário, discursos, legislação, vetos, e-Cidadania, contratos/
 * licitações, servidores, orçamento. Several fixtures are deliberately "neighbor"/ambiguous
 * cases (search vs. obter, votos_materia vs. votacoes_senador, listar vs. acervo) — the
 * hardest part of selecting among 66 tools.
 *
 * INVARIANT (enforced by tests/evals/fixtures.test.ts): every name in every `expectedTools`
 * must exist in the live catalog (so a tool rename breaks this offline test immediately),
 * 30 <= count <= 50, no duplicate ids, no duplicate queries.
 */

export interface EvalFixture {
  id: string;
  query: string;
  /** Acceptable first-call tools. A prediction is correct if it is in this set. */
  expectedTools: string[];
  note: string;
}

export const FIXTURES: EvalFixture[] = [
  // --- senadores ---------------------------------------------------------
  {
    id: "sen-01",
    query: "Quais senadores de Minas Gerais estão em exercício hoje?",
    expectedTools: ["senado_listar_senadores"],
    note: "Listagem com filtro de UF.",
  },
  {
    id: "sen-06",
    query: "Use o app Dados Abertos Senado BR. Liste os senadores em exercício e cite a fonte.",
    expectedTools: ["senado_listar_senadores"],
    note: "Prompt canário de demo do ChatGPT App: a primeira ação deve ser a listagem atual com proveniência.",
  },
  {
    id: "sen-02",
    query: "Me dá a biografia e os mandatos do senador Renan Calheiros.",
    expectedTools: ["senado_listar_senadores", "senado_obter_senador"],
    note: "Precisa do código antes do detalhe; listar (filtro nome) é o 1º passo legítimo.",
  },
  {
    id: "sen-03",
    query: "Quero o histórico de filiações partidárias do senador de código 4994.",
    expectedTools: ["senado_senador_historico"],
    note: "Histórico (filiações/profissões/licenças) é tool dedicada, não obter_senador.",
  },
  {
    id: "sen-04",
    query: "Quais senadores estão licenciados ou afastados do mandato atualmente?",
    expectedTools: ["senado_senadores_afastados"],
    note: "Neighbor de listar_senadores (que traz só em exercício).",
  },
  {
    id: "sen-05",
    query: "Como o senador Flávio Bolsonaro votou nas votações nominais deste ano?",
    expectedTools: ["senado_votacoes_senador", "senado_listar_senadores"],
    note: "votacoes_senador é o alvo; listar para resolver o código é aceitável como 1º passo.",
  },

  // --- matérias / processos ---------------------------------------------
  {
    id: "mat-01",
    query: "Procura projetos de lei sobre proteção de dados apresentados em 2023.",
    expectedTools: ["senado_buscar_materias", "senado_search_processos"],
    note: "Busca por palavra-chave/ano; processos é o vizinho v3.",
  },
  {
    id: "mat-02",
    query: "Qual a ementa e a situação atual da PEC 45 de 2019?",
    expectedTools: ["senado_buscar_materias"],
    note: "Sigla+número+ano → buscar para achar o codigoMateria antes do detalhe.",
  },
  {
    id: "mat-03",
    query: "Me mostra o histórico de tramitação da matéria de código 137211.",
    expectedTools: ["senado_obter_materia"],
    note: "Já tem o codigoMateria; secao=tramitacao em obter_materia.",
  },
  {
    id: "proc-01",
    query: "Detalha o processo legislativo de id 7654321, com objetivo e indexação.",
    expectedTools: ["senado_obter_processo"],
    note: "Detalhe de processo por id.",
  },
  {
    id: "proc-02",
    query: "Quais emendas foram apresentadas ao processo 8899001?",
    expectedTools: ["senado_processo_detalhe"],
    note: "secao=emendas; neighbor de obter_processo.",
  },
  {
    id: "proc-03",
    query: "Quem são os senadores que mais apresentaram matérias em tramitação?",
    expectedTools: ["senado_autores_atuais"],
    note: "Ranking de autores de processos em tramitação.",
  },
  {
    id: "proc-04",
    query: "Quais são os tipos de prazo e os códigos de situação usados nos processos legislativos?",
    expectedTools: ["senado_tabelas_processo"],
    note: "Tabela de referência consolidada de processos.",
  },

  // --- votações ----------------------------------------------------------
  {
    id: "vot-01",
    query: "Lista as votações do plenário do Senado nos últimos 30 dias.",
    expectedTools: ["senado_search_votacoes"],
    note: "Janela por dias; search é a porta de entrada.",
  },
  {
    id: "vot-02",
    query: "Como cada senador votou na votação de código de sessão 12345?",
    expectedTools: ["senado_obter_votacao"],
    note: "Votos nominais por código de sessão — neighbor de search_votacoes.",
  },
  {
    id: "vot-03",
    query: "Quais foram as votações da matéria 150999 e qual o placar de cada uma?",
    expectedTools: ["senado_votos_materia"],
    note: "Votações de uma matéria pelo codigoMateria.",
  },
  {
    id: "vot-04",
    query: "Como as lideranças partidárias orientaram o voto nas votações de 10/04/2024?",
    expectedTools: ["senado_orientacao_bancada"],
    note: "Orientação de bancada (disciplina partidária) — distinto de obter_votacao.",
  },

  // --- comissões ---------------------------------------------------------
  {
    id: "com-01",
    query: "Quais CPIs estão ativas no Senado agora?",
    expectedTools: ["senado_listar_comissoes"],
    note: "Listar comissões com tipo=cpi.",
  },
  {
    id: "com-02",
    query: "Quais são as próximas reuniões agendadas das comissões do Senado?",
    expectedTools: ["senado_agenda_comissoes"],
    note: "Agenda de comissões.",
  },
  {
    id: "com-03",
    query: "Lista os requerimentos da CPI do nome CPIMSC.",
    expectedTools: ["senado_requerimentos_cpi"],
    note: "Requerimentos por siglaCpi.",
  },
  {
    id: "com-04",
    query: "Quais senadores mais relataram matérias na Comissão de Constituição e Justiça?",
    expectedTools: ["senado_distribuicao_materias"],
    note: "Estatística de distribuição (autoria/relatoria) por comissão.",
  },
  {
    id: "com-05",
    query: "Detalha a composição e a presidência da comissão de sigla CAE.",
    expectedTools: ["senado_obter_comissao"],
    note: "Detalhe de comissão por sigla.",
  },

  // --- plenário ----------------------------------------------------------
  {
    id: "ple-01",
    query: "Qual a pauta da sessão do plenário do Senado para amanhã?",
    expectedTools: ["senado_agenda_plenario"],
    note: "Agenda/pauta — distinta de resultado.",
  },
  {
    id: "ple-02",
    query: "Quais itens foram apreciados no plenário em 15/05/2024 e com que resultado?",
    expectedTools: ["senado_resultado_plenario"],
    note: "Resultado das sessões numa data — neighbor de agenda_plenario.",
  },

  // --- vetos -------------------------------------------------------------
  {
    id: "vet-01",
    query: "Quais vetos presidenciais estão em tramitação no Congresso atualmente?",
    expectedTools: ["senado_vetos"],
    note: "Listagem de vetos.",
  },
  {
    id: "vet-02",
    query: "Qual foi o resultado da votação do veto de código 88?",
    expectedTools: ["senado_resultado_veto"],
    note: "Resultado de um veto específico — neighbor de senado_vetos.",
  },

  // --- discursos / taquigrafia ------------------------------------------
  {
    id: "dis-01",
    query: "Lista os pronunciamentos do senador de código 5012 neste ano.",
    expectedTools: ["senado_discursos_senador"],
    note: "Discursos por senador.",
  },
  {
    id: "dis-02",
    query: "Quero o texto integral do discurso de código 470123.",
    expectedTools: ["senado_discurso_texto"],
    note: "Texto completo de um discurso — neighbor de discursos_senador (que não traz texto).",
  },
  {
    id: "taq-01",
    query: "Me passa as notas taquigráficas da sessão plenária de id 9001.",
    expectedTools: ["senado_notas_taquigraficas"],
    note: "Transcrição oficial (taquigrafia).",
  },

  // --- legislação --------------------------------------------------------
  {
    id: "leg-01",
    query: "Encontra a Lei nº 14.133 de 2021 (nova lei de licitações).",
    expectedTools: ["senado_buscar_legislacao"],
    note: "Busca de norma federal por tipo/número/ano.",
  },
  {
    id: "leg-02",
    query: "Me dá o detalhe e o link do texto integral da norma de código 600123.",
    expectedTools: ["senado_obter_legislacao"],
    note: "Detalhe de norma por código — neighbor de buscar_legislacao.",
  },

  // --- blocos / lideranças / mesa ---------------------------------------
  {
    id: "blo-01",
    query: "Quais blocos parlamentares existem no Senado e que partidos os compõem?",
    expectedTools: ["senado_listar_blocos"],
    note: "Blocos e partidos.",
  },
  {
    id: "lid-01",
    query: "Quem são os líderes e vice-líderes partidários no Senado hoje?",
    expectedTools: ["senado_liderancas"],
    note: "Lideranças — neighbor de listar_blocos.",
  },
  {
    id: "mes-01",
    query: "Quem compõe a Mesa Diretora do Senado (presidente e secretários)?",
    expectedTools: ["senado_mesa"],
    note: "Mesa Diretora.",
  },

  // --- e-Cidadania -------------------------------------------------------
  {
    id: "eci-01",
    query: "Quais consultas públicas estão abertas no e-Cidadania para o cidadão votar sim ou não?",
    expectedTools: ["senado_ecidadania_listar_consultas"],
    note: "Consultas públicas abertas.",
  },
  {
    id: "eci-02",
    query: "Quais são as ideias legislativas mais apoiadas pelos cidadãos no e-Cidadania?",
    expectedTools: ["senado_ecidadania_listar_ideias"],
    note: "Ideias legislativas — neighbor de consultas.",
  },
  {
    id: "eci-03",
    query: "Quais eventos interativos (audiências, sabatinas) estão agendados no e-Cidadania?",
    expectedTools: ["senado_ecidadania_listar_eventos"],
    note: "Eventos do e-Cidadania.",
  },
  {
    id: "eci-04",
    query: "Quero o acervo histórico de votos das consultas públicas com a quebra por estado (UF).",
    expectedTools: ["senado_ecidadania_consultas_votos"],
    note: "Acervo histórico votos-por-UF — neighbor de listar_consultas (vivas).",
  },

  // --- CEAPS / gastos / contratos / servidores --------------------------
  {
    id: "cea-01",
    query: "Quanto cada senador gastou de cota parlamentar (CEAPS) em 2023?",
    expectedTools: ["senado_ceaps"],
    note: "Gasto CEAPS agregado por senador.",
  },
  {
    id: "con-01",
    query: "Quais contratos administrativos o Senado tem com a empresa de CNPJ 33.000.167/0001-01?",
    expectedTools: ["senado_contratos"],
    note: "Contratos por fornecedor/CNPJ.",
  },
  {
    id: "con-02",
    query: "Lista as licitações do Senado cujo objeto menciona serviços de limpeza.",
    expectedTools: ["senado_licitacoes"],
    note: "Licitações por objeto — neighbor de contratos.",
  },
  {
    id: "con-03",
    query: "Quais colaboradores terceirizados trabalham no Senado pela empresa X?",
    expectedTools: ["senado_terceirizados"],
    note: "Terceirizados.",
  },
  {
    id: "ser-01",
    query: "Qual o total de horas extras pagas a servidores do Senado em março de 2024?",
    expectedTools: ["senado_horas_extras"],
    note: "Horas extras — neighbor de remuneracoes_servidores.",
  },
  {
    id: "ser-02",
    query: "Qual a remuneração bruta média dos servidores do Senado em janeiro de 2024?",
    expectedTools: ["senado_remuneracoes_servidores"],
    note: "Remuneração de servidores.",
  },

  // --- orçamento ---------------------------------------------------------
  {
    id: "orc-01",
    query: "Quais emendas parlamentares os senadores fizeram ao orçamento da União?",
    expectedTools: ["senado_orcamento_parlamentar"],
    note: "Emendas parlamentares ao orçamento federal.",
  },
  {
    id: "orc-02",
    query: "Como está a execução orçamentária do próprio Senado (empenhado, liquidado e pago) em 2023?",
    expectedTools: ["senado_execucao_orcamentaria"],
    note: "Execução orçamentária da casa — neighbor de orcamento_parlamentar (que é emenda à União).",
  },
];
