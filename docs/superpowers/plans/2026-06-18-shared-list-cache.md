# Shared List Cache + Mobile Offline Browse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote desktop's list-caching into `@musex/core` behind a `ListCache` port (one shared, tested implementation), repoint desktop with no behavior change, and add a mobile `expo-file-system` adapter + caching gateway + view wiring for instant repeat-loads and offline full-library browse. **One PR.**

**Architecture:** Core gains a `ListCache` port, an `OfflineUnavailable` error, pure cache-key/eviction helpers, and a `CachingPlexGateway` base (implements `PlexGateway`, wraps an inner `PlexGateway` + a `ListCache`; a `protected cached()` does exact-validation serve-stale-first, gated by an injected `isOnline()`). Desktop's `ListCacheStore` (fs) implements the port; a thin `DesktopCachingGateway extends CachingPlexGateway` adds its non-port extras with `isOnline: () => true` (behavior-identical). Mobile adds a `MobileListCache` (expo-file-system) + `MobileCachingGateway extends CachingPlexGateway` (adds `getArtist`/`listArtistTracks`) + store/view wiring.

**Tech Stack:** TypeScript 6 (`verbatimModuleSyntax`), pnpm workspaces, `@musex/core` (pure, no Node/DOM), Expo SDK 56 / RN 0.85, `expo-file-system` (SDK-56 `File`/`Directory`/`Paths`), `js-sha256` (already a dep), vitest 4, biome 2.

## Global Constraints

- **Desktop is a no-op refactor** — behavior-identical, all desktop tests green. The offline branch is gated by injected `isOnline()`; desktop passes `() => true`. Desktop's renderer keeps passing the same validators; methods newly routed through `cached()` with NO validator behave as pass-through (the existing desktop behavior).
- **Caching is driven by validator presence:** `cached(key, validator, fetch)` with `validator === undefined` → fetch, no `set` (no caching). A caller opts into caching by passing a validator.
- **`@musex/core` stays pure** — no Node/DOM/RN imports; the `ListCache` storage is platform (fs on desktop, expo-file-system on mobile) behind the port. `import type` for types (`verbatimModuleSyntax`).
- **Reuse `listValidator(updatedAt, count)`** (already core) — `${updatedAt ?? 0}:${count ?? 0}`.
- **Schema-version prefix** on every cache key: desktop `"v6"` (unchanged), mobile `"m1"`.
- **`search` is never cached.** **Mutations evict exact keys** via the shared helpers.
- **Verification bar:** full `pnpm check` (= `pnpm -r typecheck` incl. desktop's TWO tsc passes + the mobile harness pass + `biome check .` + `pnpm -r test`) green before every commit; **the controller re-runs `pnpm check` before any push.** `git add -A` always.
- **Native:** none new (`js-sha256` already linked from Phase B); on-device verification is the user's.
- Exact source of the code being promoted: see `/tmp/...` grounding (the controller will provide the exact desktop `CachingPlexGateway`/`ListCacheStore` text to implementers).

---

## File structure

**Core (new/modified):**
- `packages/core/src/ports/list-cache.ts` — the `ListCache` port (new).
- `packages/core/src/ports/plex-gateway.ts` — add `OfflineUnavailable` error (modify).
- `packages/core/src/logic/list-cache-keys.ts` (+ `.test.ts`) — pure key builders + eviction-key derivation (new).
- `packages/core/src/adapters/caching-plex-gateway.ts` (+ `.test.ts`) — the decorator base (new; tests adapted from desktop's).
- `packages/core/src/index.ts` — barrel exports (modify).

**Desktop (modified):**
- `packages/desktop/src/main/adapters/list-cache-store.ts` — implement the `ListCache` port (add `getStale`).
- `packages/desktop/src/main/adapters/caching-plex-gateway.ts` — replace with `DesktopCachingGateway extends CachingPlexGateway` (extras only); delete the old decorator + its test (moved to core).
- `packages/desktop/src/main/runtime.ts` — construct `DesktopCachingGateway(realGateway, listCache, { isOnline: () => true, schemaVersion: "v6" })`.

**Mobile (new/modified):**
- `packages/mobile/src/cache/mobile-list-cache.ts` (+ `.test.ts`) + `mobile-list-cache-fs.ts` (the `FsOps` impl over expo-file-system).
- `packages/mobile/src/cache/mobile-caching-gateway.ts` (+ `.test.ts`).
- `packages/mobile/src/state/store.tsx` — wrap the gateway, init the cache, inject `isOnline`, clear on sign-out.
- `packages/mobile/app/(tabs)/library/{index,albums,tracks}.tsx`, `home/index.tsx`, playlist screens — pass validators + handle `OfflineUnavailable`; navigation passes the tapped item's `updatedAt` for drill-down validators.

---

## Batch A — Core promotion

### Task 1: `ListCache` port + `OfflineUnavailable` error

**Files:** Create `packages/core/src/ports/list-cache.ts`; Modify `packages/core/src/ports/plex-gateway.ts`, `packages/core/src/index.ts`.

**Interfaces produced (exact):**
```ts
// ports/list-cache.ts
export interface ListCache {
  init(): Promise<void>;
  get<T>(key: string, validator: string): Promise<T | null>;   // data iff stored validator matches
  getStale<T>(key: string): Promise<T | null>;                  // data ignoring validator (offline-serve)
  set<T>(key: string, validator: string, data: T): Promise<void>;
  evictKey(key: string): Promise<void>;
  clear(): Promise<void>;
}
// ports/plex-gateway.ts (add, next to PlexAuthError)
export class OfflineUnavailable extends Error {
  constructor(message = "offline: not cached") { super(message); this.name = "OfflineUnavailable"; }
}
```

- [ ] **Step 1:** Write `ports/list-cache.ts` with the `ListCache` interface above.
- [ ] **Step 2:** Add `OfflineUnavailable` to `ports/plex-gateway.ts`.
- [ ] **Step 3:** Barrel: `index.ts` add `export * from "./ports/list-cache";` and confirm `OfflineUnavailable` is exported (the plex-gateway export already re-exports the file).
- [ ] **Step 4:** `pnpm --filter @musex/core typecheck` clean. Commit `feat(core): ListCache port + OfflineUnavailable error`.

### Task 2: Pure cache-key + eviction helpers

**Files:** Create `packages/core/src/logic/list-cache-keys.ts` + `.test.ts`; Modify `index.ts`.

**Interfaces produced (exact):**
```ts
export const cacheKeys = {
  artists: (libId: string) => `artists:${libId}`,
  albums: (artistId: string) => `albums:${artistId}`,
  tracks: (albumId: string) => `tracks:${albumId}`,
  playlistTracks: (id: string) => `pltracks:${id}`,
  allAlbums: (libId: string, sort: string) => `allalbums:${libId}:${sort}`,
  allTracks: (libId: string, sort: string) => `alltracks:${libId}:${sort}`,
  playlists: (libId: string) => `playlists:${libId}`,
  artist: (artistId: string) => `artist:${artistId}`,            // mobile extra
  artistTracks: (artistId: string) => `artisttracks:${artistId}`, // mobile extra
} as const;
export function evictKeysForRating(opts: { albumId?: string; artistId?: string; libraryId?: string }): string[];
export function evictKeysForPlaylist(playlistId: string, libraryId?: string): string[];
```
`evictKeysForRating`: push `tracks(albumId)` if albumId; `albums(artistId)` if artistId; for libraryId, for each sort in `["title","artist","added"]` push `allTracks` + `allAlbums`. `evictKeysForPlaylist`: `[playlistTracks(playlistId), ...(libraryId ? [playlists(libraryId)] : [])]`.

- [ ] **Step 1:** Write the failing test: `cacheKeys.allTracks("L","title")` === `"alltracks:L:title"`; `evictKeysForRating({libraryId:"L"})` has 6 entries (3 sorts × alltracks+allalbums); `evictKeysForRating({albumId:"al"})` === `["tracks:al"]`; `evictKeysForPlaylist("p","L")` === `["pltracks:p","playlists:L"]`.
- [ ] **Step 2:** Run → fail. **Step 3:** Implement. **Step 4:** Run → pass.
- [ ] **Step 5:** Barrel-export from `index.ts`. `pnpm --filter @musex/core test`. Commit `feat(core): list-cache key + eviction helpers`.

### Task 3: Core `CachingPlexGateway` decorator base

**Files:** Create `packages/core/src/adapters/caching-plex-gateway.ts` + `.test.ts`; Modify `index.ts`.

**Interfaces produced (exact):**
```ts
export interface CachingGatewayOpts { isOnline: () => boolean; schemaVersion: string; }
export class CachingPlexGateway implements PlexGateway {
  constructor(protected readonly inner: PlexGateway, protected readonly cache: ListCache, protected readonly opts: CachingGatewayOpts);
  // cached, validator-aware (each adds optional trailing validator?):
  listArtists(library, token, validator?): Promise<Artist[]>;
  listAlbums(library, artistId, token, validator?): Promise<Album[]>;
  listTracks(library, albumId, token, validator?): Promise<Track[]>;
  listAllAlbums(library, sort, token, validator?): Promise<Album[]>;
  listAllTracks(library, sort, token, validator?): Promise<Track[]>;
  listPlaylists(library, token, validator?): Promise<Playlist[]>;
  listPlaylistTracks(playlistId, serverId, token, validator?): Promise<PlaylistTrack[]>;
  // mutations (evict via helpers); rateItem adds opts?:
  rateItem(serverId, itemId, rating, token, opts?: { albumId?: string; artistId?: string; libraryId?: string }): Promise<void>;
  createPlaylist/addToPlaylist/removeFromPlaylist/renamePlaylist/deletePlaylist  // delegate + evictKeysForPlaylist
  // pass-through: createPin/pollPin/listServers/listMusicLibraries/search/getUserRating/listAllTracksPage
  protected async cached<T>(key: string, validator: string | undefined, fetch: () => Promise<T>): Promise<T>;
  protected evict(keys: string[]): Promise<void>;  // applies schemaVersion prefix, calls cache.evictKey
}
```

The `cached` body (the heart — offline branch gated by isOnline):
```ts
protected async cached<T>(key, validator, fetch) {
  const vkey = `${this.opts.schemaVersion}:${key}`;
  if (!this.opts.isOnline()) {
    const stale = await this.cache.getStale<T>(vkey);
    if (stale !== null) return stale;
    throw new OfflineUnavailable(`offline: ${key} not cached`);
  }
  if (validator !== undefined) {
    const hit = await this.cache.get<T>(vkey, validator);
    if (hit !== null) return hit;
  }
  const data = await fetch();
  if (validator !== undefined) await this.cache.set(vkey, validator, data);
  return data;
}
```
The cached methods call `this.cached(cacheKeys.X(...), validator, () => this.inner.X(...))`. Mutations: delegate to inner, then `await this.evict(evictKeysForRating(opts ?? {}))` / `evict(evictKeysForPlaylist(playlistId, /* libraryId from where available */))`. **Note for desktop parity:** desktop's current rateItem/playlist eviction is preserved by the helpers (same keys); `createPlaylist` previously evicted nothing — now evicts `evictKeysForPlaylist` (playlists key is a no-op on desktop since desktop passes no validator to listPlaylists → never cached there). `listAllTracksPage` is a pass-through to `inner`.

- [ ] **Step 1:** Port desktop's `caching-plex-gateway.test.ts` into `packages/core/src/adapters/caching-plex-gateway.test.ts`, adapted to: construct `new CachingPlexGateway(fakeInner, fakeCache, { isOnline: () => true, schemaVersion: "v6" })` where `fakeInner` is a vi.fn-mocked `PlexGateway` and `fakeCache` is an in-memory `ListCache` fake (Map of `key → {validator,data}` + a `getStale`). Keep the existing cases (validator match → no inner call; mismatch → refetch; no validator → always fetch; mutation eviction for playlists + rateItem albumId/artistId/libraryId/none). **ADD offline-branch cases:** with `isOnline: () => false` → a cached key returns via `getStale` (no inner call); an uncached key throws `OfflineUnavailable`; offline never calls `inner`.
- [ ] **Step 2:** Run → fail (no impl). **Step 3:** Implement `caching-plex-gateway.ts` (the class above, using `cacheKeys`/`evictKeys*`/`listValidator` from core). **Step 4:** Run → pass.
- [ ] **Step 5:** Barrel-export `CachingPlexGateway` + `CachingGatewayOpts` from `index.ts`. `pnpm --filter @musex/core test` + typecheck. Commit `feat(core): CachingPlexGateway decorator (shared, offline-aware)`.

---

## Batch B — Desktop repoint (no behavior change)

### Task 4: Desktop `ListCacheStore` implements the `ListCache` port

**Files:** Modify `packages/desktop/src/main/adapters/list-cache-store.ts` (+ its test if needed).

- [ ] **Step 1:** Add `getStale<T>(key): Promise<T | null>` to `ListCacheStore` — returns the entry's `data` ignoring the validator (mem first, then disk read; null if absent/corrupt). Add `implements ListCache` (import the port from `@musex/core`); confirm the existing `init/get/set/evictKey/clear` signatures match the port.
- [ ] **Step 2:** Add a `list-cache-store.test.ts` case for `getStale` (returns data regardless of validator; null when absent).
- [ ] **Step 3:** `pnpm --filter @musex/desktop test` (store tests green) + typecheck. Commit `refactor(desktop): ListCacheStore implements the core ListCache port`.

### Task 5: `DesktopCachingGateway` + Runtime repoint; delete the old decorator

**Files:** Replace `packages/desktop/src/main/adapters/caching-plex-gateway.ts`; Delete its old `.test.ts` (moved to core in Task 3); Modify `runtime.ts`.

**Interface produced:**
```ts
export class DesktopCachingGateway extends CachingPlexGateway {
  constructor(private readonly desktopInner: PlexapiGateway, cache: ListCacheStore)  // calls super(desktopInner, cache, { isOnline: () => true, schemaVersion: "v6" })
  endpoint(serverId, token): Promise<{ baseUrl: string; token: string }>             // delegate to desktopInner
  listPlaylistTracksPage(playlistId, serverId, start, size, token): Promise<{ items: PlaylistTrack[]; total: number }>  // delegate
}
```
(`listAllTracksPage` is on the port → inherited pass-through from the base. `endpoint`/`listPlaylistTracksPage` are NOT on the port → added here, delegating to the concrete `desktopInner`.)

- [ ] **Step 1:** Rewrite `caching-plex-gateway.ts` as `DesktopCachingGateway extends CachingPlexGateway` (from `@musex/core`) with the two extras delegating to `desktopInner`. Remove all the moved logic (it's in core now).
- [ ] **Step 2:** `runtime.ts`: `readonly gateway = new DesktopCachingGateway(this.realGateway, this.listCache);` (the `listCache` field type is now the port-implementing `ListCacheStore` — unchanged construction). Confirm `this.gateway.endpoint(...)` (LibraryWatcher) + the renderer's validator-passing calls still typecheck.
- [ ] **Step 3:** `rm packages/desktop/src/main/adapters/caching-plex-gateway.test.ts` (now in core).
- [ ] **Step 4:** **Full `pnpm check`** — desktop's two tsc passes + ALL desktop tests green (this is the keystone; `plugin-host`/`core` also green). Commit `refactor(desktop): consume core CachingPlexGateway via DesktopCachingGateway`.

---

## Batch C — Mobile

### Task 6: `MobileListCache` (expo-file-system, behind `FsOps`)

**Files:** Create `packages/mobile/src/cache/{mobile-list-cache.ts,mobile-list-cache-fs.ts,mobile-list-cache.test.ts}`.

**Interfaces produced:**
```ts
// FsOps — the injectable seam (real impl in mobile-list-cache-fs.ts over expo-file-system)
export interface FsOps {
  ensureDir(): Promise<void>;
  read(name: string): Promise<string | null>;   // null if absent
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
  list(): Promise<string[]>;                      // filenames
  stat(name: string): Promise<number | null>;     // mtime ms, for LRU
  clearAll(): Promise<void>;
}
export class MobileListCache implements ListCache {
  constructor(fs: FsOps, sha256: (s: string) => string, maxEntries?: number);  // implements the core ListCache port (init/get/getStale/set/evictKey/clear)
}
```
Filename = `${sha256(key)}.json`; entry JSON `{validator, ts, data}`; in-memory Map tier; `get` enforces validator, `getStale` ignores it; `set` writes + LRU-evicts beyond `maxEntries` (default 200) by `stat` mtime; corrupt JSON → miss. `mobile-list-cache-fs.ts` implements `FsOps` over the SDK-56 `expo-file-system` `File`/`Directory`/`Paths` (`documentDirectory/list-cache/`; `new File(dir,name).textSync()`/`.write(text)`/`.delete()`, `Directory.list()`, `.size`/modification time) — **NOT imported by the unit test** (native).

- [ ] **Step 1:** Failing tests with a fake in-memory `FsOps` + `js-sha256`: set→get round-trips on validator match; get returns null on validator mismatch; `getStale` returns data regardless; `evictKey` removes; LRU drops oldest beyond cap; corrupt entry → miss; `clear` empties.
- [ ] **Step 2:** Run → fail. **Step 3:** Implement `MobileListCache` + `mobile-list-cache-fs.ts` (the real `FsOps`). **Step 4:** Run → pass.
- [ ] **Step 5:** `pnpm check`. Commit `feat(mobile): expo-file-system ListCache adapter`.

### Task 7: `MobileCachingGateway`

**Files:** Create `packages/mobile/src/cache/mobile-caching-gateway.ts` + `.test.ts`.

**Interface produced:**
```ts
export class MobileCachingGateway extends CachingPlexGateway {
  constructor(private readonly mobileInner: PlexGatewayImpl, cache: ListCache, isOnline: () => boolean)  // super(mobileInner, cache, { isOnline, schemaVersion: "m1" })
  baseUrlFor(serverId: string): string;                                  // delegate to mobileInner
  getArtist(library, artistId, token, validator?): Promise<Artist | null>;       // this.cached(cacheKeys.artist(artistId), validator, () => mobileInner.getArtist(...))
  listArtistTracks(artistId, library, token, validator?): Promise<Track[]>;      // this.cached(cacheKeys.artistTracks(artistId), validator, () => mobileInner.listArtistTracks(...))
}
```

- [ ] **Step 1:** Failing tests (fake inner with vi.fn `getArtist`/`listArtistTracks` + a fake `ListCache` + `isOnline`): `getArtist` with a matching validator → cached, no inner call; mismatch → inner call + cache; offline → `getStale`/`OfflineUnavailable`; `listArtistTracks` same; `baseUrlFor` delegates.
- [ ] **Step 2:** Run → fail. **Step 3:** Implement. **Step 4:** Run → pass.
- [ ] **Step 5:** `pnpm check`. Commit `feat(mobile): MobileCachingGateway (caches artist + artist-tracks)`.

### Task 8: Store wiring

**Files:** Modify `packages/mobile/src/state/store.tsx`.

- [ ] **Step 1:** Construct (memoized): `const listCache = new MobileListCache(expoFsOps, sha256Hex)` (sha256Hex from `js-sha256`, resolved across interops as in Phase B's md5); wrap the gateway: `const gateway = useMemo(() => new MobileCachingGateway(new PlexGatewayImpl(fetch, CLIENT_ID), listCache, () => connectivityRef.current === "online"), [])`. (Keep `connectivityRef` in sync with `state.connectivity`.)
- [ ] **Step 2:** On bootstrap, `await listCache.init()` before first use. On **sign-out**, `await listCache.clear()` (in the existing sign-out path that clears token/library).
- [ ] **Step 3:** `pnpm check`. Commit `feat(mobile): wire the list cache into the gateway + store`.

### Task 9: View wiring — validators + offline handling

**Files:** Modify `packages/mobile/app/(tabs)/library/{index,albums,tracks}.tsx`, `home/index.tsx`, the playlist screens, and the navigation that opens drill-downs.

**Validator rules:** flat lists → `listValidator(state.library.updatedAt)`; drill-downs → `listValidator(parentUpdatedAt)` where `parentUpdatedAt` is the tapped item's `updatedAt`, threaded via the route params (the tile came from a cached list and carries `updatedAt`). `getArtist`/`listArtistTracks`/`listAlbums` use the artist's `updatedAt`; `listTracks` uses the album's `updatedAt`; `listPlaylists` uses `library.updatedAt`; `listPlaylistTracks` uses the playlist's `updatedAt` (or `leafCount` via `listValidator(updatedAt, leafCount)` when present).

- [ ] **Step 1:** `library/index.tsx`: pass `listValidator(state.library.updatedAt)` to `listArtists`/`listAllAlbums`/`listAllTracks`. Wrap the fetch so an `OfflineUnavailable` (import from `@musex/core`) sets an "offline — not cached" empty state instead of silently keeping stale (other errors keep prior items, as today).
- [ ] **Step 2:** Navigation to `library/albums` (artist) and `library/tracks` (album): include the tapped item's `updatedAt` in the route params (e.g. `router.push({ pathname, params: { artistId, updatedAt } })`). In `albums.tsx`, pass `listValidator(Number(params.updatedAt) || undefined)` to `listAlbums` + `getArtist`. In `tracks.tsx`, pass it to `listTracks`. Handle `OfflineUnavailable` → offline state.
- [ ] **Step 3:** `home/index.tsx`: pass `listValidator(state.library.updatedAt)` to `listAllTracks` + `listPlaylists`; on `OfflineUnavailable`, fall back to empty rails (Home already tolerates empties).
- [ ] **Step 4:** Playlist screens (`home/playlist.tsx` / wherever `listPlaylistTracks` is called): pass `listValidator(playlist.updatedAt, playlist.leafCount)` where available; offline handling.
- [ ] **Step 5:** `pnpm check`. Commit `feat(mobile): pass cache validators + offline-unavailable handling in library views`.

---

## Batch D — Verify, review, docs

### Task 10: Full verification + adversarial review + docs

- [ ] **Step 1:** Controller re-runs full `pnpm check` → exit 0; record tallies (core gains the decorator + key tests; desktop loses the moved decorator test but keeps the store test; mobile gains cache + gateway tests).
- [ ] **Step 2:** Dispatch an adversarial review over the whole diff (focus: desktop behavior parity — the moved decorator + the `isOnline:()=>true` no-op + `createPlaylist` now evicting [no-op on desktop]; the offline `cached()` branch correctness; `MobileListCache` LRU/getStale/corruption; validator threading + `OfflineUnavailable` handling in views; the route-param `updatedAt` drill-down validators; no swallowed errors; core purity). Fix confirmed findings.
- [ ] **Step 3:** Update root `CLAUDE.md` with an arc bullet (the `ListCache` port + `CachingPlexGateway` promotion; desktop `DesktopCachingGateway` no-op repoint; mobile `MobileListCache`/`MobileCachingGateway`; the validator scheme incl. drill-down route-param `updatedAt`; offline-serve gated by `isOnline`; schema-version `v6`/`m1`; non-goals).
- [ ] **Step 4:** Commit; controller re-runs `pnpm check`; push; update PR #60 with final state + on-device steps.

---

## Testing summary
- **Core:** `list-cache-keys` (keys + eviction), `CachingPlexGateway` (validator hit/miss, no-validator pass-through, offline serve-stale/throw, mutation eviction) — the moved + extended desktop decorator tests. `listValidator` already tested.
- **Desktop:** `ListCacheStore` (+ `getStale`) stays; the decorator test now lives in core.
- **Mobile:** `MobileListCache` (fake `FsOps`), `MobileCachingGateway` (artist/artist-tracks caching + offline).
- **On-device (user):** browse Artists/Albums/Tracks online (warms cache) → repeat visit instant + no network → airplane mode → visited library still browsable, un-visited shows "not available offline" → rate a track / edit a playlist (eviction reflects) → a Plex rescan surfaces new items (validator).

## Risks
- **Keystone (Task 5):** desktop must stay green after the decorator moves to core — verify the full desktop suite + both tsc passes; the `createPlaylist`-now-evicts + routing `listPlaylists` through `cached()` must be no-ops for desktop (no validator passed → no caching).
- **Drill-down validators:** if a route-param `updatedAt` is missing, `listValidator(undefined)` = `"0:0"` (stable) → caches but never invalidates online; mitigated because mobile mutations evict and the tapped tile always carries `updatedAt`. Acceptable; documented.
- **expo-file-system SDK-56 API** (`textSync`/`write`/`Directory.list`) behind `FsOps` so tests don't load native.
