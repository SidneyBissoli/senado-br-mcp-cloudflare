/**
 * e-Cidadania EVENTOS full-corpus listing scraper (audiências/eventos interativos).
 *
 * Source: the paginated HTML listing `www12.senado.leg.br/ecidadania/principalaudiencia?p=N`
 * (the REST `/restcolecaomaisaudiencia` endpoint returns only the ~5 highlights). Pure parser,
 * fixture-testable, keyed on stable anchors/classes — not on layout.
 *
 * Each event renders as one `<article class="resumo-audiencia resumo-audiencia-STATUS">` block
 * (the container tag was a <div> historically — the parser accepts either):
 *   <article class="resumo-audiencia resumo-audiencia-AGENDADO">
 *     <header><span>Audiência Pública</span></header>
 *     <section><div class="descricao"><a href="visualizacaoaudiencia?id=39529">TÍTULO</a></div></section>
 *     <footer><div class="comissao">
 *        <span class="data">24/06/26 | 10:00</span>
 *        <em class="sigla" title="Comissão …"> | CCT</em>
 *     </div></footer>
 *   </article>
 * Status is the class suffix (AGENDADO | ENCERRADO | REALIZADO | CANCELADO | REGISTRADO); date/time live in
 * `<span class="data">`; the committee sigla is the token after "| " in `<em class="sigla">`.
 */

import { extractId, extractDate, extractTime } from "../../src/scraper/ecidadania.js";
import { decodeEntities } from "./listing.js";

export interface EventoListingItem {
  id: number;
  titulo: string;
  data: string | null;
  hora: string | null;
  comissao: string | null;
  comentarios: number;
  /** agendado | encerrado | cancelado — derived from the block's class suffix (date fallback). */
  status: string;
}

/** Map the `resumo-audiencia-STATUS` class suffix to the EventoResumo status vocabulary. */
export function mapEventoStatus(classSuffix: string | null, data: string | null, now: Date): string {
  const st = (classSuffix || "").toUpperCase();
  if (st === "CANCELADO") return "cancelado";
  if (st === "REALIZADO" || st === "ENCERRADO") return "encerrado";
  if (st === "AGENDADO") return "agendado";
  // TODO(registrado): the live listing now also emits a `resumo-audiencia-REGISTRADO` class.
  // The page shows three visible sections — "Eventos agendados", "Eventos sem data prevista",
  // and "Eventos encerrados" — with no explicit "registrado" label, so REGISTRADO most likely
  // maps to "sem data prevista" (no date → date fallback below yields "agendado", which is the
  // sensible reading for an event not yet held). Not adding an explicit case until the
  // class→section binding is confirmed against the raw HTML — guessing could mislabel status.
  // Fallback by date: a past event is encerrado, otherwise agendado.
  if (data) return data < toISODate(now) ? "encerrado" : "agendado";
  return "agendado";
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Parse one events listing page. Pure. Blocks missing a parseable id are skipped.
 * `now` is injectable for the date-based status fallback (tests pass a fixed date).
 */
export function parseEventoListingPage(html: string, now: Date = new Date()): EventoListingItem[] {
  // The listing card container switched from <div> to <article> (class anchor unchanged) —
  // accept either tag so a future tag swap back does not silently zero out the crawl.
  const blocks = html.split(/<(?:div|article)\s+class="resumo-audiencia\b/i).slice(1);
  const items: EventoListingItem[] = [];
  for (const block of blocks) {
    const id = extractId(block);
    if (id === null) continue;

    const classSuffixMatch = block.match(/^[^"]*resumo-audiencia-([A-Z]+)/i);
    const tituloMatch = block.match(/class="descricao"[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
    const dataMatch = block.match(/class="data"[^>]*>([^<]+)<\/span>/i);
    const dataRaw = dataMatch ? dataMatch[1] : "";
    const siglaMatch = block.match(/class="sigla"[^>]*>([^<]+)<\/em>/i);
    // The sigla cell looks like " | CCT" — keep the token after the last "|".
    const sigla = siglaMatch ? siglaMatch[1].split("|").pop()!.trim() || null : null;
    // Comentários may not appear on the listing block — best-effort, default 0.
    const comentMatch = block.match(/(\d+)\s*coment[aá]rio/i) || block.match(/Participe\s*(\d+)/i);

    const data = extractDate(dataRaw);
    items.push({
      id,
      titulo: tituloMatch ? decodeEntities(tituloMatch[1]) : "",
      data,
      hora: extractTime(dataRaw),
      comissao: sigla,
      comentarios: comentMatch ? parseInt(comentMatch[1], 10) : 0,
      status: mapEventoStatus(classSuffixMatch ? classSuffixMatch[1] : null, data, now),
    });
  }
  return items;
}

/** Discover the last page number from `principalaudiencia?p=N` links (1 if none). */
export function findLastPageEventos(html: string): number {
  const pages = [...html.matchAll(/principalaudiencia\?p=(\d+)/gi)].map((m) => parseInt(m[1], 10));
  return pages.length ? Math.max(...pages) : 1;
}
