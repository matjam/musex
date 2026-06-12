# Phase 0: Platform Logic into Core + Static Core Plugins — Design

**Date:** 2026-06-11
**Status:** Approved (user: "lets just plan and execute phase 0 first and see how it lands")

Phase 0 of the mobile roadmap (see the mobile assessment discussion): make
`@musex/core` actually contain everything platform-agnostic, and split the
plugin system into **core plugins** (first-party, statically bundled — no
arbitrary code execution for anything we ship) and **user plugins** (the
existing dynamic-loading path). Zero behavior change for the user beyond the
Settings layout for plugins.

## Part 1 — Logic moves into core

**Move** from `packages/desktop/src/logic/` to `packages/core/src/logic/`
(tests come along; intra-module relative imports stay relative inside core):

collage, discography-merge, external-url, for-you, genres, library-sort,
library-watch, mood-mixes, nav-history, plex-mapping, smart-playlists,
taste-expansion, taste-profile — plus `shared/list-validator.ts`.

**Stay in desktop** (with the reason recorded):
- `cache.ts` — imports `node:crypto` (media-cache keying; desktop's caching
  strategy anyway).
- `scrobble-gate.ts` — imports `TrackInfo` from `@musex/plugin-api`; core
  keeps zero dependencies.
- `mpv-ipc.ts`, `audio-filters.ts` — mpv-specific.
- `proxy-url.ts` — stream-proxy-specific.
- `plugin-manifest.ts` — desktop plugin loading.

**Export style:** everything re-exported through core's single barrel
(`@musex/core`) — consumers never deep-import. Core keeps **zero runtime
dependencies**. ~22 importer files across main/renderer/shared update their
paths; the desktop copies are deleted.

## Part 2 — Core plugins (static) vs user plugins (dynamic)

**Principle:** anything musex ships executes only statically-bundled code.
The dynamic `import()` path remains exclusively for user-provided plugins in
`userData/plugins/`.

- `plugins/lastfm` and `plugins/lidarr` become ordinary workspace
  dependencies of `@musex/desktop` (`workspace:*`). Each package exports its
  TS source (`"exports": { ".": "./src/index.ts" }`, like core) and a typed
  `manifest` const (`{ id, name, version, apiVersion }` — the data moves out
  of `plugin.json`, which is deleted; `plugin.json` remains the format for
  USER plugins only). `electron-vite`'s `externalizeDepsPlugin` exclude list
  adds both packages so their source bundles into main.
- New `main/plugins/core-plugins.ts` (DESKTOP, not core — core must never
  depend on plugins): static imports of `{ manifest, activate }` from both
  packages, exported as `CORE_PLUGINS`.
- `PluginHost` gains `loadCore(CORE_PLUGINS)`: same apiVersion gate,
  per-plugin try/catch isolation, and enable/disable persistence as dynamic
  plugins; runs before the dynamic scan. Reload re-runs core activates
  against the fresh registry (no cache-busting needed — the module is
  static). Duplicate-id rule: a user plugin may NOT override a core plugin id
  (core wins; log a warning) — first-party code must not be silently
  replaceable by dropped-in files.
- `PluginInfo` (ipc-contract) gains `origin: "core" | "user"`.
- Scan dirs shrink to `userData/plugins/` only — the dev repo-dist scan and
  the packaged `resourcesPath/plugins` scan die (nothing ships there
  anymore).

**Build/packaging fallout (all dead):** the plugins' `build.mjs` + esbuild
devDependencies + `dist/` outputs; the root `build:plugins` script; its
invocations in `.github/workflows/ci.yml` and `release-please.yml`; the two
plugin `extraResources` entries in `electron-builder.yml`; the
`pnpm vendor && build:plugins` step in any local-package instructions
(CLAUDE.md updates).

## Part 3 — Settings UI

- The **Plugins** category covers user plugins only: install/reload row +
  list filtered to `origin === "user"` (empty state: "No plugins installed.").
  Copy updated to say user plugins run with full trust.
- Core plugins (Last.fm, Lidarr) keep their own nav entries with their full
  settings panes, listed as regular entries between Discovery and Plugins —
  no longer indented sub-entries of Plugins. They keep their enable toggles
  inside their panes (unchanged PluginCard).

## Testing / verification

- All moved tests run from core (`pnpm check` — same totals, new home).
- Plugins' own vitest suites unchanged (they test source, not dist).
- **Local package build is mandatory** (packaging changed): verify the built
  app contains NO `Resources/plugins/`, launches, and both core plugins
  activate (lastfm/lidarr settings panes functional, scrobbling/discover
  sections come up).
- Live dev run: plugins active, Discover sections render (lastfm), Lidarr
  lookup works, user-plugin dir still scanned (drop a dummy plugin.json to
  prove the dynamic path survives — or verify via logs that the scan runs).

## Out of scope

- Any mobile code (Phase 1+).
- Moving `scrobble-gate`/`cache` (revisit when mobile needs them).
- Plugin sandboxing for user plugins (they remain full-trust, documented).
- `@musex/plex` extraction (mobile-phase decision).
