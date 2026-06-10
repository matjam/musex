// Bundles the plugin to dist/{index.mjs,plugin.json} — the layout the musex
// plugin host scans (dev: <repo>/plugins/<name>/dist/plugin.json).
// @musex/plugin-api is types-only, so nothing real gets bundled from it.
import { copyFile } from "node:fs/promises";
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.mjs",
  bundle: true,
  format: "esm",
  platform: "node",
});
await copyFile("plugin.json", "dist/plugin.json");
