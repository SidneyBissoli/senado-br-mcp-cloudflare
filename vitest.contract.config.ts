import { defineConfig } from "vitest/config";

// Upstream shape-drift contract tier. Runs OUTSIDE the default `npm test`
// suite (see the exclude in vitest.config.ts): `npm run test:contract`.
// Tests assert the presence/shape of the raw upstream fields each exported
// parser depends on, against committed fixtures in tests/contract/fixtures/
// (offline, deterministic). The nightly CI workflow refreshes the fixtures
// from the live upstream first, so a failure there means real shape drift.
export default defineConfig({
  test: {
    include: ["tests/contract/**/*.contract.test.ts"],
    globals: true,
  },
});
