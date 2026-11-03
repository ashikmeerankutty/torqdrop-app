import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/rules/**/*.test.ts"],
    // All files share one emulator instance.
    fileParallelism: false,
    testTimeout: 20000,
  },
});
