import { describe, it, expect } from "vitest";
import { parseVotacaoComissao, filtrarPorData } from "../../src/tools/votacao-comissao.js";
import { digArrayRoot } from "../../src/utils/upstream-parse.js";

describe("parseVotacaoComissao (BUG-017)", () => {
  // Real shape: VotacoesComissao.Votacoes.Votacao[] with DataHoraInicioReuniao,
  // SiglaColegiado, IdentificacaoMateria and per-member QualidadeVoto (S/N/A).
  it("parses a real committee vote and tallies QualidadeVoto", () => {
    const v = {
      Votacao: {
        CodigoVotacao: "6932",
        CodigoReuniao: "4097",
        DataHoraInicioReuniao: "2015-10-21T10:25:00",
        SiglaColegiado: "CCJ",
        IdentificacaoMateria: "PLS 562/2011",
        DescricaoVotacao: "PLS 562/2011",
        Votos: {
          Voto: [
            { CodigoParlamentar: "5006", NomeParlamentar: "Gleisi Hoffmann", SiglaPartidoParlamentar: "PT", QualidadeVoto: "S" },
            { CodigoParlamentar: "5008", NomeParlamentar: "Humberto Costa", SiglaPartidoParlamentar: "PT", QualidadeVoto: "S" },
            { CodigoParlamentar: "3", NomeParlamentar: "C", SiglaPartidoParlamentar: "PL", QualidadeVoto: "N" },
            { CodigoParlamentar: "4", NomeParlamentar: "D", SiglaPartidoParlamentar: "MDB", QualidadeVoto: "A" },
          ],
        },
      },
    };
    const r = parseVotacaoComissao(v);
    expect(r.codigo).toBe("6932");
    expect(r.data).toBe("2015-10-21T10:25:00");
    expect(r.comissao).toBe("CCJ");
    expect(r.reuniao).toBe("4097");
    expect(r.materia).toBe("PLS 562/2011");
    expect(r.totalSim).toBe(2);
    expect(r.totalNao).toBe(1);
    expect(r.totalAbstencao).toBe(1);
    expect(r.votos).toHaveLength(4);
    expect(r.votos[0].nome).toBe("Gleisi Hoffmann");
    expect(r.votos[0].partido).toBe("PT");
    expect(r.votos[0].voto).toBe("S");
  });

  it("returns nulls/zeros for empty object", () => {
    const r = parseVotacaoComissao({});
    expect(r.codigo).toBeNull();
    expect(r.comissao).toBeNull();
    expect(r.totalSim).toBe(0);
    expect(r.votos).toEqual([]);
  });

  it("resolves votes at the real VotacoesComissao root", () => {
    const response = { VotacoesComissao: { Votacoes: { Votacao: [{ CodigoVotacao: "1" }] } } };
    const votacoes = digArrayRoot(response, [["VotacoesComissao", "Votacoes", "Votacao"]], "t").map(parseVotacaoComissao);
    expect(votacoes).toHaveLength(1);
    expect(votacoes[0].codigo).toBe("1");
  });
});

describe("filtrarPorData (BUG-017 local date filter)", () => {
  const itens = [
    { data: "2015-10-21T10:25:00", codigo: "old" },
    { data: "2026-07-01T14:00:00", codigo: "new" },
  ];

  it("keeps only reunions within the YYYYMMDD window", () => {
    const out = filtrarPorData(itens, "20260601", "20260705");
    expect(out).toHaveLength(1);
    expect(out[0].codigo).toBe("new");
  });

  it("returns everything when no window is given", () => {
    expect(filtrarPorData(itens)).toHaveLength(2);
  });
});
