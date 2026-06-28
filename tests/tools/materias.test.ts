import { describe, it, expect } from "vitest";
import {
  parseProcessoResumo,
  parseProcessoDetalhe,
  pickRelatorAtual,
  parseInformesTramitacao,
  parseDocumentoProcesso,
} from "../../src/tools/materias.js";

describe("parseProcessoResumo", () => {
  it("parses a v3 /processo search item", () => {
    const item = {
      id: 7914763,
      codigoMateria: 141944,
      identificacao: "PL 2630/2020",
      apelido: "Lei das Fake News",
      autoria: "Senador Alessandro Vieira (CIDADANIA/SE)",
      dataApresentacao: "2020-05-13",
      ementa: "Institui a Lei Brasileira de Liberdade...",
      situacaoAtual: "REMETIDA À CÂMARA DOS DEPUTADOS",
      tramitando: "Não",
      urlDocumento: "https://legis.senado.gov.br/sdleg-getter/documento?dm=8110630",
    };
    const result = parseProcessoResumo(item);
    expect(result.codigo).toBe(141944);
    expect(result.idProcesso).toBe(7914763);
    expect(result.sigla).toBe("PL");
    expect(result.numero).toBe(2630);
    expect(result.ano).toBe(2020);
    expect(result.ementa).toContain("Liberdade");
    expect(result.autor).toContain("Alessandro");
    expect(result.situacao).toBe("REMETIDA À CÂMARA DOS DEPUTADOS");
    expect(result.tramitando).toBe(false);
    expect(result.url).toContain("sdleg-getter");
  });

  it("keeps user-facing summary fields before internal ids for compact ChatGPT views", () => {
    const result = parseProcessoResumo({
      id: 7914763,
      codigoMateria: 141944,
      identificacao: "PL 2630/2020",
      dataApresentacao: "2020-05-13",
      ementa: "Institui a Lei Brasileira de Liberdade...",
      autoria: "Senador Alessandro Vieira",
      situacaoAtual: "Em tramitação",
      tramitando: "Sim",
      urlDocumento: "https://legis.senado.gov.br/doc",
    });
    expect(Object.keys(result).slice(0, 9)).toEqual([
      "sigla",
      "numero",
      "ano",
      "identificacao",
      "dataApresentacao",
      "ementa",
      "autor",
      "situacao",
      "tramitando",
    ]);
  });

  it("prefers explicit sigla/numero/ano fields when present", () => {
    const result = parseProcessoResumo({
      identificacao: "PEC 45/2019",
      sigla: "PEC",
      numero: "45",
      ano: 2019,
      tramitando: "Sim",
    });
    expect(result.sigla).toBe("PEC");
    expect(result.numero).toBe(45);
    expect(result.ano).toBe(2019);
    expect(result.tramitando).toBe(true);
  });

  it("returns defaults for empty input", () => {
    const result = parseProcessoResumo({});
    expect(result.codigo).toBeNull();
    expect(result.idProcesso).toBeNull();
    expect(result.sigla).toBe("");
    expect(result.numero).toBe(0);
    expect(result.ementa).toBeNull();
    expect(result.tramitando).toBeNull();
  });
});

describe("parseProcessoDetalhe", () => {
  const det = {
    id: 7914763,
    codigoMateria: 141944,
    identificacao: "PL 2630/2020",
    sigla: "PL",
    numero: "2630",
    ano: 2020,
    apelido: "Lei das Fake News",
    tramitando: "Não",
    situacaoAtual: "REMETIDA À CÂMARA DOS DEPUTADOS",
    dataSituacaoAtual: "2020-07-03",
    documento: {
      dataApresentacao: "2020-05-13",
      indexacao: " CRIAÇÃO , LEI FEDERAL .",
      url: "https://legis.senado.gov.br/sdleg-getter/documento?dm=8110630",
    },
    autoriaIniciativa: [
      { autor: "Alessandro Vieira", descricaoTipo: "SENADOR", siglaPartido: "CIDADANIA", uf: "SE" },
    ],
    classificacoes: [
      { descricao: "Ciência, Tecnologia e Informática", descricaoHierarquia: "Economia / Ciência" },
    ],
    autuacoes: [{ numero: 1, nomeEnteControleAtual: "Coordenação de Arquivo" }],
    deliberacao: {
      data: "2020-06-30",
      siglaTipo: "APROVADA_NO_PLENARIO",
      tipoDeliberacao: "Aprovada pelo Plenário",
      destino: "À Câmara dos Deputados",
    },
    normaGerada: {},
  };

  it("parses full v3 detail", () => {
    const result = parseProcessoDetalhe(det);
    expect(result.codigo).toBe(141944);
    expect(result.idProcesso).toBe(7914763);
    expect(result.sigla).toBe("PL");
    expect(result.numero).toBe(2630);
    expect(result.apelido).toBe("Lei das Fake News");
    expect(result.autor).toBe("Alessandro Vieira");
    expect(result.tipoAutor).toBe("SENADOR");
    expect(result.situacao).toBe("REMETIDA À CÂMARA DOS DEPUTADOS");
    expect(result.localAtual).toBe("Coordenação de Arquivo");
    expect(result.dataApresentacao).toBe("2020-05-13");
    expect(result.indexacao).toBe("CRIAÇÃO , LEI FEDERAL .");
    expect(result.tramitando).toBe(false);
    expect(result.classificacoes).toEqual(["Economia / Ciência"]);
    expect(result.deliberacao).toEqual({
      data: "2020-06-30",
      tipo: "Aprovada pelo Plenário",
      destino: "À Câmara dos Deputados",
    });
  });

  it("returns null for empty normaGerada and deliberacao", () => {
    const result = parseProcessoDetalhe({ ...det, deliberacao: {}, normaGerada: {} });
    expect(result.normaGerada).toBeNull();
    expect(result.deliberacao).toBeNull();
  });

  it("handles minimal input", () => {
    const result = parseProcessoDetalhe({});
    expect(result.codigo).toBeNull();
    expect(result.autor).toBeNull();
    expect(result.localAtual).toBeNull();
    expect(result.classificacoes).toEqual([]);
  });
});

describe("pickRelatorAtual", () => {
  it("picks the rapporteur without dataDestituicao", () => {
    const result = pickRelatorAtual([
      { nomeParlamentar: "Antigo", dataDesignacao: "2020-01-01", dataDestituicao: "2020-06-01" },
      { nomeParlamentar: "Atual", siglaPartidoParlamentar: "MDB", ufParlamentar: "BA", dataDesignacao: "2020-06-26", dataDestituicao: null, descricaoTipoRelator: "Relator", siglaColegiado: "PLEN" },
    ]);
    expect(result?.nome).toBe("Atual");
    expect(result?.partido).toBe("MDB");
    expect(result?.comissao).toBe("PLEN");
  });

  it("falls back to the most recent designation when all were dismissed", () => {
    const result = pickRelatorAtual([
      { nomeParlamentar: "Primeiro", dataDesignacao: "2020-01-01", dataDestituicao: "2020-03-01" },
      { nomeParlamentar: "Segundo", dataDesignacao: "2020-06-26", dataDestituicao: "2020-06-30" },
    ]);
    expect(result?.nome).toBe("Segundo");
  });

  it("returns null for empty list", () => {
    expect(pickRelatorAtual([])).toBeNull();
  });
});

describe("parseInformesTramitacao", () => {
  it("flattens and sorts informes from all autuações", () => {
    const det = {
      autuacoes: [
        {
          informesLegislativos: [
            { data: "2020-06-30 10:00:00", colegiado: { nome: "Plenário" }, descricao: "Votação" },
            { data: "2020-05-13 08:03:49", colegiado: { nome: "Plenário do Senado Federal" }, descricao: "Leitura da matéria" },
          ],
        },
        {
          informesLegislativos: [
            { data: "2020-06-01 09:00:00", enteAdministrativo: { nome: "Secretaria" }, descricao: "Despacho" },
          ],
        },
      ],
    };
    const result = parseInformesTramitacao(det);
    expect(result).toHaveLength(3);
    expect(result[0].descricao).toBe("Leitura da matéria");
    expect(result[1].descricao).toBe("Despacho");
    expect(result[1].local).toBe("Secretaria");
    expect(result[2].descricao).toBe("Votação");
  });

  it("returns empty array when there are no autuações", () => {
    expect(parseInformesTramitacao({})).toEqual([]);
  });
});

describe("parseDocumentoProcesso", () => {
  it("parses a v3 documento item", () => {
    const result = parseDocumentoProcesso({
      descricaoTipo: "Projeto de Lei Ordinária",
      siglaTipo: "PROJETO_LEI_ORDINARIA",
      identificacao: "PL 2630/2020",
      dataDocumento: "2020-05-13",
      autoria: "Alessandro Vieira",
      urlDocumento: "https://legis.senado.gov.br/doc",
    });
    expect(result.tipo).toBe("Projeto de Lei Ordinária");
    expect(result.formato).toBe("PROJETO_LEI_ORDINARIA");
    expect(result.data).toBe("2020-05-13");
    expect(result.url).toBe("https://legis.senado.gov.br/doc");
  });

  it("uses defaults for missing fields", () => {
    const result = parseDocumentoProcesso({});
    expect(result.tipo).toBe("Documento");
    expect(result.url).toBe("");
  });
});
