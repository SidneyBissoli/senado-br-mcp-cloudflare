import { describe, it, expect } from "vitest";
import {
  ProvenanceSchema,
  FieldSourceSchema,
  SOURCES,
  ECIDADANIA_BASE_URL,
  buildProvenance,
  provenanceFor,
  provenanceEcidadania,
  provenanceFooter,
  withFieldSources,
  resultWithProvenance,
} from "../../src/utils/provenance.js";

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

describe("ProvenanceSchema", () => {
  it("accepts a complete level-1 envelope", () => {
    const ok = ProvenanceSchema.safeParse({
      source: "Senado Federal",
      source_url: "https://legis.senado.leg.br/dadosabertos/votacao",
      dataset_id: "codigoSessao=123",
      reference_period: "2024-03-15",
      retrieved_at: "2026-06-22T12:00:00.000Z",
      citation: "Fonte: Senado Federal.",
      license: "Dados Abertos.",
    });
    expect(ok.success).toBe(true);
  });

  it("requires source, source_url, retrieved_at and citation (the non-empty level-1 core)", () => {
    for (const field of ["source", "source_url", "retrieved_at", "citation"]) {
      const base: Record<string, string> = {
        source: "s",
        source_url: "u",
        retrieved_at: "t",
        citation: "a",
      };
      delete base[field];
      expect(ProvenanceSchema.safeParse(base).success, `missing ${field}`).toBe(false);
    }
  });

  it("rejects empty strings on required fields", () => {
    expect(
      ProvenanceSchema.safeParse({ source: "", source_url: "u", retrieved_at: "t", citation: "a" })
        .success,
    ).toBe(false);
  });

  it("accepts an optional field_sources array (field-level granularity)", () => {
    const ok = ProvenanceSchema.safeParse({
      source: "s",
      source_url: "u",
      retrieved_at: "t",
      citation: "a",
      field_sources: [{ fields: ["ementa"], source_url: "u2", retrieved_at: "t2" }],
    });
    expect(ok.success).toBe(true);
  });
});

describe("FieldSourceSchema", () => {
  it("requires at least one field name and a source_url", () => {
    expect(FieldSourceSchema.safeParse({ fields: [], source_url: "u" }).success).toBe(false);
    expect(FieldSourceSchema.safeParse({ fields: ["x"], source_url: "" }).success).toBe(false);
    expect(FieldSourceSchema.safeParse({ fields: ["x"], source_url: "u" }).success).toBe(true);
  });
});

describe("buildProvenance", () => {
  it("defaults retrieved_at to an ISO-8601 timestamp", () => {
    const p = buildProvenance({ source: "s", source_url: "u", citation: "a" });
    expect(p.retrieved_at).toMatch(ISO_RE);
  });

  it("preserves an explicit retrieved_at (the cache-fidelity seam)", () => {
    const p = buildProvenance({
      source: "s",
      source_url: "u",
      citation: "a",
      retrieved_at: "2020-01-01T00:00:00.000Z",
    });
    expect(p.retrieved_at).toBe("2020-01-01T00:00:00.000Z");
  });

  it("throws on an invalid envelope (missing citation)", () => {
    // @ts-expect-error intentionally incomplete
    expect(() => buildProvenance({ source: "s", source_url: "u" })).toThrow();
  });
});

describe("provenanceFor", () => {
  it("fills source/citation/license from the registry and builds source_url", () => {
    const p = provenanceFor("SENADO_LEGIS", "https://legis.senado.leg.br/dadosabertos", "/votacao", {
      dataset_id: "codigoSessao=1",
    });
    expect(p.source).toBe(SOURCES.SENADO_LEGIS.source);
    expect(p.citation).toBe(SOURCES.SENADO_LEGIS.citation);
    expect(p.license).toBe(SOURCES.SENADO_LEGIS.license);
    expect(p.source_url).toBe("https://legis.senado.leg.br/dadosabertos/votacao");
    expect(p.dataset_id).toBe("codigoSessao=1");
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
    expect(p.source).toBe(SOURCES.SENADO_ORCAMENTO_EXEC.source);
    expect(p.source_url).toBe(
      "https://www.senado.gov.br/bi-arqs/Arquimedes/Financeiro/DespesaSenadoDadosAbertos.json",
    );
    expect(p.reference_period).toBe("2024");
  });

  it("threads field_sources through into the envelope", () => {
    const p = provenanceFor("SENADO_LEGIS", "https://x", "/processo/1", {
      field_sources: [{ fields: ["ementa"], source_url: "https://x/processo" }],
    });
    expect(p.field_sources).toHaveLength(1);
    expect(p.field_sources?.[0].fields).toEqual(["ementa"]);
  });
});

describe("provenanceEcidadania", () => {
  it("prepends the portal base for a section path", () => {
    const p = provenanceEcidadania("/principalmateria", { dataset_id: "consultas" });
    expect(p.source).toBe(SOURCES.ECIDADANIA.source);
    expect(p.source_url).toBe(`${ECIDADANIA_BASE_URL}/principalmateria`);
    expect(p.dataset_id).toBe("consultas");
  });

  it("uses a full item URL as-is (level-3 canonical item provenance)", () => {
    const url = "https://www12.senado.leg.br/ecidadania/visualizacaomateria?id=42";
    const p = provenanceEcidadania(url, { dataset_id: "consulta=42", retrieved_at: "2026-01-02T03:04:05.000Z" });
    expect(p.source_url).toBe(url);
    expect(p.retrieved_at).toBe("2026-01-02T03:04:05.000Z");
  });
});

describe("withFieldSources", () => {
  it("attaches validated field_sources and is a no-op for an empty list", () => {
    const base = provenanceFor("SENADO_LEGIS", "https://x", "/processo/1");
    expect(withFieldSources(base, [])).toBe(base);
    const enriched = withFieldSources(base, [
      { fields: ["relator"], source_url: "https://x/processo/relatoria", retrieved_at: "2026-01-01T00:00:00.000Z" },
    ]);
    expect(enriched.field_sources).toHaveLength(1);
    expect(enriched.field_sources?.[0].source_url).toBe("https://x/processo/relatoria");
  });

  it("throws on an invalid field source", () => {
    const base = provenanceFor("SENADO_LEGIS", "https://x", "/processo/1");
    // @ts-expect-error fields is required and non-empty
    expect(() => withFieldSources(base, [{ source_url: "u" }])).toThrow();
  });
});

describe("provenanceFooter", () => {
  it("renders a compact source line with the period when present", () => {
    const footer = provenanceFooter(
      buildProvenance({
        source: "Senado Federal",
        source_url: "https://x/votacao",
        citation: "a",
        reference_period: "2024",
        retrieved_at: "2026-06-22T12:00:00.000Z",
      }),
    );
    expect(footer).toContain("Fonte: Senado Federal");
    expect(footer).toContain("https://x/votacao");
    expect(footer).toContain("extraído em 2026-06-22T12:00:00.000Z");
    expect(footer).toContain("competência 2024");
  });
});

describe("resultWithProvenance", () => {
  it("puts provenance in structuredContent and the compact footer, NOT in the text JSON", () => {
    const prov = provenanceFor("SENADO_LEGIS", "https://x", "/votacao");
    const res = resultWithProvenance({ count: 2, votacoes: [] }, prov);

    // structuredContent carries the full envelope (Opção 2 — parseable channel).
    expect(res.structuredContent.provenance).toEqual(prov);
    expect(res.structuredContent).toMatchObject({ count: 2 });
    expect(res.content).toHaveLength(2);

    // The text JSON block holds only the data — provenance must NOT be duplicated here
    // (the Δ-token optimization). The compact footer (Opção 1) carries the source for
    // text-only clients.
    const textJson = JSON.parse(res.content[0].text);
    expect(textJson).toEqual({ count: 2, votacoes: [] });
    expect(textJson.provenance).toBeUndefined();
    expect(textJson.attribution).toBeUndefined();
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

  it("attribution is just the single source_url when there are no field_sources", () => {
    const prov = provenanceFor("SENADO_LEGIS", "https://x", "/votacao");
    const res = resultWithProvenance({ ok: true }, prov);
    expect(res.structuredContent.attribution).toEqual(["https://x/votacao"]);
  });

  it("produces structuredContent that passes the permissive global outputSchema", () => {
    // The server registers tools with z.object({}).passthrough(); a merged object validates.
    const prov = provenanceFor("ECIDADANIA", "https://www12.senado.leg.br/ecidadania", "/consultas");
    const res = resultWithProvenance({ ok: true }, prov);
    expect(res.structuredContent).toMatchObject({ ok: true, provenance: { source: prov.source } });
  });
});
