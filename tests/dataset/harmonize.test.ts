import { describe, it, expect } from "vitest";
import { harmonizeRow, harmonizeEntity, type CorpusRow } from "../../src/dataset/harmonize.js";
import { DATASET_LICENSE, DATASET_SCHEMA_VERSION, ENTITY_SCHEMAS } from "../../src/dataset/schema.js";
import type { FieldEnvelope } from "../../src/dataset/provenance.js";

const RETRIEVED = "2026-06-29T13:56:00.000Z";
const FIRST_SEEN = "2026-06-22T10:33:00.000Z";

/** Envelope de toda variável tem exatamente os 6 campos do contrato, com os valores fixos corretos. */
function expectEnvelopeShape(env: FieldEnvelope, retrievedAt: string) {
  expect(Object.keys(env)).toEqual([
    "value",
    "sourceEndpoint",
    "sourceField",
    "retrievedAt",
    "license",
    "schemaVersion",
  ]);
  expect(env.license).toBe(DATASET_LICENSE);
  expect(env.schemaVersion).toBe(DATASET_SCHEMA_VERSION);
  expect(env.retrievedAt).toBe(retrievedAt);
}

describe("harmonizeRow — consultas", () => {
  const payload = {
    id: 164804,
    materia: "PL 2987/2024",
    ementa: "Dispõe sobre X.",
    votosSim: 714736,
    votosNao: 1005358,
    totalVotos: 1720094,
    percentualSim: 42,
    percentualNao: 58,
    status: "aberta",
    url: "https://www12.senado.leg.br/ecidadania/visualizacaomateria?id=164804",
  };
  const row: CorpusRow = { entityId: 164804, scrapedAt: RETRIEVED, payload, firstSeenAt: FIRST_SEEN };
  const rec = harmonizeRow("consultas", row);

  it("preserva identidade e cobre todas as variáveis do esquema", () => {
    expect(rec.entidade).toBe("consultas");
    expect(rec.entityId).toBe(164804);
    const schemaNames = ENTITY_SCHEMAS.consultas.variables.map((v) => v.name);
    expect(Object.keys(rec.fields)).toEqual(schemaNames); // ordem do esquema, estável
  });

  it("todo campo é um envelope de 6 chaves com license/schemaVersion/retrievedAt corretos", () => {
    for (const env of Object.values(rec.fields)) expectEnvelopeShape(env, RETRIEVED);
  });

  it("mapeia sourceField ao campo UPSTREAM verdadeiro (o que a ETAPA 4 confere)", () => {
    expect(rec.fields.votosSim.value).toBe(714736);
    expect(rec.fields.votosSim.sourceEndpoint).toContain("pesquisamateria");
    expect(rec.fields.votosSim.sourceField).toContain("grafico-consulta-publica");
    expect(rec.fields.materia.sourceField).toContain("header > a");
  });

  it("status: fonte é /processo?tramitando=S (transformada, não derived:)", () => {
    expect(rec.fields.status.value).toBe("aberta");
    expect(rec.fields.status.sourceEndpoint).toContain("/processo");
    expect(rec.fields.status.sourceEndpoint.startsWith("derived:")).toBe(false);
  });

  it("cálculos locais usam derived:calculo-local", () => {
    expect(rec.fields.totalVotos.sourceEndpoint).toBe("derived:calculo-local");
    expect(rec.fields.percentualSim.sourceEndpoint).toBe("derived:calculo-local");
    expect(rec.fields.url.sourceEndpoint).toBe("derived:calculo-local");
  });

  it("firstSeenAt: derived:ecidadania_history com MIN(scraped_at), nunca fonte upstream", () => {
    const fs = rec.fields.firstSeenAt;
    expect(fs.value).toBe(FIRST_SEEN);
    expect(fs.sourceEndpoint).toBe("derived:ecidadania_history");
    expect(fs.sourceField).toBe("MIN(scraped_at) per entity_id");
  });
});

describe("harmonizeRow — ideias", () => {
  const payload = {
    id: 80429,
    titulo: "Ideia X",
    apoios: 253804,
    dataPublicacao: null,
    status: "aberta",
    autor: null,
    url: "https://www12.senado.leg.br/ecidadania/visualizacaoideia?id=80429",
  };
  const rec = harmonizeRow("ideias", { entityId: 80429, scrapedAt: RETRIEVED, payload, firstSeenAt: FIRST_SEEN });

  it("dataPublicacao e autor são declarados null (detail-only, fora do corpus)", () => {
    expect(rec.fields.dataPublicacao.value).toBeNull();
    expect(rec.fields.autor.value).toBeNull();
    expect(rec.fields.dataPublicacao.sourceField).toContain("ausente na listagem");
  });

  it("status vem do parâmetro situacao da listagem", () => {
    expect(rec.fields.status.sourceEndpoint).toContain("pesquisaideia");
    expect(rec.fields.status.sourceField).toContain("situacao");
  });
});

describe("harmonizeRow — eventos", () => {
  const payload = {
    id: 39529,
    titulo: "Audiência X",
    data: "2026-06-24",
    hora: "10:00",
    comissao: "CCT",
    comentarios: 0,
    status: "agendado",
    url: "https://www12.senado.leg.br/ecidadania/visualizacaoaudiencia?id=39529",
  };
  const rec = harmonizeRow("eventos", { entityId: 39529, scrapedAt: RETRIEVED, payload, firstSeenAt: FIRST_SEEN });

  it("status documenta o fold REGISTRADO→agendado como caveat", () => {
    const def = ENTITY_SCHEMAS.eventos.variables.find((v) => v.name === "status")!;
    expect(def.caveat).toMatch(/REGISTRADO/);
    expect(rec.fields.comissao.sourceField).toContain("sigla");
  });
});

describe("harmonizeRow — consultas_votos (acervo vintage único)", () => {
  const payload = {
    id: 137498,
    materia: "PL 3799/2019",
    ementa: "Ementa",
    autoria: "Senador Y",
    status: "Descontinuado",
    votosSim: 1542,
    votosNao: 300,
    totalVotos: 1842,
    votosPorUf: { RJ: { sim: 800, nao: 100 }, SP: { sim: 742, nao: 200 } },
    url: "https://www12.senado.leg.br/ecidadania/visualizacaomateria?id=137498",
    referencePeriod: "2026-06-29",
  };
  // Sem firstSeenAt de propósito: acervo não tem série.
  const rec = harmonizeRow("consultas_votos", { entityId: 137498, scrapedAt: RETRIEVED, payload });

  it("NÃO tem firstSeenAt e TEM referencePeriod (vintage do CSV)", () => {
    expect(rec.fields.firstSeenAt).toBeUndefined();
    expect(rec.fields.referencePeriod.value).toBe("2026-06-29");
    expect(rec.fields.referencePeriod.sourceField).toContain("linha 1");
  });

  it("votos vêm da soma das linhas matéria×UF do CSV Arquimedes", () => {
    expect(rec.fields.votosSim.sourceEndpoint).toContain("Proposi");
    expect(rec.fields.votosSim.sourceField).toContain("VOTO SIM");
    expect(rec.fields.votosPorUf.value).toEqual(payload.votosPorUf);
  });
});

describe("harmonizeEntity — ordenação determinística", () => {
  it("ordena por entityId ascendente independentemente da ordem de entrada", () => {
    const mk = (id: number): CorpusRow => ({
      entityId: id,
      scrapedAt: RETRIEVED,
      payload: { id, materia: `M${id}`, votosSim: 1, votosNao: 1 },
      firstSeenAt: null,
    });
    const out = harmonizeEntity("consultas", [mk(300), mk(100), mk(200)]);
    expect(out.map((r) => r.entityId)).toEqual([100, 200, 300]);
  });

  it("é byte-idêntico entre dois runs sobre o mesmo corpus (chaves JSON estáveis)", () => {
    const rows: CorpusRow[] = [
      { entityId: 2, scrapedAt: RETRIEVED, payload: { id: 2, materia: "B", votosSim: 5, votosNao: 5 }, firstSeenAt: null },
      { entityId: 1, scrapedAt: RETRIEVED, payload: { id: 1, materia: "A", votosSim: 3, votosNao: 7 }, firstSeenAt: null },
    ];
    const a = JSON.stringify(harmonizeEntity("consultas", rows));
    const b = JSON.stringify(harmonizeEntity("consultas", [...rows].reverse()));
    expect(a).toBe(b);
  });
});
