import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    // No tests yet (added from Task 4 on); keep green until then.
    passWithNoTests: true,
    include: ["src/**/*.test.ts"],
    // Smoke tests need a real native runtime/device — opt-in only.
    exclude: ["**/*.smoke.test.ts", "**/node_modules/**"],
  },
});
