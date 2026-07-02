/**
 * Integrity-check verdict for the frozen consultas_votos acervo (ROADMAP Etapa 2, "Cron diário").
 *
 * Kept in its own module (not in index-consultas-votos.ts, which runs main() on import) so tests can
 * import it without triggering the ingestion — the same split as csv.ts / *-listing.ts.
 */

export type AcervoVerifyVerdict = "integro" | "divergente";

/**
 * Decide whether the freshly-parsed CSV still matches the frozen acervo in D1. Pure (no I/O). The
 * acervo is `integro` iff nothing changed (rowsChanged 0) AND the matéria count is unchanged — a
 * deletion leaves rowsChanged 0 but shrinks the count, so both conditions are needed to catch it.
 */
export function verifyAcervoIntegrity(params: { rowsScraped: number; existingCount: number; rowsChanged: number }): AcervoVerifyVerdict {
  return params.rowsChanged === 0 && params.rowsScraped === params.existingCount ? "integro" : "divergente";
}
