/**
 * Fixture-based unit tests for the ideias full-corpus listing parser.
 *
 * Fixture: a trimmed but faithful capture of pesquisaideia?situacao=5&p=1 (2 idea blocks +
 * pagination). Pure parser, no network — matches the repo scraper test convention. Also covers the
 * SITUACAO_STATUS map and the canonical IdeiaResumo byte-compatibility (a corpus row built from a
 * listing item must hash identically to the one the 2h splice would produce for the same fields).
 */

import { describe, it, expect } from "vitest";
import {
  parseIdeiaListingPage,
  findLastPageIdeias,
  SITUACAO_STATUS,
} from "../../scripts/ingest-ecidadania/ideias-listing.js";
import { buildIdeiaResumo } from "../../src/scraper/ecidadania.js";
import { contentHash } from "../../src/scraper/pipeline.js";
import ideiasHtml from "../fixtures/ecidadania/ideias-listing-p1.html?raw";

describe("parseIdeiaListingPage", () => {
  const items = parseIdeiaListingPage(ideiasHtml);

  it("extracts one item per resumo-ideia block", () => {
    expect(items).toHaveLength(2);
  });

  it("parses the id from visualizacaoideia?id=", () => {
    expect(items.map((i) => i.id)).toEqual([80429, 80111]);
  });

  it("parses apoios from the first footer span (thousand-separated)", () => {
    expect(items[0].apoios).toBe(253804);
    expect(items[1].apoios).toBe(1542);
  });

  it("decodes the title (named entities → chars)", () => {
    expect(items[0].titulo).toBe("Educação financeira nas escolas públicas & privadas");
    expect(items[1].titulo).toBe("Revisão da política de saneamento básico");
  });

  it("returns an empty array for markup with no idea blocks", () => {
    expect(parseIdeiaListingPage("<html><body>nada</body></html>")).toEqual([]);
  });
});

describe("findLastPageIdeias", () => {
  it("returns the max page across pesquisaideia?...p= links (situacao between ? and p=)", () => {
    expect(findLastPageIdeias(ideiasHtml)).toBe(2434);
  });

  it("returns 1 when there is no pagination", () => {
    expect(findLastPageIdeias("<html>single</html>")).toBe(1);
  });
});

describe("SITUACAO_STATUS map", () => {
  it("buckets the live situacao values into the IdeiaResumo status vocabulary", () => {
    expect(SITUACAO_STATUS[5]).toBe("aberta");
    expect(SITUACAO_STATUS[6]).toBe("aberta");
    expect(SITUACAO_STATUS[8]).toBe("aberta");
    expect(SITUACAO_STATUS[7]).toBe("encerrada");
    expect(SITUACAO_STATUS[9]).toBe("encerrada");
    expect(SITUACAO_STATUS[10]).toBe("convertida");
  });
});

describe("buildIdeiaResumo byte-compatibility", () => {
  it("a corpus row and the equivalent splice produce the same content hash", () => {
    const listingItem = parseIdeiaListingPage(ideiasHtml)[0];
    // Corpus row built from the listing (weekly job path), status tagged by the situacao bucket.
    const corpus = buildIdeiaResumo({ ...listingItem, status: "aberta" });
    // The 2h splice path: rebuild from corpus fields + the same metric → must be byte-identical.
    const spliced = buildIdeiaResumo({
      id: corpus.id,
      titulo: corpus.titulo,
      apoios: corpus.apoios,
      dataPublicacao: corpus.dataPublicacao,
      status: corpus.status,
      autor: corpus.autor,
      url: corpus.url,
    });
    expect(JSON.stringify(spliced)).toBe(JSON.stringify(corpus));
    expect(contentHash(JSON.stringify(spliced))).toBe(contentHash(JSON.stringify(corpus)));
  });

  it("keeps the canonical field order", () => {
    expect(Object.keys(buildIdeiaResumo({ id: 1 }))).toEqual([
      "id", "titulo", "apoios", "dataPublicacao", "status", "autor", "url",
    ]);
  });

  it("defaults autor/dataPublicacao to null (detail-only fields)", () => {
    const r = buildIdeiaResumo({ id: 7, titulo: "x", apoios: 3, status: "aberta" });
    expect(r.autor).toBeNull();
    expect(r.dataPublicacao).toBeNull();
    expect(r.url).toContain("visualizacaoideia?id=7");
  });
});
