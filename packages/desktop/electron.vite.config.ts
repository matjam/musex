import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@musex/core"] })],
    build: { rollupOptions: { output: { format: "es" } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@musex/core"] })],
    // Sandboxed preloads must be CommonJS; emit .cjs so it is unambiguous under "type":"module".
    build: { rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } } },
  },
  renderer: {
    plugins: [react()],
  },
});
