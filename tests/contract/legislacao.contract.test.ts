/**
 * Upstream shape-drift contract tests for src/tools/legislacao.ts.
 *
 * Contract tier: runs via `npm run test:contract` (vitest.contract.config.ts),
 * NOT part of the default `npm test` suite. Fixtures in tests/contract/fixtures/
 * are raw upstream JSON captures (sorted keys, arrays truncated to 3 items),
 * refreshed by `npm run contract:refresh`. A failure right after a live refresh
 * means real upstream shape drift, not a code bug.
 *
 * The /legislacao endpoints are legacy-style wrappers but with LOWERCASE item
 * keys (dataassinatura, anoassinatura, ...), unlike the PascalCase legacy
 * family. brDateToISO is internal (not exported) — its DD/MM/AAAA → ISO
 * conversion is asserted through the parsers' `data` output. Presence/shape
 * only — never exact values.
 */
import { describe, it, expect } from "vitest";
import { parseLegislacaoResumo, parseLegislacaoDetalhe } from "../../src/tools/legislacao.js";
import legislacaoListaRaw from "./fixtures/legado/legislacao-lista.json?raw";
import legislacaoDetalheRaw from "./fixtures/legado/legislacao-detalhe.json?raw";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const BR_DATE = /^\d{2}\/\d{2}\/\d{4}$/;

// ── /legislacao/lista (ListaDocumento.documentos.documento[]) ─────────────

describe("contract: /legislacao/lista (legacy wrapper, lowercase keys)", () => {
  const root = JSON.parse(legislacaoListaRaw);

  it("raw fixture keeps the ListaDocumento.documentos.documento[] wrapper and item keys", () => {
    const docs = root?.ListaDocumento?.documentos?.documento;
    expect(Array.isArray(docs)).toBe(true);
    expect(docs.length).toBeGreaterThan(0);
    for (const doc of docs) {
      // parser-critical fields — strict presence (all-lowercase key style)
      for (const k of ["id", "dataassinatura", "tipo", "numero", "anoassinatura", "ementa"]) {
        expect(doc, `key "${k}" missing from documento item`).toHaveProperty(k);
      }
      // dataassinatura still arrives as DD/MM/AAAA (brDateToISO's input contract)
      expect(doc.dataassinatura).toMatch(BR_DATE);
      expect(typeof doc.ementa).toBe("string");
      // optional descriptors — if present, strings
      if (doc.normaNome != null) expect(typeof doc.normaNome).toBe("string");
      if (doc.apelido != null) expect(typeof doc.apelido).toBe("string");
      if (doc.descricao != null) expect(typeof doc.descricao).toBe("string");
    }
  });

  it("parseLegislacaoResumo yields defined/typed fields from the fixture", () => {
    const docs = root.ListaDocumento.documentos.documento;
    for (const parsed of docs.map(parseLegislacaoResumo)) {
      expect(parsed.codigo).toBeDefined();
      expect(parsed.codigo).not.toBeNull();
      expect(typeof parsed.tipo).toBe("string");
      expect(parsed.numero).not.toBeNull();
      expect(parsed.ano).not.toBeNull();
      // brDateToISO converted the BR date to ISO
      expect(parsed.data).toMatch(ISO_DATE);
      expect(typeof parsed.ementa).toBe("string");
      expect((parsed.ementa as string).length).toBeGreaterThan(0);
      // optional: norma/apelido — string or null
      expect(parsed.norma === null || typeof parsed.norma === "string").toBe(true);
      expect(parsed.apelido === null || typeof parsed.apelido === "string").toBe(true);
    }
  });
});

// ── /legislacao/{codigo} (DetalheDocumento.documentos.documento[0]) ───────

describe("contract: /legislacao/{codigo} detail (legacy wrapper, nested identificacao)", () => {
  const root = JSON.parse(legislacaoDetalheRaw);

  it("raw fixture keeps the DetalheDocumento.documentos.documento[0] wrapper and nested keys", () => {
    const docs = root?.DetalheDocumento?.documentos?.documento;
    expect(Array.isArray(docs)).toBe(true);
    expect(docs.length).toBeGreaterThan(0);
    const doc = docs[0];
    // parser-critical: doc-level id/ementa + nested identificacao object
    expect(doc).toHaveProperty("id");
    expect(typeof doc.ementa).toBe("string");
    expect(doc).toHaveProperty("identificacao");
    expect(typeof doc.identificacao).toBe("object");
    for (const k of ["tipo", "numero", "dataassinatura", "urlDocumento"]) {
      expect(doc.identificacao, `key "${k}" missing from identificacao`).toHaveProperty(k);
    }
    expect(doc.identificacao.dataassinatura).toMatch(BR_DATE);
    // indexacao.frase carries the thematic terms (array or single string)
    expect(doc).toHaveProperty("indexacao");
    const frase = doc.indexacao?.frase;
    expect(Array.isArray(frase) || typeof frase === "string").toBe(true);
    // optional: descricao/normaNome/apelido inside identificacao — if present, strings
    if (doc.identificacao.descricao != null) expect(typeof doc.identificacao.descricao).toBe("string");
    if (doc.identificacao.normaNome != null) expect(typeof doc.identificacao.normaNome).toBe("string");
  });

  it("parseLegislacaoDetalhe yields defined/typed fields from the fixture", () => {
    const parsed = parseLegislacaoDetalhe(root.DetalheDocumento.documentos.documento[0]);
    expect(parsed.codigo).toBeDefined();
    expect(parsed.codigo).not.toBeNull();
    expect(typeof parsed.tipo).toBe("string");
    expect(parsed.numero).not.toBeNull();
    expect(parsed.ano).not.toBeNull();
    // brDateToISO converted the nested BR date to ISO
    expect(parsed.data).toMatch(ISO_DATE);
    expect(typeof parsed.ementa).toBe("string");
    expect((parsed.ementa as string).length).toBeGreaterThan(0);
    // indexacao.frase[] must join into a non-empty whitespace-normalized string
    expect(typeof parsed.indexacao).toBe("string");
    expect((parsed.indexacao as string).length).toBeGreaterThan(0);
    expect(parsed.indexacao).not.toMatch(/\s{2,}/);
    expect(typeof parsed.url).toBe("string");
    expect((parsed.url as string).length).toBeGreaterThan(0);
    // optional: norma/apelido — string or null
    expect(parsed.norma === null || typeof parsed.norma === "string").toBe(true);
    expect(parsed.apelido === null || typeof parsed.apelido === "string").toBe(true);
  });
});
