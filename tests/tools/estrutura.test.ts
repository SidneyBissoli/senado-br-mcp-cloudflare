import { describe, it, expect } from "vitest";
import { normalizarNome } from "../../src/estrutura/normalizar.js";
import {
  construirIndice,
  resolverOrgao,
  sugerirOrgaos,
  subarvore,
  ancestrais,
  conjuntoCasamento,
  lotacaoNoConjunto,
  lotacaoReconhecida,
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
    expect(new Set(subarvore(indice, 2).map((o) => o.cod))).toEqual(new Set([2, 3, 4]));
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

describe("ehLotacaoParlamentar", () => {
  it("reconhece estrutura parlamentar e ignora administrativa", () => {
    expect(ehLotacaoParlamentar("Gabinete do Senador X")).toBe(true);
    expect(ehLotacaoParlamentar("Gabinete da Liderança do PT")).toBe(true);
    expect(ehLotacaoParlamentar("Escritório de Apoio 1 do Senador Y")).toBe(true);
    expect(ehLotacaoParlamentar("Serviço de Policiamento Externo")).toBe(false);
    expect(ehLotacaoParlamentar(null)).toBe(false);
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
  ];

  it("conta a subárvore (piso) e isola os não classificados administrativos", () => {
    const { sob, naoClassificados } = particionarPorUnidade(servidores, indice, 2);
    expect(sob.map((s) => s.nome).sort()).toEqual(["A", "B"]);
    // C está reconhecida (SGM) → fora de sob e fora de naoClassificados;
    // D é parlamentar → ignorada; só E (admin desconhecida) entra em naoClassificados.
    expect(naoClassificados.total).toBe(1);
    expect(naoClassificados.amostraUnidades).toEqual([{ nome: "Serviço Desconhecido X", quantidade: 1 }]);
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
});
