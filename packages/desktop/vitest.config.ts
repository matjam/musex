import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/logic/**/*.test.ts", "src/shared/**/*.test.ts", "src/renderer/src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
  },
});
