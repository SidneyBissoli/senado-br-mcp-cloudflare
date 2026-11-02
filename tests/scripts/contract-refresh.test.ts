/**
 * Unit tests for the nightly fixture refresher's outage handling. No network.
 *
 * Since 3.21.2 the verdict, the breaker, the retry and the exit policy live in
 * the portfolio's `@sbissoli/mcp-live-source`; what is pinned HERE is the seam
 * this repo owns: the local `UpstreamError` that `traduzirErro` builds must
 * carry the package error in `cause`, because that is the only way the
 * reporter can read the origin's `kind`. Without it every failure is "alheio"
 * (ours), which is exactly the false alarm of 22/10/2026 — one endpoint in 502
 * for three attempts, three red runs, "a fonte mudou" on the panel.
 *
 * `refresh-fixtures.ts` itself reads `process.argv` and writes files, so it
 * only type-checks under `scripts/tsconfig.json`; importing it here would drag
 * it into the root (Workers-typed) program. The seam is tested through the
 * pieces it is made of.
 */

import { describe, it, expect } from "vitest";
import { UpstreamError as PkgUpstreamError } from "@sbissoli/mcp-upstream";
import {
  Relatorio,
  SAIDA_FALHA,
  SAIDA_FONTE_INALCANCAVEL,
  SAIDA_OK,
  capturarComRetentativa,
  classificarFalha,
} from "@sbissoli/mcp-live-source";
import {
  MSG_ROTA_INEXISTENTE,
  RecursoAusenteError,
  UpstreamError,
  traduzirErro,
} from "../../src/throttle/upstream.js";
import { MissingDependencyError } from "../../scripts/contract/manifest.js";
import { RotaSumiuNaFonteError, ehDeriva, reclassificarRotaSumida } from "../../scripts/contract/rota-sumida.js";

const ehDependencia = (err: unknown) => err instanceof MissingDependencyError;

function doPacote(kind: PkgUpstreamError["kind"], status?: number, attempts = 3): PkgUpstreamError {
  return new PkgUpstreamError({
    url: "https://legis.senado.leg.br/dadosabertos/x.json",
    kind,
    status,
    retryable: false,
    transport: kind === "timeout" || kind === "network",
    attempts,
  });
}

describe("traduzirErro carries the package error in `cause`", () => {
  it("every kind: the local error keeps its message AND the origin's verdict is readable", () => {
    const casos: Array<[PkgUpstreamError["kind"], number | undefined, string]> = [
      ["timeout", undefined, "indisponivel"],
      ["network", undefined, "indisponivel"],
      ["rate_limited", 429, "indisponivel"],
      ["http_5xx", 502, "indisponivel"],
      ["http_5xx", 503, "indisponivel"],
      ["http_4xx", 406, "respondeu"],
      ["not_found", 404, "respondeu"],
      ["malformed_body", 200, "ambiguo"],
      ["aborted", undefined, "alheio"],
    ];
    for (const [kind, status, veredito] of casos) {
      const pacote = doPacote(kind, status);
      const local = traduzirErro(pacote, "/x");
      expect(local, kind).toBeInstanceOf(UpstreamError);
      expect(local.cause, kind).toBe(pacote);
      expect(classificarFalha(local).veredito, kind).toBe(veredito);
    }
  });

  it("the 22/10/2026 case: HTTP 502 after three attempts is 'indisponivel', not ours — message unchanged", () => {
    const local = traduzirErro(doPacote("http_5xx", 502, 3), "/taquigrafia/videos");
    expect(local.message).toBe("[/taquigrafia/videos] Upstream retornou HTTP 502");
    expect(local.transport).toBe(false); // unchanged: the flag still means "nothing arrived"
    const falha = classificarFalha(local);
    expect(falha.veredito).toBe("indisponivel");
    expect(falha.status).toBe(502);
    expect(falha.motivo).toContain("3 tentativas");
  });

  it("a local error built without `cause` (our own guards) is 'alheio'", () => {
    const err = new UpstreamError("[/x] Resposta upstream excede o limite de 5 MB", 413, false);
    expect(err.cause).toBeUndefined();
    expect(classificarFalha(err).veredito).toBe("alheio");
  });

  it("a missing dependency is its own verdict, through the predicate this repo passes", () => {
    const err = new MissingDependencyError("senador-lista-atual");
    expect(err.dependsOn).toBe("senador-lista-atual");
    expect(classificarFalha(err).veredito).toBe("alheio");
    expect(classificarFalha(err, { dependencia: ehDependencia }).veredito).toBe("dependencia");
  });
});

describe("the nightly policy, driven by this repo's errors", () => {
  function noite(falhas: Array<[string, unknown | null]>, limite?: number) {
    const r = new Relatorio({ dependencia: ehDependencia, limiteDoDisjuntor: limite });
    for (const [nome, err] of falhas) {
      if (err === null) r.registrarCaptura(nome, 1);
      else r.registrarFalha(nome, err, 1);
      if (r.deveParar) break;
    }
    return r;
  }

  it("one endpoint in 502, the rest ok → exit 0 with the 'Fonte indisponível' warning naming it", () => {
    const r = noite([
      ["senador-lista-atual", null],
      ["taquigrafia-videos", traduzirErro(doPacote("http_5xx", 502), "/taquigrafia/videos")],
      ["ceaps", null],
    ]);
    expect(r.codigoDeSaida()).toBe(SAIDA_OK);
    expect(r.anotacoes()).toEqual(["::warning title=Fonte indisponível::taquigrafia-videos"]);
  });

  it("nothing answers → the breaker trips on the 5th and exits 3 (5xx now COUNTS; it used to clear the streak)", () => {
    const r = noite(
      Array.from({ length: 20 }, (_, i) => [`spec-${i}`, traduzirErro(doPacote("http_5xx", 502), "/x")]),
    );
    expect(r.resultados).toHaveLength(5);
    expect(r.codigoDeSaida()).toBe(SAIDA_FONTE_INALCANCAVEL);
    expect(r.anotacoes()[0]).toContain("::error title=Fonte inalcançável::");
  });

  it("the env override of the streak limit is honoured", () => {
    const r = noite(
      Array.from({ length: 20 }, (_, i) => [`spec-${i}`, traduzirErro(doPacote("timeout"), "/x")]),
      2,
    );
    expect(r.resultados).toHaveLength(2);
    expect(r.codigoDeSaida()).toBe(SAIDA_FONTE_INALCANCAVEL);
  });

  it("a refused request (404) or a non-JSON body that persisted is red and labelled", () => {
    const r = noite([
      ["a", null],
      ["rota-velha", traduzirErro(doPacote("not_found", 404), "/rota")],
      ["html", traduzirErro(doPacote("malformed_body", 200), "/html")],
    ]);
    expect(r.codigoDeSaida()).toBe(SAIDA_FALHA);
    expect(r.anotacoes()).toEqual([
      "::error title=Deriva de formato::rota-velha",
      "::error title=Ambíguo (deriva ou página de erro)::html",
    ]);
  });

  it("a spec that depends on an unavailable capture is 'not measured', not red", () => {
    const r = noite([
      ["lista", null],
      ["processo-lista", traduzirErro(doPacote("timeout"), "/processo")],
      ["processo-detalhe", new MissingDependencyError("processo-lista")],
    ]);
    expect(r.codigoDeSaida()).toBe(SAIDA_OK);
    expect(r.anotacoes()).toEqual(["::warning title=Fonte indisponível::processo-lista, processo-detalhe"]);
  });
});

describe("a route that already answered and now 404s 'No static resource' is drift (2026-11-02)", () => {
  // The exact error `upstreamFetch` raises for the route-not-found 404 (no package `cause`).
  const rotaInexistente = (path: string) =>
    new UpstreamError(
      `[${path}] ${MSG_ROTA_INEXISTENTE} — o caminho montado não existe na API do Senado.`,
      404,
      false,
      false,
      "defeito",
    );

  /** Runs one capture through the same wiring as `refresh-fixtures.ts`. */
  async function capturar(spec: string, fixtureExiste: boolean, err: unknown): Promise<unknown> {
    try {
      await Promise.reject(err).catch(reclassificarRotaSumida(spec, fixtureExiste));
    } catch (e) {
      return e;
    }
    throw new Error("unreachable");
  }

  it("without the fix this is exactly the false label of run 41478280273: 'alheio'", () => {
    expect(classificarFalha(rotaInexistente("/api/v1/senadores/escritorios")).veredito).toBe("alheio");
  });

  it("fixture committed → RotaSumiuNaFonteError → 'respondeu', with the check named in the message", async () => {
    const e = await capturar("escritorios", true, rotaInexistente("/api/v1/senadores/escritorios"));
    expect(e).toBeInstanceOf(RotaSumiuNaFonteError);
    expect((e as Error).message).toContain("/v3/api-docs");
    expect((e as Error).cause).toBeInstanceOf(UpstreamError);
    expect(classificarFalha(e, { deriva: ehDeriva }).veredito).toBe("respondeu");
  });

  it("no fixture (a NEW spec with a wrong path) → stays ours: 'alheio'", async () => {
    const e = await capturar("nova", false, rotaInexistente("/api/v1/x"));
    expect(e).not.toBeInstanceOf(RotaSumiuNaFonteError);
    expect(classificarFalha(e, { deriva: ehDeriva }).veredito).toBe("alheio");
  });

  it("other errors pass through untouched, even with a fixture (absent key, 5xx, our own guards)", async () => {
    const ausente = new RecursoAusenteError("/supridos/2005");
    const fora = traduzirErro(doPacote("http_5xx", 502), "/x");
    const guarda = new UpstreamError("Resposta upstream excede o limite de 5 MB", 200, false);
    for (const err of [ausente, fora, guarda]) {
      expect(await capturar("spec", true, err)).toBe(err);
    }
  });

  it("the night of 02/11 replayed: three renamed routes → red 'Deriva de formato', no retry", async () => {
    const r = new Relatorio({ dependencia: ehDependencia, deriva: ehDeriva });
    r.registrarCaptura("senador-lista-atual", 1);
    for (const [spec, path] of [
      ["auxilio-moradia", "/api/v1/senadores/auxilio-moradia"],
      ["escritorios", "/api/v1/senadores/escritorios"],
      ["pessoal-estagiarios", "/api/v1/servidores/estagiarios"],
    ] as const) {
      let tentativas = 0;
      const err = await capturarComRetentativa(
        () => {
          tentativas++;
          return Promise.reject(rotaInexistente(path)).catch(reclassificarRotaSumida(spec, true));
        },
        { tentativas: 3, dependencia: ehDependencia, deriva: ehDeriva, dormir: async () => {} },
      ).catch((e: unknown) => e);
      expect(tentativas).toBe(1);
      r.registrarFalha(spec, err, 1);
    }
    expect(r.codigoDeSaida()).toBe(SAIDA_FALHA);
    expect(r.anotacoes()).toEqual(["::error title=Deriva de formato::auxilio-moradia, escritorios, pessoal-estagiarios"]);
  });
});
