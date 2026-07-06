import { describe, it, expect } from "vitest";
import {
  stripWrapper,
  firstArrayDeep,
  extractSessoesResultado,
  parseSessaoAgenda,
  parseSessaoResultado,
  parseOrientacaoVotacao,
  parseVeto,
} from "../../src/tools/plenario.js";

describe("parseSessaoAgenda (BUG-016)", () => {
  // TipoSessao/SituacaoSessao are plain strings; pauta materia carries a sigla.
  it("maps string tipo/situacao and a sigla-bearing pauta materia", () => {
    const s = {
      CodigoSessao: "564661",
      Data: "16/06/2026",
      Hora: "14:00",
      TipoSessao: "SESSÃO DELIBERATIVA ORDINÁRIA ",
      SituacaoSessao: "Encerrada",
      Materias: {
        Materia: [
          {
            SiglaMateria: "PL",
            NumeroMateria: "00096",
            AnoMateria: "2024",
            DescricaoIdentificacaoMateria: "PL 96/2024",
            Ementa: "Altera a LDB.",
            NomeAutor: "Idilvan Alencar",
            Parecer: "Parecer favorável nº 35, de 2026. ",
          },
        ],
      },
    };
    const r = parseSessaoAgenda(s);
    expect(r.codigo).toBe(564661);
    expect(r.tipo).toBe("SESSÃO DELIBERATIVA ORDINÁRIA"); // trimmed
    expect(r.situacao).toBe("Encerrada");
    expect(r.pauta).toHaveLength(1);
    expect(r.pauta![0].materia).toBe("PL 96/2024"); // has sigla, not "00096/2024"
    expect(r.pauta![0].ementa).toBe("Altera a LDB.");
    expect(r.pauta![0].autor).toBe("Idilvan Alencar");
    expect(r.pauta![0].parecer).toBe("Parecer favorável nº 35, de 2026.");
  });

  it("has no pauta for a ceremonial session (Evento, no Materias)", () => {
    const r = parseSessaoAgenda({ CodigoSessao: "1", TipoSessao: "SESSÃO DE PREMIAÇÕES ", SituacaoSessao: "Encerrada" });
    expect(r.pauta).toBeUndefined();
    expect(r.situacao).toBe("Encerrada");
  });
});

describe("stripWrapper", () => {
  it("unwraps single-key wrappers and drops Metadados", () => {
    const result = stripWrapper({
      ResultadoPlenario: {
        noNamespaceSchemaLocation: "https://x.xsd",
        Metadados: { Versao: "1" },
        Sessoes: { Sessao: [{ codigoSessao: "1" }] },
      },
    });
    expect(result.Sessoes.Sessao).toHaveLength(1);
    expect(result.Metadados).toBeUndefined();
  });

  it("returns arrays and primitives unchanged", () => {
    expect(stripWrapper([1, 2])).toEqual([1, 2]);
    expect(stripWrapper(null)).toBeNull();
  });
});

describe("firstArrayDeep", () => {
  it("finds the first nested array", () => {
    expect(firstArrayDeep({ a: { b: { c: [1, 2, 3] } } })).toEqual([1, 2, 3]);
  });

  it("returns empty array when nothing found", () => {
    expect(firstArrayDeep({ a: { b: "x" } })).toEqual([]);
  });
});

describe("extractSessoesResultado + parseSessaoResultado", () => {
  it("parses a ResultadoPlenario response", () => {
    const response = {
      ResultadoPlenario: {
        Metadados: {},
        Sessoes: {
          Sessao: [{
            codigoSessao: "461394",
            numeroSessao: "60",
            dataSessao: "10/06/2025",
            horaSessao: "14:00",
            descricaoTipoSessao: "Sessão Deliberativa Ordinária",
            siglaCasa: "SF",
            Itens: {
              Item: [{
                codigoMateria: "161599",
                identificacao: "PROJETO DE LEI Nº 419, DE 2023\n\n",
                parecer: "Pareceres favoráveis ",
              }],
            },
          }],
        },
      },
    };
    const sessoes = extractSessoesResultado(response).map(parseSessaoResultado);
    expect(sessoes).toHaveLength(1);
    expect(sessoes[0].codigoSessao).toBe(461394);
    expect(sessoes[0].casa).toBe("SF");
    expect(sessoes[0].itens[0].codigoMateria).toBe(161599);
    expect(sessoes[0].itens[0].identificacao).toBe("PROJETO DE LEI Nº 419, DE 2023");
    expect(sessoes[0].itens[0].parecer).toBe("Pareceres favoráveis");
  });
});

describe("parseOrientacaoVotacao", () => {
  it("parses a flat camelCase orientacao item", () => {
    const result = parseOrientacaoVotacao({
      codigoVotacaoSve: 12150,
      descricaoVotacao: "Solicita calendário especial para a PEC nº 48/2023.",
      siglaTipoMateria: "RQS",
      numeroMateria: 911,
      anoMateria: 2025,
      descricaoMateria: "Requerimento nº 911, de 2025",
      dataInicioVotacao: "2025-12-09T17:18:08",
      qtdVotosSim: 48,
      qtdVotosNao: 21,
      qtdVotosAbstencao: 0,
      qtdObstrucoes: 0,
      orientacoesLideranca: [
        { dataHora: "2025-12-09T17:21:37", partido: "PSD", voto: "NÃO" },
        { partido: "PT", voto: "SIM" },
      ],
    });
    expect(result.codigoVotacao).toBe(12150);
    expect(result.materia).toBe("Requerimento nº 911, de 2025");
    expect(result.totalSim).toBe(48);
    expect(result.orientacoes).toEqual([
      { partido: "PSD", voto: "NÃO" },
      { partido: "PT", voto: "SIM" },
    ]);
  });

  it("builds materia from sigla/numero/ano when descricao is missing", () => {
    const result = parseOrientacaoVotacao({
      siglaTipoMateria: "PEC", numeroMateria: 48, anoMateria: 2023,
    });
    expect(result.materia).toBe("PEC 48/2023");
  });
});

describe("parseVeto", () => {
  it("parses a legacy veto item", () => {
    const result = parseVeto({
      Codigo: "17011",
      Materia: {
        Codigo: "166968", Sigla: "VET", Numero: "50", Ano: "2024",
        EmTramitacao: "Sim", Ementa: "Veto parcial aposto ao Projeto de Lei nº 3.149 de 2020",
      },
      MateriaVetada: { Codigo: "166093", Sigla: "PL", Numero: "3149", Ano: "2020" },
    });
    expect(result.codigo).toBe(17011);
    expect(result.identificacao).toBe("VET 50/2024");
    expect(result.emTramitacao).toBe(true);
    expect(result.materiaVetada).toEqual({ codigo: 166093, identificacao: "PL 3149/2020" });
  });

  it("handles empty input", () => {
    const result = parseVeto({});
    expect(result.codigo).toBeNull();
    expect(result.identificacao).toBeNull();
    expect(result.materiaVetada).toBeNull();
  });

  // BUG-023: tipo/dataLimiteVotacao came from non-existent fields (always null).
  it("maps tipo from Total and dataLimiteVotacao from DataSobrestacaoPauta", () => {
    const result = parseVeto({
      Codigo: "18449",
      Total: "Não",
      DataSobrestacaoPauta: "2026-08-18",
      Assunto: "Trabalho em Condição Análoga à de Escravo",
      Materia: { Sigla: "VET", Numero: "36", Ano: "2026", EmTramitacao: "Sim" },
      MateriaVetada: { Codigo: "166703", Sigla: "PL", Numero: "5760", Ano: "2023" },
    });
    expect(result.tipo).toBe("parcial"); // Total = "Não"
    expect(result.dataLimiteVotacao).toBe("2026-08-18");
    expect(result.assunto).toBe("Trabalho em Condição Análoga à de Escravo");
  });

  it("maps a total veto (Total = 'Sim')", () => {
    expect(parseVeto({ Codigo: "1", Total: "Sim" }).tipo).toBe("total");
  });
});

describe("parseSessaoResultado items (BUG-028)", () => {
  // resultado <- textoResultado, ementa <- ementaPapeleta; empty textoResultado -> null.
  it("maps textoResultado/ementaPapeleta and distinguishes non-deliberated items", () => {
    const s = {
      codigoSessao: "564661",
      Itens: {
        Item: [
          {
            codigoMateria: "172498",
            identificacao: "PROJETO DE LEI Nº 96, DE 2024\n\n",
            DescricaoIdentificacaoMateria: "Projeto de Lei nº 96, de 2024",
            ementaPapeleta: "altera a LDB.",
            textoResultado: "Resultado da matéria: Aprovado o projeto.\n\n",
          },
          { codigoMateria: "999", textoResultado: "" }, // not deliberated
        ],
      },
    };
    const r = parseSessaoResultado(s);
    expect(r.itens[0].identificacao).toBe("Projeto de Lei nº 96, de 2024");
    expect(r.itens[0].ementa).toBe("altera a LDB.");
    expect(r.itens[0].resultado).toContain("Aprovado o projeto");
    expect(r.itens[1].resultado).toBeNull(); // empty string -> null, not ""
  });
});
