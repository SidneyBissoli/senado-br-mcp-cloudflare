import { describe, it, expect } from "vitest";
import { parseProcessoResumo, parseProcessoDetalhe, ensureISODate, parseEmendaProcesso, parseRelatoriaProcesso, parseAutorAtual, TABELAS_PROCESSO } from "../../src/tools/processos.js";

describe("parseProcessoResumo", () => {
  it("parses a process search result", () => {
    const p = {
      id: 12345,
      codigoMateria: 151234,
      identificacao: "PL 100/2024",
      ementa: "Dispõe sobre...",
      tipoDocumento: "Projeto de Lei",
      dataApresentacao: "2024-03-15",
      autoria: "Senador Fulano",
      tramitando: "S",
    };
    const result = parseProcessoResumo(p);
    expect(result.id).toBe(12345);
    expect(result.codigoMateria).toBe(151234);
    expect(result.identificacao).toBe("PL 100/2024");
    expect(result.ementa).toBe("Dispõe sobre...");
    expect(result.tramitando).toBe("S");
  });

  it("returns null for missing fields", () => {
    const result = parseProcessoResumo({});
    expect(result.id).toBeNull();
    expect(result.codigoMateria).toBeNull();
    expect(result.ementa).toBeNull();
  });
});

describe("parseProcessoDetalhe", () => {
  it("parses full process detail", () => {
    const p = {
      id: 12345,
      codigoMateria: 151234,
      identificacao: "PL 100/2024",
      sigla: "PL",
      descricaoSigla: "Projeto de Lei",
      numero: 100,
      ano: 2024,
      objetivo: "Dispor sobre...",
      conteudo: { ementa: "Ementa detalhada", tipo: "Ordinário" },
      documento: {
        dataApresentacao: "2024-03-15",
        resumoAutoria: "Senador Fulano",
        indexacao: "educação; saúde",
        url: "https://example.com/doc.pdf",
      },
      tramitando: "S",
    };
    const result = parseProcessoDetalhe(p);
    expect(result.id).toBe(12345);
    expect(result.sigla).toBe("PL");
    expect(result.numero).toBe(100);
    expect(result.ementa).toBe("Ementa detalhada");
    expect(result.dataApresentacao).toBe("2024-03-15");
    expect(result.autoria).toBe("Senador Fulano");
    expect(result.urlDocumento).toBe("https://example.com/doc.pdf");
  });

  it("handles missing nested objects", () => {
    const result = parseProcessoDetalhe({});
    expect(result.ementa).toBeNull();
    expect(result.dataApresentacao).toBeNull();
    expect(result.urlDocumento).toBeNull();
  });
});

describe("ensureISODate", () => {
  it("converts YYYYMMDD to YYYY-MM-DD", () => {
    expect(ensureISODate("20240315")).toBe("2024-03-15");
  });

  it("passes through ISO dates unchanged", () => {
    expect(ensureISODate("2024-03-15")).toBe("2024-03-15");
  });

  it("returns undefined for undefined", () => {
    expect(ensureISODate(undefined)).toBeUndefined();
  });
});

describe("parseEmendaProcesso", () => {
  it("parses a v3 emenda item", () => {
    const result = parseEmendaProcesso({
      id: 99,
      identificacao: "EMENDA 1 - PLEN",
      numero: 1,
      tipo: "EMENDA",
      autoria: "Senador Fulano (PT/BA)",
      dataApresentacao: "2020-06-20",
      siglaColegiado: "PLEN",
      descricaoDocumentoEmenda: "Emenda de plenário",
      decisoes: [{ descricao: "Aprovada" }],
      urlDocumentoEmenda: "https://legis.senado.gov.br/e1",
    });
    expect(result.id).toBe(99);
    expect(result.numero).toBe(1);
    expect(result.colegiado).toBe("PLEN");
    expect(result.decisoes).toEqual(["Aprovada"]);
    expect(result.url).toBe("https://legis.senado.gov.br/e1");
  });

  it("handles empty input", () => {
    const result = parseEmendaProcesso({});
    expect(result.id).toBeNull();
    expect(result.decisoes).toEqual([]);
  });
});

describe("parseRelatoriaProcesso", () => {
  it("parses a v3 relatoria item", () => {
    const result = parseRelatoriaProcesso({
      idProcesso: 7914763,
      codigoMateria: 141944,
      identificacaoProcesso: "PL 2630/2020",
      nomeParlamentar: "Angelo Coronel",
      siglaPartidoParlamentar: "PSD",
      ufParlamentar: "BA",
      descricaoTipoRelator: "Relator",
      siglaColegiado: "PLEN",
      nomeColegiado: "Plenário do Senado Federal",
      dataDesignacao: "2020-06-26 08:57:02",
      dataDestituicao: "2020-06-30 21:07:13",
      descricaoTipoEncerramento: "Deliberação da matéria",
    });
    expect(result.relator).toBe("Angelo Coronel");
    expect(result.partido).toBe("PSD");
    expect(result.comissao).toBe("PLEN");
    expect(result.motivoEncerramento).toBe("Deliberação da matéria");
  });
});

describe("parseAutorAtual", () => {
  it("parses a legacy PascalCase author entry", () => {
    const result = parseAutorAtual({
      CodigoParlamentar: "4981",
      FormaTratamento: "Senador ",
      NomeParlamentar: "Acir Gurgacz",
      UfParlamentar: "RO",
      QuantidadeMaterias: "56",
    });
    expect(result.codigo).toBe(4981);
    expect(result.nome).toBe("Acir Gurgacz");
    expect(result.tratamento).toBe("Senador");
    expect(result.uf).toBe("RO");
    expect(result.quantidadeMaterias).toBe(56);
  });
});

describe("TABELAS_PROCESSO", () => {
  it("maps every table to a /processo path", () => {
    expect(Object.keys(TABELAS_PROCESSO)).toHaveLength(12);
    for (const path of Object.values(TABELAS_PROCESSO)) {
      expect(path.startsWith("/processo/")).toBe(true);
    }
  });
});
