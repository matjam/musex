import { readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          "@musex/core",
          "@musex/plugin-api",
          "@musex/plugin-lastfm",
          "@musex/plugin-lidarr",
        ],
      }),
    ],
    build: { rollupOptions: { output: { format: "es" } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@musex/core", "@musex/plugin-api"] })],
    // Sandboxed preloads must be CommonJS; emit .cjs so it is unambiguous under "type":"module".
    build: { rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } } },
  },
  renderer: {
    plugins: [react()],
    // Version shown in the About window; release-please keeps package.json current.
    define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  },
});
