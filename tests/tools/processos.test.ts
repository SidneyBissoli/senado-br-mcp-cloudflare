import { describe, it, expect } from "vitest";
import { parseProcessoResumo, parseProcessoDetalhe, ensureISODate, parseEmendaProcesso, parseRelatoriaProcesso, parseAutorAtual, TABELAS_PROCESSO, normalizeTramitando, compactAutoria } from "../../src/tools/processos.js";
import { digArrayRoot } from "../../src/utils/upstream-parse.js";

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
    // OBS-3: tramitando normalized to boolean
    expect(result.tramitando).toBe(true);
    // OBS-2: single author kept as-is with count
    expect(result.autoria).toBe("Senador Fulano");
    expect(result.totalAutores).toBe(1);
  });

  it("normalizes tramitando 'Não' and compacts a long author list (OBS-2/3)", () => {
    const autoria = "Senador A (PT/BA), Senador B (PL/SP), Senador C (MDB/RJ), Senador D (PP/RS), Senador E (PSD/CE)";
    const result = parseProcessoResumo({ autoria, tramitando: "Não" });
    expect(result.tramitando).toBe(false);
    expect(result.totalAutores).toBe(5);
    expect(result.autoria).toContain("Senador A (PT/BA)");
    expect(result.autoria).toContain("e mais 2");
    expect(result.autoria).toContain("(5 no total)");
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
      tramitando: "Sim",
      situacaoAtual: "REMETIDA À CÂMARA DOS DEPUTADOS",
      siglaSituacaoAtual: "REMET_CD",
      dataSituacaoAtual: "2026-06-16",
      deliberacao: { data: "2026-06-16", siglaTipo: "APROVADA_NO_PLENARIO", tipoDeliberacao: "Aprovada pelo Plenário", siglaDestino: "CAMARA", destino: "À Câmara dos Deputados" },
      normaGerada: {},
    };
    const result = parseProcessoDetalhe(p);
    expect(result.id).toBe(12345);
    expect(result.sigla).toBe("PL");
    expect(result.numero).toBe(100);
    expect(result.ementa).toBe("Ementa detalhada");
    expect(result.dataApresentacao).toBe("2024-03-15");
    expect(result.autoria).toBe("Senador Fulano");
    expect(result.urlDocumento).toBe("https://example.com/doc.pdf");
    // OBS-3 + OBS-17
    expect(result.tramitando).toBe(true);
    expect(result.situacaoAtual).toBe("REMETIDA À CÂMARA DOS DEPUTADOS");
    expect(result.deliberacao).toEqual({ data: "2026-06-16", tipo: "Aprovada pelo Plenário", destino: "À Câmara dos Deputados" });
    // empty {} normaGerada collapses to null
    expect(result.normaGerada).toBeNull();
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
  it("parses a v3 emenda item with structured decisoes (OBS-18)", () => {
    const result = parseEmendaProcesso({
      id: 99,
      identificacao: "EMENDA 1 - PLEN",
      numero: 1,
      tipo: "EMENDA",
      autoria: "Senador Fulano (PT/BA)",
      dataApresentacao: "2020-06-20",
      siglaColegiado: "PLEN",
      descricaoDocumentoEmenda: "Emenda de plenário",
      // upstream shape: array of objects, descricaoTipo carries a trailing space
      decisoes: [{ casa: "SF", data: "2026-06-16", descricaoTipo: "Rejeitada ", siglaColegiado: "CI", nomeColegiado: "Comissão de Serviços de Infraestrutura" }],
      urlDocumentoEmenda: "https://legis.senado.gov.br/e1",
    });
    expect(result.id).toBe(99);
    expect(result.numero).toBe(1);
    expect(result.colegiado).toBe("PLEN");
    expect(result.decisoes).toEqual([
      { casa: "SF", data: "2026-06-16", tipo: "Rejeitada", comissao: "CI", nomeComissao: "Comissão de Serviços de Infraestrutura" },
    ]);
    expect(result.url).toBe("https://legis.senado.gov.br/e1");
  });

  it("parses decisoes delivered as JSON-serialized strings", () => {
    const result = parseEmendaProcesso({
      id: 5,
      decisoes: ['{"casa":"SF","data":"2026-06-16","descricaoTipo":"Aprovada ","siglaColegiado":"PLEN","nomeColegiado":"Plenário"}'],
    });
    expect(result.decisoes).toEqual([
      { casa: "SF", data: "2026-06-16", tipo: "Aprovada", comissao: "PLEN", nomeComissao: "Plenário" },
    ]);
  });

  it("handles empty input", () => {
    const result = parseEmendaProcesso({});
    expect(result.id).toBeNull();
    expect(result.decisoes).toEqual([]);
  });
});

describe("normalizeTramitando (OBS-3)", () => {
  it("maps string and boolean forms", () => {
    expect(normalizeTramitando("Sim")).toBe(true);
    expect(normalizeTramitando("Não")).toBe(false);
    expect(normalizeTramitando("Nao")).toBe(false);
    expect(normalizeTramitando("S")).toBe(true);
    expect(normalizeTramitando("N")).toBe(false);
    expect(normalizeTramitando(true)).toBe(true);
    expect(normalizeTramitando(false)).toBe(false);
    expect(normalizeTramitando(null)).toBeNull();
    expect(normalizeTramitando("")).toBeNull();
  });
});

describe("compactAutoria (OBS-2)", () => {
  it("keeps short lists intact", () => {
    const r = compactAutoria("Senador A (PT/BA), Senador B (PL/SP)");
    expect(r.totalAutores).toBe(2);
    expect(r.autoria).toBe("Senador A (PT/BA), Senador B (PL/SP)");
  });
  it("summarizes long lists", () => {
    const r = compactAutoria("Senador A (PT/BA), Senador B (PL/SP), Senador C (MDB/RJ), Senador D (PP/RS)");
    expect(r.totalAutores).toBe(4);
    expect(r.autoria).toContain("e mais 1");
  });
  it("handles empty", () => {
    expect(compactAutoria(null)).toEqual({ autoria: null, totalAutores: 0 });
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

describe("autores root (BUG-032)", () => {
  // Live dump: ListaAutores.Autores.Autor[]; the old parser read .Autores.Parlamentar.
  it("resolves authors at the real root and parses them", () => {
    const response = {
      ListaAutores: {
        Autores: {
          Autor: [
            { CodigoParlamentar: "4981", NomeParlamentar: "Acir Gurgacz", UfParlamentar: "RO", QuantidadeMaterias: "56" },
          ],
        },
      },
    };
    const autores = digArrayRoot(response, [["ListaAutores", "Autores", "Autor"]], "t").map(parseAutorAtual);
    expect(autores).toHaveLength(1);
    expect(autores[0].quantidadeMaterias).toBe(56);
    // The old (wrong) path yields nothing.
    expect((response as any).ListaAutores.Autores.Parlamentar).toBeUndefined();
  });
});
