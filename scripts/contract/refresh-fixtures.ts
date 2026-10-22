/**
 * Captures/refreshes the upstream contract fixtures.
 *
 * Usage:
 *   npm run contract:refresh              # all specs
 *   npm run contract:refresh -- ceaps ... # only the named specs
 *
 * Fetches one live sample per manifest spec (scripts/contract/manifest.ts),
 * normalizes it (recursively sorted keys + arrays truncated to a few items,
 * so diffs stay stable and files stay small) and writes it to
 * tests/contract/fixtures/<family>/<name>.json.
 *
 * Reuses upstreamFetch/admFetch so the global token bucket, retries and size
 * guards all apply; specs also run sequentially with a small pause between
 * captures to stay polite to the upstream.
 *
 * The nightly CI workflow runs this script and then `npm run test:contract`
 * against the fresh (uncommitted) fixtures — a failure there means the live
 * upstream drifted from the shape the parsers depend on.
 *
 * OUTAGE IS NOT DRIFT. Telling the two apart — the verdict per failed capture,
 * the circuit breaker, the retry, the exit code, the job summary and the
 * `::warning`/`::error` annotations the portfolio panel reads — is the
 * portfolio's live-source reporter, `@sbissoli/mcp-live-source` (since 3.21.2;
 * it was extracted from this script's former `outage.ts`). The policy, decided
 * on 22/10/2026: a night where the ONLY failures are the source being down
 * (5xx, timeout, network, 429) and at least one capture answered exits 0 with
 * `::warning title=Fonte indisponível::<specs>` — the committed fixtures stay in
 * place for those specs and the summary says drift was NOT measured there.
 * Nothing answered at all → exit 3 (breaker). A refused request (404/4xx), a
 * body that is not the expected one after the retries, or a defect of our own
 * → exit 1, labelled. The verdict comes from the package error's `kind`, which
 * the local `UpstreamError` carries in `cause` — never from the message.
 *
 * Why 5xx had to move: this script's own classifier read the translated local
 * error, whose `transport` flag is false for a 5xx, so a 502 counted as "a
 * response arrived" and CLEARED the breaker — a night of 502 on every endpoint
 * walked the whole manifest to the 30 min ceiling, and a single endpoint in 502
 * for three attempts (22/10/2026, taquigrafia videos) failed the job three
 * times and opened "a fonte mudou" on the panel.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Relatorio, capturarComRetentativa, linhaDeResultado } from "@sbissoli/mcp-live-source";
import { upstreamFetch } from "../../src/throttle/upstream.js";
import { admFetch } from "../../src/throttle/adm.js";
import { MAX_RESPONSE_SIZE_LARGE } from "../../src/types.js";
import { FIXTURES, MissingDependencyError, type Helpers } from "./manifest.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES_DIR = join(ROOT, "tests", "contract", "fixtures");

const FINANCEIRO_BASE = "https://www.senado.gov.br";
const PAUSE_MS = 400;
const CAPTURE_RETRIES = 3;
const DEFAULT_KEEP_ITEMS = 3;

/**
 * Streak limit for the outage breaker (the package's default is 5 and the
 * reasoning lives there). The env override exists so the behaviour can be
 * exercised without waiting out five real timeouts.
 */
const TRANSPORT_STREAK_LIMIT =
  process.env.CONTRACT_TRANSPORT_STREAK === undefined ? undefined : Number(process.env.CONTRACT_TRANSPORT_STREAK);

/** The package does not know this repo's error classes; this is how it learns `dependencia`. */
export const ehDependencia = (err: unknown): boolean => err instanceof MissingDependencyError;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Recursively sort object keys and truncate arrays for stable, small fixtures. */
export function normalizeFixture(value: unknown, keepItems: number): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, keepItems).map((v) => normalizeFixture(v, keepItems));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = normalizeFixture((value as Record<string, unknown>)[key], keepItems);
    }
    return out;
  }
  return value;
}

const helpers: Helpers = {
  legis: (path, params = {}, opts = {}) =>
    upstreamFetch(path, params, undefined, {
      maxSize: opts.large ? MAX_RESPONSE_SIZE_LARGE : undefined,
      on404: opts.on404,
    }),
  adm: (path, params = {}, large = false) =>
    admFetch(path, params, undefined, large ? { maxSize: MAX_RESPONSE_SIZE_LARGE } : {}),
  financeiro: (path) =>
    upstreamFetch(path, {}, FINANCEIRO_BASE, { noJsonSuffix: true, maxSize: MAX_RESPONSE_SIZE_LARGE }),
  ctx: new Map<string, unknown>(),
};

async function main(): Promise<void> {
  const only = new Set(process.argv.slice(2));
  const specs = only.size > 0 ? FIXTURES.filter((s) => only.has(s.name)) : FIXTURES;
  if (only.size > 0 && specs.length !== only.size) {
    const known = new Set(specs.map((s) => s.name));
    const unknown = [...only].filter((n) => !known.has(n));
    throw new Error(`unknown spec name(s): ${unknown.join(", ")}`);
  }

  // Dependency captures (h.ctx) require the full manifest order; when running
  // a subset, dependencies may be missing — specs throw a clear error then,
  // and the reporter files them as `dependencia` (not measured, not drift).
  const relatorio = new Relatorio({ dependencia: ehDependencia, limiteDoDisjuntor: TRANSPORT_STREAK_LIMIT });

  for (const spec of specs) {
    const target = join(FIXTURES_DIR, spec.family, `${spec.name}.json`);
    process.stdout.write(`capturing ${spec.family}/${spec.name} ... `);
    const startedAt = Date.now();
    try {
      const raw = await capturarComRetentativa(() => spec.capture(helpers), {
        tentativas: CAPTURE_RETRIES,
        dependencia: ehDependencia,
        aoRepetir: (tentativa, falha) =>
          console.warn(`  retry ${tentativa}/${CAPTURE_RETRIES} for '${spec.name}' [${falha.veredito}]: ${falha.motivo}`),
      });
      helpers.ctx.set(spec.name, raw);
      const normalized = normalizeFixture(raw, spec.keepItems ?? DEFAULT_KEEP_ITEMS);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, JSON.stringify(normalized, null, 2) + "\n", "utf8");
      console.log(linhaDeResultado(relatorio.registrarCaptura(spec.name, Date.now() - startedAt)));
    } catch (err) {
      console.log(linhaDeResultado(relatorio.registrarFalha(spec.name, err, Date.now() - startedAt)));
    }
    if (relatorio.deveParar) break;
    await sleep(PAUSE_MS);
  }

  // stdout conclusion, `::warning`/`::error` annotations and $GITHUB_STEP_SUMMARY
  // (when the variable exists — i.e. in Actions; a local run just logs).
  const resumo = relatorio.escrever();
  if (resumo.codigoDeSaida === 0 && resumo.naoMedidas.length === 0) {
    console.log(`all ${specs.length} fixtures written to ${FIXTURES_DIR}`);
  }
  process.exit(resumo.codigoDeSaida);
}

// Only run when invoked as the entry point, so the unit suite can import
// `normalizeFixture`/`ehDependencia` without firing a live capture run.
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
