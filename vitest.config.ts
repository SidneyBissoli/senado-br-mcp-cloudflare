import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // Upstream shape-drift contract tier lives in its own config
    // (vitest.contract.config.ts) and must not run in the default suite.
    exclude: [...configDefaults.exclude, "tests/contract/**"],
    globals: true,
  },
});
