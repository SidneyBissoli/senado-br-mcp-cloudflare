import { describe, it, expect } from "vitest";
import { parseBlocoResumo, parseLideranca, parseMembroMesa } from "../../src/tools/composicao.js";

describe("parseBlocoResumo", () => {
  it("parses a PascalCase bloc with member parties", () => {
    const b = {
      Bloco: {
        CodigoBloco: "101",
        NomeBloco: "Bloco Parlamentar da Resistência",
        NomeApelido: "Resistência",
        DataCriacao: "2023-02-01",
        Membros: {
          Membro: [
            { SiglaPartido: "PT", NomePartido: "Partido dos Trabalhadores", DataAdesao: "2023-02-01" },
            { SiglaPartido: "PSB", NomePartido: "Partido Socialista Brasileiro", DataAdesao: "2023-03-15" },
          ],
        },
      },
    };
    const result = parseBlocoResumo(b);
    expect(result.codigo).toBe("101");
    expect(result.nome).toBe("Bloco Parlamentar da Resistência");
    expect(result.nomeApelido).toBe("Resistência");
    expect(result.dataCriacao).toBe("2023-02-01");
    expect(result.partidos).toHaveLength(2);
    expect(result.partidos[0].sigla).toBe("PT");
    expect(result.partidos[1].sigla).toBe("PSB");
  });

  it("handles single partido (not array)", () => {
    const b = {
      Bloco: {
        CodigoBloco: "102",
        NomeBloco: "Bloco Solo",
        Membros: { Membro: { SiglaPartido: "MDB" } },
      },
    };
    const result = parseBlocoResumo(b);
    expect(result.partidos).toHaveLength(1);
    expect(result.partidos[0].sigla).toBe("MDB");
  });

  it("returns nulls for empty object", () => {
    const result = parseBlocoResumo({});
    expect(result.codigo).toBeNull();
    expect(result.nome).toBeNull();
    expect(result.partidos).toEqual([]);
  });
});

describe("parseLideranca", () => {
  it("parses a leadership entry", () => {
    const l = {
      SiglaTipoLideranca: "LIDER",
      DescricaoTipoLideranca: "Líder",
      UnidadeLideranca: { NomeUnidadeLideranca: "PL" },
      Lider: {
        CodigoParlamentar: "5678",
        NomeParlamentar: "Senador Líder",
        SiglaPartido: "PL",
        SiglaUf: "SP",
      },
    };
    const result = parseLideranca(l);
    expect(result.tipo).toBe("LIDER");
    expect(result.descricao).toBe("Líder");
    expect(result.unidadeLideranca).toBe("PL");
    expect(result.parlamentar).not.toBeNull();
    expect(result.parlamentar!.nome).toBe("Senador Líder");
    expect(result.parlamentar!.partido).toBe("PL");
  });

  it("returns null parlamentar when Lider is absent", () => {
    const result = parseLideranca({});
    expect(result.tipo).toBeNull();
    expect(result.parlamentar).toBeNull();
  });
});

describe("parseMembroMesa", () => {
  it("parses a board member", () => {
    const m = {
      DescricaoCargo: "Presidente",
      CodigoParlamentar: "1234",
      NomeParlamentar: "Senador Presidente",
      SiglaPartido: "MDB",
      SiglaUf: "AP",
    };
    const result = parseMembroMesa(m);
    expect(result.cargo).toBe("Presidente");
    expect(result.codigo).toBe("1234");
    expect(result.nome).toBe("Senador Presidente");
    expect(result.partido).toBe("MDB");
    expect(result.uf).toBe("AP");
  });

  it("returns nulls for empty object", () => {
    const result = parseMembroMesa({});
    expect(result.cargo).toBeNull();
    expect(result.codigo).toBeNull();
    expect(result.nome).toBeNull();
  });
});
