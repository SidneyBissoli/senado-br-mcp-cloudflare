/**
 * e-Cidadania IDEIAS full-corpus listing scraper (ideias legislativas).
 *
 * Source: the paginated HTML listing `www12.senado.leg.br/ecidadania/pesquisaideia?p=N`
 * (the REST `/restcolecaomaisideia` endpoint returns only the ~5 highlights). Status is NOT
 * inline on the listing, but the listing is filterable by `situacao=N` (GET) — so the orchestrator
 * crawls per situacao value and tags each item's status. This module is a pure parser of one page.
 *
 * Each idea renders as one `class="resumo-ideia"` block. Since 12/10/2026 the portal serves:
 *   <li class="resumo-ideia">
 *     <a href="visualizacaoideia?id=80429">
 *       <h4>TÍTULO</h4>
 *       <figure class="componente-grafico-ideia">
 *         <figcaption><span class="contabilizacao">253.804 apoios confirmados</span>
 *                     <span>Meta de 20.000 apoios</span></figcaption>
 *       </figure>
 *     </a>
 *   </li>
 * Until 11/10/2026 it was `<article class="resumo-ideia">` with the title in `<section><a>` and the
 * count in the first `<footer><span>N apoios</span>`. Both forms are parsed (fixtures for each), and
 * the block split keys on the class, not on the tag. The support goal (20.000) is always ignored.
 */

import { extractId, parseBrNum } from "../../src/scraper/ecidadania.js";
import { decodeEntities } from "./listing.js";

/** situacao GET value → IdeiaResumo status vocabulary (aberta | encerrada | convertida).
 *  Mapping read from the live <option value> of the pesquisaideia Situação dropdown. */
export const SITUACAO_STATUS: Record<number, string> = {
  5: "aberta", // Ideias abertas
  6: "aberta", // Ideias em avaliação na CDH (still in process)
  8: "aberta", // Ideias aguardando envio à CDH (still in process)
  7: "encerrada", // Ideias encerradas sem apoios suficientes
  9: "encerrada", // Ideias debatidas pela CDH
  10: "convertida", // Ideias transformadas em proposição
};

export interface IdeiaListingItem {
  id: number;
  titulo: string;
  apoios: number;
}

/** Parse one ideas listing page. Pure. Blocks missing a parseable id are skipped; a block with an
 *  id but no title or no count throws (unknown markup — see below). */
export function parseIdeiaListingPage(html: string): IdeiaListingItem[] {
  const blocks = html.split(/<[a-z]+\b[^>]*\bclass="resumo-ideia"[^>]*>/i).slice(1);
  const items: IdeiaListingItem[] = [];
  for (const block of blocks) {
    const id = extractId(block);
    if (id === null) continue;
    const tituloMatch =
      block.match(/<h4[^>]*>([^<]+)<\/h4>/i) ?? block.match(/<section>\s*<a[^>]*>([^<]+)<\/a>/i);
    // The count, never the goal ("Meta de 20.000 apoios"): the contabilizacao span, or (old form)
    // the first footer span.
    const apoiosMatch =
      block.match(/class="contabilizacao"[^>]*>\s*([\d.]+)\s*apoios/i) ??
      block.match(/<footer>\s*<span>([\d.]+)\s*apoios/i);
    // A block found by its id but missing the title or the count is a partial markup drift: fail
    // the page (→ retry → page failure → the crawl gate) instead of writing "" / 0 into the corpus.
    if (!tituloMatch || !apoiosMatch) {
      throw new Error(
        `forma desconhecida no bloco id=${id}: ${!tituloMatch ? "título" : "apoios"} não encontrado`,
      );
    }
    items.push({
      id,
      titulo: decodeEntities(tituloMatch[1]),
      apoios: parseBrNum(apoiosMatch[1]),
    });
  }
  return items;
}

/** Discover the last page from `pesquisaideia?...p=N` links (situacao may sit between ? and p=). */
export function findLastPageIdeias(html: string): number {
  const pages = [...html.matchAll(/pesquisaideia\?[^"'#]*?\bp=(\d+)/gi)].map((m) => parseInt(m[1], 10));
  return pages.length ? Math.max(...pages) : 1;
}
