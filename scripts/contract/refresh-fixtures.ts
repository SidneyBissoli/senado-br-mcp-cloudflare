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
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { upstreamFetch } from "../../src/throttle/upstream.js";
import { admFetch } from "../../src/throttle/adm.js";
import { MAX_RESPONSE_SIZE_LARGE } from "../../src/types.js";
import { FIXTURES, type Helpers } from "./manifest.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES_DIR = join(ROOT, "tests", "contract", "fixtures");

const FINANCEIRO_BASE = "https://www.senado.gov.br";
const PAUSE_MS = 400;
const CAPTURE_RETRIES = 3;
const DEFAULT_KEEP_ITEMS = 3;

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
      treat404AsEmpty: opts.treat404AsEmpty,
    }),
  adm: (path, params = {}, large = false) =>
    admFetch(path, params, undefined, large ? { maxSize: MAX_RESPONSE_SIZE_LARGE } : {}),
  financeiro: (path) =>
    upstreamFetch(path, {}, FINANCEIRO_BASE, { noJsonSuffix: true, maxSize: MAX_RESPONSE_SIZE_LARGE }),
  ctx: new Map<string, unknown>(),
};

async function captureWithRetry(name: string, fn: () => Promise<unknown>): Promise<unknown> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= CAPTURE_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`  retry ${attempt}/${CAPTURE_RETRIES} for '${name}': ${msg}`);
      await sleep(2000 * attempt);
    }
  }
  throw lastErr;
}

async function main(): Promise<void> {
  const only = new Set(process.argv.slice(2));
  const specs = only.size > 0 ? FIXTURES.filter((s) => only.has(s.name)) : FIXTURES;
  if (only.size > 0 && specs.length !== only.size) {
    const known = new Set(specs.map((s) => s.name));
    const unknown = [...only].filter((n) => !known.has(n));
    throw new Error(`unknown spec name(s): ${unknown.join(", ")}`);
  }

  // Dependency captures (h.ctx) require the full manifest order; when running
  // a subset, dependencies may be missing — specs throw a clear error then.
  const failures: string[] = [];
  for (const spec of specs) {
    const target = join(FIXTURES_DIR, spec.family, `${spec.name}.json`);
    process.stdout.write(`capturing ${spec.family}/${spec.name} ... `);
    try {
      const raw = await captureWithRetry(spec.name, () => spec.capture(helpers));
      helpers.ctx.set(spec.name, raw);
      const normalized = normalizeFixture(raw, spec.keepItems ?? DEFAULT_KEEP_ITEMS);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, JSON.stringify(normalized, null, 2) + "\n", "utf8");
      console.log("ok");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`FAILED: ${msg}`);
      failures.push(spec.name);
    }
    await sleep(PAUSE_MS);
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} capture(s) failed: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log(`\nall ${specs.length} fixtures written to ${FIXTURES_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
