/**
 * Fixture-based unit tests for the eventos full-corpus listing parser.
 *
 * Fixture: a trimmed but faithful capture of principalaudiencia?p=1 (2 event blocks + pagination).
 * Pure parser, no network — matches the repo scraper test convention. Also covers the canonical
 * EventoResumo byte-compatibility (a corpus row built from a listing item must hash identically to
 * one the 2h splice would produce for the same fields).
 */

import { describe, it, expect } from "vitest";
import {
  parseEventoListingPage,
  findLastPageEventos,
  mapEventoStatus,
} from "../../scripts/ingest-ecidadania/eventos-listing.js";
import { buildEventoResumo } from "../../src/scraper/ecidadania.js";
import { contentHash } from "../../src/scraper/pipeline.js";
import eventosHtml from "../fixtures/ecidadania/eventos-listing-p1.html?raw";

const NOW = new Date("2026-06-23T12:00:00Z");

describe("parseEventoListingPage", () => {
  const items = parseEventoListingPage(eventosHtml, NOW);

  it("extracts one item per resumo-audiencia block", () => {
    expect(items).toHaveLength(2);
  });

  it("parses the id from visualizacaoaudiencia?id=", () => {
    expect(items.map((i) => i.id)).toEqual([39529, 38000]);
  });

  it("derives status from the resumo-audiencia-STATUS class", () => {
    expect(items[0].status).toBe("agendado"); // AGENDADO
    expect(items[1].status).toBe("encerrado"); // REALIZADO
  });

  it("parses data/hora from the <span class=data> cell", () => {
    expect(items[0]).toMatchObject({ data: "2026-06-24", hora: "10:00" });
    expect(items[1]).toMatchObject({ data: "2025-03-10", hora: "14:30" });
  });

  it("parses the committee sigla (token after '|')", () => {
    expect(items[0].comissao).toBe("CCT");
    expect(items[1].comissao).toBe("CDH");
  });

  it("best-effort parses comentarios (Participe N or N comentários)", () => {
    expect(items[0].comentarios).toBe(70);
    expect(items[1].comentarios).toBe(120);
  });

  it("decodes the title", () => {
    expect(items[0].titulo).toContain("Avanços");
    expect(items[1].titulo).toContain("Arguição");
  });

  it("returns an empty array for markup with no event blocks", () => {
    expect(parseEventoListingPage("<html><body>nada</body></html>", NOW)).toEqual([]);
  });
});

describe("mapEventoStatus", () => {
  it("maps the class suffix", () => {
    expect(mapEventoStatus("AGENDADO", null, NOW)).toBe("agendado");
    expect(mapEventoStatus("REALIZADO", null, NOW)).toBe("encerrado");
    expect(mapEventoStatus("CANCELADO", null, NOW)).toBe("cancelado");
  });

  it("falls back to the date when there is no class suffix", () => {
    expect(mapEventoStatus(null, "2025-01-01", NOW)).toBe("encerrado"); // past
    expect(mapEventoStatus(null, "2099-01-01", NOW)).toBe("agendado"); // future
    expect(mapEventoStatus(null, null, NOW)).toBe("agendado"); // unknown → agendado
  });
});

describe("findLastPageEventos", () => {
  it("returns the max page across principalaudiencia?p= links", () => {
    expect(findLastPageEventos(eventosHtml)).toBe(55);
  });

  it("returns 1 when there is no pagination", () => {
    expect(findLastPageEventos("<html>single</html>")).toBe(1);
  });
});

describe("buildEventoResumo byte-compatibility", () => {
  it("a corpus row and the equivalent splice produce the same content hash", () => {
    const listingItem = parseEventoListingPage(eventosHtml, NOW)[0];
    // Corpus row built from the listing (weekly job path).
    const corpus = buildEventoResumo(listingItem);
    // The 2h splice path: rebuild from corpus fields + the same metric → must be byte-identical.
    const spliced = buildEventoResumo({
      id: corpus.id,
      titulo: corpus.titulo,
      data: corpus.data,
      hora: corpus.hora,
      comissao: corpus.comissao,
      comentarios: corpus.comentarios,
      status: corpus.status,
      url: corpus.url,
    });
    expect(JSON.stringify(spliced)).toBe(JSON.stringify(corpus));
    expect(contentHash(JSON.stringify(spliced))).toBe(contentHash(JSON.stringify(corpus)));
  });

  it("keeps the canonical field order", () => {
    expect(Object.keys(buildEventoResumo({ id: 1 }))).toEqual([
      "id", "titulo", "data", "hora", "comissao", "comentarios", "status", "url",
    ]);
  });
});
