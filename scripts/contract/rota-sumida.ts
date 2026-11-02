/**
 * A route that ALREADY ANSWERED and now 404s with "No static resource": the source
 * renamed or removed it. That is drift, not a defect of ours.
 *
 * `upstreamFetch` raises the route-not-found 404 as a local `UpstreamError` with no
 * package `cause`. In the Worker that is right (a path we built that the API does not
 * have is our bug, telemetry class `defeito`), but the live-source reporter then files
 * it as `alheio` ("Falha alheia à origem", "defeito nosso"). Measured on 2026-11-02
 * (run 41478280273): the Senate renamed three adm routes between 27/10 and 02/11
 * (`/senadores/auxilio-moradia` → `…-imoveis-funcionais`, `/senadores/escritorios` →
 * `…-apoio`, `/servidores/estagiarios` → `/colaboradores/estagiarios`) and the panel
 * pointed at our code instead of at the source.
 *
 * "Already answered" = the spec's fixture is committed: it exists because a capture of
 * that route succeeded. A NEW spec whose path is wrong has no fixture and stays
 * `alheio`. Limit, accepted: a refactor that breaks the path of an existing spec also
 * reads as drift — the job is red either way, and the message names the check
 * (`/v3/api-docs` of the API) that tells the two apart.
 *
 * Pure (no fs, no argv), so the unit suite can import it; `refresh-fixtures.ts` wires it.
 */

import { MSG_ROTA_INEXISTENTE, UpstreamError } from "../../src/throttle/upstream.js";

export class RotaSumiuNaFonteError extends Error {
  constructor(spec: string, causa: UpstreamError) {
    super(
      `rota que já respondeu (fixture de '${spec}' commitada) agora dá 404 "No static resource": ` +
        `a fonte renomeou ou removeu a rota — conferir /v3/api-docs da API. Erro original: ${causa.message}`,
      { cause: causa },
    );
    this.name = "RotaSumiuNaFonteError";
  }
}

/** Is this the route-not-found 404 of a route whose fixture is committed? */
export function rotaQueJaRespondeu(err: unknown, fixtureExiste: boolean): err is UpstreamError {
  return (
    fixtureExiste && err instanceof UpstreamError && err.status === 404 && err.message.includes(MSG_ROTA_INEXISTENTE)
  );
}

/** How the package learns `respondeu` (drift) for this repo: `deriva` in its options. */
export const ehDeriva = (err: unknown): boolean => err instanceof RotaSumiuNaFonteError;

/** `.catch` handler: rethrows the route-not-found of a route that already answered as drift. */
export function reclassificarRotaSumida(spec: string, fixtureExiste: boolean): (err: unknown) => never {
  return (err: unknown): never => {
    throw rotaQueJaRespondeu(err, fixtureExiste) ? new RotaSumiuNaFonteError(spec, err) : err;
  };
}
