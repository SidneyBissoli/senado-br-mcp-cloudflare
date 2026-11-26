/**
 * E1.c — tabelas `vinculos/materias` e `vinculos/autores` (`scripts/publicacao/vinculos.ts`), montadas
 * de observações reais: as respostas recortadas em `tests/fixtures/autoria-2026-11/` passam pelo leitor
 * (`fatos-autoria.ts`) e pela fusão, como no job.
 */

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { leiturasAutoria } from "../../scripts/observacoes/fatos-autoria.js";
import type { LinhaC5 } from "../../scripts/observacoes/fatos-c5.js";
import { fundir, type Leitura } from "../../scripts/observacoes/fundir.js";
import { confereComPortal, tabelasDosVinculos, type ItensDoECidadania } from "../../scripts/publicacao/vinculos.js";

const F = "tests/fixtures/autoria-2026-11";
const S = "https://legis.senado.leg.br/dadosabertos";
const CD = "https://dadosabertos.camara.leg.br/api/v2/proposicoes/2295936/autores";

let n = 0;
function leitura(url: string, corpo: string, status = 200, instante = "2026-11-25T19:38:20.000Z"): Leitura[] {
  n++;
  const l: LinhaC5 = { id: n, url, entity_id: null, instante, status_http: status, sha256: n.toString(16).padStart(64, "0") };
  return leiturasAutoria(l, corpo, { foraDoMolde: 0 });
}
const ler = (x: string) => readFileSync(`${F}/${x}`, "utf8");

function obsReais() {
  n = 0;
  return fundir([], [
    ...leitura(`${S}/processo?codigoMateria=176514`, ler("lista-176514.json")),
    ...leitura(`${S}/processo/9133965`, ler("processo-9133965.json")),
    ...leitura(CD, ler("camara-2295936-autores.json")),
    ...leitura(`${S}/processo?codigoMateria=555`, "[]"),
    ...leitura(`${S}/processo?codigoMateria=404`, "", 404),
  ]);
}

const itens: ItensDoECidadania = {
  consultas: [{ id: "176514", autoria: "Câmara dos Deputados" }, { id: "555", autoria: null }, { id: "777", autoria: "Senador X (P/UF)" }],
  proposicoes: [
    { id: "10", url: "https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=2295936" },
    { id: "10", url: "https://www25.senado.leg.br/web/atividade/materias/-/materia/176514" },
    { id: "11", url: "https://exemplo.org/sem-codigo" },
  ],
  acervo: [{ codigo: "404" }],
};

describe("confereComPortal (vigia da decisão 4)", () => {
  it("igual, ou o resumo começa pelo texto do portal seguido de vírgula", () => {
    expect(confereComPortal("Senador A (P/UF)", "Senador A (P/UF)")).toBe("sim");
    expect(confereComPortal("Senador A (P/UF), Senador B (Q/UF)", "Senador A (P/UF)")).toBe("sim");
    // O portal corta na 1ª vírgula até no nome de comissão (medido em 89517, 25/11/2026).
    expect(confereComPortal("Comissão Mista de Planos, Orçamentos Públicos e Fiscalização", "Comissão Mista de Planos")).toBe("sim");
    expect(confereComPortal("Senador A  (P/UF)", " Senador A (P/UF)")).toBe("sim");
    expect(confereComPortal("Senador AB (P/UF)", "Senador A")).toBe("nao");
    expect(confereComPortal("Câmara dos Deputados", "Senador A (P/UF)")).toBe("nao");
    expect(confereComPortal(null, "x")).toBeNull();
    expect(confereComPortal("x", null)).toBeNull();
  });
});

describe("tabelasDosVinculos", () => {
  const r = tabelasDosVinculos(obsReais(), itens);
  const m = (entidade: string, itemId: string, codigo: string) => r.materias.find((x) => x.entidade === entidade && x.itemId === itemId && x.codigo === codigo);

  it("consulta 176514: lida, com identificação, resumo e vigia conferida", () => {
    expect(m("consultas", "176514", "176514")).toEqual({
      entidade: "consultas", itemId: "176514", casa: "SF", codigo: "176514", metodo: "id-da-consulta", linkPublicado: null, situacao: "lida",
      processos: "9133965", identificacao: "PL 5905/2026 (Substitutivo-CD)", resumoAutoria: "Câmara dos Deputados", autoriaNoPortal: "Câmara dos Deputados",
      confereComPortal: "sim", conferidoEm: "2026-11-25T19:38:20.000Z",
    });
  });

  it("situações: sem-processo, pendente (nunca lida), nao-encontrada (404)", () => {
    expect(m("consultas", "555", "555")).toMatchObject({ situacao: "sem-processo", processos: null, confereComPortal: null });
    expect(m("consultas", "777", "777")).toMatchObject({ situacao: "pendente", conferidoEm: null, confereComPortal: null });
    expect(m("consultas_votos", "404", "404")).toMatchObject({ metodo: "codigo-do-acervo", situacao: "nao-encontrada" });
  });

  it("ideia com duas proposições (Câmara e Senado) dá dois vínculos; link sem código fica fora", () => {
    expect(m("ideias", "10", "2295936")).toMatchObject({ casa: "CD", metodo: "link-publicado", situacao: "lida", processos: null });
    expect(m("ideias", "10", "176514")).toMatchObject({ casa: "SF", situacao: "lida" });
    expect(r.materias.filter((x) => x.itemId === "11")).toEqual([]);
    expect(r.materias.map((x) => `${x.entidade}:${x.itemId}:${x.codigo}`)).toEqual([
      "consultas:555:555", "consultas:777:777", "consultas:176514:176514", "ideias:10:2295936", "ideias:10:176514", "consultas_votos:404:404",
    ]);
  });

  it("autores: a mesma matéria uma vez só, os dois papéis, posição a partir de 1, com a página de origem", () => {
    const sf = r.autores.filter((a) => a.casa === "SF");
    expect(sf.map((a) => `${a.papel}:${a.posicao}:${a.autor}`)).toEqual(["iniciativa:1:Marcelo Crivella", "texto:1:Câmara dos Deputados"]);
    expect(sf[0]).toMatchObject({ codigo: "176514", processo: "9133965", codigoParlamentar: 3366, uf: "RJ", url: `${S}/processo/9133965` });
    expect(sf[0].sha).toMatch(/^[0-9a-f]{64}$/);
    const cd = r.autores.filter((a) => a.casa === "CD");
    expect(cd).toHaveLength(1);
    expect(cd[0]).toMatchObject({ codigo: "2295936", processo: null, papel: "camara", idDeputado: 74398, autor: "Maria do Rosário", url: CD });
  });

  it("autoria que não confere com o portal: o vínculo sai e é contado", () => {
    const r2 = tabelasDosVinculos(obsReais(), { consultas: [{ id: "176514", autoria: "Senador Outro (P/UF)" }], proposicoes: [], acervo: [] });
    expect(r2.materias).toEqual([]);
    expect(r2.naoConferem).toEqual(["176514"]);
    expect(r2.autores).toEqual([]);
  });

  it("detalhe de outra matéria não liga (conta como incoerente e fica pendente)", () => {
    n = 0;
    const obs = fundir([], [
      ...leitura(`${S}/processo?codigoMateria=1`, JSON.stringify([{ id: 9133965, codigoMateria: 1 }])),
      ...leitura(`${S}/processo/9133965`, ler("processo-9133965.json")),
    ]);
    const r3 = tabelasDosVinculos(obs, { consultas: [{ id: "1", autoria: null }], proposicoes: [], acervo: [] });
    expect(r3.incoerentes).toBe(1);
    expect(r3.materias[0]).toMatchObject({ situacao: "pendente", processos: "9133965" });
  });

  it("vale a leitura mais recente da lista", () => {
    n = 0;
    const obs = fundir([], [
      ...leitura(`${S}/processo?codigoMateria=555`, "", 404, "2026-11-25T10:00:00.000Z"),
      ...leitura(`${S}/processo?codigoMateria=555`, "[]", 200, "2026-11-26T10:00:00.000Z"),
    ]);
    expect(tabelasDosVinculos(obs, { consultas: [{ id: "555", autoria: null }], proposicoes: [], acervo: [] }).materias[0])
      .toMatchObject({ situacao: "sem-processo", conferidoEm: "2026-11-26T10:00:00.000Z" });
  });
});
