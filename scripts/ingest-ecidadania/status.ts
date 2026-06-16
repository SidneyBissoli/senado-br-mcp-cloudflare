/**
 * Status derivation for consultations (§8 step 3, §4) — NOT scraped from HTML.
 *
 * Authoritative rule (§4): a public consultation runs from the proposition's presentation until
 * the end of its tramitação. So `status` is a function of the matter, not a page attribute:
 *   aberta    ⟺ the consultation's matter is in tramitação
 *   encerrada ⟺ tramitação concluded
 *
 * We build the "in tramitação" universe from the legislative `/processo` API (`tramitando=S`),
 * which is robust JSON. The e-Cidadania listing id equals the legislative `codigoMateria`
 * (verified: listing id 137929 ↔ codigoMateria 137929 ↔ PLP 183/2019), so membership of the
 * consultation id in the set of tramitando `codigoMateria`s decides its status.
 *
 * We query per sigla because `/processo` expects at least one filter; the orchestrator passes the
 * siglas actually present in the consultation corpus, so no sigla list is hardcoded.
 */

import { getJson, sleep } from "./http.js";

interface ProcessoItem {
  codigoMateria?: number;
  tramitando?: string;
}

/** Fetch the tramitando=S codigoMateria values for one sigla. */
export async function fetchTramitandoCodigos(baseUrl: string, sigla: string): Promise<number[]> {
  const url = `${baseUrl}/processo.json?sigla=${encodeURIComponent(sigla)}&tramitando=S`;
  const data = await getJson<ProcessoItem[] | unknown>(url);
  const arr = Array.isArray(data) ? data : [];
  const codigos: number[] = [];
  for (const p of arr as ProcessoItem[]) {
    if (typeof p?.codigoMateria === "number") codigos.push(p.codigoMateria);
  }
  return codigos;
}

/**
 * Build the full set of tramitando codigoMateria across the given siglas, querying politely.
 * `delayMs` spaces the per-sigla requests; failures on a single sigla propagate (the caller's
 * crawl-completeness gate treats an incomplete status universe as a failed run).
 */
export async function buildTramitandoSet(
  baseUrl: string,
  siglas: string[],
  delayMs = 300,
): Promise<Set<number>> {
  const set = new Set<number>();
  for (let i = 0; i < siglas.length; i++) {
    const codigos = await fetchTramitandoCodigos(baseUrl, siglas[i]);
    for (const c of codigos) set.add(c);
    if (i < siglas.length - 1) await sleep(delayMs);
  }
  return set;
}

/** Derive aberta/encerrada from membership in the tramitando set (§4). */
export function deriveStatus(tramitandoSet: Set<number>, codigoMateria: number): "aberta" | "encerrada" {
  return tramitandoSet.has(codigoMateria) ? "aberta" : "encerrada";
}
