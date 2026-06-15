# Phase 0 Core Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all platform-agnostic logic into `@musex/core` and convert the bundled lastfm/lidarr plugins into statically-imported "core plugins" (dynamic loading remains only for user plugins), with the Settings UI reflecting the split.

**Architecture:** Pure mechanical move for Part 1 (13 logic modules + list-validator + their tests into `packages/core/src/logic/`, re-exported through the existing `@musex/core` barrel; ~22 importers update). Part 2 makes the plugin packages workspace deps exporting TS source, statically registered via a new desktop-side `core-plugins.ts` through a new `PluginHost.loadCore()`; the esbuild/dist/extraResources pipeline dies. Part 3 splits the settings nav.

**Tech Stack:** existing monorepo (core ships TS source via `exports`; electron-vite bundles excluded workspace deps). Spec: `docs/superpowers/specs/2026-06-11-phase0-core-refactor-design.md`.

**Conventions:** branch `refactor/phase0-core`; main/shared/preload/core imports use `.js` extensions, renderer none, test files import siblings extensionless; `pnpm exec biome check --write .` then `pnpm check` (exit 0) before each commit; `git add -A`; push after each commit.

---

### Task 1: Move logic modules into core

**Files:**
- Move (with their `.test.ts` files): `packages/desktop/src/logic/{collage,discography-merge,external-url,for-you,genres,library-sort,library-watch,mood-mixes,nav-history,plex-mapping,smart-playlists,taste-expansion,taste-profile}.ts` → `packages/core/src/logic/`
- Move: `packages/desktop/src/shared/list-validator.ts` (+ test) → `packages/core/src/logic/list-validator.ts`
- Modify: `packages/core/src/index.ts` (re-export everything public from the moved modules)
- Modify: ~22 importer files (list below)

- [ ] **Step 1: git mv the files.** `git mv` each module + its test into `packages/core/src/logic/`. Fix intra-module imports: within core they stay RELATIVE (`./taste-profile.js` style — core source uses `.js` extensions? READ an existing core file first, e.g. `packages/core/src/usecases/build-queue.ts`, and match its import-extension convention exactly; tests match core's existing test style). `plex-mapping.ts` and others import `@musex/core` types (`Track` etc.) — inside core these become relative imports of `../models/index.js` (match core's internal convention).

- [ ] **Step 2: Barrel exports.** In `packages/core/src/index.ts`, re-export the full public surface of every moved module (use `export *` per module unless it collides — check for collisions with existing exports; `export * from "./logic/collage.js";` etc. for all 14). Run `pnpm -r typecheck` to surface collisions; resolve any by explicit re-exports.

- [ ] **Step 3: Update importers.** Replace every desktop import of a moved module with `@musex/core`, MERGING into existing `@musex/core` import statements where the file already has one. Importer list (verify with `grep -rn "logic/collage\|logic/discography-merge\|logic/external-url\|logic/for-you\|logic/genres\|logic/library-sort\|logic/library-watch\|logic/mood-mixes\|logic/nav-history\|logic/plex-mapping\|logic/smart-playlists\|logic/taste-expansion\|logic/taste-profile\|shared/list-validator" packages/desktop/src` and fix EVERY hit):
  - main: `runtime.ts`, `ipc.ts`, `adapters/plex-gateway.ts`, `adapters/persistence.ts`, `adapters/library-watcher.ts`, `plugins/plugin-host.ts` (discography-merge + taste-profile/KEY_SEPARATOR), `plugins/radio-resolve.ts`, `expansion/coordinator.ts`
  - renderer: `state/app.tsx`, `ui/Shell.tsx`, `ui/TrackDetailPanel.tsx`, `ui/smart-mix-icons.ts`, `ui/views/{HomeView,MixView,GenresView,GenreView,SmartPlaylistView}.tsx` (+ any other grep hits)
  - desktop modules that STAY but imported moved ones (e.g. `logic/scrobble-gate.ts`? check) — same treatment.
  - NOTE: `logic/cache.ts`, `logic/scrobble-gate.ts`, `logic/mpv-ipc.ts`, `logic/audio-filters.ts`, `logic/proxy-url.ts`, `logic/plugin-manifest.ts` and their tests STAY in desktop untouched.

- [ ] **Step 4: Verify counts and commit.** `pnpm check` must exit 0 and the TOTAL test count across the workspace must equal the pre-move total (tests changed homes, none lost — record the before/after numbers). Then:

```bash
git add -A && git commit -m "refactor: move platform-agnostic logic into @musex/core" && git push
```

---

### Task 2: Static core plugins

**Files:**
- Modify: `plugins/lastfm/package.json`, `plugins/lastfm/src/index.ts`; same for lidarr
- Delete: `plugins/lastfm/plugin.json`, `plugins/lastfm/build.mjs`, same for lidarr (and their `dist/` from .gitignore scope if listed)
- Create: `packages/desktop/src/main/plugins/core-plugins.ts`
- Modify: `packages/desktop/src/main/plugins/plugin-host.ts`, `packages/desktop/src/main/runtime.ts`, `packages/desktop/package.json` (deps), `packages/desktop/electron.vite.config.ts`, `packages/desktop/electron-builder.yml`, `packages/desktop/src/shared/ipc-contract.ts` (PluginInfo.origin), root `package.json` (drop build:plugins), `.github/workflows/ci.yml`, `.github/workflows/release-please.yml`, `docs/plugins.md`

- [ ] **Step 1: Plugin packages export source + manifest.** In each plugin package.json: add `"exports": { ".": "./src/index.ts" }`, remove the `build` script and `esbuild` devDependency (KEEP vitest test setup). In each `src/index.ts`, add (values copied from the soon-deleted plugin.json):

```ts
/** Static manifest — core plugins register through this instead of a
 *  plugin.json (which remains the format for USER plugins only). */
export const manifest = {
  id: "lastfm",
  name: "Last.fm",
  version: "0.1.0",
  apiVersion: 1,
} as const;
```

(lidarr equivalent.) Delete both `plugin.json` files and both `build.mjs`. Read each plugin.json BEFORE deleting and carry its exact id/name/version/apiVersion values.

- [ ] **Step 2: Desktop consumes them.** `packages/desktop/package.json` dependencies: add `"@musex/plugin-lastfm": "workspace:*"`, `"@musex/plugin-lidarr": "workspace:*"`. In `electron.vite.config.ts`, add both names to `externalizeDepsPlugin({ exclude: [...] })` for the MAIN config (they ship TS source and must be bundled, same as `@musex/core`).

- [ ] **Step 3: core-plugins registry.** Create `packages/desktop/src/main/plugins/core-plugins.ts`:

```ts
/** First-party plugins, statically imported — anything musex ships executes
 *  only bundled code. The dynamic import() path in PluginHost remains
 *  exclusively for user plugins in userData/plugins/. */
import * as lastfm from "@musex/plugin-lastfm";
import * as lidarr from "@musex/plugin-lidarr";
import type { PluginContext } from "@musex/plugin-api";

export interface CorePlugin {
  manifest: { id: string; name: string; version: string; apiVersion: number };
  activate: (ctx: PluginContext) => void | Promise<void>;
}

export const CORE_PLUGINS: readonly CorePlugin[] = [
  { manifest: lastfm.manifest, activate: lastfm.activate },
  { manifest: lidarr.manifest, activate: lidarr.activate },
];
```

(Adapt the activate signature to the real exported type.)

- [ ] **Step 4: PluginHost.loadCore.** READ `plugin-host.ts`'s load flow first. Add `loadCore(corePlugins: readonly CorePlugin[])` that, for each: apiVersion gate (same check as dynamic), enable/disable persistence (same `disabledPlugins` mechanism), per-plugin try/catch isolation, registers with `origin: "core"`; runs BEFORE the dynamic scan in the same load/reload entry point so reload re-activates core plugins against the fresh registry. Dynamic scan: a user plugin whose id collides with a core plugin is SKIPPED with a logged warning (core wins). `PluginInfo` in ipc-contract gains `origin: "core" | "user"`; the host populates it (dynamic = "user").

- [ ] **Step 5: Scan dirs shrink.** In `runtime.ts`, the PluginHost scan-dir wiring drops the dev repo `plugins/*/dist` entries and the packaged `process.resourcesPath/plugins` entry — only `userData/plugins` remains. Pass `CORE_PLUGINS` in. (READ the current wiring; keep the userData path exactly.)

- [ ] **Step 6: Build pipeline cleanup.** Remove: both plugin `extraResources` entries in `electron-builder.yml` (mpv entry STAYS); root package.json `build:plugins` script; the `pnpm build:plugins` steps in `.github/workflows/ci.yml` and `release-please.yml`. Update `docs/plugins.md`: bundled integrations are compiled in; the documented plugin.json/dist flow applies to user plugins in `userData/plugins/` only.

- [ ] **Step 7: Verify + commit.** `pnpm check` exit 0 (plugin tests still run from source). Then:

```bash
git add -A && git commit -m "refactor: bundled plugins become statically-imported core plugins" && git push
```

---

### Task 3: Settings UI split

**Files:**
- Modify: `packages/desktop/src/renderer/src/ui/views/SettingsView.tsx`

- [ ] **Step 1.** READ the current SettingsView shell. Changes: (a) core plugin nav entries (`plugins.filter(p => p.origin === "core")`) render as REGULAR entries (not `settings-nav-sub`, Puzzle icon retained or per-plugin) between Discovery and Plugins; (b) the indented sub-entries under Plugins render only `origin === "user"` plugins; (c) `PluginsOverview` lists only user plugins (empty state "No plugins installed." retained) and its description copy notes user plugins run with full trust; (d) the `plugin:<id>` pane logic is unchanged (works for both origins).

- [ ] **Step 2: Verify + commit.**

```bash
pnpm exec biome check --write . && pnpm check
git add -A && git commit -m "refactor: settings shows core integrations as their own entries; Plugins = user plugins" && git push
```

---

### Task 4: Package build + live verification + docs + PR (controller)

- [ ] Local package build: `pnpm vendor` then `cd packages/desktop && CSC_IDENTITY_AUTO_DISCOVERY=false pnpm run package` — verify the built app has NO `Contents/Resources/plugins/` directory and the dmg builds.
- [ ] Live dev run (CDP): lastfm + lidarr active (Settings panes functional, origin-correct nav placement), Discover sections render, Plugins pane shows the empty user-plugin state, logs show the userData scan ran.
- [ ] CLAUDE.md: rewrite the plugin-architecture bullet (core vs user plugins, static imports, no build:plugins, scan dirs), note the logic move (logic lives in `packages/core/src/logic`, desktop keeps only mpv-ipc/audio-filters/proxy-url/cache/scrobble-gate/plugin-manifest), update the local-package instructions (no build:plugins).
- [ ] Draft PR `refactor: phase 0 — platform logic into core, first-party plugins statically bundled`.
