import { describe, it, expect } from "vitest";
import { parseServidor, resumoRemuneracao } from "../../src/tools/servidores.js";

describe("parseServidor", () => {
  it("parses a snake_case servant item", () => {
    const result = parseServidor({
      sequencial: 1,
      nome: "FULANO DE TAL",
      vinculo: "EFETIVO",
      situacao: "ATIVO",
      cargo: "ANALISTA LEGISLATIVO",
      especialidade: "PROCESSO LEGISLATIVO",
      funcao: "FC-3",
      lotacao: "SGM",
      categoria: "NIVEL III",
      cedido: "NÃO",
      ano_admissao: 2012,
    });
    expect(result.nome).toBe("FULANO DE TAL");
    expect(result.vinculo).toBe("EFETIVO");
    expect(result.cargo).toBe("ANALISTA LEGISLATIVO");
    expect(result.lotacao).toBe("SGM");
    expect(result.anoAdmissao).toBe(2012);
    expect((result as any).sequencial).toBeUndefined();
  });

  it("handles empty input", () => {
    const result = parseServidor({});
    expect(result.nome).toBe("");
    expect(result.cargo).toBeNull();
    expect(result.anoAdmissao).toBeNull();
  });
});

describe("resumoRemuneracao", () => {
  it("computes the gross total from components", () => {
    const result = resumoRemuneracao({
      nome: "FULANO",
      tipo_folha: "Servidores",
      remuneracao_basica: 10000,
      vantagens_pessoais: 500.5,
      funcao_comissionada: 1000,
      gratificacao_natalina: 0,
      horas_extras: 250.25,
      outras_eventuais: 0,
      abono_permanencia: 0,
      diarias: 300,
      auxilios: 100,
    });
    expect(result.bruto).toBe(11750.75);
    expect(result.diarias).toBe(300);
    expect(result.tipoFolha).toBe("Servidores");
  });

  it("treats non-numeric fields as zero", () => {
    const result = resumoRemuneracao({ nome: "X", remuneracao_basica: "n/a" });
    expect(result.bruto).toBe(0);
  });
});
