import { defineConfig } from "vitest/config";

// Default suite: pure unit tests. Rules tests need emulators, see vitest.rules.config.ts.
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], exclude: ["tests/rules/**", "node_modules/**"] },
});
