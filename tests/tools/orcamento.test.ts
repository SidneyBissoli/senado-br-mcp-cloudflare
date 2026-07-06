import { describe, it, expect } from "vitest";
import { parseEmenda, parseOficio } from "../../src/tools/orcamento.js";

describe("parseEmenda", () => {
  // Real shape from ListaLoteEmendas.LotesEmendasOrcamento.LoteEmendasOrcamento[].
  it("parses a real budget amendment batch (LoteEmendasOrcamento)", () => {
    const e = {
      NomeAutorOrcamento: "Abilio Brunini",
      IndicadorAtivo: "Não",
      CodigoAutorOrcamento: "4290",
      DataOperacao: "2023-11-29",
      QuantidadeEmendas: "10",
      AnoExecucao: "2024",
      NumeroMateria: "29",
      AnoMateria: "2023",
      SiglaTipoPlOrcamento: "LOA",
      DescricaoTipoPlOrcamento: "Lei Orçamentária Anual",
    };
    const result = parseEmenda(e);
    expect(result.autor).toBe("Abilio Brunini");
    expect(result.codigoAutor).toBe(4290);
    expect(result.quantidadeEmendas).toBe(10);
    expect(result.anoExecucao).toBe("2024");
    expect(result.materia).toBe("LOA 29/2023");
    expect(result.tipoPl).toBe("Lei Orçamentária Anual");
    expect(result.dataOperacao).toBe("2023-11-29");
    expect(result.ativo).toBe(false);
  });

  it("maps IndicadorAtivo 'Sim' to ativo true", () => {
    expect(parseEmenda({ IndicadorAtivo: "Sim" }).ativo).toBe(true);
  });

  it("returns nulls/zeros for empty object", () => {
    const result = parseEmenda({});
    expect(result.autor).toBeNull();
    expect(result.codigoAutor).toBeNull();
    expect(result.quantidadeEmendas).toBe(0);
    expect(result.materia).toBeNull();
    expect(result.ativo).toBe(false);
  });
});

describe("parseOficio", () => {
  it("parses a support letter", () => {
    const o = {
      Codigo: "200",
      Numero: "OF-001",
      Data: "2024-06-01",
      Tipo: "Apoio",
      Descricao: "Ofício de apoio",
      Situacao: "Enviado",
    };
    const result = parseOficio(o);
    expect(result.codigo).toBe("200");
    expect(result.numero).toBe("OF-001");
    expect(result.data).toBe("2024-06-01");
    expect(result.tipo).toBe("Apoio");
    expect(result.descricao).toBe("Ofício de apoio");
    expect(result.situacao).toBe("Enviado");
  });

  it("returns nulls for empty object", () => {
    const result = parseOficio({});
    expect(result.codigo).toBeNull();
    expect(result.data).toBeNull();
    expect(result.situacao).toBeNull();
  });
});
