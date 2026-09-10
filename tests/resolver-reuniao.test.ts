import { describe, it, expect } from "vitest";
import {
  escolherReuniao,
  ehReuniaoInexistente,
  mensagemCodigoInexistente,
  type ReuniaoResumo,
} from "../src/tools/resolver-reuniao.js";

/**
 * Conserto de `senado_reuniao_comissao`, que falhava em 74 de 74 chamadas
 * porque a única entrada era um inteiro interno que ninguém tem. Estes casos
 * guardam as três decisões do resolvedor e a mensagem que substitui o
 * "tente de novo" — conselho errado para um código que não existe.
 */
const r = (codigo: number, data: string, descricao = "Ordinária"): ReuniaoResumo => ({
  codigo,
  data,
  descricao,
  hora: "10:00",
});

describe("escolherReuniao", () => {
  it("uma só: resolve o código", () => {
    expect(escolherReuniao([r(14910, "2026-09-01")], "CAE", "20260901")).toEqual({
      tipo: "codigo",
      codigo: 14910,
    });
  });

  it("nenhuma: diz o que fazer, sem prometer que repetir resolve", () => {
    const res = escolherReuniao([], "CAE", "20260901");
    expect(res.tipo).toBe("nenhuma");
    if (res.tipo === "nenhuma") {
      expect(res.mensagem).toContain("CAE");
      expect(res.mensagem).toContain("senado_listar_comissoes");
      expect(res.mensagem).not.toMatch(/repita a chamada|tente de novo/i);
    }
  });

  it("várias: devolve as candidatas com código, em vez da lista no lugar do detalhe", () => {
    const res = escolherReuniao(
      [r(1, "2026-09-01", "Ordinária"), r(2, "2026-09-01", "Extraordinária")],
      "CAE",
      "20260901",
    );
    expect(res.tipo).toBe("ambigua");
    if (res.tipo === "ambigua") {
      expect(res.mensagem).toContain("codigoReuniao");
      expect(res.mensagem).toContain("1 (2026-09-01");
      expect(res.mensagem).toContain("2 (2026-09-01");
    }
  });

  it("muitas: corta a lista para não estourar a resposta", () => {
    const muitas = Array.from({ length: 25 }, (_, i) => r(i + 1, "2026-09-01"));
    const res = escolherReuniao(muitas, "CAE", "20260901");
    expect(res.tipo).toBe("ambigua");
    if (res.tipo === "ambigua") {
      expect(res.mensagem).toContain("25 reuniões");
      expect(res.mensagem).toContain("…");
      expect(res.mensagem).not.toContain("; 12 (");
    }
  });
});

describe("ehReuniaoInexistente", () => {
  it("reconhece a resposta vazia DESTE endpoint", () => {
    expect(ehReuniaoInexistente(new Error("[/comissao/reuniao/999999] Resposta upstream vazia"))).toBe(true);
    expect(ehReuniaoInexistente(new Error("[/comissao/reuniao/1] Resposta upstream não é JSON válido"))).toBe(true);
  });

  it("NÃO confunde com o vazio de outro endpoint, que pode ser transitório", () => {
    expect(ehReuniaoInexistente(new Error("[/comissao/agenda/20260901/20260901] Resposta upstream vazia"))).toBe(false);
    expect(ehReuniaoInexistente(new Error("[/comissao/reuniao/9] Tempo esgotado"))).toBe(false);
    expect(ehReuniaoInexistente(new Error("qualquer outra coisa"))).toBe(false);
  });
});

describe("mensagemCodigoInexistente", () => {
  it("diz o número, o caminho novo e que repetir não adianta", () => {
    const m = mensagemCodigoInexistente(999999);
    expect(m).toContain("999999");
    expect(m).toContain("sigla e data");
    expect(m).toContain("não vai funcionar");
  });
});
