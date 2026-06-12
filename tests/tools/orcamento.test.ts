import { describe, it, expect } from "vitest";
import { parseEmenda, parseOficio } from "../../src/tools/orcamento.js";

describe("parseEmenda", () => {
  it("parses a budget amendment", () => {
    const e = {
      Codigo: "500",
      Numero: "123",
      Ano: "2024",
      TipoEmenda: "Individual",
      Autor: "Senador Fulano",
      Valor: "1000000.00",
      Descricao: "Emenda para saúde",
    };
    const result = parseEmenda(e);
    expect(result.codigo).toBe("500");
    expect(result.numero).toBe("123");
    expect(result.ano).toBe("2024");
    expect(result.tipo).toBe("Individual");
    expect(result.autor).toBe("Senador Fulano");
    expect(result.valor).toBe("1000000.00");
    expect(result.descricao).toBe("Emenda para saúde");
  });

  it("returns nulls for empty object", () => {
    const result = parseEmenda({});
    expect(result.codigo).toBeNull();
    expect(result.numero).toBeNull();
    expect(result.tipo).toBeNull();
    expect(result.descricao).toBeNull();
  });

  it("falls back to Ementa for descricao", () => {
    const result = parseEmenda({ Ementa: "Ementa alternativa" });
    expect(result.descricao).toBe("Ementa alternativa");
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
