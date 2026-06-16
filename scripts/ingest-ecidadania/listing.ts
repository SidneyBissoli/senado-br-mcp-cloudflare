/**
 * e-Cidadania full-corpus listing scraper — discovery + vote counts (§8 step 2).
 *
 * The paginated HTML listing `www12.senado.leg.br/ecidadania/pesquisamateria?p=N` is the only
 * full-coverage source of consultations (the REST `/restcolecaomais*` endpoints return only the
 * ~5-item highlight set). This module exposes a *pure* parser so it can be unit-tested from a
 * saved fixture (repo convention: pure parsers, no network in tests), plus a polite driver that
 * paginates the whole listing.
 *
 * Each consultation renders as one `<div class="resumo-materia">` block:
 *   <div class="resumo-materia">
 *     <header><a href="visualizacaomateria?id=160575">PL 5064/2023</a></header>
 *     <section><a href="...">EMENTA ...</a></section>
 *     <a href="..."><figure class="grafico-consulta-publica">
 *        <header><span>714.736</span><span>1.005.358</span></header>  <!-- SIM, NÃO -->
 *        ...<footer><span>SIM</span><span>NÃO</span></footer>
 *     </figure></a>
 *   </div>
 * The id in `visualizacaomateria?id=` is the legislative matter code (`codigoMateria`) — corroborated
 * by obter_consulta(164804) ↔ PL 2987/2024 and id 160575 ↔ PL 5064/2023.
 *
 * The parser keys on these stable patterns (anchors + the figure-header vote spans), NOT on the
 * surrounding div/class layout, so cosmetic markup changes don't silently break discovery.
 */

import { parseBrNum, extractId } from "../../src/scraper/ecidadania.js";

export interface ListingItem {
  /** e-Cidadania matter code (== codigoMateria), from visualizacaomateria?id=. */
  codigoMateria: number;
  votosSim: number;
  votosNao: number;
  /** Short identification (e.g. "PL 5064/2023"), when present on the listing. */
  identificacao: string | null;
  /** Ementa text, when present on the listing. */
  ementa: string | null;
}

/** Decode the handful of HTML entities that appear in listing anchor text. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse one listing page into consultation items. Pure and side-effect-free.
 * Items missing a parseable id are skipped (defensive against partial/garbage blocks).
 */
export function parseConsultaListingPage(html: string): ListingItem[] {
  const blocks = html.split(/<div class="resumo-materia">/i).slice(1);
  const items: ListingItem[] = [];
  for (const block of blocks) {
    const codigoMateria = extractId(block);
    if (codigoMateria === null) continue;

    const identMatch = block.match(/<header>\s*<a[^>]*>([^<]+)<\/a>/i);
    const ementaMatch = block.match(/<section>\s*<a[^>]*>([^<]+)<\/a>/i);
    // The real vote counts are the two <span>s in the figure's <header> (SIM then NÃO).
    const votesMatch = block.match(
      /<figure[^>]*class="grafico-consulta-publica"[^>]*>\s*<header>\s*<span>([\d.]+)<\/span>\s*<span>([\d.]+)<\/span>/i,
    );

    items.push({
      codigoMateria,
      votosSim: votesMatch ? parseBrNum(votesMatch[1]) : 0,
      votosNao: votesMatch ? parseBrNum(votesMatch[2]) : 0,
      identificacao: identMatch ? decodeEntities(identMatch[1]) : null,
      ementa: ementaMatch ? decodeEntities(ementaMatch[1]) : null,
    });
  }
  return items;
}

/**
 * Discover the last page number from the pagination links (`pesquisamateria?p=N`).
 * Takes the max across all such links — robust to whether the "último" marker is present.
 * Returns 1 when no pagination is found (single-page listing).
 */
export function findLastPage(html: string): number {
  const pages = [...html.matchAll(/pesquisamateria\?p=(\d+)/gi)].map((m) => parseInt(m[1], 10));
  return pages.length ? Math.max(...pages) : 1;
}
