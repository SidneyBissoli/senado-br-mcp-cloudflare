/**
 * E1.b — parte pura do coletor da autoria oficial das matérias (`scripts/ingest-ecidadania/autoria.ts`).
 * As formas de resposta vêm da medição de 25/11/2026 (30 consultas ao acaso: 1 processo cada, o
 * detalhe com o mesmo `id` e `autoriaIniciativa[]`).
 */

import { describe, it, expect } from "vitest";
import {
  alvoDoLinkDaProposicao, filaDaAutoria, idsDaListaDeProcessos, conferirDetalheDoProcesso, conferirAutoresDaCamara,
  estadoStmt, AutoriaForaDoMoldeError, MAX_PROCESSOS,
} from "../../scripts/ingest-ecidadania/autoria.js";

describe("alvoDoLinkDaProposicao", () => {
  it("Senado e Câmara pelo link publicado; outro link fica fora", () => {
    expect(alvoDoLinkDaProposicao("https://www25.senado.leg.br/web/atividade/materias/-/materia/148537")).toEqual({ casa: "SF", codigo: 148537 });
    expect(alvoDoLinkDaProposicao("https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=2295936")).toEqual({ casa: "CD", codigo: 2295936 });
    expect(alvoDoLinkDaProposicao("https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?x=1&idProposicao=7")).toEqual({ casa: "CD", codigo: 7 });
    expect(alvoDoLinkDaProposicao("https://www25.senado.leg.br/web/atividade/materias/-/materia/148537x")).toBeNull();
    expect(alvoDoLinkDaProposicao("https://exemplo.org/materia/1")).toBeNull();
    expect(alvoDoLinkDaProposicao(null)).toBeNull();
  });
});

describe("filaDaAutoria", () => {
  const fontes = {
    consultas: [10, 20, 30],
    linksDasIdeias: [
      "https://www25.senado.leg.br/web/atividade/materias/-/materia/20", // repete uma consulta
      "https://www25.senado.leg.br/web/atividade/materias/-/materia/40",
      "https://www.camara.leg.br/proposicoesWeb/fichadetramitacao?idProposicao=20", // outra Casa: não repete
      null,
    ],
    acervo: [30, 50, 60],
  };

  it("prioridade consultas → ideias → acervo, sem repetição e sem as já lidas", () => {
    const { fila, pendentes } = filaDaAutoria(fontes, new Set(["SF:10"]), 100);
    expect(fila.map((a) => `${a.origem}/${a.casa}:${a.codigo}`)).toEqual([
      "consulta/SF:20", "consulta/SF:30", "ideia/SF:40", "ideia/CD:20", "acervo/SF:50", "acervo/SF:60",
    ]);
    expect(pendentes).toBe(6);
  });

  it("o teto corta pela cauda (o acervo sai primeiro) e conta o total pendente", () => {
    const { fila, pendentes } = filaDaAutoria(fontes, new Set(), 4);
    expect(fila.map((a) => a.origem)).toEqual(["consulta", "consulta", "consulta", "ideia"]);
    expect(pendentes).toBe(7);
  });

  it("código inválido fica fora", () => {
    expect(filaDaAutoria({ consultas: [0, -1, 1.5], linksDasIdeias: [], acervo: [] }, new Set(), 10).fila).toEqual([]);
  });
});

describe("respostas da API", () => {
  it("lista de processos: ids na ordem, sem repetir; vazia é situação, não erro", () => {
    expect(idsDaListaDeProcessos([{ id: 7956349, codigoMateria: 143307 }], 143307)).toEqual([7956349]);
    expect(idsDaListaDeProcessos([{ id: 1, codigoMateria: 9 }, { id: 2, codigoMateria: 9 }, { id: 1, codigoMateria: 9 }], 9)).toEqual([1, 2]);
    expect(idsDaListaDeProcessos([], 9)).toEqual([]);
  });

  it("lista fora do molde lança (a matéria não é marcada)", () => {
    expect(() => idsDaListaDeProcessos({ id: 1 }, 9)).toThrow(AutoriaForaDoMoldeError);
    expect(() => idsDaListaDeProcessos([{ id: "1" }], 9)).toThrow(AutoriaForaDoMoldeError);
    expect(() => idsDaListaDeProcessos([{ id: 1, codigoMateria: 8 }], 9)).toThrow(/da matéria 8/);
    const muitos = Array.from({ length: MAX_PROCESSOS + 1 }, (_, i) => ({ id: i + 1, codigoMateria: 9 }));
    expect(() => idsDaListaDeProcessos(muitos, 9)).toThrow(/teto/);
  });

  it("detalhe: mesmo id e autoriaIniciativa[] (vazia vale)", () => {
    expect(() => conferirDetalheDoProcesso({ id: 5, autoriaIniciativa: [] }, 5)).not.toThrow();
    expect(() => conferirDetalheDoProcesso({ id: 6, autoriaIniciativa: [] }, 5)).toThrow(/respondeu o processo 6/);
    expect(() => conferirDetalheDoProcesso({ id: 5 }, 5)).toThrow(/sem autoriaIniciativa/);
    expect(() => conferirDetalheDoProcesso([], 5)).toThrow(AutoriaForaDoMoldeError);
  });

  it("Câmara: { dados: [] }", () => {
    expect(() => conferirAutoresDaCamara({ dados: [{ nome: "Maria do Rosário" }] }, 1)).not.toThrow();
    expect(() => conferirAutoresDaCamara({ dados: null }, 1)).toThrow(AutoriaForaDoMoldeError);
  });
});

describe("estadoStmt", () => {
  it("upsert com os processos separados por vírgula; sem processo = NULL", () => {
    const s = estadoStmt({ casa: "SF", codigo: 143307 }, "lida", [7956349, 1], "2026-11-25T12:00:00.000Z", "autoria@abc1234");
    expect(s).toContain("VALUES ('SF', 143307, 'lida', '7956349,1', '2026-11-25T12:00:00.000Z', 'autoria@abc1234')");
    expect(s).toContain("ON CONFLICT(casa, codigo) DO UPDATE");
    expect(estadoStmt({ casa: "CD", codigo: 7 }, "nao-encontrada", null, "t", "l")).toContain("'nao-encontrada', NULL,");
    expect(estadoStmt({ casa: "SF", codigo: 7 }, "sem-processo", [], "t", "l")).toContain("'sem-processo', NULL,");
  });
});
