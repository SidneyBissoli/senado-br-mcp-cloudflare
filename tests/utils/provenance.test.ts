/**
 * Tests for the provenance adapter over `@sbissoli/mcp-provenance` (contract v1.0,
 * release 3.5.0). What is asserted here is the SENADO-facing behavior: the historical
 * input names (`dataset_id`, `reference_period`) map into the canonical model, the
 * emitted block is the fixed 6-key `concise` projection, timestamps are Brasília
 * (-03:00), and the three emission channels keep their roles. The contract itself
 * (schema validation, determinism, footer wording) is tested in the package.
 */

import { describe, it, expect } from "vitest";
import {
  SOURCES,
  ECIDADANIA_BASE_URL,
  buildProvenance,
  provenanceFor,
  provenanceEcidadania,
  provenanceArquimedesVotos,
  provenanceFooter,
  provenanceContext,
  withFieldSources,
  resultWithProvenance,
  toBrasiliaIso,
  humanizeRetrievedAt,
  PROVENANCE_META_KEY,
  ATTRIBUTION_META_KEY,
} from "../../src/utils/provenance.js";

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

const BASE = { source: "s", source_url: "u", citation: "a", license: "l" };

describe("buildProvenance (canonical v1.0 from historical input names)", () => {
  it("defaults retrieved_at to an ISO-8601 timestamp in Brasília time", () => {
    const p = buildProvenance(BASE);
    expect(p.retrieved_at).toMatch(ISO_RE);
    expect(p.retrieved_at).toMatch(/-03:00$/);
  });

  it("preserves the INSTANT of an explicit retrieved_at, re-expressed in Brasília time (P34/P39/P42-P45)", () => {
    const p = buildProvenance({ ...BASE, retrieved_at: "2020-01-01T00:00:00.000Z" });
    // Mesmo instante: meia-noite UTC = 21h do dia anterior em Brasília.
    expect(p.retrieved_at).toBe("2019-12-31T21:00:00-03:00");
    expect(new Date(p.retrieved_at).getTime()).toBe(new Date("2020-01-01T00:00:00.000Z").getTime());
  });

  it("is idempotent for a retrieved_at already in Brasília time", () => {
    const p = buildProvenance({ ...BASE, retrieved_at: "2026-07-14T21:23:45-03:00" });
    expect(p.retrieved_at).toBe("2026-07-14T21:23:45-03:00");
  });

  it("leaves date-only vintages and unparseable strings untouched", () => {
    expect(buildProvenance({ ...BASE, retrieved_at: "2026-06-28" }).retrieved_at).toBe("2026-06-28");
    expect(buildProvenance({ ...BASE, retrieved_at: "vintage-x" }).retrieved_at).toBe("vintage-x");
  });

  it("maps dataset_id/reference_period to the canonical dataset.id/data_vintage", () => {
    const p = buildProvenance({ ...BASE, dataset_id: "codigoSessao=1", reference_period: "2024-03-15" });
    expect(p.dataset.id).toBe("codigoSessao=1");
    expect(p.data_vintage).toBe("2024-03-15");
    expect(p.contract_version).toBe("1.0");
    expect(p.source.name).toBe("s");
    expect(p.license.name).toBe("l");
  });

  it("maps field_sources (incl. reference_period → data_vintage) and normalizes their retrieved_at", () => {
    const p = buildProvenance({
      ...BASE,
      field_sources: [
        { fields: ["ementa"], source_url: "u2", reference_period: "2024", retrieved_at: "2026-01-01T01:00:00.000Z" },
      ],
    });
    expect(p.field_sources?.[0]).toEqual({
      fields: ["ementa"],
      source_url: "u2",
      dataset_id: null,
      data_vintage: "2024",
      retrieved_at: "2025-12-31T22:00:00-03:00",
    });
  });

  it("throws on an invalid envelope (empty citation)", () => {
    expect(() => buildProvenance({ ...BASE, citation: "" })).toThrow();
  });
});

describe("toBrasiliaIso / humanizeRetrievedAt", () => {
  it("converts a UTC instant to explicit -03:00 wall time", () => {
    expect(toBrasiliaIso("2026-07-15T00:23:45.123Z")).toBe("2026-07-14T21:23:45-03:00");
  });

  it("humanizes a Brasília timestamp with the explicit label", () => {
    expect(humanizeRetrievedAt("2026-07-14T21:23:45-03:00")).toBe(
      "14/07/2026 às 21:23 (horário de Brasília)",
    );
  });

  it("humanizes a date-only vintage without inventing a time", () => {
    expect(humanizeRetrievedAt("2026-06-28")).toBe("28/06/2026");
  });

  it("passes through strings outside the pattern", () => {
    expect(humanizeRetrievedAt("vintage-x")).toBe("vintage-x");
  });
});

describe("provenanceFor", () => {
  it("fills source/citation/license from the registry and builds source_url", () => {
    const p = provenanceFor("SENADO_LEGIS", "https://legis.senado.leg.br/dadosabertos", "/votacao", {
      dataset_id: "codigoSessao=1",
    });
    expect(p.source.name).toBe(SOURCES.SENADO_LEGIS.source);
    expect(p.citation).toBe(SOURCES.SENADO_LEGIS.citation);
    expect(p.license.name).toBe(SOURCES.SENADO_LEGIS.license);
    expect(p.source_url).toBe("https://legis.senado.leg.br/dadosabertos/votacao");
    expect(p.dataset.id).toBe("codigoSessao=1");
  });

  it("does not double the slash when baseUrl has a trailing slash", () => {
    const p = provenanceFor("SENADO_ADM", "https://adm.senado.gov.br/adm-dadosabertos/", "/orgao");
    expect(p.source_url).toBe("https://adm.senado.gov.br/adm-dadosabertos/orgao");
  });

  it("carries the budget-execution source (Arquimedes/Financeiro feed)", () => {
    const p = provenanceFor(
      "SENADO_ORCAMENTO_EXEC",
      "https://www.senado.gov.br",
      "/bi-arqs/Arquimedes/Financeiro/DespesaSenadoDadosAbertos.json",
      { reference_period: "2024", retrieved_at: "2026-01-01T00:00:00.000Z" },
    );
    expect(p.source.name).toBe(SOURCES.SENADO_ORCAMENTO_EXEC.source);
    expect(p.data_vintage).toBe("2024");
  });

  it("threads field_sources through into the envelope", () => {
    const p = provenanceFor("SENADO_LEGIS", "https://x", "/processo/1", {
      field_sources: [{ fields: ["ementa"], source_url: "https://x/processo" }],
    });
    expect(p.field_sources).toHaveLength(1);
    expect(p.field_sources?.[0].fields).toEqual(["ementa"]);
  });
});

describe("provenanceEcidadania / provenanceArquimedesVotos", () => {
  it("prepends the portal base for a section path", () => {
    const p = provenanceEcidadania("/principalmateria", { dataset_id: "consultas" });
    expect(p.source.name).toBe(SOURCES.ECIDADANIA.source);
    expect(p.source_url).toBe(`${ECIDADANIA_BASE_URL}/principalmateria`);
    expect(p.dataset.id).toBe("consultas");
  });

  it("uses a full item URL as-is (level-3 canonical item provenance)", () => {
    const url = "https://www12.senado.leg.br/ecidadania/visualizacaomateria?id=42";
    const p = provenanceEcidadania(url, { dataset_id: "consulta=42", retrieved_at: "2026-01-02T03:04:05.000Z" });
    expect(p.source_url).toBe(url);
    expect(p.retrieved_at).toBe("2026-01-02T00:04:05-03:00");
  });

  it("pins the Arquimedes CSV as source_url and consultas_votos as dataset", () => {
    const p = provenanceArquimedesVotos({ reference_period: "2026-07-01" });
    expect(p.source.name).toBe(SOURCES.ECIDADANIA_ARQUIMEDES.source);
    expect(p.source_url).toContain("bi-arqs/Arquimedes/ecidadania");
    expect(p.dataset.id).toBe("consultas_votos");
    expect(p.data_vintage).toBe("2026-07-01");
  });
});

describe("withFieldSources", () => {
  it("attaches mapped field_sources and is a no-op for an empty list", () => {
    const base = provenanceFor("SENADO_LEGIS", "https://x", "/processo/1");
    expect(withFieldSources(base, [])).toBe(base);
    const enriched = withFieldSources(base, [
      { fields: ["relator"], source_url: "https://x/processo/relatoria", retrieved_at: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(enriched.field_sources).toHaveLength(1);
    expect(enriched.field_sources?.[0].source_url).toBe("https://x/processo/relatoria");
    expect(enriched.field_sources?.[0].retrieved_at).toBe("2025-12-31T21:00:00-03:00");
  });

  it("throws on an invalid field source", () => {
    const base = provenanceFor("SENADO_LEGIS", "https://x", "/processo/1");
    expect(() => withFieldSources(base, [{ fields: [], source_url: "u" }])).toThrow();
  });
});

describe("provenanceFooter (contract v1.0 wording)", () => {
  it("renders source line, license line and the reader notice", () => {
    const footer = provenanceFooter(
      buildProvenance({
        source: "Senado Federal",
        source_url: "https://x/votacao",
        citation: "a",
        license: "Dados Abertos do Senado Federal — uso livre com atribuição da fonte.",
        reference_period: "2024",
        retrieved_at: "2026-06-22T12:00:00.000Z",
      }),
    );
    expect(footer).toContain("Fonte: Senado Federal");
    expect(footer).toContain("https://x/votacao");
    expect(footer).toContain("dados de 2024");
    // 12:00 UTC = 09:00 em Brasília, humanizado com o rótulo explícito do fuso.
    expect(footer).toContain("extraído em 22/06/2026 às 09:00 (horário de Brasília)");
    expect(footer).toContain("Licença: Dados Abertos do Senado Federal");
    expect(footer).toContain("A referência completa desta informação pode ser solicitada nesta própria conversa.");
  });
});

describe("resultWithProvenance (three channels, concise projection)", () => {
  it("emits the fixed 6-key concise block in structuredContent, with explicit nulls", () => {
    const prov = provenanceFor("SENADO_LEGIS", "https://x", "/votacao");
    const res = resultWithProvenance({ count: 2, votacoes: [] }, prov);
    expect(res.structuredContent).toMatchObject({ count: 2 });
    expect(Object.keys(res.structuredContent.provenance as Record<string, unknown>)).toEqual([
      "source",
      "source_url",
      "data_vintage",
      "retrieved_at",
      "citation",
      "license",
    ]);
    expect(res.structuredContent.provenance).toMatchObject({
      source: SOURCES.SENADO_LEGIS.source,
      source_url: "https://x/votacao",
      data_vintage: null,
      citation: SOURCES.SENADO_LEGIS.citation,
      license: SOURCES.SENADO_LEGIS.license,
    });
  });

  it("keeps provenance out of the text JSON (Δ-token optimization) and appends the footer", () => {
    const prov = provenanceFor("SENADO_LEGIS", "https://x", "/votacao");
    const res = resultWithProvenance({ count: 2, votacoes: [] }, prov);
    expect(res.content).toHaveLength(2);
    const textJson = JSON.parse(res.content[0].text);
    expect(textJson).toEqual({ count: 2, votacoes: [] });
    expect(res.content[1].text).toContain("Fonte:");
    expect(res.content[1].text).toContain(prov.source_url);
  });

  it("emits the RFC #711 canonical top-level `attribution` list (distinct source URLs)", () => {
    const prov = provenanceFor("SENADO_LEGIS", "https://x", "/processo/1", {
      field_sources: [
        { fields: ["ementa"], source_url: "https://x/processo" },
        { fields: ["relator"], source_url: "https://x/processo/relatoria" },
        { fields: ["dup"], source_url: "https://x/processo" }, // duplicate is de-duped
      ],
    });
    const res = resultWithProvenance({ ok: true }, prov);
    expect(res.structuredContent.attribution).toEqual([
      "https://x/processo/1",
      "https://x/processo",
      "https://x/processo/relatoria",
    ]);
  });

  it("mirrors the same concise block + attribution into result-level `_meta` under namespaced keys", () => {
    const prov = provenanceFor("SENADO_LEGIS", "https://x", "/processo/1", {
      field_sources: [{ fields: ["ementa"], source_url: "https://x/processo" }],
    });
    const res = resultWithProvenance({ ok: true }, prov);
    expect(res._meta[PROVENANCE_META_KEY]).toEqual(res.structuredContent.provenance);
    expect(res._meta[ATTRIBUTION_META_KEY]).toEqual(res.structuredContent.attribution);
    expect(PROVENANCE_META_KEY).toBe("com.sidneybissoli.senado/provenance");
    expect(ATTRIBUTION_META_KEY).toBe("com.sidneybissoli.senado/attribution");
  });

  it("produces structuredContent that passes the permissive global outputSchema", () => {
    // The server registers tools with z.object({}).passthrough(); a merged object validates.
    const prov = provenanceFor("ECIDADANIA", "https://www12.senado.leg.br/ecidadania", "/consultas");
    const res = resultWithProvenance({ ok: true }, prov);
    expect(res.structuredContent).toMatchObject({ ok: true, provenance: { source: prov.source.name } });
  });
});

describe("provenanceContext configuration", () => {
  it("is pt-BR, Brasília fixed offset, concise by default", () => {
    expect(provenanceContext.locale.id).toBe("pt-BR");
    expect(provenanceContext.timezone).toEqual({ offset: "-03:00", label: "horário de Brasília" });
    expect(provenanceContext.defaultMode).toBe("concise");
  });
});
