#!/usr/bin/env node
// Generates the dependency-attribution data shown in the About window.
//
// Sources:
//  - `pnpm licenses list -P --json`: every production dependency (direct +
//    transitive) of every workspace package, from the lockfile. This covers
//    what ships: main-process externals (electron-store, electron-updater,
//    @ctrl/plex, ...), renderer bundle deps (lucide-react, react-virtual),
//    and the esbuild-bundled plugin deps.
//  - EXTRA_PACKAGES: packages that ship in the app but live in devDependencies
//    (react/react-dom are bundled by vite; electron IS the runtime), resolved
//    from node_modules.
//  - MANUAL_ENTRIES: non-npm runtime pieces (the vendored mpv binary).
//
// Output: packages/desktop/src/renderer/src/generated/licenses.json
// (committed; re-run `pnpm gen:licenses` whenever dependencies change).
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outFile = join(root, "packages/desktop/src/renderer/src/generated/licenses.json");

const EXTRA_PACKAGES = ["react", "react-dom", "electron"];

const MANUAL_ENTRIES = [
  {
    name: "mpv",
    version: readMpvVersion(),
    license: "GPL-2.0-or-later",
    homepage: "https://mpv.io/",
    description:
      "Audio playback engine, bundled as an unmodified standalone binary and run as a separate process. " +
      "Source code: https://github.com/mpv-player/mpv — the exact build musex ships is fetched, " +
      "pinned and checksum-verified by scripts/fetch-mpv.mjs in the musex repository.",
    licenseText: null,
  },
];

function readMpvVersion() {
  const src = readFileSync(join(root, "scripts/fetch-mpv.mjs"), "utf8");
  const m = src.match(/v(\d+\.\d+\.\d+)/);
  return m ? m[1] : "unknown";
}

function readLicenseText(pkgDir) {
  let names;
  try {
    names = readdirSync(pkgDir);
  } catch {
    return null;
  }
  const candidate = names.find((n) => /^(licen[cs]e|copying)(\.(md|txt|markdown))?$/i.test(n));
  if (!candidate) return null;
  try {
    return readFileSync(join(pkgDir, candidate), "utf8").trim();
  } catch {
    return null;
  }
}

function entriesFromPnpm() {
  const raw = execFileSync("pnpm", ["licenses", "list", "-P", "--json"], {
    cwd: root,
    encoding: "utf8",
  });
  const byLicense = JSON.parse(raw);
  const entries = [];
  for (const group of Object.values(byLicense)) {
    for (const pkg of group) {
      if (pkg.name.startsWith("@musex/")) continue;
      const path = pkg.paths?.[0];
      entries.push({
        name: pkg.name,
        version: pkg.versions?.at(-1) ?? "unknown",
        license: pkg.license ?? "unknown",
        homepage: pkg.homepage ?? null,
        description: pkg.description ?? null,
        licenseText: path ? readLicenseText(path) : null,
      });
    }
  }
  return entries;
}

function entriesFromExtras() {
  const require = createRequire(join(root, "packages/desktop/package.json"));
  return EXTRA_PACKAGES.map((name) => {
    const pkgDir = dirname(require.resolve(`${name}/package.json`));
    const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
    return {
      name: pkg.name,
      version: pkg.version,
      license: pkg.license ?? "unknown",
      homepage: pkg.homepage ?? null,
      description: pkg.description ?? null,
      licenseText: readLicenseText(pkgDir),
    };
  });
}

const seen = new Set();
const entries = [...MANUAL_ENTRIES, ...entriesFromExtras(), ...entriesFromPnpm()]
  .filter((e) => (seen.has(e.name) ? false : seen.add(e.name)))
  .sort((a, b) => a.name.localeCompare(b.name));

const missing = entries.filter((e) => e.name !== "mpv" && !e.licenseText);
if (missing.length > 0) {
  console.warn(`note: no license text found for: ${missing.map((e) => e.name).join(", ")}`);
}

writeFileSync(outFile, `${JSON.stringify(entries, null, 2)}\n`);
console.log(`wrote ${entries.length} entries to ${outFile}`);
