import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**"],
      reporter: ["text-summary", "lcov"],
      // A floor just under today's numbers, so coverage can only go up.
      thresholds: { statements: 80, branches: 85, functions: 80, lines: 80 },
    },
  },
});
