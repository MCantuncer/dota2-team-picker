import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**"],
      reporter: ["text-summary", "lcov"],
      // A floor just under today's numbers (as Vitest 4+ counts them), so coverage can only go up.
      thresholds: { statements: 70, branches: 60, functions: 75, lines: 70 },
    },
  },
});
