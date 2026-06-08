# Preferences View + Local Media Cache — Design

**Date:** 2026-06-08
**Status:** Approved (design decisions confirmed); spec for review before planning.

## Goal

Add (1) a **Settings/Preferences view** in the desktop app, and (2) a **local media cache** the user can enable, which caches direct-play tracks to disk as they stream, serves them from disk on subsequent plays (including seeking), and auto-evicts least-recently-used files once a configurable size cap is exceeded.

## Decisions (confirmed)

- **Eviction:** LRU auto-eviction at a configurable max-size cap (no manual-only).
- **Settings scope:** a sectioned, extensible preferences view. The **Local Cache** section is functional now; lay out the structure so future sections (Playback, Account, …) slot in. **Volume stays in the Now Playing bar** — it is NOT moved into Settings.
- **UI:** built to the existing approved dark theme/shell — no new visual mockup.

## Architecture

Hexagonal boundaries unchanged. Caching is a **desktop infrastructure concern** that lives entirely in the **main process** inside the existing localhost HTTP stream proxy + a new `MediaCache` module. **No `@musex/core` changes. No renderer/audio-engine changes** beyond the new Settings UI and a few preference IPC channels. The proxy is the single choke point all audio already flows through, so caching is transparent to the player.

### Part 1 — Preferences view (renderer)

- New nav item **Settings** in the sidebar (gear/“Settings”), and a new `view: { name: "settings" }` in `AppProvider`. `Shell` renders `SettingsView` for it.
- `SettingsView` is a **sectioned layout** built to the theme. v1 sections:
  - **Local Cache** (functional): enable toggle; max-size cap (e.g. a number + unit, default **5 GB**); current cache size + file count (read-only); **Clear cache** button.
  - **Account / Library** (light, mostly informational): show connected server + active library (we already have these). Reuses existing data; no new flows. (Sign-out is out of scope for v1.)
  - Structure allows adding more sections later without rework.
- Volume control: **unchanged**, remains in `NowPlayingBar`.
- Reads/writes config via new IPC backed by `electron-store` persistence.

### Part 2 — Local media cache (main process)

**Persistence (`electron-store`):** add to `PersistedState`:
- `cacheEnabled: boolean` (default `false`)
- `cacheMaxBytes: number` (default `5 * 1024**3`)

**`MediaCache` module** (`packages/desktop/src/main/adapters/media-cache.ts`):
- **Location:** `app.getPath("userData")/media-cache/`. All operations are strictly confined to this directory.
- **Key:** `sha256(`​`${serverId}:${plexPath}`​`)` → hex filename. (`plexPath` includes Plex’s file-version token, so a replaced file naturally yields a new key; the stale entry is later evicted.)
- **Read:** `pathIfComplete(key) → string | null` — returns the cache file path if a *complete* entry exists.
- **Write-through:** a tee that writes streamed bytes to a temp file `<key>.<rand>.part`; on **successful, complete** download → atomically `rename` to `<key>` (so an aborted/skipped download never becomes a “complete” entry), then trigger eviction. On error/abort → delete the temp file.
- **Eviction (LRU):** after a successful write, sum the dir’s file sizes; while total `> cacheMaxBytes`, delete the file with the **oldest mtime**. mtime is **touched on every cache read** to approximate “least recently used”. Eviction only ever unlinks files inside `media-cache/`.
- **Clear:** delete all files in `media-cache/`; return freed bytes.
- **Stats:** total bytes + file count.

**Stream-proxy integration** (`stream-proxy.ts handle()`), after the existing secret/Host checks:
1. Caching is keyed on the resolved `serverId` + `plexPath` (already parsed). The proxy reads `cacheEnabled`/`cacheMaxBytes` from the runtime (sourced from persistence).
2. **Only direct-play originals are cached.** Transcode/HLS requests (`/music/:/transcode/…`) are never cached — proxy them as today.
3. If `cacheEnabled` and `pathIfComplete(key)` → **serve from disk**: full request → `200` + `Content-Length` streamed from the file; `Range` request → `206` + `Content-Range` via `fs.createReadStream({start,end})`. Derive `Content-Type` from the file extension (`.flac→audio/flac`, `.mp3→audio/mpeg`, `.m4a/.aac→audio/mp4`, `.ogg/.opus→audio/ogg`, `.wav→audio/wav`, else `application/octet-stream`). Touch mtime.
4. **Cache miss:**
   - `Range` request → proxy to Plex, **do not cache** (partials aren’t cached).
   - Full request (`range` absent) → proxy to Plex **and tee** to the cache (write-through). This is the path that populates the cache, and gapless-5’s Web Audio loader always issues a full GET per track, so every played track gets cached. Plays immediately while caching.

**Concurrency:** the audio element (Range) and Web Audio (full GET) hit the same track simultaneously; only the full GET tees. Two concurrent full GETs use unique temp names and atomic rename (last wins) — safe.

## Security / safety

- Cache files are raw media bytes — **no Plex token** is stored. Fine under `userData`.
- Eviction and Clear **only** unlink within `media-cache/`. No path outside it is ever touched.
- The proxy’s existing secret/Host/Origin protections are unchanged and run before any cache logic.

## Testability

- Unit-testable pure logic (Vitest, node env): cache-key hashing, `Content-Type`-from-extension mapping, and the LRU eviction selection (given a list of `{path,size,mtime}` and a cap, which to delete). These go in `src/logic/` or a pure helper so they’re tested without the filesystem/Electron.
- Filesystem + proxy integration and the Settings UI are verified manually (the app’s established pattern).

## Out of scope (v1)

- Caching transcoded/HLS streams.
- Pre-downloading / “make album available offline” / pinning.
- Per-track cache management UI (only global enable + size + clear).
- Sign-out flow.

## Affected files (preview)

- Renderer: `state/app.tsx` (settings view), `ui/Shell.tsx` (nav + route), new `ui/views/SettingsView.tsx`, theme additions.
- Shared: `shared/ipc-contract.ts` (preference + cache channels).
- Main: `adapters/persistence.ts` (new fields), new `adapters/media-cache.ts`, `adapters/stream-proxy.ts` (cache integration), `runtime.ts` (expose cache config + MediaCache), `ipc.ts` (handlers).
- Logic (pure, tested): `logic/cache-key.ts` / `logic/content-type.ts` / `logic/lru.ts` (or one `logic/cache.ts`).
