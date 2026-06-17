# Default to the Owned Plex Library + In-App Library Switching — Design

**Date:** 2026-06-16
**Status:** Approved in conversation (user: surface = both mobile + desktop; default = auto-pick owned, skip the launch picker; "stack it into PR #44").
**Branch / PR:** stacked into `feature/mobile-home-taste-lockscreen` / **PR #44**.

When a Plex account can reach several servers (the user's own + servers shared with them), musex should **default to a library on the server the user OWNS**, connect automatically without a launch picker, and let the user **switch servers/libraries from Settings**. Applies to desktop and mobile.

## Verified facts (checked against the code)

- Plex `/api/v2/resources` returns **`owned: boolean`** (+ `ownerId`, and `sourceTitle` = the owner's name for shared servers) per resource. `@ctrl/plex`'s `ResourcesResponse` exposes `owned`. **Both surfaces currently discard it.**
- Core `Server = { id, name, connections }`, `Library = { id, serverId, serverName, title, type, updatedAt? }` — no ownership fields.
- Core `discoverMusicLibraries(gateway, token)` lists music libraries across every reachable server (per-server failures skipped into `unreachable`; only account-level 401 propagates).
- **Desktop:** `restoreSession` uses a persisted library if present, else `discoverMusicLibraries` → `libraries[0]` (persisted). `SignIn.tsx` also picks `libraries[0]`. `selectLibrary(id)` IPC persists + sets the watcher. The renderer `library-updated` action **only refreshes when the id is unchanged** (`s.library.id !== a.library.id` returns state untouched) — so a manual switch to a *different* library needs a new action. Settings → Account pane is **read-only**.
- **Mobile:** the launch picker (`app/picker.tsx`) drives selection; the chosen library is **NOT persisted** (re-picks every launch). The mobile gateway resolves a server's base URL **lazily inside `listMusicLibraries`** (`requireBase` throws otherwise), so a restored library must re-prime its server before browsing. Settings is read-only (current library + Sign out). Views (`library/index`, `home/index`) refetch when `state.library` changes (it's in their effect deps).

## Core changes (`@musex/core`)

- `Server` += `owned?: boolean` and `sourceTitle?: string` (optional — keeps existing literals/persisted data valid; absent = not owned).
- `Library` += `owned?: boolean` and `sourceTitle?: string` (stamped from its server during `listMusicLibraries`).
- New pure, tested `logic/library-select.ts`:
  - `pickDefaultServer(servers: Server[]): Server | null` → `servers.find(s => s.owned) ?? servers[0] ?? null`.
  - `pickDefaultLibrary(libraries: Library[]): Library | null` → `libraries.find(l => l.owned) ?? libraries[0] ?? null`.
  - Re-exported from the barrel. Tests: owned-first, fallback-to-first, empty → null.

Rationale for two helpers: **mobile** picks the owned *server* first then lists only that server's libraries (avoids the ~4s probe-timeout per offline shared server at launch); **desktop** already discovers across all servers, so it picks the owned *library* from the full set.

## Mobile changes (`packages/mobile`)

- **Parsing:** `parseServers` maps `owned: Boolean(r.owned)`, `sourceTitle: str(r.sourceTitle)`. `parseLibraries(json, serverId, serverName, owned, sourceTitle)` stamps `owned`/`sourceTitle` onto each `Library`; `gateway.listMusicLibraries` passes `server.owned`/`server.sourceTitle`.
- **Persistence:** new `src/adapters/selected-library-store.ts` over AsyncStorage (`musex.selected-library`) — `loadSelectedLibrary()/saveSelectedLibrary(lib)/clearSelectedLibrary()` (never throws; mirrors `taste-persistence`).
- **Store / bootstrap:** the `signed-in` action carries `library: Library | null`. Bootstrap resolves the library before flipping to the app:
  1. `listServers(token)`.
  2. **Restore:** `loadSelectedLibrary()`; if present, find its server in the list, `listMusicLibraries(thatServer)` to **prime the base URL**, and keep the persisted library if its id is still in that server's libraries, else `pickDefaultLibrary` of them.
  3. **First run (nothing persisted):** `pickDefaultServer(servers)` → `listMusicLibraries(ownedServer)` → `pickDefaultLibrary` → `saveSelectedLibrary`.
  4. `dispatch({ type: "signed-in", token, servers, library })`. On any discovery error, dispatch with `library: null` (routes to the picker fallback).
- **Switching:** store exposes `selectLibrary(library: Library): Promise<void>` — `listMusicLibraries(thatServer)` to ensure base URL, `saveSelectedLibrary`, `dispatch library-selected`. And `listAllLibraries(): Promise<Library[]>` — `discoverMusicLibraries(gateway, token)` across all servers (used lazily by the switcher; tolerates offline shared servers).
- **Routing:** `index.tsx` unchanged in shape — signed-in + library → `/(tabs)/library`, signed-in + no library → `/picker` (now only a fallback for the rare zero-library case).
- **Settings → stack with a switcher:** convert `app/(tabs)/settings.tsx` into `app/(tabs)/settings/{_layout,index,library}.tsx` (Stack, like `library/` and `home/`). `settings/index.tsx` keeps the current content + a tappable **Library** row (current `serverName · title`) → `settings/library`. `settings/library.tsx`: on mount `listAllLibraries()` (loading state), render a `Row` list **owned libraries first**, shared ones subtitled "shared by {sourceTitle}", the current one checked; tapping calls `selectLibrary(lib)` then navigates back. Views refetch via their existing `state.library` deps.

## Desktop changes (`packages/desktop`)

- **Gateway:** `listServers` maps `owned: r.owned`, `sourceTitle: r.sourceTitle`. `listMusicLibraries` stamps `owned: server.owned`, `sourceTitle: server.sourceTitle` onto each mapped `Library`.
- **Default pick:** `restoreSession` and `SignIn.tsx` use `pickDefaultLibrary(result.libraries)` instead of `result.libraries[0]`.
- **Renderer action:** add `library-switched { library }` to the app reducer — sets `library`, resets `view` to `{ name: "home" }`, clears history (distinct from `library-updated`, which is the same-id in-place watcher refresh). Switching to a different server/library reloads the views fresh.
- **Settings → Account switcher:** `AccountSection` becomes interactive. On open it calls `window.musex.discoverLibraries()` (existing IPC; also populates `rt.libraries` so `selectLibrary` can find the target), shows a list **owned-first** (shared subtitled "shared by {sourceTitle}", current selected/disabled), and on click `await window.musex.selectLibrary(lib.id)` then `dispatch({ type: "library-switched", library: lib })`. A loading + empty/error state while discovering.

## Error handling
- Discovery failure at launch → `signed-in` with `library: null` (mobile picker fallback / desktop keeps current). No crash.
- Persisted library whose server/section is gone → falls back to `pickDefaultLibrary`. Persistence reads never throw (logged).
- Switcher discovery tolerates offline shared servers (`discoverMusicLibraries` records them in `unreachable`; we just don't list them).

## Testing
- **Core unit:** `library-select.ts` (`pickDefaultServer`/`pickDefaultLibrary`: owned-first, fallback, empty).
- **Mobile unit:** `parseServers` owned/sourceTitle mapping; `parseLibraries` owned/sourceTitle stamping; `selected-library-store` round-trip (mocked AsyncStorage).
- **Desktop unit:** if the gateway has unit coverage, assert `listServers` maps `owned`; otherwise typecheck-only (the @ctrl/plex calls are env-gated). `pickDefaultLibrary` usage is covered by the core test.
- `pnpm check` green throughout; the controller re-runs the full check before pushing (per the lesson that per-package runs miss repo-wide biome).
- **Manual (user):** fresh sign-in auto-selects the owned server's library (no picker); relaunch keeps it; Settings lists libraries owned-first and switches without re-auth; an account with only shared servers still auto-picks and can switch — on both desktop and the iOS dev client.

## Out of scope
- Choosing among multiple music sections beyond "first owned" as the *default* (the switcher still lists them all).
- Showing non-music sections.
- Syncing the selected library between devices.

## Done when
Both apps connect to the owned server's library automatically on sign-in (no launch picker), persist it across launches, and offer an owned-first library switcher in Settings that swaps libraries without signing out; `pnpm check` green.
