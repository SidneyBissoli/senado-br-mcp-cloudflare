/**
 * Fixture-based unit tests for the full-corpus listing parser (§8 step 2).
 *
 * The fixture is a trimmed but faithful capture of pesquisamateria?p=1 (3 consultation blocks +
 * the real pagination nav). Pure parser, no network — matches the repo's scraper test convention.
 * Refresh the fixture in tests/fixtures/ecidadania/ if the portal markup changes.
 */

import { describe, it, expect } from "vitest";
import { parseConsultaListingPage, findLastPage } from "../../scripts/ingest-ecidadania/listing.js";
import listingHtml from "../fixtures/ecidadania/consultas-listing-p1.html?raw";

describe("parseConsultaListingPage", () => {
  const items = parseConsultaListingPage(listingHtml);

  it("extracts one item per resumo-materia block", () => {
    expect(items).toHaveLength(3);
  });

  it("parses codigoMateria from the visualizacaomateria id (== matter code)", () => {
    expect(items.map((i) => i.codigoMateria)).toEqual([160575, 149624, 137929]);
  });

  it("parses SIM/NÃO vote counts from the figure header (Brazilian number format)", () => {
    expect(items[0]).toMatchObject({ votosSim: 714736, votosNao: 1005358 });
    expect(items[1]).toMatchObject({ votosSim: 351491, votosNao: 8839 });
    expect(items[2]).toMatchObject({ votosSim: 344917, votosNao: 10363 });
  });

  it("captures identificacao and ementa from the listing anchors", () => {
    expect(items[0].identificacao).toBe("PL 5064/2023");
    expect(items[0].ementa).toContain("Concede anistia");
    expect(items[2].identificacao).toBe("PLP 183/2019");
  });

  it("returns an empty array for markup with no consultation blocks", () => {
    expect(parseConsultaListingPage("<html><body>nada</body></html>")).toEqual([]);
  });
});

describe("findLastPage", () => {
  it("returns the max page number across pagination links", () => {
    expect(findLastPage(listingHtml)).toBe(77);
  });

  it("returns 1 when there is no pagination", () => {
    expect(findLastPage("<html><body>single page</body></html>")).toBe(1);
  });
});
