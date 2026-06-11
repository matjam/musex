# Library Staleness: Detect Plex Changes and Refresh — Design

**Date:** 2026-06-11
**Status:** Approved (user: "spec it and build it")

## Problem

New artists/albums/tracks added to Plex never appear in a running musex (often
not even after a restart). Root cause (traced 2026-06-11): every list fetch is
validated by a Plex `updatedAt` timestamp the app **never refreshes** — the
persisted `Library.updatedAt` is written once at selection and restored
forever, so `listValidator(library.updatedAt)` never changes, the list cache
hits every time, and Plex is never re-asked. Nested lists inherit the problem
(`artist.updatedAt` / `album.updatedAt` come from those same cached lists).
There is no refresh trigger anywhere — no poller, no websocket, no manual
refresh. The validator architecture is sound; nothing feeds it fresh
timestamps.

## Detection: how we learn "it changed"

Two mechanisms, both verified against the installed `@ctrl/plex` v6 and the
python-plexapi reference docs:

1. **Push (primary): PMS websocket notifications** at
   `ws(s)://<baseUrl>/:/websockets/notifications?X-Plex-Token=<token>`
   (baseUrl+token already available via `PlexapiGateway.endpoint()`).
   Messages are `{"NotificationContainer": {...}}`; the interesting one is
   `type: "timeline"` with `TimelineEntry[]` of
   `{identifier, sectionID, state, ...}` — `identifier ===
   "com.plexapp.plugins.library"`, `sectionID` matching our section, and
   `state === 5` (item processed) or `state === 9` (item deleted) mean the
   library changed. `@ctrl/plex` exports these payload **types**
   (`AlertTypes`, `TimelineNotification` from `alert.types.ts`) — we import
   the types only. We do NOT use its `AlertListener` class: it has no
   reconnect and attaches no `error` handler to the `ws` socket (an unhandled
   `error` event would crash main). Electron 42's main process is Node 24
   (verified: 24.15.0), which has a stable global `WebSocket` — we hand-roll
   the ~30-line connection with it. **No new dependency.**

2. **Poll (fallback): section timestamp compare.** One
   `library.sections()` call returns each section's `updatedAt` AND
   `scannedAt`. Compare against the last value we hold; differ → changed.
   Runs every 15 minutes, plus immediately after every websocket (re)connect
   (covers events missed while disconnected).

### Prerequisite fix: map `scannedAt` into `Library.updatedAt`

Plex bumps a section's `scannedAt` on every completed scan; `updatedAt` only
moves on section-settings changes. `PlexapiGateway.listMusicLibraries`
currently maps only `s.updatedAt` — change it to
`Math.max(s.updatedAt.getTime(), s.scannedAt.getTime())` so the value the
whole validator system keys on actually moves when content changes. (A
changed validator is the designed cache-refresh path — no cache version bump
needed.)

## Refresh pipeline (main process)

On a detected change (debounced — see below):

1. Re-fetch the section list via the existing
   `gateway.listMusicLibraries({id: lib.serverId, name: lib.serverName,
   connections: []}, token)` (the method only uses `id`/`name`; it is not
   list-cached) and find our section → fresh `Library` with new `updatedAt`.
2. **Evict the entire list cache** (`ListCacheStore.clear()` exists). Whole-
   store eviction is deliberate: Plex does not reliably bump an *artist's*
   `updatedAt` when an album appears under it, so trusting nested validators
   after a change is fragile; the cache exists purely as a cache and refills
   lazily. Cost: one refetch per actual library change.
3. `persistence.setLibrary(fresh)` (so the next launch starts fresh too).
4. Push `musex:library:changed` with the fresh `Library` to the renderer.
5. Log one line (`[musex library] section <title> changed — refreshed`).

If the refresh fetch fails: log, keep the old state, and let the next trigger
(debounce re-arm, 15-min poll, reconnect) retry. A Plex 401 stops the watcher
(the existing auth flow owns recovery; watcher restarts on next library
selection).

### Debounce

A Plex scan over a batch import fires many timeline entries. Coalesce:
first relevant event arms a **5s quiet-period timer** (each further event
re-arms it), with a **30s max wait** from the first event so a long scan
still produces interim refreshes.

## Renderer

- `state/app.tsx`: new action `{type: "library-updated"; library: Library}` —
  reducer replaces `state.library` (and nothing else: view, search etc.
  untouched) **only when** signed-in and `a.library.id === s.library?.id`;
  `AppProvider` subscribes via a new `window.musex.onLibraryChanged(cb)`
  (preload push pattern identical to `onNavigateTo`).
- That's the entire renderer change: every view's fetch `useEffect` already
  depends on `library`, so the new object (new `updatedAt`) triggers refetches
  with fresh validators; the evicted main cache misses and goes to Plex.
  Detail views holding stale `artist`/`album` objects also depend on
  `library`, so they live-refetch too (their stale child validators just miss
  the now-empty cache — correct data either way).

## Components

1. **Pure logic — `packages/desktop/src/logic/library-watch.ts`** (new,
   tested): `relevantSectionChange(container, sectionId): boolean` (parse an
   `AlertTypes` NotificationContainer payload; timeline entries with the
   library identifier, matching section, state 5|9), `sectionFrom(libraries,
   id)`, `timestampChanged(prev, fresh)` (inequality, not greater-than — a
   reset Plex DB must still register), `nextReconnectDelayMs(attempt)`
   (capped exponential 1s→60s), and a `ChangeCoalescer` class (injected
   `now()`; `noteChange(now)` → `dueAt` honoring 5s quiet / 30s max — the
   adapter owns the actual timer).
2. **Adapter — `packages/desktop/src/main/adapters/library-watcher.ts`**
   (new): owns the global-`WebSocket` connection, timers (debounce, poll,
   reconnect backoff), and lifecycle (`setLibrary(lib | null)` idempotently
   starts/stops/reconnects; `dispose()` on app quit). Constructor takes a
   deps object (endpoint/listMusicLibraries/onChange/getToken closures) so it
   is wireable from `Runtime` without importing it.
3. **Wiring** — `Runtime` (or `main/index.ts`): construct the watcher with
   closures over `rt`; `onChange` = the refresh pipeline above;
   `setLibrary()` called after init (persisted library), in the
   `selectLibrary` IPC handler, and with `null` on sign-out/401;
   `dispose()` in `will-quit`.
4. **IPC** — `ipc-contract.ts`: `libraryChanged: "musex:library:changed"`
   (push main→renderer, payload `Library`), `MusexApi.onLibraryChanged`;
   preload subscription wrapper; `main/index.ts` forwards via
   `win.webContents.send` like the other push channels.

## Testing

- `logic/library-watch.test.ts`: notification parsing (timeline hit, wrong
  section, wrong identifier, states 0–4 ignored, activity/status/playing
  ignored, malformed → false), `ChangeCoalescer` quiet/max-wait behavior with
  fake now, reconnect backoff curve, timestamp compare.
- Gateway mapping change covered by typecheck + existing smoke test
  (`MUSEX_PLEX_E2E`, env-gated, not run in CI).
- Manual e2e: with the dev app running, add a file to the Plex library (or
  trigger a Plex scan) → app shows the new item within seconds, without
  restarting; relaunch shows it too.

## Out of scope (deliberate)

- Item-level diff fetches (`addedAt>>=` queries) — whole-cache evict +
  lazy refill is simpler and correct.
- Watching non-selected libraries/servers.
- Renderer UI for "library updated" (silent refresh; no toast).
- Manual refresh button (the watcher makes it redundant; revisit if needed).
