# Spec 2 — Library Search & Playlists — Design

**Date:** 2026-06-08
**Status:** Approved (design decisions confirmed via visual companion); spec for review before planning.
**Roadmap:** Implements the bulk of roadmap item 2 (*App shell & library UI*) from the foundation spec — in-library search + playlists, plus making the placeholder Search/Playlists nav real.

## Goal

Add **in-library search** and **Plex-backed playlists** to the desktop app: search the active library as you type (artists, albums, tracks) and fully manage playlists that live on the Plex server (create, play, add/remove tracks, rename, delete). Introduce a reusable track row + context menu shared across album, search, and playlist views.

## Decisions (confirmed)

- **Search behavior:** live as-you-type (debounced ~250 ms), scoped to the active library.
- **Search results layout:** grouped lists in order — **Artists → Albums → Songs** (no "top result" ranking).
- **Playlist storage:** **Plex-backed** (server API), so playlists sync with every Plex client and survive reinstall.
- **Playlist scope:** **full management** — list, open, play, create, add/remove tracks, rename, delete.
- **Playlist navigation:** **sidebar rail** (Spotify-style) — playlists listed directly in the sidebar with a "+" to create; click opens the playlist detail view.
- **Add-to-playlist trigger:** **both** a "⋯" button on track-row hover **and** right-click, opening the same context menu.

## Architecture

Hexagonal boundaries preserved. The work splits cleanly:
- **`@musex/core`** — new models (`Playlist`, `SearchResults`) + `PlexGateway` port extensions (search + playlist ops) + thin use-cases. No DOM/Node.
- **Main (data plane)** — implement the new gateway methods against `@ctrl/plex` v6, bake art URLs through the existing `StreamProxy`, expose new IPC channels.
- **Renderer (UI plane)** — `SearchView`, `PlaylistView`, the sidebar playlist rail, and a shared `TrackRow` + `TrackContextMenu`; new app `View`s.

Playback needs **no core changes**: playing a playlist or a search result reuses the existing `PlaybackSession.loadQueue(tracks, index)`.

### Core (`@musex/core`)

**Models** (`models/index.ts`):
```ts
export interface Playlist {
  id: string;          // Plex playlist ratingKey
  serverId: string;
  title: string;
  trackCount: number;
  durationMs?: number;
  thumb?: string;      // composite cover (may be undefined)
}
export interface SearchResults {
  artists: Artist[];
  albums: Album[];
  tracks: Track[];
}
// A track as it appears inside a playlist: the track plus its identity within
// that playlist (Plex's playlistItemID), needed to remove the right row even
// when the same track appears more than once.
export interface PlaylistTrack {
  track: Track;
  playlistItemId: string;
}
```

**`PlexGateway` port extensions** (`ports/plex-gateway.ts`):
```ts
search(library: Library, query: string, token: string): Promise<SearchResults>;
listPlaylists(library: Library, token: string): Promise<Playlist[]>;
listPlaylistTracks(playlistId: string, serverId: string, token: string): Promise<PlaylistTrack[]>;
createPlaylist(library: Library, title: string, trackIds: string[], token: string): Promise<Playlist>;
addToPlaylist(playlistId: string, serverId: string, trackIds: string[], token: string): Promise<void>;
removeFromPlaylist(playlistId: string, serverId: string, playlistItemIds: string[], token: string): Promise<void>;
renamePlaylist(playlistId: string, serverId: string, title: string, token: string): Promise<void>;
deletePlaylist(playlistId: string, serverId: string, token: string): Promise<void>;
```
- `search` caps each type for responsiveness (e.g. 8 artists / 8 albums / 30 tracks) — exact limits set in the plan.
- Removal keys on the Plex **playlistItemID** (a track's identity *within* a playlist, distinct from its `ratingKey`), so `listPlaylistTracks` must surface that id. This means a playlist track needs its `playlistItemID` carried alongside the `Track` (a `PlaylistTrack = { track: Track; playlistItemId: string }` wrapper returned by `listPlaylistTracks`, rather than polluting the base `Track` model).

**Use-cases** (thin, gateway-backed, testable against fakes): `searchLibrary`, and playlist command/query helpers as needed. Most are direct pass-throughs; the value is the port boundary + fakes, consistent with `discoverLibraries`.

**Fakes** (`testing/fakes.ts`): extend `FakePlexGateway` with in-memory playlists + search so renderer-independent tests cover create/add/remove/rename/delete and search grouping.

### Main process

**Gateway adapter** (`adapters/plex-gateway.ts`) — map to `@ctrl/plex` v6 (verified present in installed types):
- Search: `MusicSection.searchArtists / searchAlbums / searchTracks` (per-type, with a query + limit).
- Playlists: `library.playlists()`, `library.createPlaylist(title, opts)`, `Playlist.items()`, `Playlist.addItems()`, `Playlist.removeItems()`, `Playlist.edit({title})`, `Playlist.delete()`.
- Exact call shapes verified against installed `.d.ts` + (at planning) context7 docs for `@ctrl/plex`, per project rule.

**Art URLs** — playlist covers + search-result thumbs are baked to proxy URLs via `rt.proxy.artUrl(serverId, thumb)` exactly like browse results today; `ensureProxyEndpoint` is already called on browse.

**IPC** (`shared/ipc-contract.ts`, `main/ipc.ts`, `preload/index.ts`): `search`, `listPlaylists`, `listPlaylistTracks`, `createPlaylist`, `addToPlaylist`, `removeFromPlaylist`, `renamePlaylist`, `deletePlaylist`. Inputs validated; thumbs baked before returning.

### Renderer

**App state** (`state/app.tsx`): `View` gains `{ name: "search" }` and `{ name: "playlist"; playlist: Playlist }`. A small app-level store of the user's playlists (loaded once on sign-in, refreshed after mutations) so the sidebar rail and the "Add to playlist" submenu share one source of truth.

**Sidebar (`ui/Shell.tsx`)** — make **Search** functional (→ search view); add a **Playlists** rail: a header with a "+" (new playlist), then the playlist titles (scrollable; active highlight), placed below the Library nav and above the library switcher.

**New views:**
- `SearchView` — a live search input (debounced ~250 ms; clears to an empty-state prompt; loading + "no results" states). Results render as **B/grouped**: Artists (circles row) → Albums (grid) → Songs (list). Artist/album click navigates; song click plays (loads a queue of the songs results from that index); song rows use the shared `TrackRow`.
- `PlaylistView` — mirrors `AlbumDetailView`: header (cover, "Playlist" label, title, song count + total duration, green play button, "⋯" menu = rename / delete / play), then the track list via `TrackRow`. Empty playlists show a prompt. Track rows here include **Remove from this playlist**.

**Shared components:**
- `TrackRow` — one component used by album, search, and playlist track lists. Shows index/art/title/artist/duration, a hover "⋯" button, click-to-play, and right-click → context menu.
- `TrackContextMenu` — items: **Add to playlist ▸** (submenu: "+ New playlist", then each playlist), **Go to album**, **Go to artist**, and (playlist context only) **Remove from this playlist**. Opened by the ⋯ button or right-click; closes on outside-click/Esc; positioned to stay on-screen.
- `NewPlaylistDialog` — a small in-app modal (themed, not native) prompting for a name; used by the sidebar "+" and the submenu's "+ New playlist" (the latter creates the playlist seeded with the chosen track).

**Mutations & feedback:** after create/add/remove/rename/delete, refresh the affected data (playlist list and/or the open playlist) so the UI reflects server state. Errors surface inline (no silent failure); a 401 drops to re-auth per existing policy.

## Out of scope (deferred)

- **Queue management** — "Play next" / "Add to queue" and a visible play-queue view. The context menu is built to accept these items later; they ship with a dedicated queue slice (they need `PlaybackSession` insertion logic + a queue UI).
- **Drag-to-reorder** within a playlist — depends on Plex's playlist-move API; **flagged for verification at planning**. If cheap and supported, it may be folded in; otherwise it's a follow-up. Add/remove/rename/delete do not depend on it.
- External-metadata search (Spec 3), AI discovery (Spec 4), Lidarr (Spec 5), multi-library merged search, smart playlists, collaborative playlists, lyrics, scrobbling.

## Testability

- **Core is the test target:** `searchLibrary` + playlist use-cases against an extended `FakePlexGateway` (in-memory playlists + search) — assert grouping/limits, create-seeds-with-track, add/remove by `playlistItemId`, rename, delete, and that playing a playlist/search result loads the correct queue.
- Gateway-adapter `@ctrl/plex` mapping verified against installed types + the env-gated smoke test (`MUSEX_PLEX_E2E`) extended to exercise search + a create/add/remove/delete round-trip on a real server.
- Renderer views/menus verified manually (the app's established pattern); pure helpers (e.g. debounce, duration/string formatting) unit-tested.
- Local bar = CI bar: `pnpm check` (typecheck + tests + Biome) before every push.

## Affected files (preview)

- Core: `models/index.ts` (+`Playlist`, `SearchResults`, `PlaylistTrack`), `ports/plex-gateway.ts` (+search/playlist methods), `testing/fakes.ts`, new `usecases/search-library.ts` (+ playlist use-cases) with tests.
- Shared: `shared/ipc-contract.ts` (channels + types + `MusexApi`).
- Main: `adapters/plex-gateway.ts` (search + playlist impls), `ipc.ts` (handlers, thumb baking), `preload/index.ts`.
- Renderer: `state/app.tsx` (views + playlist store), `ui/Shell.tsx` (Search nav + Playlists rail), new `ui/views/SearchView.tsx`, `ui/views/PlaylistView.tsx`, new `ui/TrackRow.tsx`, `ui/TrackContextMenu.tsx`, `ui/NewPlaylistDialog.tsx`, refactor `ui/views/AlbumDetailView.tsx` to use `TrackRow`, `ui/theme.css` additions.

## Build sequence (for the plan)

1. Core models + port + fakes + use-case tests (search + playlists).
2. Gateway adapter impls + IPC + preload.
3. Shared `TrackRow` + `TrackContextMenu` (refactor AlbumDetailView onto it) — no playlists yet (menu shows Go to album/artist).
4. SearchView + Search nav.
5. Playlists: sidebar rail, PlaylistView, NewPlaylistDialog, wire Add/Remove/Create/Rename/Delete into the menu + playlist store.
6. Verification (full `pnpm check` + manual smoke + extended E2E smoke).
