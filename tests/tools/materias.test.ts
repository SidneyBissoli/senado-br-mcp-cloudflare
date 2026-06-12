import { describe, it, expect } from "vitest";
import { parseMateriaResumo, parseMateriaDetalhe } from "../../src/tools/materias.js";

describe("parseMateriaResumo", () => {
  it("parses a materia with IdentificacaoMateria wrapper", () => {
    const materia = {
      IdentificacaoMateria: {
        CodigoMateria: "151234",
        SiglaSubtipoMateria: "PEC",
        NumeroMateria: "45",
        AnoMateria: "2024",
      },
      EmentaMateria: "Altera a Constituição Federal...",
      AutorPrincipal: { NomeAutor: "Senador Fulano" },
      SituacaoAtual: { DescricaoSituacao: "Em tramitação" },
      DataApresentacao: "2024-03-15",
    };
    const result = parseMateriaResumo(materia);
    expect(result.codigo).toBe(151234);
    expect(result.sigla).toBe("PEC");
    expect(result.numero).toBe(45);
    expect(result.ano).toBe(2024);
    expect(result.ementa).toContain("Constituição");
    expect(result.autor).toBe("Senador Fulano");
    expect(result.situacao).toBe("Em tramitação");
  });

  it("handles flat materia without wrapper", () => {
    const materia = {
      CodigoMateria: "99999",
      SiglaMateria: "PL",
      NumeroMateria: "100",
      AnoMateria: "2023",
      Ementa: "Dispõe sobre...",
    };
    const result = parseMateriaResumo(materia);
    expect(result.codigo).toBe(99999);
    expect(result.sigla).toBe("PL");
    expect(result.ementa).toBe("Dispõe sobre...");
  });

  it("returns defaults for empty input", () => {
    const result = parseMateriaResumo({});
    expect(result.codigo).toBe(0);
    expect(result.sigla).toBe("");
    expect(result.numero).toBe(0);
    expect(result.ementa).toBeNull();
  });
});

describe("parseMateriaDetalhe", () => {
  it("parses full detail", () => {
    const dados = {
      Materia: {
        IdentificacaoMateria: {
          CodigoMateria: "151234",
          SiglaSubtipoMateria: "PLP",
          NumeroMateria: "10",
          AnoMateria: "2024",
        },
        DadosBasicosMateria: {
          EmentaMateria: "Ementa completa",
          ExplicacaoEmentaMateria: "Explicação detalhada",
          DataApresentacao: "2024-01-10",
        },
        SituacaoAtual: { DescricaoSituacao: "Pronta para pauta" },
        Autoria: {
          Autor: [{ NomeAutor: "Autor Principal", TipoAutor: "Senador" }],
        },
        Relator: {
          NomeRelator: "Relator Fulano",
          SiglaPartido: "MDB",
          UfRelator: "RJ",
        },
      },
    };
    const result = parseMateriaDetalhe(dados);
    expect(result.codigo).toBe(151234);
    expect(result.ementa).toBe("Ementa completa");
    expect(result.ementaDetalhada).toBe("Explicação detalhada");
    expect(result.autor).toBe("Autor Principal");
    expect(result.tipoAutor).toBe("Senador");
    expect(result.relator).toEqual({ nome: "Relator Fulano", partido: "MDB", uf: "RJ" });
  });
});
