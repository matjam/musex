# Shared List Cache + Mobile Offline Library Browse — Design

**Date:** 2026-06-18
**Status:** Approved (design); proceeding to plan + build per user delegation — **one PR**, no staging.
**Context:** Desktop already has list caching (`CachingPlexGateway` + `ListCacheStore` in `main/adapters/`), but it lives in desktop and isn't shared. Mobile has **no list cache** — every browse hits Plex live (slow on cellular, data-heavy) and only the Downloaded collection is browsable offline. Rather than re-implement a second cache on mobile (drift), **promote the platform-agnostic caching logic into `@musex/core`** behind a `ListCache` port, repoint desktop to consume it (no behavior change), and add a mobile `expo-file-system` `ListCache` adapter + view wiring. This gives the iOS app instant repeat-loads, reduced cellular traffic, and **offline full-library browse** (Artists/Albums/Tracks/playlists you've visited), and leaves desktop + mobile sharing one tested cache implementation.

## Decisions locked in brainstorming

- **Freshness = exact-validation, serve-stale-first.** Reuse `@musex/core`'s `listValidator(updatedAt, count)`. Online + validator matches → serve cache, **no Plex call**; online + mismatch/absent → fetch + write-through; offline → serve cached data regardless of validator, or throw `OfflineUnavailable` if none. Instant render on match (no spinner on repeat visits); the views' existing keep-prior-data / spinner-only-on-first-load behavior covers the changed-library refetch.
- **Single PR**, core + desktop + mobile together.
- **Desktop stays a no-op refactor** (behavior-identical, tests green) — offline-serve is gated by an injected `isOnline()`; desktop passes `() => true` (current behavior preserved). Mobile injects real connectivity.

## Architecture

### Core (`@musex/core`) — the shared logic

- **`ListCache` port** (`ports/list-cache.ts`): `init(): Promise<void>` · `get<T>(key, validator): Promise<T | null>` (returns data only if the stored validator matches) · `getStale<T>(key): Promise<T | null>` (data ignoring validator — for offline-serve) · `set<T>(key, validator, data): Promise<void>` · `evictKey(key): Promise<void>` · `clear(): Promise<void>`.
- **`OfflineUnavailable`** error (`ports/plex-gateway.ts`, alongside `PlexAuthError`): thrown by the caching decorator when offline with no cached data, so views can show "not available offline."
- **`CachingPlexGateway`** (`adapters/caching-plex-gateway.ts`) — implements the `PlexGateway` port, wraps an inner `PlexGateway`, talks to a `ListCache`. Constructor: `(inner: PlexGateway, cache: ListCache, opts: { isOnline: () => boolean; schemaVersion: string })`. The cached list methods add an optional trailing `validator?: string` (assignable to the port — extra optional param). A `protected cached<T>(key, validator, fetch): Promise<T>` implements the freshness decision (online+match→`cache.get`; online+miss→`fetch`+`cache.set`; offline→`cache.getStale` or throw `OfflineUnavailable`). Non-cached methods (auth/discovery/`search`/mutations/`listAllTracksPage`) delegate to the inner; **`search` is never cached** (live). Mutations evict exact keys via the shared helpers below.
- **Pure helpers** (`logic/list-cache-keys.ts`, tested): the cache-key builders (`artistsKey(libId)`, `albumsKey(artistId)`, `tracksKey(albumId)`, `allAlbumsKey(libId, sort)`, `allTracksKey(libId, sort)`, `playlistsKey(libId)`, `playlistTracksKey(id)`) and the mutation→evict-keys derivation (`evictKeysForRating({albumId?, artistId?, libraryId?})`, `evictKeysForPlaylist(playlistId, libraryId)`). The `schemaVersion` prefix (`${version}:${key}`) is applied by the decorator.
- Reuses existing `listValidator` (already core).

**Why a base class + the `cached` helper rather than a desktop class verbatim:** desktop's gateway exposes extras NOT on the `PlexGateway` port — `endpoint()`, `listPlaylistTracksPage` (progressive paging). Mobile exposes different extras — `getArtist`, `listArtistTracks`. The shared base implements the port methods + the `protected cached` helper; each platform's thin subclass adds its own extras (and caches them via `this.cached(...)`).

### Desktop — repoint, no behavior change

- Its existing **`ListCacheStore` (Node `fs`)** is adjusted to implement the core `ListCache` port (it already has `get(key,validator)/set/evictKey/clear/init`; add `getStale`). Stays desktop-side (the storage is platform).
- A thin **`DesktopCachingGateway extends CachingPlexGateway`** adds `endpoint()` + `listPlaylistTracksPage` (progressive paging — desktop-specific), delegating/caching as today. `Runtime` constructs it with `isOnline: () => true` (preserve current behavior) + `schemaVersion: "v6"` (unchanged). The desktop renderer's gateway surface + validator-passing are unchanged.
- Desktop's existing `CachingPlexGateway` decorator tests **move to core**; `ListCacheStore` (fs) tests stay desktop.

### Mobile — adapter + subclass + view wiring

- **`MobileListCache`** (`src/cache/mobile-list-cache.ts`) implements the core `ListCache` port over **`expo-file-system`** (JSON-per-key under `documentDirectory/list-cache/`, filename = `sha256(key)` via `js-sha256` (already a dep), an in-memory tier, LRU cap ~200 entries, `getStale` for offline). All `expo-file-system` calls behind a tiny injectable `FsOps` so unit tests use a fake fs.
- **`MobileCachingGateway extends CachingPlexGateway`** adds the mobile extras `getArtist` (key `artist:{id}`, validator `artist.updatedAt`) + `listArtistTracks` (key `artisttracks:{id}`, validator `artist.updatedAt`), cached via `this.cached(...)`. Constructed with `isOnline: () => connectivity === "online"` + `schemaVersion: "m1"`.
- **Store wiring** (`store.tsx`): wrap `new PlexGatewayImpl(...)` with `new MobileCachingGateway(inner, mobileListCache, …)`; `init()` the cache on bootstrap; expose as `gateway` (transparent to views). Inject the existing `connectivity` signal. **`clear()` the cache on sign-out.**
- **View wiring** (`app/(tabs)/library/*`, artist/album screens, playlists): pass validators on the cached calls — `listValidator(library.updatedAt)` for the flat lists, `listValidator(artist.updatedAt)` / `listValidator(album.updatedAt)` for drill-downs. Catch `OfflineUnavailable` → render a "not available offline" state (most things are cached once visited). The existing `useFocusEffect` background-refresh + the offline banner stay.

## Cached lists + keys

| Method | Key | Validator |
|---|---|---|
| `listArtists` | `artists:{libId}` | `library.updatedAt` |
| `listAllAlbums(sort)` | `allalbums:{libId}:{sort}` | `library.updatedAt` |
| `listAllTracks(sort)` | `alltracks:{libId}:{sort}` | `library.updatedAt` |
| `listAlbums(artistId)` | `albums:{artistId}` | `artist.updatedAt` |
| `listTracks(albumId)` | `tracks:{albumId}` | `album.updatedAt` |
| `listArtistTracks(artistId)` (mobile) | `artisttracks:{artistId}` | `artist.updatedAt` |
| `getArtist(artistId)` (mobile) | `artist:{artistId}` | `artist.updatedAt` (best-effort) |
| `listPlaylists` | `playlists:{libId}` | omitted online (small/volatile) — cached for offline-serve |
| `listPlaylistTracks` | `pltracks:{playlistId}` | omitted online — cached for offline-serve |

`search` — never cached. Schema-version prefix: desktop `v6:`, mobile `m1:` (invalidate on mapper changes). **Mutation eviction** (shared helpers): `rateItem` → evict `tracks:{albumId}`, `albums:{artistId}`, `alltracks/allalbums:{libId}:*`; playlist create/add/remove/rename/delete → evict `pltracks:{id}` + `playlists:{libId}`.

## Error handling

- Offline + no cached data → `OfflineUnavailable` (views show the offline state). Desktop never hits it (`isOnline → true`).
- Cache read/write failure → log + fall through to a live fetch (a cache miss, not a crash); never swallow silently.
- `PlexAuthError` propagates unchanged (re-auth), never treated as offline.
- Library changed (Plex rescan) → `library.updatedAt` moves → validator mismatch → refetch (new items appear) — the staleness mechanism works *with* the cache.

## Testing

- **Core (shared, the bulk):** `CachingPlexGateway` against a `FakePlexGateway` + a fake `ListCache` + injected `isOnline` — match→no inner call; mismatch→inner call + `set`; offline→`getStale` served; offline+empty→`OfflineUnavailable`; `search` never cached; each mutation evicts the right keys. `list-cache-keys` helpers (key strings + eviction-key derivation). `listValidator` already tested.
- **Desktop:** `ListCacheStore` (fs) tests stay; one smoke that `DesktopCachingGateway` preserves behavior (the moved decorator tests now run in core).
- **Mobile:** `MobileListCache` over a fake `FsOps` (validator hit/miss, `getStale`, LRU evict, clear) + `MobileCachingGateway` extras (getArtist/listArtistTracks caching).
- **Verification bar:** full `pnpm check` green (core + plugin-host + desktop ×2 tsc + mobile + biome + all tests); controller re-runs before push.
- **On-device (user):** browse Artists/Albums/Tracks online (warms cache) → repeat-visit is instant + no network → airplane mode → the visited library is still browsable; un-visited shows "not available offline"; ratings/playlist edits reflect (eviction); a Plex rescan surfaces new items (validator). Needs a dev-client rebuild only if `js-sha256` isn't already linked (it is, from Phase B).

## Non-goals (v1)

- No pagination cache on mobile (mobile loads full lists; desktop keeps its progressive paging uncached as today).
- No background pre-warming of the whole library (caches what you visit).
- No `peek`-based cold-load stale-paint beyond the validator-match instant render.
- Desktop does **not** adopt offline-serve here (it passes `isOnline → true`); wiring desktop's `ConnectivityMonitor` for offline list-browse is a low-risk later follow-up, kept out to guarantee a no-op desktop refactor.
- No mobile list-change watcher (desktop's ws watcher stays desktop-only; mobile freshness is the `updatedAt` validator + focus refetch).

## Success criteria

- `@musex/core` owns the `ListCache` port + `CachingPlexGateway` + the key/eviction helpers (tested in core); `listValidator` reused.
- Desktop consumes the core decorator via a thin subclass + its fs `ListCache` adapter — **behavior-identical, all desktop tests green**.
- Mobile: an `expo-file-system` `ListCache` adapter + caching gateway + view wiring → instant repeat browse, reduced traffic, and offline full-library browse of visited lists; ratings/playlist mutations evict correctly.
- `pnpm check` green across all packages; one PR.
