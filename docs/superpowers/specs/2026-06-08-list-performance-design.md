# Spec 2c — List Caching, Pagination & Virtualization (performance) — Design

**Date:** 2026-06-08
**Status:** Draft for review.
**Context:** Large lists (e.g. a long playlist, the full library) are slow to open and re-open. This slice makes lists fast: cache results (disk-persisted, exactly revalidated), load long lists progressively, and render them virtualized.

## Goal

Opening any list is **instant when nothing changed** (served from a disk-persisted cache, validated for free), **fast on first load** of huge lists (progressive paging instead of one giant blocking fetch), and **smooth to scroll** at thousands of rows (virtualized rendering). No correctness regressions — a changed list always refetches; mutations invalidate immediately.

## Decisions (confirmed)

- **Scope:** full pass — cache + pagination/lazy-load + virtualized rendering.
- **Persistence:** cache persists to disk (survives restart; revalidated on access).

## Key mechanism: validator-based exact revalidation

Plex has **no per-item delta API** for playlist/library contents, but every list has a cheap **validator** the renderer already holds:

- **Playlist tracks** → the playlist's `updatedAt` + `leafCount` (from `listPlaylists`, already loaded for the sidebar).
- **Artist's albums** → the artist's `updatedAt`; **album's tracks** → the album's `updatedAt` (from the parent list).
- **Library artists/albums** (top level, no cheap parent) → the music section's `updatedAt`/`scannedAt`, else a short TTL fallback.

The renderer passes the current validator with each list request. The cache compares it to the stored validator:
- **match** → return cached list immediately, **no Plex call**.
- **differ / missing** → fetch (paginated), store with the new validator, return.

This requires adding `updatedAt` to the `Artist`, `Album`, and `Playlist` models (mapped from Plex's `updatedAt`). It's exact (not time-based) and costs zero extra network on the hot path.

## Architecture

Hexagonal preserved. Caching is a **main-process decorator around `PlexGateway`** — a `CachingPlexGateway` that implements the same port, wraps the real `PlexapiGateway`, and is what `Runtime` instantiates. **`@musex/core` stays pure and unaware.** Pagination is a fetch detail inside the gateway + a renderer-facing page API for progressive load; virtualization is renderer-only.

### Part 1 — Models (core)

Add `updatedAt?: number` (epoch ms) to `Artist`, `Album`, `Playlist`. Map from Plex `updatedAt` in the desktop mappers. A small pure helper `listValidator(updatedAt?, count?) → string` (e.g. `"${updatedAt ?? 0}:${count ?? 0}"`) lives in core or `logic/` and is unit-tested.

### Part 2 — Caching decorator (main)

`packages/desktop/src/main/adapters/caching-plex-gateway.ts` — `class CachingPlexGateway implements PlexGateway`, constructed with the real gateway + a `ListCacheStore`.

- **Cached methods** (item-heavy): `listArtists`, `listAlbums`, `listTracks`, `listPlaylistTracks`. Each takes the existing args **plus the caller's validator** — so the port methods grow an optional `validator?: string` parameter (added in core; `undefined` = always fetch, preserving today's behaviour for any caller that doesn't pass one).
- **Pass-through / cheap**: `listPlaylists` (cheap; provides validators for playlist tracks — optionally cached with a short TTL), `search` (live — never cached), auth/discovery/`endpoint`.
- **Lookup:** key = stable hash of (method + ids). On call: read the store entry; if present and `entry.validator === args.validator` → return `entry.data`; else call the wrapped gateway, store `{ validator, data, ts }`, return.
- **Mutation invalidation:** `addToPlaylist` / `removeFromPlaylist` / `createPlaylist` / `renamePlaylist` / `deletePlaylist` delegate to the real gateway, then **evict** the affected `listPlaylistTracks:{id}` key (and the playlists-list cache). So the next open refetches.
- The decorator returns the **same shapes** the IPC already bakes art URLs onto — art baking stays in `ipc.ts`, unchanged.

### Part 3 — Disk persistence (`ListCacheStore`)

`packages/desktop/src/main/adapters/list-cache-store.ts` — JSON entries under `app.getPath("userData")/list-cache/`, one file per key (`<sha256(key)>.json` = `{ validator, ts, data }`). All ops confined to that dir. A modest cap (entry count or total bytes) with oldest-`ts` eviction — mirrors `MediaCache`'s confinement + eviction discipline. In-memory layer in front for same-session instant hits; disk read on cold start. Pure key-hashing + eviction-selection logic is unit-tested; fs ops tested against a temp dir like `MediaCache`.

### Part 4 — Progressive / paginated load (huge first loads)

For the item-heavy lists, add page-aware fetching so a cache miss doesn't block on one giant request:
- Gateway fetches in batches via Plex container params (`X-Plex-Container-Start` / `X-Plex-Container-Size`); the response's `totalSize` bounds it. (Note: `@ctrl/plex`'s `playlist.items()` fetches everything in one call, so playlist-track paging fetches `/playlists/{id}/items` directly via `fetchItems` with container options — the same deep path already used.)
- Renderer-facing page API: `listPlaylistTracksPage(playlistId, serverId, start, size, validator?) → { items, total }` (and equivalents where needed). The view loads page 0, renders, then loads subsequent pages (eagerly in the background and/or on scroll) until `total`, appending to the virtualized list. Once fully assembled, the decorator caches the complete list so later opens are a single instant hit.
- On a cache hit the full list is already present — no paging needed; paging only applies to the cold path.

### Part 5 — Virtualized rendering (renderer)

Track lists (`PlaylistView`, `AlbumDetailView`, and the search Songs group) render via a windowing library so only visible `TrackRow`s mount. **Library choice:** a maintained, React-19-compatible virtualizer — **`@tanstack/react-virtual`** is the leading candidate; **confirm the latest version + React 19 peer compatibility with `npm view` and current docs at planning** (per project rule), and wrap it so the list components don't depend on it directly (a small `VirtualTrackList` component). The grid views (artists/albums) can be virtualized too if needed, but track lists are the priority.

## Build sequence (phased — each phase ships independently)

1. **Cache + disk + validators** (Parts 1–3): models gain `updatedAt`; `CachingPlexGateway` + `ListCacheStore`; renderer passes validators; mutations invalidate. **Delivers the biggest win** — instant re-opens, fast restart — at the lowest risk. Shippable alone.
2. **Virtualized rendering** (Part 5): `VirtualTrackList`; smooth scroll on huge lists. Shippable alone.
3. **Progressive paging** (Part 4): page API + progressive load for the cold path. Shippable alone.

Recommend landing phase 1 first and trying it before 2–3 — caching alone may make the perceived problem mostly disappear (the slow case becomes only the first-ever open of a list), which can re-inform how much of 3 is worth it.

## Out of scope

- True server-push/websocket invalidation (Plex `/:/eventsource` alerts) — future; validator-on-open is sufficient now.
- Incremental library sync via `updatedAt>=` filters (a deeper library-mirroring feature) — future.
- Caching `search` (intentionally live).

## Testability

- **Core:** `listValidator` pure helper; model mapping (`updatedAt`) via the existing mapper tests.
- **Cache:** `CachingPlexGateway` against a fake wrapped gateway — assert cache hit (no underlying call) on matching validator, refetch on differing validator, eviction on mutations. `ListCacheStore` against a temp dir (write/validate/evict/clear), like `MediaCache`.
- **Pagination:** gateway page assembly against a fake; renderer progressive-load logic kept in a tested hook where practical.
- **Virtualization + final feel:** manual smoke; `pnpm check` (typecheck + tests + Biome) is the bar.

## Affected files (preview)

- Core: `models/index.ts` (`updatedAt`), `ports/plex-gateway.ts` (optional `validator` params; page method[s]), `logic`/core `list-validator` + test, `testing/fakes.ts`.
- Main: new `adapters/caching-plex-gateway.ts`, new `adapters/list-cache-store.ts` (+ tests), `adapters/plex-gateway.ts` (map `updatedAt`; paged playlist-track fetch), `runtime.ts` (wrap gateway in the decorator), `ipc.ts` (pass validators; page channel[s]).
- Shared: `shared/ipc-contract.ts` (validator args; page channel[s]).
- Renderer: `state/playlists.tsx` + views (`PlaylistView`, `AlbumDetailView`, `ArtistsView`/`ArtistDetailView`, `SearchView`) pass validators + progressive load; new `ui/VirtualTrackList.tsx`; `package.json` (+ virtualizer dep).
