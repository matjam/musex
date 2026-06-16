# Library Browse v2 — Design

**Date:** 2026-06-16
**Status:** Approved in conversation (visual-companion mockups; user: "spec it and build it all")

Refines the Phase 2 library UI: consistent **tiles** (art + label), a **flat
segmented browse** (Artists / Albums / Tracks) with an **A–Z fast-scroll bar**,
the existing **drill-down** preserved, and a top **action bar** (Play / Shuffle /
Add to Queue) on album and artist screens. Lands on the **`feature/mobile-ui-phase2`
branch / PR #42** (it rewrites the same library screens Phase 2 built, pre-merge).

## Decided UI (from the visual companion)

- **Flat browse + drill-down (both).** Library tab = a segmented control
  (Artists / Albums / Tracks); each segment is a **2-column tile grid** with the
  **A–Z scrubber**. Tapping a tile still drills in.
- **Tiles:** 2 columns. Artists = circular art + name; Albums = cover + title +
  artist; Tracks = album art + title + artist.
- **A–Z scrubber:** vertical `# A B … Z` bar on the right; drag maps touch-Y →
  letter → scroll; a green **letter bubble** shows during drag.
- **Action bar (treatment B):** three equal icon+label buttons **Play /
  Shuffle / Add to Queue**, on the Album screen (the album) and the Artist
  screen (all the artist's tracks).

## Screens (`packages/mobile/app/(tabs)/library/`)

- **`index.tsx` — flat browse** (replaces the Phase 2 artists-only list): a
  `SegmentedControl` (Artists / Albums / Tracks) over a 2-col tiled `FlatList` +
  `AZScrubber`.
  - Artists → `listArtists`; tile (circular) → tap `→ /albums?artistId`.
  - Albums → `listAllAlbums` (NEW); tile → tap `→ /tracks?albumId`.
  - Tracks → `listAllTracks` (NEW); tile → tap plays that track
    (`loadQueue(buildQueue([track], 0))`).
- **`albums.tsx` — an artist's albums + action bar.** Header = artist name;
  `ActionBar` acts on **all the artist's tracks** (`listArtistTracks`); body =
  2-col album tiles → tap `→ /tracks?albumId`.
- **`tracks.tsx` — an album's tracks + action bar.** Big art header + album
  title/artist; `ActionBar` acts on the album's tracks; body = track-numbered
  list (unchanged ordering — NOT tiled/A–Z; tracks aren't alphabetical).

## Components (`packages/mobile/src/ui/`)

- **`Tile.tsx`** — `AlbumArt` (square or circular) + label + optional sublabel;
  fixed-width for a 2-col grid (`(width - gutters) / 2`).
- **`SegmentedControl.tsx`** — pure presentational; `segments: string[]`,
  `value`, `onChange`.
- **`AZScrubber.tsx`** — props: `letters: string[]`, `onScrubTo(letter)`. A
  vertical bar; `onResponderMove` computes the letter from touch Y; shows a
  bubble overlay with the active letter. Parent owns the FlatList ref and, on
  `onScrubTo`, calls `flatListRef.scrollToIndex({ index, viewPosition: 0 })`
  using a **letter→firstIndex map** (pure helper below). Handle
  `onScrollToIndexFailed` (FlatList may not have measured far rows) by
  `scrollToOffset` estimate then retry.
- **`ActionBar.tsx`** — `{ getTracks: () => Promise<Track[]> | Track[] }` + the
  session; three buttons: **Play** → `session.loadQueue(buildQueue(tracks, 0))`;
  **Shuffle** → `session.loadQueueShuffled(tracks)`; **Add to Queue** →
  `session.enqueueEnd(tracks)`. (All exist on the core `PlaybackSession`.) Shows
  a brief disabled/spinner state while fetching tracks.

## Pure logic (tested — `packages/mobile/src/logic/`)

- **`az-index.ts`** — `letterFor(name): string` (first char uppercased, digits →
  `#`, other → `#`) and `buildLetterIndex(items, keyFn): { letters: string[];
  indexOf: Record<string, number> }` mapping each present letter to the first
  item index in the alphabetically-sorted array. Unit-tested (digits, accents,
  empty, case).
- Reused by the browse screens to drive the A–Z scrubber.

## Gateway work (`packages/mobile/src/adapters/plex-gateway.ts` + parsers)

The Phase 1 mobile gateway STUBS these to throw — implement them now:
- **`listAllAlbums(library, sort, token)`** → `GET {base}/library/sections/{id}/all?type=9`
  → `parseAlbums`. (Sort: title; mirror desktop's sort param if present, else
  client-sort by title.)
- **`listAllTracks(library, sort, token)`** → `…/all?type=10` → `parseTracks`.
- **`listArtistTracks(artistId, library, token)`** (NEW method) → `GET
  {base}/library/metadata/{artistId}/allLeaves` → `parseTracks`. Feeds the
  Artist action bar.
- All go through the existing `parse*` (already handle Metadata/Media/Part).
  Add fake-fetch unit tests for the new method + the un-stubbed ones.

## Testing
- **Unit:** `az-index.ts` (letterFor, buildLetterIndex); gateway `listAllAlbums`/
  `listAllTracks`/`listArtistTracks` against fake `fetch` (fixtures).
- **Manual (device/sim):** segmented switch; 2-col tiles + art; A–Z drag jumps +
  bubble; drill-down (artist→albums→tracks); action bars Play/Shuffle/Add on
  album AND artist; tapping a track tile plays it.
- `pnpm check` green throughout.

## Risks / notes
1. **All Tracks size** — a large library returns thousands of tracks; v1 fetches
   the full list with a loading state. If sluggish, paginate later (desktop's
   `listAllTracksPage` progressive pattern is the reference). Documented, not
   built now.
2. **`scrollToIndex` on a 2-col `FlatList`** — needs `getItemLayout` (fixed tile
   height) or robust `onScrollToIndexFailed`; this is the fiddly bit. Fixed tile
   height makes `getItemLayout` straightforward.

## Out of scope
Per-track row actions / context menu (action bars only — user chose album+artist
headers, not per-row); All-Tracks pagination; search; drag-reorder.

## Done when
Library tab shows the segmented tiled browse with a working A–Z scrubber;
drill-down still works; album and artist screens have the Play/Shuffle/Add-to-
Queue bar wired to the queue; new gateway methods return data; `pnpm check` green.
