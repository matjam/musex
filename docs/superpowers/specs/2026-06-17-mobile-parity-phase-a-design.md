# Mobile Feature Parity — Phase A Design

**Date:** 2026-06-17
**Status:** Approved (design); spec pending user review
**Context:** First parity phase after the shared-logic promotion (`2026-06-17-shared-logic-promotion-design.md`). These are the "cheap wins" — features whose pure logic already lives in `@musex/core`, so the work is mostly implementing the mobile Plex gateway stubs and building mobile UI. No plugin system, last.fm, downloads, or offline (those are later phases).

## Goal

Bring the mobile (iOS/Expo) app up to the everyday-music-app baseline: search, star ratings (read + write), full playlist CRUD, a per-track action sheet, queue reorder/remove, and genre/mood browsing — reusing core logic and matching desktop behavior where it makes sense on a phone.

## Pleasant surprise: core is almost entirely ready

Grounding against the code confirmed the heavy lifting is done in core:

- `PlaybackSession` already exposes `enqueueNext`, `enqueueEnd`, `playTrackNext`, `removeAt(i)`, `move(from,to)`, `clearQueue`, `playIndex(i)` — with shuffle/`unshuffled` bookkeeping handled. The action sheet and queue editing wire to these; **no new session methods needed.**
- `PlaylistTrack` already carries `playlistItemId` (removal has its ID).
- `searchLibrary(gateway, library, query, token)` already wraps `gateway.search` with a blank-query short-circuit.
- `TasteProfile.recordTrackRating(t, rating10)` and `recordArtistRating` already exist (rating writes feed the local taste profile).
- `genres.ts`, `mood-mixes.ts`, `collage.ts` are in core and mobile already parses `genres`/`moods` onto the models.

So the **only new core code** is a tiny rating-conversion helper (below). Everything else is mobile gateway + mobile UI.

## Navigation change — a Search tab (4 tabs)

Mobile goes from 3 tabs (Home · Library · Settings) to **4** (Home · **Search** · Library · Settings). Add the tab to `app/(tabs)/_layout.tsx`; new stack `app/(tabs)/search/`. The Search tab is the home for both search and genre/mood browsing — the Spotify-familiar model.

## Feature 1 — Per-track action sheet (the spine)

A reusable bottom sheet, `src/ui/TrackActionSheet.tsx`, opened by **long-press on any track row** or a **trailing ⋯ button**. Contents:

- **Header:** track art + title + artist, with a single-line **star rating** control (Feature 2) directly under the subtitle.
- **Actions:** Play next (`session.enqueueNext`/`playTrackNext`) · Add to queue (`session.enqueueEnd`) · Add to playlist… (Feature 3) · Go to artist (navigate to `library/albums?artistId=`) · Go to album (navigate to `library/tracks?albumId=`).
- **Contextual:** when opened from inside a playlist, a **"Remove from this playlist"** row appears (calls `removeFromPlaylist`).

Wired into: album `tracks.tsx` rows, `TrackList` rows, Search result rows, and (for remove) the playlist view. The ⋯ button + long-press both open the same sheet with the track's context (and `playlistId` when applicable).

## Feature 2 — Ratings (write-path + star UI)

- **Core (new):** `packages/core/src/logic/rating.ts` — `starsFromRating10(r: number | null): number` (`Math.round(r/2)`, 0 when null) and `rating10FromStars(stars: number): number` (`stars * 2`); re-uses the now-public `LOVED_RATING`. Pure + unit-tested. (Both surfaces convert 0–10 ↔ 1–5; this removes the inline arithmetic.)
- **Gateway (new):** implement `rateItem(ratingKey, rating10, serverId, token)` → Plex `PUT /:/rate?identifier=com.plexapp.plugins.library&key={ratingKey}&rating={0-10}`. Implement `getUserRating` by reading the item's `userRating` (already parsed onto models; a dedicated re-fetch is unnecessary — the model carries it).
- **UI (new):** `src/ui/StarRating.tsx` — five tappable stars; tapping star *n* writes `rating10FromStars(n)`, tapping the current rating clears it (writes 0). On change: call `gateway.rateItem` **then** `taste.recordTrackRating(track, rating10)` so Top Rated / affinity update locally and immediately. Optimistic UI with revert on gateway rejection.
- **Placement:** in the action-sheet header and on the **Now-Playing** screen (under title/artist).
- No artist rating UI in Phase A (track ratings only).

## Feature 3 — Playlist CRUD

- **Gateway (new):** implement the five stubbed methods against Plex:
  - `createPlaylist(title, firstTrack, serverId, token)` → `POST /playlists?type=audio&title=&smart=0&uri=server://…/library/metadata/{ratingKey}`
  - `addToPlaylist(playlistId, tracks, serverId, token)` → `PUT /playlists/{id}/items?uri=…`
  - `removeFromPlaylist(playlistId, playlistItemId, serverId, token)` → `DELETE /playlists/{id}/items/{playlistItemId}`
  - `renamePlaylist(playlistId, title, serverId, token)` → `PUT /playlists/{id}?title=`
  - `deletePlaylist(playlistId, serverId, token)` → `DELETE /playlists/{id}`
- **UI (new):**
  - `src/ui/AddToPlaylistSheet.tsx` — lists the user's playlists (`listPlaylists`) with a **"New playlist"** row on top; tapping a playlist adds the track(s) (`addToPlaylist`).
  - `src/ui/NewPlaylistDialog.tsx` — name input; on Create, `createPlaylist` with the track already in it.
  - **Remove:** the action sheet's contextual row + swipe-left on a playlist-view row (`removeFromPlaylist` by `playlistItemId`).
  - **Rename / Delete:** long-press a playlist tile (Home "Your playlists" rail) → a small menu → Rename (reuses the name dialog) / Delete (confirm dialog).
- After any mutation, refresh the affected playlist view / playlists list.

## Feature 4 — Search

- **Gateway (new):** implement `search(library, query, token)` → Plex `/library/sections/{id}/search?query=` (or `/hubs/search`), parsed into `SearchResults { artists, albums, tracks }` via the mobile raw-JSON parser.
- **UI (new):** `app/(tabs)/search/index.tsx` — a search field (debounced) calling `searchLibrary`. With a query → **grouped results** (Artists / Albums / Tracks, each capped at a handful); tap track to play, tap artist/album to drill in, long-press → action sheet. With no query → the **Browse grid** (Feature 5).
- **Scope:** library-only search. Federated "not in your library" search needs the acquisition-provider/plugin system — deferred.

## Feature 5 — Genres + Mood mixes (Browse + detail)

- **Browse grid** (no-query state of the Search tab): a proper **2-column tiled grid** (the same `FlatList`/`Tile` pattern as Library browse — tiles must tile cleanly, consistent gutters, no ragged inline-wrap): the 5 mood-mixes as color/`Collage` tiles (`mood-mixes.ts`) and library genres (`genres.ts` `genreIndex` over `listAllAlbums`) as a tile/chip grid below.
- **Detail screens** (reuse `src/ui/TrackList.tsx`):
  - `app/(tabs)/search/mix.tsx?mood=` → tracks for the mood mix (`mood-mixes.ts`).
  - `app/(tabs)/search/genre.tsx?genre=` → tracks for the genre (`genres.ts`).
- Both compose from `listAllAlbums`/`listAllTracks` (already real) + the core logic (already there).

## Feature 6 — Queue editing + Now-Playing rating

- **Now-Playing rating:** the `StarRating` control under the title (Feature 2).
- **Up Next reorder/remove:** the Up Next list becomes a draggable list — **drag the ≡ handle** to reorder (`session.move(from,to)`), **swipe-left** to reveal Remove (`session.removeAt(i)`); tapping a row still jumps (`session.playIndex`). Indices are absolute queue indices.
- **New dependency:** drag + swipe need `react-native-gesture-handler` + `react-native-reanimated` (common Expo deps) and a draggable list — `react-native-draggable-flatlist`. Install via `expo install`. **These are native deps → the dev client must be rebuilt (`expo prebuild` + `expo run:ios`); CI stays JS-only.**

## Core changes (complete list)

1. `packages/core/src/logic/rating.ts` (+ test) — `starsFromRating10`, `rating10FromStars`; barrel export.

That is the entire core surface change. (All queue/session/taste/search/genre/mood logic already exists.)

## Mobile gateway methods to implement (replace the Phase-1 throwing stubs)

`search`, `rateItem`, `getUserRating`, `createPlaylist`, `addToPlaylist`, `removeFromPlaylist`, `renamePlaylist`, `deletePlaylist`. (`listAllTracksPage` stays unimplemented — pagination is a separate perf concern, out of scope.) Each gets a fake-`fetch` unit test (the gateway already takes an injected `fetch` + `clientId` for this). Verify `parsePlaylistTracks` populates `playlistItemId` (the model field exists; confirm the parser fills it — it must, for removal).

## New mobile UI (files)

- `app/(tabs)/_layout.tsx` — add the Search tab.
- `app/(tabs)/search/{_layout,index,genre,mix}.tsx` — Search tab stack.
- `src/ui/TrackActionSheet.tsx`, `src/ui/StarRating.tsx`, `src/ui/AddToPlaylistSheet.tsx`, `src/ui/NewPlaylistDialog.tsx`.
- Wire long-press/⋯ into existing track rows (`TrackList`, album `tracks.tsx`, search results).
- Now-Playing (`app/now-playing.tsx`): star row + draggable/swipeable Up Next.
- Home "Your playlists" rail: long-press → Rename/Delete menu.

## Testing

- **Core:** `rating.ts` unit tests (conversion + null/clear). Existing `PlaybackSession` queue-mutation tests already cover `move`/`removeAt`/`enqueueNext`/`enqueueEnd`; no new core behavior to test beyond rating.
- **Mobile gateway:** fake-`fetch` unit tests for each new method (request shape: URL, method, params; response parse for search). Assert blank-query short-circuit via `searchLibrary`.
- **Verification bar:** full `pnpm check` (core + desktop ×2 tsc + mobile + biome + all tests) green before every commit; controller re-runs before push.
- **On-device acceptance (user):** search results + browse tiles tiling correctly, rating write reflected in Plex + Top Rated, playlist create/add/remove/rename/delete, action sheet from every surface, queue drag-reorder + swipe-remove, all after a dev-client rebuild (native deps).

## Non-goals / deferred

- Federated/external search, acquisition, taste expansion, new-release watching (need the plugin/provider system).
- Last.fm (scrobble, similar, radio, bio) — its own phase.
- Downloads / offline / transcoded storage — its own iOS phase.
- Audio filters / EQ (AVPlayer can't do mpv's filter graph).
- Artist rating UI; flat all-tracks pagination (`listAllTracksPage`); lyrics; gapless.

## Success criteria

- 4-tab nav with a working Search tab (grouped results + tiled Browse grid).
- Star ratings read + write (Plex + local taste profile), in the action sheet and Now-Playing.
- Full playlist CRUD (create, add, remove, rename, delete) from the relevant surfaces.
- A per-track action sheet (long-press + ⋯) reused across all track rows.
- Up Next reorder + swipe-remove.
- Genre + mood-mix browse and detail screens.
- All eight gateway stubs implemented + tested; `pnpm check` green; only `rating.ts` added to core.
