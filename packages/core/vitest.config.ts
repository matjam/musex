import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
    typecheck: {
      tsconfig: "./tsconfig.test.json",
    },
  },
});
