import { describe, it, expect } from "vitest";
import { normalizarNome, tokenizarNome } from "../../src/estrutura/normalizar.js";
import {
  construirIndice,
  resolverOrgao,
  sugerirOrgaos,
  subarvore,
  ancestrais,
  conjuntoCasamento,
  lotacaoNoConjunto,
  lotacaoReconhecida,
  casamentoPorTokens,
  casarLotacaoAproximado,
  casarLotacaoPorSufixoAncestral,
  aliasesDeSiglasDoCadastro,
  ehPseudoUnidadeSituacional,
  ehLotacaoParlamentar,
} from "../../src/estrutura/resolver.js";
import { ESTRUTURA_ORGANIZACIONAL } from "../../src/data/estrutura-organizacional.js";
import { parseServidor, particionarPorUnidade } from "../../src/tools/servidores.js";
import { indiceEstrutura } from "../../src/tools/estrutura.js";
import type { OrgaoNode } from "../../src/estrutura/tipos.js";

/** Árvore sintética: SF → {DGER → SEGRAF → Núcleo folha; SGM → Serviço folha}. */
const ARVORE: OrgaoNode[] = [
  { cod: 1, sigla: "SF", nome: "Senado Federal", codSuperior: null },
  { cod: 2, sigla: "DGER", nome: "Diretoria-Geral", codSuperior: 1 },
  { cod: 3, sigla: "SEGRAF", nome: "Secretaria de Editoração e Publicações", codSuperior: 2 },
  { cod: 4, sigla: null, nome: "Núcleo de Atendimento da SEGRAF", codSuperior: 3 },
  { cod: 5, sigla: "SGM", nome: "Secretaria Geral da Mesa", codSuperior: 1 },
  { cod: 6, sigla: null, nome: "Serviço de Registro de Plenário", codSuperior: 5 },
  // Nós para o casamento aproximado (abreviação/truncamento/sigla-no-nome/ambiguidade):
  { cod: 7, sigla: null, nome: "Gabinete da Diretoria Geral", codSuperior: 2 },
  { cod: 8, sigla: null, nome: "Coordenação de Projetos e Obras de Infraestrutura", codSuperior: 2 },
  { cod: 9, sigla: null, nome: "Serviço de Apoio à Comissão de Educação", codSuperior: 5 },
  { cod: 10, sigla: null, nome: "Serviço de Apoio à Comissão de Meio Ambiente", codSuperior: 2 },
];

describe("normalizarNome", () => {
  it("remove acentos, caixa, pontuação e stopwords", () => {
    expect(normalizarNome("Diretoria-Geral")).toBe("diretoria geral");
    expect(normalizarNome("Secretaria de Editoração e Publicações")).toBe("secretaria editoracao publicacoes");
    expect(normalizarNome("  Núcleo   de  Atendimento  ")).toBe("nucleo atendimento");
  });
  it("é estável para entrada vazia", () => {
    expect(normalizarNome(null)).toBe("");
    expect(normalizarNome(undefined)).toBe("");
  });
  it("tokenizarNome expõe os tokens que normalizarNome junta", () => {
    expect(tokenizarNome("Coord. de Projetos e Obras de Infraestrutura")).toEqual([
      "coord", "projetos", "obras", "infraestrutura",
    ]);
    expect(tokenizarNome(null)).toEqual([]);
  });
});

describe("resolver — árvore sintética", () => {
  const indice = construirIndice(ARVORE);

  it("resolve por sigla (case-insensitive) e por nome normalizado", () => {
    expect(resolverOrgao(indice, "dger")?.cod).toBe(2);
    expect(resolverOrgao(indice, "DGER")?.cod).toBe(2);
    expect(resolverOrgao(indice, "diretoria geral")?.cod).toBe(2);
    expect(resolverOrgao(indice, "Diretoria-Geral")?.cod).toBe(2);
    expect(resolverOrgao(indice, "inexistente")).toBeNull();
  });

  it("subárvore inclui todos os descendentes e o próprio", () => {
    expect(new Set(subarvore(indice, 2).map((o) => o.cod))).toEqual(new Set([2, 3, 4, 7, 8, 10]));
    expect(subarvore(indice, 4).map((o) => o.cod)).toEqual([4]); // folha
  });

  it("ancestrais vão do superior imediato até a raiz", () => {
    expect(ancestrais(indice, 4).map((o) => o.sigla ?? o.nome)).toEqual(["SEGRAF", "DGER", "SF"]);
    expect(ancestrais(indice, 1)).toEqual([]); // raiz
  });

  it("conjunto de casamento cobre nomes (inclusive folhas sem sigla) e siglas da subárvore", () => {
    const conj = conjuntoCasamento(indice, 2);
    expect(conj.siglas).toEqual(new Set(["DGER", "SEGRAF"]));
    expect(conj.nomes.has(normalizarNome("Núcleo de Atendimento da SEGRAF"))).toBe(true);
    expect(conj.nomes.has(normalizarNome("Serviço de Registro de Plenário"))).toBe(false);
  });

  it("lotacaoNoConjunto casa por sigla OU por nome (folha profunda sem sigla)", () => {
    const conj = conjuntoCasamento(indice, 2);
    expect(lotacaoNoConjunto(conj, { sigla: "SEGRAF", nome: "Secretaria de Editoração e Publicações" })).toBe(true);
    expect(lotacaoNoConjunto(conj, { sigla: null, nome: "Núcleo de Atendimento da SEGRAF" })).toBe(true);
    expect(lotacaoNoConjunto(conj, { sigla: "SGM", nome: "Secretaria Geral da Mesa" })).toBe(false);
    expect(lotacaoNoConjunto(conj, null)).toBe(false);
  });

  it("lotacaoReconhecida distingue unidade da árvore de unidade desconhecida", () => {
    expect(lotacaoReconhecida(indice, { sigla: null, nome: "Serviço de Registro de Plenário" })).toBe(true);
    expect(lotacaoReconhecida(indice, { sigla: null, nome: "Serviço Fantasma" })).toBe(false);
  });

  it("sugere unidades por sigla/nome parcial", () => {
    const s = sugerirOrgaos(indice, "secretaria");
    expect(s.map((o) => o.sigla)).toContain("SEGRAF");
    expect(s.map((o) => o.sigla)).toContain("SGM");
  });
});

describe("casamentoPorTokens", () => {
  it("casa token exato, abreviação-prefixo e truncamento (lotação com menos tokens)", () => {
    expect(casamentoPorTokens(["coord", "projetos"], ["coordenacao", "projetos", "obras"]))
      .toEqual({ chars: 13, skips: 0, cobreTudo: false });
    expect(casamentoPorTokens(["coordenacao", "projetos"], ["coordenacao", "projetos"]))
      .toEqual({ chars: 19, skips: 0, cobreTudo: true });
  });
  it("salta tokens do nó que o cadastro omite (preposição/palavra), com contagem de saltos", () => {
    // "Serv. de Apoio a Contratações de Tecnologia" ↔ "…Contratações EM Tecnologia"
    expect(casamentoPorTokens(["servico", "apoio", "contratacoes", "tecnologia"],
      ["servico", "apoio", "contratacoes", "em", "tecnologia"]))
      .toEqual({ chars: 34, skips: 1, cobreTudo: false });
    // "Serv. de C. de Qual e Mon…" ↔ "Serviço de CONTROLE de Qualidade e Monitoração…"
    expect(casamentoPorTokens(["serv", "qual", "mon"], ["servico", "controle", "qualidade", "monitoracao"]))
      .toEqual({ chars: 11, skips: 1, cobreTudo: false });
  });
  it("o primeiro token é âncora (não salta) e tokens de 1 char da lotação são ignorados", () => {
    expect(casamentoPorTokens(["qualidade", "monitoracao"], ["servico", "qualidade", "monitoracao"])).toBeNull();
    expect(casamentoPorTokens(["servico", "p", "areas"], ["servico", "para", "areas"]))
      .toEqual({ chars: 12, skips: 1, cobreTudo: false }); // "p" ignorado; "para" saltado
  });
  it("dígitos são preservados e casam pelo valor (Escritório de Apoio 2 ↔ Nº 02, nunca Nº 01)", () => {
    expect(casamentoPorTokens(["escritorio", "apoio", "2", "senador"], ["escritorio", "apoio", "n", "02", "senador"]))
      .toEqual({ chars: 23, skips: 1, cobreTudo: false });
    expect(casamentoPorTokens(["escritorio", "apoio", "2", "senador"], ["escritorio", "apoio", "n", "01", "senador"]))
      .toBeNull();
  });

  it("tolera plural da lotação sobre singular do nó", () => {
    expect(casamentoPorTokens(["servico", "expedicao", "remessas"], ["servico", "expedicao", "remessa"]))
      .toEqual({ chars: 24, skips: 0, cobreTudo: true });
  });
  it("rejeita token que não é prefixo, só-1-char e lotação mais longa que o nó", () => {
    expect(casamentoPorTokens(["coord", "obras"], ["coordenacao", "projetos"])).toBeNull();
    expect(casamentoPorTokens(["c", "projetos"], ["coordenacao", "projetos"])).toBeNull(); // "projetos" vira âncora e não casa
    expect(casamentoPorTokens(["c"], ["coordenacao"])).toBeNull(); // só tokens de 1 char = sem sinal
    expect(casamentoPorTokens(["coordenacao", "projetos", "obras"], ["coordenacao", "projetos"])).toBeNull();
    expect(casamentoPorTokens([], ["coordenacao"])).toBeNull();
  });
});

describe("casarLotacaoAproximado — árvore sintética", () => {
  const indice = construirIndice(ARVORE);

  it("casa nome abreviado por prefixo de token (inequívoco)", () => {
    const c = casarLotacaoAproximado(indice, { nome: "Coord. de Projetos e Obras de Infraestrutura" });
    expect(c?.metodo).toBe("prefixo");
    expect(c?.orgaos.map((o) => o.cod)).toEqual([8]);
  });

  it("casa nome truncado em largura fixa (corte no meio do token)", () => {
    const c = casarLotacaoAproximado(indice, { nome: "Coordenação de Projetos e Obras de Infraestr" });
    expect(c?.orgaos.map((o) => o.cod)).toEqual([8]);
  });

  it("expande sigla em caixa-alta no nome para o extenso (Gabinete da DGER)", () => {
    const c = casarLotacaoAproximado(indice, { nome: "Gabinete da DGER" });
    expect(c?.metodo).toBe("sigla-extenso");
    expect(c?.orgaos.map((o) => o.cod)).toEqual([7]);
  });

  it("não expande palavra comum que coincide com sigla (caixa-alta obrigatória)", () => {
    // "Sf" minúsculo/misto não é tratado como a sigla SF.
    expect(casarLotacaoAproximado(indice, { nome: "Oficina do sf" })).toBeNull();
  });

  it("empate entre dois nós devolve os dois candidatos (ambíguo — ninguém chuta)", () => {
    const c = casarLotacaoAproximado(indice, { nome: "Serviço de Apoio à Comissão de" });
    expect(c?.metodo).toBe("prefixo");
    expect(new Set(c?.orgaos.map((o) => o.cod))).toEqual(new Set([9, 10]));
  });

  it("desempata quando um token distingue os candidatos", () => {
    const c = casarLotacaoAproximado(indice, { nome: "Serv. de Apoio à Com. de Meio Amb" });
    expect(c?.orgaos.map((o) => o.cod)).toEqual([10]);
  });

  it("guardas de especificidade: nome curto demais ou genérico não casa", () => {
    expect(casarLotacaoAproximado(indice, { nome: "Serv. de Ap." })).toBeNull(); // < 10 chars
    expect(casarLotacaoAproximado(indice, { nome: "Setor Totalmente Desconhecido da Casa" })).toBeNull();
    expect(casarLotacaoAproximado(indice, null)).toBeNull();
  });
});

describe("ehLotacaoParlamentar", () => {
  it("reconhece estrutura parlamentar e ignora administrativa", () => {
    expect(ehLotacaoParlamentar("Gabinete do Senador X")).toBe(true);
    expect(ehLotacaoParlamentar("Gabinete da Liderança do PT")).toBe(true);
    expect(ehLotacaoParlamentar("Escritório de Apoio 1 do Senador Y")).toBe(true);
    expect(ehLotacaoParlamentar("Serviço de Policiamento Externo")).toBe(false);
    expect(ehLotacaoParlamentar(null)).toBe(false);
  });
});

describe("ehPseudoUnidadeSituacional", () => {
  it("reconhece as situações funcionais do cadastro e nada além delas", () => {
    expect(ehPseudoUnidadeSituacional("Servidores Afastados - SF")).toBe(true);
    expect(ehPseudoUnidadeSituacional("Servidores em Trânsito - SF")).toBe(true);
    expect(ehPseudoUnidadeSituacional("Serviço de Apoio a Servidores Afastados")).toBe(false);
    expect(ehPseudoUnidadeSituacional("Coordenação de Trânsito")).toBe(false);
    expect(ehPseudoUnidadeSituacional(null)).toBe(false);
  });
});

describe("particionarPorUnidade", () => {
  const indice = construirIndice(ARVORE);
  const servidores = [
    parseServidor({ nome: "A", lotacao: { sigla: "SEGRAF", nome: "Secretaria de Editoração e Publicações" } }),
    parseServidor({ nome: "B", lotacao: { sigla: null, nome: "Núcleo de Atendimento da SEGRAF" } }), // folha sob DGER
    parseServidor({ nome: "C", lotacao: { sigla: "SGM", nome: "Secretaria Geral da Mesa" } }), // outra área, reconhecida
    parseServidor({ nome: "D", lotacao: { sigla: null, nome: "Gabinete do Senador Z" } }), // parlamentar não reconhecida
    parseServidor({ nome: "E", lotacao: { sigla: null, nome: "Serviço Desconhecido X" } }), // admin não reconhecida
    parseServidor({ nome: "F", lotacao: { sigla: null, nome: "Coord. de Projetos e Obras de Infraestrutura" } }), // abreviada, sob DGER
    parseServidor({ nome: "G", lotacao: { sigla: null, nome: "Serviço de Apoio à Comissão de" } }), // truncada AMBÍGUA (nós 9 fora e 10 dentro)
    parseServidor({ nome: "H", lotacao: { sigla: null, nome: "Serv. de Apoio à Com. de Educação" } }), // abreviada, resolvida FORA (SGM)
    parseServidor({ nome: "I", lotacao: { sigla: null, nome: "Gabinete da DGER" } }), // sigla no nome, sob DGER
    parseServidor({ nome: "J", lotacao: { sigla: "NSASF", nome: "Servidores Afastados - SF" } }), // pseudo-unidade situacional
  ];

  it("conta a subárvore (piso) e isola os não classificados administrativos", () => {
    const { sob, naoClassificados, afastadosOuEmTransito } = particionarPorUnidade(servidores, indice, 2);
    // A/B exatos; F recuperado por abreviação; I por sigla→extenso (mesmo com cara de 'gabinete').
    expect(sob.map((s) => s.nome).sort()).toEqual(["A", "B", "F", "I"]);
    // C exata fora e H aproximada fora → excluídas sem ruído; D parlamentar → ignorada;
    // E (desconhecida) e G (ambígua entre dentro/fora) entram em naoClassificados;
    // J (situação funcional, lotação real não publicada) ganha rótulo próprio.
    expect(naoClassificados.total).toBe(2);
    expect(naoClassificados.amostraUnidades.map((u) => u.nome).sort()).toEqual([
      "Serviço Desconhecido X",
      "Serviço de Apoio à Comissão de",
    ]);
    expect(afastadosOuEmTransito).toBe(1);
  });
});

describe("snapshot real da estrutura organizacional", () => {
  const indice = indiceEstrutura();

  it("tem árvore consistente e resolve a DGER", () => {
    expect(ESTRUTURA_ORGANIZACIONAL.orgaos.length).toBeGreaterThan(300);
    const dger = resolverOrgao(indice, "DGER");
    expect(dger).not.toBeNull();
    expect(subarvore(indice, dger!.cod).length).toBeGreaterThan(100);
  });

  it("inclui as Diretorias-Executivas (DIREG/DIRECON/DIRETEC) sob a DGER", () => {
    const dger = resolverOrgao(indice, "DGER")!;
    const nomesSub = subarvore(indice, dger.cod).map((o) => o.nome.toLowerCase());
    const executivas = nomesSub.filter((n) => n.includes("diretoria-executiva") || n.includes("diretoria executiva"));
    expect(executivas.length).toBeGreaterThanOrEqual(3);
  });

  it("uma secretaria da DGER (SEGRAF) tem a DGER na cadeia de ancestrais", () => {
    const segraf = resolverOrgao(indice, "SEGRAF");
    expect(segraf).not.toBeNull();
    const siglas = ancestrais(indice, segraf!.cod).map((o) => o.sigla);
    expect(siglas).toContain("DGER");
  });

  it("recupera lotações truncadas/abreviadas reais do cadastro de servidores (inequívocas)", () => {
    // Pares (lotação como vem no cadastro → nome por extenso no organograma) do diagnóstico 09/07.
    const casos: Array<[string, string]> = [
      ["Coord. de Projetos e Obras de Infraestrutura", "Coordenação de Projetos e Obras de Infraestrutura"],
      ["Núcleo de Quali. e Padron. de Proc. e Prod. de Sof", "Núcleo de Qualidade e Padronização de Processos e Produtos de Software"],
      ["Serv. de Promoção à Saúde e Segurança do Trabalho", "Serviço de Promoção à Saúde e Segurança do Trabalho"],
      ["Sec. de Apoio à Com. de Const. Just. e Cidadania", "Secretaria de Apoio à Comissão de Constituição, Justiça e Cidadania"],
      ["Serv de Soluções para Áreas Téc. e Administrativas", "Serviço de Soluções Para Áreas Técnicas e Administrativas"],
      ["Escr. Corporativo de Gov. e Gestão Estratégica", "Escritório Corporativo de Governança e Gestão Estratégica"],
      ["Núcleo de Inst. e Gestão de Contratos de Inf.e Doc", "Núcleo de Instrução e Gestão de Contratos de Informação e Documentação"],
    ];
    for (const [lotacao, esperado] of casos) {
      const c = casarLotacaoAproximado(indice, { nome: lotacao });
      expect(c, lotacao).not.toBeNull();
      expect(c!.orgaos.map((o) => o.nome), lotacao).toEqual([esperado]);
    }
  });

  it("recupera as abreviações irregulares do cadastro validadas pelo mantenedor (10/07)", () => {
    // Pares reais (lotação do cadastro → nó da árvore), subordinação confirmada à mão:
    // PRDSTI/SEGRAF/SADCON (DGER), AUDIT e SECOM (fora da DGER).
    const casos: Array<[string, string]> = [
      // "T.I."/"TI" → Tecnologia da Informação
      ["Núcleo de Segurança da Informação em T.I.", "Núcleo de Segurança da Informação Em Tecnologia da Informação"],
      ["Serviço de Auditoria de Operações de TI", "Serviço de Auditoria de Operações de Tecnologia da Informação"],
      ["Serviço de Auditoria de Gestão de TI", "Serviço de Auditoria de Gestão de Tecnologia da Informação"],
      // contração "Prc." (não é prefixo de "Processo")
      ["Serviço de Soluções para o Prc. Leg. Eletrônico", "Serviço de Soluções Para O Processo Legislativo Eletrônico"],
      // "p/" vira token de 1 char (ignorado) + salto de "Para"
      ["Serv. de Soluçoes p/ a Ativ. Parla. e Consultorias", "Serviço de Soluções Para a Atividade Parlamentar e Consultorias"],
      ["Serv. de Soluç. p/ Áreas de Info., Doc. e Com. Soc", "Serviço de Soluções Para Áreas de Informação, documentação e Comunicação Social"],
      // plural do cadastro sobre singular do nó
      ["Serviço de Expedição e Remessas", "Serviço de Expedição e Remessa"],
      // "de" (stopword) na lotação × "Em" (não-stopword) no nó → salto
      ["Serviço de Apoio a Contratações de Tecnologia", "Serviço de Apoio a Contratações Em Tecnologia"],
      // "C." de 1 char ignorado + salto de "Controle"
      ["Serv. de C. de Qual e Mon. da Plat. de Tec. da Inf", "Serviço de Controle de Qualidade e Monitoração da Plataforma de Tecnologia da Informação"],
    ];
    for (const [lotacao, esperado] of casos) {
      const c = casarLotacaoAproximado(indice, { nome: lotacao });
      expect(c, lotacao).not.toBeNull();
      expect(c!.orgaos.map((o) => o.nome), lotacao).toEqual([esperado]);
    }
  });

  it("complemento do Congresso Nacional: raiz própria, fora do SF, casada por sigla", () => {
    // Os cods fixos do complemento não colidem com o snapshot do portal.
    const codsSnapshot = new Set(ESTRUTURA_ORGANIZACIONAL.orgaos.map((o) => o.cod));
    for (const cod of [-900000, -900001, -900002, -900003]) expect(codsSnapshot.has(cod)).toBe(false);

    const cn = resolverOrgao(indice, "CN")!;
    expect(cn.nome).toBe("Congresso Nacional");
    expect(subarvore(indice, cn.cod).map((o) => o.sigla).sort()).toEqual(["CMMC", "CMO", "CN", "CPCMS"]);
    // CMO resolve e seu caminho é o CN — nunca o Senado/DGER.
    const cmo = resolverOrgao(indice, "CMO")!;
    expect(ancestrais(indice, cmo.cod).map((o) => o.sigla)).toEqual(["CN"]);
    const dger = resolverOrgao(indice, "DGER")!;
    expect(new Set(subarvore(indice, dger.cod).map((o) => o.cod)).has(cmo.cod)).toBe(false);
    // A lotação do cadastro (nome truncado, sigla exata) é reconhecida e cai sob o CN.
    const lot = { sigla: "CMO", nome: "Com. Mista de Plan. Orç. Públicos e Fiscalização" };
    expect(lotacaoReconhecida(indice, lot)).toBe(true);
    expect(lotacaoNoConjunto(conjuntoCasamento(indice, cn.cod), lot)).toBe(true);
    expect(lotacaoNoConjunto(conjuntoCasamento(indice, dger.cod), lot)).toBe(false);
  });

  it("expande abreviação institucional CN → Congresso Nacional (COSEC)", () => {
    const c = casarLotacaoAproximado(indice, { nome: "Coordenação de Sessões e Colegiados do CN" });
    expect(c?.metodo).toBe("sigla-extenso");
    expect(c?.orgaos.map((o) => o.nome)).toEqual(["Coordenação de Sessões e Colegiados do Congresso Nacional"]);
  });

  it("resolve 'Gabinete da DGER' para o Gabinete da Diretoria Geral (sob a DGER)", () => {
    const c = casarLotacaoAproximado(indice, { nome: "Gabinete da DGER" });
    expect(c?.metodo).toBe("sigla-extenso");
    expect(c?.orgaos).toHaveLength(1);
    const dger = resolverOrgao(indice, "DGER")!;
    const codsDger = new Set(subarvore(indice, dger.cod).map((o) => o.cod));
    expect(codsDger.has(c!.orgaos[0].cod)).toBe(true);
  });

  it("núcleos da CONLEG/CONORF entraram na árvore como nós sintéticos, sob os pais certos (problema 2)", () => {
    // O portal só os publica link-less nas páginas da CONLEG/CONORF; o crawler os materializa
    // com cod negativo. Casamento agora é EXATO e a subárvore da consultoria os contém.
    const conleg = resolverOrgao(indice, "CONLEG")!;
    const conjunto = conjuntoCasamento(indice, conleg.cod);
    for (const nome of ["Núcleo de Políticas Econômicas", "Núcleo de Direito dos Negócios"]) {
      expect(lotacaoReconhecida(indice, { nome }), nome).toBe(true);
      expect(lotacaoNoConjunto(conjunto, { nome }), nome).toBe(true);
    }
    const conorf = resolverOrgao(indice, "CONORF")!;
    const nomesConorf = subarvore(indice, conorf.cod).map((o) => o.nome);
    expect(nomesConorf).toContain("Núcleo de Receita Pública, Macroeconomia e Política Fiscal");
    // Neto (indentação 50px na página): serviço sob um núcleo sintético.
    expect(nomesConorf).toContain("Serviço de Gestão dos Sistemas Orçamentários");
  });

  it("lotações truncadas do cadastro casam com os nós sintéticos (aproximado, inequívoco)", () => {
    const conorf = resolverOrgao(indice, "CONORF")!;
    const codsConorf = new Set(subarvore(indice, conorf.cod).map((o) => o.cod));
    const c = casarLotacaoAproximado(indice, { nome: "Núcleo de Rec. Púb. Macroecon. e Política Fiscal" });
    expect(c?.orgaos.map((o) => o.nome)).toEqual(["Núcleo de Receita Pública, Macroeconomia e Política Fiscal"]);
    expect(codsConorf.has(c!.orgaos[0].cod)).toBe(true);
  });

  it("sufixo-ancestral: unidade genérica qualificada pela sigla do pai resolve dentro da subárvore certa", () => {
    // "Assessoria Técnica" existe 10× na árvore; o sufixo desambigua. SGM/SCOM têm sigla na árvore.
    const casos: Array<[string, string, string]> = [
      ["Assessoria Técnico-Legislativa da SGM", "SGM", "Assessoria Técnico-Legislativa"],
      ["Coordenação-Geral da SCOM", "SCOM", "Coordenação-Geral"],
      ["Serviço de Reportagem da SRSF", "SRSF", "Serviço de Reportagem"],
    ];
    for (const [lotacao, siglaPai, esperado] of casos) {
      const c = casarLotacaoPorSufixoAncestral(indice, { nome: lotacao });
      expect(c?.metodo, lotacao).toBe("sufixo-ancestral");
      expect(c?.orgaos.map((o) => o.nome), lotacao).toEqual([esperado]);
      const pai = resolverOrgao(indice, siglaPai)!;
      const cods = new Set(subarvore(indice, pai.cod).map((o) => o.cod));
      expect(cods.has(c!.orgaos[0].cod), lotacao).toBe(true);
    }
  });

  it("sufixo-ancestral com sigla que a árvore não tem usa aliases derivados do cadastro (DIREG)", () => {
    // Sem alias, a sigla DIREG é desconhecida → null. Com o par {DIREG, Diretoria-Executiva de
    // Gestão} visto no cadastro, "Assessoria Técnica da DIREG" resolve no nó certo (há 10 homônimas).
    const lot = { sigla: "ATEC", nome: "Assessoria Técnica da DIREG" };
    expect(casarLotacaoPorSufixoAncestral(indice, lot)).toBeNull();
    const aliases = aliasesDeSiglasDoCadastro(indice, [
      { sigla: "DIREG", nome: "Diretoria-Executiva de Gestão" },
    ]);
    expect(aliases.get("DIREG")?.nome).toBe("Diretoria-Executiva de Gestão");
    const c = casarLotacaoPorSufixoAncestral(indice, lot, aliases);
    expect(c?.orgaos).toHaveLength(1);
    expect(c?.orgaos[0].nome).toBe("Assessoria Técnica");
    expect(ancestrais(indice, c!.orgaos[0].cod).map((o) => o.nome)).toContain("Diretoria-Executiva de Gestão");
  });

  it("aliases do cadastro: resolve nome truncado, ignora sigla já conhecida e descarta conflito", () => {
    const aliases = aliasesDeSiglasDoCadastro(indice, [
      // Nome abreviado no cadastro → casa aproximado inequívoco com a Diretoria-Executiva.
      { sigla: "DIRECON", nome: "Diretoria-Executiva de Gov. Contrat. e Licitatória" },
      // Sigla que a árvore já tem: não vira alias.
      { sigla: "SGM", nome: "Secretaria-Geral da Mesa" },
      // Mesma sigla apontando para dois nós diferentes: descartada (não chuta).
      { sigla: "XCONF", nome: "Diretoria-Executiva de Gestão" },
      { sigla: "XCONF", nome: "Consultoria Legislativa" },
      null,
    ]);
    expect(aliases.get("DIRECON")?.nome).toBe("Diretoria-Executiva de Governança Contratual e Licitatória");
    expect(aliases.has("SGM")).toBe(false);
    expect(aliases.has("XCONF")).toBe(false);
  });
});
