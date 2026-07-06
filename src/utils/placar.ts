/**
 * Compute a roll-call tally from individual votes.
 *
 * The legislative `votacao` endpoint returns `totalVotosSim/Nao/Abstencao: null` for
 * OPEN roll calls while still providing the individual `votos[]` array. Repassing those
 * nulls loses the single most analytically relevant field exactly on open votes. This
 * helper recomputes the tally by counting only genuine Sim/Nao/Abstencao votes.
 *
 * Non-vote codes (P-NRV, AP, LS, LAP, NCom, "Presidente (art. 51 RISF)", etc.) normalize
 * to something outside the allowlist and are excluded automatically, so matching the
 * {sim, nao, abstencao} allowlist is sufficient and needs no explicit exclusion list.
 */

import { normalizeText } from "./validation.js";

export interface Placar {
  sim: number;
  nao: number;
  abstencao: number;
}

/**
 * Count Sim/Nao/Abstencao across a list of vote records.
 * @param votos - Individual vote records.
 * @param getSigla - Extracts the vote sigla from a record. Defaults to the upstream
 *   field names (`siglaVotoParlamentar`, then `siglaVoto`, then `sigla`).
 */
export function computarPlacar(
  votos: Array<Record<string, unknown>>,
  getSigla: (v: Record<string, unknown>) => unknown = (v) =>
    v.siglaVotoParlamentar ?? v.siglaVoto ?? v.sigla,
): Placar {
  let sim = 0;
  let nao = 0;
  let abstencao = 0;
  for (const v of votos) {
    const s = normalizeText(getSigla(v));
    if (s === "sim") sim++;
    else if (s === "nao") nao++;
    else if (s === "abstencao") abstencao++;
  }
  return { sim, nao, abstencao };
}
