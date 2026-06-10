# Plugin Architecture + last.fm — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Spec: `docs/superpowers/specs/2026-06-09-plugin-architecture-lastfm-design.md` (READ IT FIRST — it defines the full PluginContext API and all decisions).

**Goal:** Dynamic full-trust plugin host (main-process `import()`, manifest+apiVersion, kernel API + data-only contribution points) and the last.fm plugin (auth, scrobbling, Love action, Discover similar-artists, track-detail rows).

**Conventions:** main/shared `.js` import suffixes; renderer no suffix; `import type`; `noUncheckedIndexedAccess`; lucide-only icons; every task ends GREEN on `pnpm check`; `git add -A`, commit to `main`, push, gated by `&&`.

**Verified facts (2026-06-09):**
- esbuild latest **0.28.0**; `allowBuilds: esbuild: true` already present in `pnpm-workspace.yaml`. Workspace `packages:` glob is only `packages/*` — must add `plugins/*`.
- last.fm: POST form-encoded to `https://ws.audioscrobbler.com/2.0/`; `api_sig = md5(concat(alpha-sorted name+value pairs) + sharedSecret)` (signature EXCLUDES the `format` param — sign first, then add `format=json`); desktop auth: `auth.getToken` → browser `https://www.last.fm/api/auth/?api_key=…&token=…` → `auth.getSession` (token valid 60 min). Scrobble rule: length > 30s AND (played ≥ half OR ≥ 4 min). `updateNowPlaying` never retried.
- SettingsView pattern: `.settings-section` / `.settings-section-title` / `.settings-row` / `.settings-row-label` / `.settings-row-desc`.
- Preload push-channel pattern: `onPlaybackEvent` (wrap `ipcRenderer.on`, return unsubscribe).
- mpv engine events reach `main/index.ts` via `runtime.mpv.setSink` — the monitor taps the same callback (forward from the sink, do NOT add a second sink mechanism).

---

### Task 1: Plugin host kernel

**Create:** `packages/plugin-api/` (types-only workspace package `@musex/plugin-api`: `src/index.ts` with ALL spec types — PluginManifest, PluginContext, PluginEvents, Section/SectionProvider/SectionContext, TrackAction, TrackDetailProvider, SettingField, SettingsActionResult `{ ok: boolean; message?: string }`, TrackInfo, Disposable, LibrarySearchResult; package.json mirrors `@musex/core`'s source-exports style).
**Create:** `packages/desktop/src/logic/plugin-manifest.ts` (+test): `validateManifest(json: unknown, hostApiVersion: number): { ok: true; manifest: PluginManifest } | { ok: false; reason: string }` — required string fields id (`/^[a-z0-9-]+$/`), name, version, entry (no path separators), numeric apiVersion (mismatch → reason "incompatible").
**Create:** `packages/desktop/src/main/plugins/plugin-store.ts` — per-plugin `storage` (JSON file `userData/plugin-data/<id>.json`, get/set whole-key) and `secrets` (safeStorage-encrypted base64 JSON at `userData/plugin-secrets/<id>.json`; copy the token-store pattern).
**Create:** `packages/desktop/src/main/plugins/plugin-host.ts` (+fixture test): scan `userData/plugins/*/plugin.json` + (when `!app.isPackaged`) `<repo>/plugins/*/dist/plugin.json` (resolve repo root like `mpv-paths.ts`); validate; skip disabled (persisted set in `persistence`); `await import(pathToFileURL(entry).href + "?t=" + generation)`; call `activate(ctx)` in try/catch → status `active | error | disabled | incompatible` (+error message). `reloadAll()`: run all disposables + `deactivate?.()`, bump generation, rescan. Registry on the host: settings schemas, settings action handlers, and (placeholders for Task 2/4) event subscribers, section providers, track actions, detail providers — all registered through ctx with `Disposable`s tracked per plugin. **Constructor-inject paths/services** so the fixture test runs without Electron (like MpvController).
**Create:** `packages/desktop/src/main/plugins/plugin-context.ts`: builds the ctx for a plugin: `manifest`, `log` (prefixed console), `storage`/`secrets` (from plugin-store), `fetch` (global), `registerSettings`, `onSettingsAction`, `ui.notify` (sink → main/index push, like mpv events), and the Task-2/4 registration methods wired to the host registry.
**IPC/preload/contract:** `plugins:list` (id/name/version/status/error), `plugins:setEnabled`, `plugins:reload`, `plugins:getSettings` (schema + values: storage values for text/toggle; for password fields only `{ set: boolean }` — NEVER the secret), `plugins:setSetting` (password→secrets, rest→storage), `plugins:settingsAction` (invoke handler, return `SettingsActionResult`), push `plugins:notify` → renderer toast.
**Renderer:** Settings → new "Plugins" section: per-plugin card (name, version, status/error, enabled toggle), Reload-plugins button, schema-rendered form (text/password/toggle/action/status; match the existing settings CSS classes; small new CSS only as needed). Simple toast stack component for `plugins:notify` (top-right, auto-dismiss, lucide `X`).
**Runtime:** `rt.plugins = new PluginHost(...)` constructed+loaded in `init()`; wire notify sink in `main/index.ts` next to the mpv sink.
**Tests:** manifest validator (valid/missing/bad-id/wrong apiVersion); host fixture test — tmp dir with a real `plugin.json` + tiny `index.mjs` (`export function activate(ctx){ ctx.registerSettings([...]) }`): loads, activates, registers; a throwing plugin → status error, others unaffected; reload re-imports (generation bump observable via a counter the fixture writes).
**Commit:** `feat(plugins): dynamic plugin host — manifest, loader, ctx kernel, settings UI`

### Task 2: Events pipeline (PlaybackMonitor + scrobble gate + ctx.events/library)

**Create:** `packages/desktop/src/logic/scrobble-gate.ts` (+thorough tests): pure class; inputs `start(track: TrackInfo, atEpochSec)`, `position(sec)` (accumulate deltas 0 < d ≤ 2s only while playing; bigger = seek, ignore), `pause()`, `resume()`, `finish()` → returns `{ track, startedAtEpochSec } | null` applying: durationMs > 30_000 AND (playedSec ≥ duration/2 OR playedSec ≥ 240). Fires at most once per start().
**Create:** `packages/desktop/src/main/plugins/playback-monitor.ts`: consumes renderer notifications `{ kind: "start", track: TrackInfo, atEpochSec } | { kind: "pause" } | { kind: "resume" } | { kind: "stop" }` + engine position events (forwarded from the mpv sink in `main/index.ts`). Emits plugin events (`trackStarted/paused/resumed/trackEnded/scrobble`) into the host's event registry (per-subscriber try/catch); maintains recently-played ring (last 50 TrackInfo, persisted via persistence so Discover context survives restarts).
**Renderer:** `player.tsx` effect: on current-track identity change while playing → `playbackNowPlaying({kind:"start", track: toTrackInfo(track), atEpochSec})`; status playing→paused → pause; paused→playing same track → resume; queue cleared/ended → stop. `toTrackInfo` strips ids/urls (title, artistName, albumTitle, durationMs, trackNumber). Restore-paused sends nothing until the user plays.
**ctx:** `events.on(...)` (registry + Disposable), `library.search(query)` (gateway search mapped to name/id results), `library.recentlyPlayed(limit)`.
**IPC:** `playbackNowPlaying` (renderer→main, fire-and-forget `ipcRenderer.send` + `ipcMain.on`).
**Tests:** scrobble-gate matrix (short track never; half-rule; 4-min rule on long tracks; pause/seek don't accumulate; single-fire; restart after finish), monitor event ordering with a scripted sequence.
**Commit:** `feat(plugins): playback events pipeline — monitor, scrobble gate, ctx.events + ctx.library`

### Task 3: last.fm plugin

**Workspace:** add `plugins/*` to `pnpm-workspace.yaml` packages. **Create `plugins/lastfm/`** (`@musex/plugin-lastfm`, private): devDeps `esbuild ^0.28.0`, `@musex/plugin-api workspace:*`; `build.mjs` (esbuild: `src/index.ts` → `dist/index.mjs`, `format: "esm"`, `platform: "node"`, `bundle: true`) + copies `plugin.json` (id `lastfm`, apiVersion 1, entry `index.mjs`) into `dist/`; script `"build": "node build.mjs"`. Root package.json script `"build:plugins": "pnpm -r --filter './plugins/**' build"`; also append plugins build to `pnpm check`? NO — keep check as-is; plugin package gets its own `typecheck` (tsc --noEmit) which `pnpm -r typecheck` picks up automatically.
**Create `plugins/lastfm/src/lastfm-client.ts`** (+unit-testable signing): `sign(params, secret)` = md5 (`node:crypto`) of alpha-sorted `name+value` concat + secret (EXCLUDES `format`); `call(method, params, {secret, signed})` → POST form-encoded with `format=json` added AFTER signing; typed errors from last.fm `{error, message}`.
**Create `plugins/lastfm/src/index.ts`** — `activate(ctx)`:
- settings schema: apiKey (text), apiSecret (password), connect (action), connection (status), scrobbling (toggle, default on).
- connect action: `auth.getToken` (signed) → `shell`-less: plugins can't use Electron — open the authorize URL via `ctx.openExternal`?? NOT in API. **Add `ctx.ui.openExternal(url)` to the kernel in Task 1** (tiny, general; main calls `shell.openExternal`) — note it in plugin-api types. Then poll `auth.getSession` every 5s for 2 min; on success store sk + username in secrets/storage, update status field, `ui.notify("Connected to Last.fm as …")`.
- events: `trackStarted` → `track.updateNowPlaying` (if connected + scrobbling on; failures logged only); `scrobble` → `track.scrobble` with artist/track/timestamp/album/duration.
- track action: "Love on Last.fm" (icon `heart`) → `track.love`, notify result.
**Tests:** signing vector test (construct expected md5 by hand) inside the plugin package (vitest at root picks it up via `pnpm -r test` — give the package a vitest config or root-style test script `vitest run` + passWithNoTests false).
**Manual:** build plugin, launch app, paste creds, connect, play ≥half a track → shows on last.fm profile.
**Commit:** `feat(lastfm): last.fm plugin — auth, scrobbling, Love action (first dynamic plugin)`

### Task 4: Sections + Discover view + track-detail point

**ctx:** `ui.contributeSections(target, provider)`, `ui.contributeTrackAction` (if not finished in T1), `ui.contributeTrackDetail`.
**IPC:** `sections:get(target)` → host fans out to providers (per-provider try/catch + 8s timeout) with `SectionContext` from the monitor's history; **host matches items against the library**: fetch cached `listArtists` once per call, case-insensitive name match → matched items gain `{artistId}` so the renderer navigates; unmatched get `external: true`. `trackActions:list` / `trackActions:invoke(actionId, trackInfo)`; `trackDetail:get(trackInfo)`.
**Renderer:** **Discover view** (nav item, lucide `Compass`, View union + Shell case): sections of `GridCard`s (owned → navigate to artist; external → badge + `externalUrl` via `window.open`-less `plugins`-routed openExternal IPC... reuse `ctx.ui.openExternal` channel as a generic `openExternal` invoke with an allowlist of http/https). Loading/empty states ("No discovery providers enabled"). **Home**: render `"home"`-target sections under built-ins. **TrackContextMenu**: plugin actions listed below "Go to album" (fetch on open). **TrackDetailPanel**: plugin detail sections below the metadata rows (fetch on selection, per-provider).
**last.fm additions:** Discover provider (`artist.getSimilar` for up to 3 recent artists, 10 items each, requires connection) + track-detail provider (`track.getInfo` → Scrobbles/Listeners/Your scrobbles/Top tags).
**Commit:** `feat(plugins): sections + Discover view + track actions/detail points; last.fm providers`

### Task 5: Docs

`docs/plugins.md`: manifest format, lifecycle (activate/deactivate/reload), full API v1 reference (kernel + contribution points + settings vocabulary), how to scaffold/build/install a plugin (esbuild template, `userData/plugins/` drop-in, dev `plugins/*/dist` auto-scan), trust model statement. Update `CLAUDE.md` (architecture bullet: plugin host summary, where things live, apiVersion policy, `plugins:*` IPC namespace; pin note: esbuild 0.28.0). Update the spec's status line to "implemented".
**Commit:** `docs: plugin API v1 reference + CLAUDE.md plugin architecture notes`

---

## Self-review

- Spec coverage: host/loader/reload (T1), kernel ctx incl. notify+openExternal (T1), events+gate+library (T2), settings UI (T1), last.fm auth/scrobble/love (T3), sections/Discover/home/actions/detail + matching + last.fm providers (T4), docs (T5). Data-only UI throughout; TrackInfo-only boundary; password values never round-trip to renderer.
- Consistency: `ctx.ui.openExternal` added in T1 because T3's auth flow needs it (plugins cannot import electron); openExternal allowlisted http/https.
- Risks: ESM import cache on reload (accepted, spec'd); `pnpm -r` now includes plugin packages (typecheck/test must stay green — each plugin package needs its own minimal tsconfig extending base); fixture tests need Electron-free host (constructor-injected paths/services, like MpvController).
