import { describe, it, expect } from "vitest";
import { parseVotacaoComissao } from "../../src/tools/votacao-comissao.js";

describe("parseVotacaoComissao", () => {
  it("parses a PascalCase committee vote with nominal votes", () => {
    const v = {
      Votacao: {
        CodigoVotacao: "777",
        DataVotacao: "2024-05-20",
        SiglaComissao: "CCJ",
        DescricaoMateria: "PL 100/2024",
        DescricaoVotacao: "Aprovação do relatório",
        Resultado: "Aprovado",
        TotalVotosSim: 15,
        TotalVotosNao: 3,
        TotalVotosAbstencao: 1,
        Votos: {
          Voto: [
            { CodigoParlamentar: "1001", NomeParlamentar: "Senador A", SiglaPartido: "PT", DescricaoVoto: "Sim" },
            { CodigoParlamentar: "1002", NomeParlamentar: "Senador B", SiglaPartido: "PL", DescricaoVoto: "Não" },
          ],
        },
      },
    };
    const result = parseVotacaoComissao(v);
    expect(result.codigo).toBe("777");
    expect(result.data).toBe("2024-05-20");
    expect(result.comissao).toBe("CCJ");
    expect(result.resultado).toBe("Aprovado");
    expect(result.totalSim).toBe(15);
    expect(result.totalNao).toBe(3);
    expect(result.votos).toHaveLength(2);
    expect(result.votos[0].nome).toBe("Senador A");
    expect(result.votos[0].voto).toBe("Sim");
    expect(result.votos[1].voto).toBe("Não");
  });

  it("parses flat camelCase committee vote", () => {
    const v = {
      codigoVotacao: 888,
      dataVotacao: "2024-06-10",
      siglaComissao: "CAE",
      descricaoMateria: "PEC 45/2024",
      resultado: "Rejeitado",
    };
    const result = parseVotacaoComissao(v);
    expect(result.codigo).toBe(888);
    expect(result.comissao).toBe("CAE");
    expect(result.resultado).toBe("Rejeitado");
    expect(result.votos).toEqual([]);
  });

  it("returns nulls for empty object", () => {
    const result = parseVotacaoComissao({});
    expect(result.codigo).toBeNull();
    expect(result.data).toBeNull();
    expect(result.comissao).toBeNull();
    expect(result.resultado).toBeNull();
    expect(result.totalSim).toBeNull();
    expect(result.votos).toEqual([]);
  });

  it("handles single vote (not array)", () => {
    const v = {
      Votacao: {
        CodigoVotacao: "999",
        Votos: {
          Voto: { CodigoParlamentar: "2001", NomeParlamentar: "Senador Solo", DescricaoVoto: "Sim" },
        },
      },
    };
    const result = parseVotacaoComissao(v);
    expect(result.votos).toHaveLength(1);
    expect(result.votos[0].nome).toBe("Senador Solo");
  });
});
