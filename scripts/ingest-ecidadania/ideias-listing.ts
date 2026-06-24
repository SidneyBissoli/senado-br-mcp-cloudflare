/**
 * e-Cidadania IDEIAS full-corpus listing scraper (ideias legislativas).
 *
 * Source: the paginated HTML listing `www12.senado.leg.br/ecidadania/pesquisaideia?p=N`
 * (the REST `/restcolecaomaisideia` endpoint returns only the ~5 highlights). Status is NOT
 * inline on the listing, but the listing is filterable by `situacao=N` (GET) — so the orchestrator
 * crawls per situacao value and tags each item's status. This module is a pure parser of one page.
 *
 * Each idea renders as one `<article class="resumo-ideia">` block:
 *   <article class="resumo-ideia">
 *     <section><a href="visualizacaoideia?id=80429">TÍTULO</a></section>
 *     <figure class="grafico-ideia-legislativa">
 *        <footer><span>253.804 apoios</span><span>20.000</span></footer>  <!-- apoios, threshold -->
 *     </figure>
 *   </article>
 * (the threshold span — 20.000 — is the support goal and is ignored.)
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

/** Parse one ideas listing page. Pure. Blocks missing a parseable id are skipped. */
export function parseIdeiaListingPage(html: string): IdeiaListingItem[] {
  const blocks = html.split(/<article class="resumo-ideia">/i).slice(1);
  const items: IdeiaListingItem[] = [];
  for (const block of blocks) {
    const id = extractId(block);
    if (id === null) continue;
    const tituloMatch = block.match(/<section>\s*<a[^>]*>([^<]+)<\/a>/i);
    // First footer span: "253.804 apoios". The second span (threshold) is ignored.
    const apoiosMatch = block.match(/<footer>\s*<span>([\d.]+)\s*apoios/i);
    items.push({
      id,
      titulo: tituloMatch ? decodeEntities(tituloMatch[1]) : "",
      apoios: apoiosMatch ? parseBrNum(apoiosMatch[1]) : 0,
    });
  }
  return items;
}

/** Discover the last page from `pesquisaideia?...p=N` links (situacao may sit between ? and p=). */
export function findLastPageIdeias(html: string): number {
  const pages = [...html.matchAll(/pesquisaideia\?[^"'#]*?\bp=(\d+)/gi)].map((m) => parseInt(m[1], 10));
  return pages.length ? Math.max(...pages) : 1;
}
