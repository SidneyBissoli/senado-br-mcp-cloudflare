import { describe, it, expect } from "vitest";
import {
  parseBlocoResumo,
  parseBlocoDetalhe,
  parseLideranca,
  parseMembroMesa,
} from "../../src/tools/composicao.js";

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
    expect(result.casa).toBeNull();
    expect(result.bloco).toBeNull();
    expect(result.partido).toBeNull();
    expect(result.numeroOrdemViceLider).toBeNull();
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

// ---- Regression fixtures from the live upstream (padrao f) ----

describe("parseBlocoResumo — real nested Membro.Partido (BUG-012)", () => {
  it("reads sigla from the nested Partido object of the list dump", () => {
    const b = {
      Bloco: {
        CodigoBloco: "346",
        NomeBloco: "Bloco Parlamentar Aliança",
        NomeApelido: "BLALIANÇA",
        DataCriacao: "2023-03-20",
        Membros: {
          Membro: [
            { Partido: { SiglaPartido: "PP", NomePartido: "Progressistas" }, DataAdesao: "2023-03-20" },
          ],
        },
      },
    };
    const r = parseBlocoResumo(b);
    expect(r.codigo).toBe("346");
    expect(r.partidos).toHaveLength(1);
    expect(r.partidos[0].sigla).toBe("PP");
    expect(r.partidos[0].nome).toBe("Progressistas");
  });
});

describe("blocos dataDesligamento (achado #11)", () => {
  // O upstream publica DataDesligamento por partido; sem expor o campo, membros
  // históricos (PT no BLPRD até 17/02/2025) parecem composição vigente e o mesmo
  // partido "aparece em 2 blocos ao mesmo tempo" (P42).
  it("lista: expõe dataDesligamento e preserva membro histórico distinto do atual", () => {
    const b = {
      Bloco: {
        CodigoBloco: "335",
        NomeBloco: "Bloco Parlamentar da Resistência Democrática",
        DataCriacao: "2023-02-01",
        Membros: {
          Membro: [
            { Partido: { SiglaPartido: "PSB" }, DataAdesao: "2023-02-01" },
            { Partido: { SiglaPartido: "PT" }, DataAdesao: "2023-02-01", DataDesligamento: "2025-02-17" },
            { Partido: { SiglaPartido: "REDE" }, DataAdesao: "2023-02-01", DataDesligamento: "2023-02-01" },
            { Partido: { SiglaPartido: "REDE" }, DataAdesao: "2023-04-25", DataDesligamento: "2024-01-30" },
          ],
        },
      },
    };
    const r = parseBlocoResumo(b);
    expect(r.partidos).toHaveLength(4);
    expect(r.partidos[0].dataDesligamento).toBeNull(); // PSB segue no bloco
    expect(r.partidos[1].dataDesligamento).toBe("2025-02-17"); // PT saiu
    const atuais = r.partidos.filter((p: any) => p.dataDesligamento === null);
    expect(atuais.map((p: any) => p.sigla)).toEqual(["PSB"]);
  });

  it("detalhe: converte dataDesligamento DD/MM/AAAA para ISO", () => {
    const bloco = {
      id: "335",
      nomeBloco: "Bloco Parlamentar da Resistência Democrática",
      dataCriacao: "01/02/2023",
      composicaoBloco: {
        composicao_bloco: [
          { partido: { siglaPartido: "PSB" }, dataAdesao: "01/02/2023" },
          { partido: { siglaPartido: "PT" }, dataAdesao: "01/02/2023", dataDesligamento: "17/02/2025" },
        ],
      },
    };
    const r = parseBlocoDetalhe(bloco);
    expect(r.partidos[0].dataDesligamento).toBeNull();
    expect(r.partidos[1].dataDesligamento).toBe("2025-02-17");
  });
});

describe("parseBlocoDetalhe — real detail shape (BUG-013)", () => {
  it("parses the lowercase blocos.bloco detail with DD/MM dates and composicao_bloco", () => {
    const bloco = {
      id: "346",
      idBloco: "346",
      siglaCasa: "SF",
      nomeBloco: "Bloco Parlamentar Aliança",
      nomeApelidoBloco: "BLALIANÇA",
      dataCriacao: "20/03/2023",
      composicaoBloco: {
        composicao_bloco: [
          { partido: { siglaPartido: "PP", nomePartido: "Progressistas" }, dataAdesao: "20/03/2023" },
        ],
      },
    };
    const r = parseBlocoDetalhe(bloco);
    expect(r.codigo).toBe("346");
    expect(r.nome).toBe("Bloco Parlamentar Aliança");
    expect(r.nomeApelido).toBe("BLALIANÇA");
    expect(r.dataCriacao).toBe("2023-03-20"); // DD/MM/AAAA -> ISO
    expect(r.partidos).toHaveLength(1);
    expect(r.partidos[0].sigla).toBe("PP");
    expect(r.partidos[0].dataAdesao).toBe("2023-03-20");
  });
});

describe("parseLideranca — real flat camelCase (BUG-011)", () => {
  it("parses a flat leadership item with parliamentarian fields on the item", () => {
    const l = {
      casa: "CN",
      codigoParlamentar: 5012,
      dataDesignacao: "2023-01-06",
      descricaoTipoLideranca: "Líder do Congresso Nacional",
      siglaTipoLideranca: "L",
      descricaoTipoUnidadeLideranca: "Liderança do Governo no Congresso Nacional",
      nomeParlamentar: "Randolfe Rodrigues",
      siglaPartidoFiliacao: "PT",
    };
    const r = parseLideranca(l);
    expect(r.tipo).toBe("L");
    expect(r.descricao).toBe("Líder do Congresso Nacional");
    expect(r.unidadeLideranca).toBe("Liderança do Governo no Congresso Nacional");
    expect(r.casa).toBe("CN");
    expect(r.dataDesignacao).toBe("2023-01-06");
    expect(r.bloco).toBeNull(); // government leadership: no bloc unit
    expect(r.partido).toBeNull(); // government leadership: no party unit
    expect(r.parlamentar).not.toBeNull();
    expect(r.parlamentar!.codigo).toBe(5012);
    expect(r.parlamentar!.nome).toBe("Randolfe Rodrigues");
    expect(r.parlamentar!.partido).toBe("PT");
    expect(r.parlamentar!.uf).toBeNull(); // not present in the flat payload
  });
});

describe("parseLideranca — bloc and party units (achado #15)", () => {
  it("exposes the led bloc on a bloc leadership (real fixture)", () => {
    const l = {
      casa: "SF",
      codigo: 17338,
      codigoBloco: 335,
      codigoParlamentar: 5718,
      codigoPartidoFiliacao: 557,
      dataDesignacao: "2024-11-11",
      descricaoTipoLideranca: "Líder do Senado Federal",
      descricaoTipoUnidadeLideranca: "Liderança de Bloco no Senado Federal",
      idTipoUnidadeLideranca: 2,
      nomeBloco: "Bloco Parlamentar da Resistência Democrática",
      nomeParlamentar: "Eliziane Gama",
      siglaBloco: "BLPRD",
      siglaPartidoFiliacao: "PSD",
      siglaTipoLideranca: "L",
    };
    const r = parseLideranca(l);
    expect(r.bloco).toEqual({
      codigo: 335,
      nome: "Bloco Parlamentar da Resistência Democrática",
      sigla: "BLPRD",
    });
    expect(r.partido).toBeNull();
    expect(r.casa).toBe("SF");
    expect(r.parlamentar!.partido).toBe("PSD");
  });

  it("exposes the led party (distinct from the leader's filiação) on a party leadership", () => {
    const l = {
      casa: "SF",
      codigoParlamentar: 5736,
      codigoPartido: 418,
      codigoPartidoFiliacao: 418,
      dataDesignacao: "2023-02-02",
      descricaoTipoUnidadeLideranca: "Liderança de Partido no Senado Federal",
      nomeParlamentar: "Tereza Cristina",
      nomePartido: "Progressistas",
      siglaPartido: "PP",
      siglaPartidoFiliacao: "PP",
      siglaTipoLideranca: "L",
      numeroOrdemViceLider: 3,
    };
    const r = parseLideranca(l);
    expect(r.partido).toEqual({ codigo: 418, sigla: "PP", nome: "Progressistas" });
    expect(r.bloco).toBeNull();
    expect(r.numeroOrdemViceLider).toBe(3);
    expect(r.dataDesignacao).toBe("2023-02-02");
    expect(r.dataTermino).toBeNull();
  });
});

describe("parseMembroMesa — real dump shape (BUG-010)", () => {
  it("reads Cargo[], Http and Bancada (UNIAO-AP)", () => {
    const m = {
      Cargo: ["PRESIDENTE"],
      NomeParlamentar: "Senador Davi Alcolumbre",
      Bancada: "(UNIÃO-AP)",
      Http: "3830",
    };
    const r = parseMembroMesa(m);
    expect(r.cargo).toBe("PRESIDENTE");
    expect(r.codigo).toBe("3830");
    expect(r.nome).toBe("Senador Davi Alcolumbre");
    expect(r.partido).toBe("UNIÃO");
    expect(r.uf).toBe("AP");
  });
});
