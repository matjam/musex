# Spec 2c — List Caching, Pagination & Virtualization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`).

**Goal:** Lists open instantly when unchanged (disk-persisted, validator-revalidated cache), load progressively on the cold path, and render virtualized.

**Architecture:** A `CachingPlexGateway` decorator in main wraps the real `PlexapiGateway`, keyed by a per-list **validator** (parent `updatedAt` [+ count]) the renderer already holds — cache hit returns with no Plex call; mismatch refetches. Disk persistence via a confined `ListCacheStore`. The decorator **widens** the cached methods with optional `validator?`/paging params and still satisfies the `PlexGateway` port, so the **only `@musex/core` change is adding `updatedAt?` to models**. Renderer passes validators, loads long lists progressively, and renders track lists with `@tanstack/react-virtual`.

**Tech Stack:** TS 6, React 19, Vitest 4, Biome 2, `@ctrl/plex` 6, `@tanstack/react-virtual` 3.14.2 (React-19 compatible — verified).

**Spec:** `docs/superpowers/specs/2026-06-08-list-performance-design.md`.

**Conventions:** core/main/logic relative imports end `.js`; test/renderer imports no extension; `import type` for types; Biome (double quotes, semicolons, 2-space); `noUncheckedIndexedAccess` on. `git add -A`; commit to `main`; push each commit. Each task ends GREEN on the FULL bar `pnpm check` before commit.

**Key invariant:** the decorator is transparent — `Runtime.gateway` becomes `CachingPlexGateway` (which also delegates the non-port `endpoint()` Runtime relies on). Existing IPC callers that don't pass a validator keep working (cache simply always-fetches for them).

---

### Task 1: Core — `updatedAt` on models

**Files:** `packages/core/src/models/index.ts`

- [ ] **Step 1:** Add `updatedAt?: number; // epoch ms, for cache validation` to the `Artist`, `Album`, and `Playlist` interfaces (leave `Track` as-is — track lists are validated by their parent album/playlist).
- [ ] **Step 2:** `pnpm --filter @musex/core exec tsc --noEmit && pnpm --filter @musex/core test` — green (optional field; nothing else changes).
- [ ] **Step 3:** Commit: `feat(core): add updatedAt to Artist/Album/Playlist for cache validation` + push.

---

### Task 2: Main — map `updatedAt`; validator helper

**Files:**
- Modify: `packages/desktop/src/logic/plex-mapping.ts` + `plex-mapping.test.ts`
- Modify: `packages/desktop/src/main/adapters/plex-gateway.ts` (`toArtistSafe`/`toAlbumSafe` inputs + `toPlaylistSafe`)
- Create: `packages/desktop/src/logic/list-validator.ts` + `list-validator.test.ts`

- [ ] **Step 1 (validator helper, TDD):** Create `list-validator.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { listValidator } from "./list-validator";

describe("listValidator", () => {
  it("combines updatedAt and count into a stable string", () => {
    expect(listValidator(1717800000000, 42)).toBe("1717800000000:42");
  });
  it("defaults missing parts to 0 (stable, comparable)", () => {
    expect(listValidator()).toBe("0:0");
    expect(listValidator(123)).toBe("123:0");
    expect(listValidator(undefined, 5)).toBe("0:5");
  });
});
```
Run it (fails), then create `list-validator.ts`:
```ts
/** Opaque cache validator for a list: changes whenever its source changes.
 *  Built from a parent's updatedAt (epoch ms) and item count. */
export function listValidator(updatedAt?: number, count?: number): string {
  return `${updatedAt ?? 0}:${count ?? 0}`;
}
```
Run it (passes).

- [ ] **Step 2 (map updatedAt):** In `plex-mapping.ts`, the raw artist/album mapper inputs already accept Plex fields; add `updatedAt?: number` to their raw input types and set `updatedAt` on the returned `Artist`/`Album`. Update `plex-mapping.test.ts` to assert it maps through (add `updatedAt` to a fixture and expect it on the output). In `plex-gateway.ts`:
  - `toArtistSafe`/`toAlbumSafe`: pass `updatedAt: a.updatedAt ? a.updatedAt.getTime() : undefined` (Plex `updatedAt` is a `Date`).
  - `toPlaylistSafe`: add `updatedAt: p.updatedAt ? p.updatedAt.getTime() : undefined`.

- [ ] **Step 3:** `pnpm check` — green. Commit: `feat(cache): map Plex updatedAt onto models + listValidator helper` + push.

---

### Task 3: Main — `ListCacheStore` (disk-persisted) + tests

**Files:**
- Create: `packages/desktop/src/main/adapters/list-cache-store.ts`
- Test: `packages/desktop/src/main/adapters/list-cache-store.test.ts`

Generic JSON cache, confined to its dir, validator-aware, with bounded eviction (oldest `ts`). Electron-free (dir passed in) so it's testable like `MediaCache`.

- [ ] **Step 1 (test first):** Create `list-cache-store.test.ts` (temp dir; covers: miss → null; set+get round-trips data; `get` with a non-matching validator returns null (stale); `get` with matching validator returns data; eviction removes oldest beyond the cap; `evictKey` drops a specific entry; survives a fresh store instance pointed at the same dir = disk persistence). Use `mkdtemp`/`rm` like `media-cache.test.ts`.

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ListCacheStore } from "./list-cache-store";

let dir: string;
let store: ListCacheStore;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "musex-listcache-"));
  store = new ListCacheStore(dir, 3);
  await store.init();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ListCacheStore", () => {
  it("returns null on miss", async () => {
    expect(await store.get("k", "v1")).toBeNull();
  });
  it("round-trips data when the validator matches", async () => {
    await store.set("k", "v1", [{ id: "a" }]);
    expect(await store.get("k", "v1")).toEqual([{ id: "a" }]);
  });
  it("returns null when the validator differs (stale)", async () => {
    await store.set("k", "v1", [{ id: "a" }]);
    expect(await store.get("k", "v2")).toBeNull();
  });
  it("persists across store instances (disk)", async () => {
    await store.set("k", "v1", [{ id: "a" }]);
    const fresh = new ListCacheStore(dir, 3);
    await fresh.init();
    expect(await fresh.get("k", "v1")).toEqual([{ id: "a" }]);
  });
  it("evicts the oldest entries beyond the cap", async () => {
    await store.set("a", "v", [1]);
    await store.set("b", "v", [2]);
    await store.set("c", "v", [3]);
    await store.set("d", "v", [4]); // cap 3 -> "a" evicted
    expect(await store.get("a", "v")).toBeNull();
    expect(await store.get("d", "v")).toEqual([4]);
  });
  it("evictKey drops a specific entry", async () => {
    await store.set("k", "v", [1]);
    await store.evictKey("k");
    expect(await store.get("k", "v")).toBeNull();
  });
});
```

- [ ] **Step 2 (implement):**
```ts
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

interface Entry<T> {
  validator: string;
  ts: number;
  data: T;
}

/** Disk-persisted JSON cache for list results, validator-keyed. All file ops are
 *  confined to `dir`. A small in-memory layer fronts disk for same-session hits. */
export class ListCacheStore {
  private readonly mem = new Map<string, Entry<unknown>>();
  constructor(
    private readonly dir: string,
    private readonly maxEntries = 200,
  ) {}

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private file(key: string): string {
    return path.join(this.dir, `${createHash("sha256").update(key).digest("hex")}.json`);
  }

  /** Cached data if present AND the validator matches; else null. */
  async get<T>(key: string, validator: string): Promise<T | null> {
    const cached = this.mem.get(key);
    if (cached) return cached.validator === validator ? (cached.data as T) : null;
    let raw: string;
    try {
      raw = await readFile(this.file(key), "utf8");
    } catch {
      return null; // not on disk
    }
    let entry: Entry<T>;
    try {
      entry = JSON.parse(raw) as Entry<T>;
    } catch {
      return null; // corrupt entry — treat as miss
    }
    this.mem.set(key, entry);
    return entry.validator === validator ? entry.data : null;
  }

  async set<T>(key: string, validator: string, data: T): Promise<void> {
    const entry: Entry<T> = { validator, ts: Date.now(), data };
    this.mem.set(key, entry);
    try {
      await writeFile(this.file(key), JSON.stringify(entry));
    } catch (err) {
      console.error("[musex list-cache] write failed:", err);
      return;
    }
    await this.evict();
  }

  async evictKey(key: string): Promise<void> {
    this.mem.delete(key);
    try {
      await unlink(this.file(key));
    } catch {
      // already gone
    }
  }

  /** Drop oldest-`ts` files beyond the cap. */
  private async evict(): Promise<void> {
    let names: string[];
    try {
      names = (await readdir(this.dir)).filter((n) => n.endsWith(".json"));
    } catch {
      return;
    }
    if (names.length <= this.maxEntries) return;
    const withTimes: { name: string; ts: number }[] = [];
    for (const name of names) {
      try {
        const s = await stat(path.join(this.dir, name));
        withTimes.push({ name, ts: s.mtimeMs });
      } catch {
        // racing deletion
      }
    }
    withTimes.sort((a, b) => a.ts - b.ts);
    for (const { name } of withTimes.slice(0, withTimes.length - this.maxEntries)) {
      try {
        await unlink(path.join(this.dir, name));
      } catch {
        // already gone
      }
    }
  }

  async clear(): Promise<void> {
    this.mem.clear();
    try {
      await rm(this.dir, { recursive: true, force: true });
      await mkdir(this.dir, { recursive: true });
    } catch (err) {
      console.error("[musex list-cache] clear failed:", err);
    }
  }
}
```
> `Date.now()` is fine here (real Node main process; the workflow-only ban does not apply).

- [ ] **Step 3:** `pnpm check` — green. Commit: `feat(cache): ListCacheStore (disk-persisted, validator-keyed, evicting)` + push.

---

### Task 4: Main — `CachingPlexGateway` decorator + wire into Runtime

**Files:**
- Create: `packages/desktop/src/main/adapters/caching-plex-gateway.ts`
- Test: `packages/desktop/src/main/adapters/caching-plex-gateway.test.ts`
- Modify: `packages/desktop/src/main/runtime.ts`

- [ ] **Step 1 (test first):** Create `caching-plex-gateway.test.ts` — wrap a fake `PlexGateway` (counts calls); assert: with a validator, first call hits the inner gateway + caches; second call with the SAME validator does NOT call the inner gateway (served from cache); a DIFFERENT validator re-calls; a mutation (`addToPlaylist`) evicts that playlist's track cache so the next `listPlaylistTracks` re-calls. Use a real `ListCacheStore` on a temp dir (or a tiny in-memory fake store).

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Library, PlaylistTrack, Track } from "@musex/core";
import { CachingPlexGateway } from "./caching-plex-gateway";
import { ListCacheStore } from "./list-cache-store";

const lib: Library = { id: "1", serverId: "s1", serverName: "K", title: "Music", type: "music" };
const track = (id: string): Track => ({
  id, serverId: "s1", albumId: "al1", artistName: "A", title: id, durationMs: 1000,
  media: { container: "flac", audioCodec: "flac", partId: "p", partKey: "/k" },
});
const ptracks: PlaylistTrack[] = [{ track: track("t1"), playlistItemId: "i1" }];

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "musex-cpg-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup() {
  const inner = {
    listPlaylistTracks: vi.fn(async () => ptracks),
    addToPlaylist: vi.fn(async () => {}),
  } as unknown as import("@musex/core").PlexGateway & { endpoint: unknown };
  const store = new ListCacheStore(dir, 50);
  return { inner, gw: new CachingPlexGateway(inner, store), store };
}

describe("CachingPlexGateway", () => {
  it("serves a matching validator from cache without re-calling inner", async () => {
    const { inner, gw, store } = setup();
    await store.init();
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1");
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1");
    expect(inner.listPlaylistTracks).toHaveBeenCalledTimes(1);
  });
  it("refetches when the validator differs", async () => {
    const { inner, gw, store } = setup();
    await store.init();
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1");
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v2");
    expect(inner.listPlaylistTracks).toHaveBeenCalledTimes(2);
  });
  it("always fetches when no validator is given", async () => {
    const { inner, gw, store } = setup();
    await store.init();
    await gw.listPlaylistTracks("pl1", "s1", "tok");
    await gw.listPlaylistTracks("pl1", "s1", "tok");
    expect(inner.listPlaylistTracks).toHaveBeenCalledTimes(2);
  });
  it("evicts a playlist's track cache after a mutation", async () => {
    const { inner, gw, store } = setup();
    await store.init();
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1");
    await gw.addToPlaylist("pl1", "s1", ["t9"], "tok");
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1");
    expect(inner.listPlaylistTracks).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2 (implement):** `CachingPlexGateway implements PlexGateway`. Delegate everything to the inner gateway; for the cached methods add an optional trailing `validator?: string` and cache through the store; mutations evict; also expose `endpoint(...)` (delegates) since Runtime uses it.

```ts
import type {
  Album, Artist, Library, Pin, PlaylistTrack, Playlist, PlexGateway, SearchResults, Server, Track,
} from "@musex/core";
import type { ListCacheStore } from "./list-cache-store.js";

/** A PlexGateway that caches item-heavy list results keyed by a caller-supplied
 *  validator, and invalidates on mutations. Transparent: same port surface
 *  (cached methods take an extra optional `validator`), plus the non-port
 *  `endpoint()` that Runtime relies on. */
export class CachingPlexGateway implements PlexGateway {
  constructor(
    private readonly inner: PlexGateway & {
      endpoint(serverId: string, token: string): Promise<{ baseUrl: string; token: string }>;
    },
    private readonly cache: ListCacheStore,
  ) {}

  // --- cached, validator-aware ---

  async listArtists(library: Library, token: string, validator?: string): Promise<Artist[]> {
    return this.cached(`artists:${library.id}`, validator, () => this.inner.listArtists(library, token));
  }
  async listAlbums(library: Library, artistId: string, token: string, validator?: string): Promise<Album[]> {
    return this.cached(`albums:${artistId}`, validator, () => this.inner.listAlbums(library, artistId, token));
  }
  async listTracks(library: Library, albumId: string, token: string, validator?: string): Promise<Track[]> {
    return this.cached(`tracks:${albumId}`, validator, () => this.inner.listTracks(library, albumId, token));
  }
  async listPlaylistTracks(playlistId: string, serverId: string, token: string, validator?: string): Promise<PlaylistTrack[]> {
    return this.cached(`pltracks:${playlistId}`, validator, () => this.inner.listPlaylistTracks(playlistId, serverId, token));
  }

  private async cached<T>(key: string, validator: string | undefined, fetch: () => Promise<T>): Promise<T> {
    if (validator !== undefined) {
      const hit = await this.cache.get<T>(key, validator);
      if (hit !== null) return hit;
    }
    const data = await fetch();
    if (validator !== undefined) await this.cache.set(key, validator, data);
    return data;
  }

  // --- mutations: delegate then invalidate ---

  async createPlaylist(library: Library, title: string, trackIds: string[], token: string): Promise<Playlist> {
    return this.inner.createPlaylist(library, title, trackIds, token);
  }
  async addToPlaylist(playlistId: string, serverId: string, trackIds: string[], token: string): Promise<void> {
    await this.inner.addToPlaylist(playlistId, serverId, trackIds, token);
    await this.cache.evictKey(`pltracks:${playlistId}`);
  }
  async removeFromPlaylist(playlistId: string, serverId: string, playlistItemIds: string[], token: string): Promise<void> {
    await this.inner.removeFromPlaylist(playlistId, serverId, playlistItemIds, token);
    await this.cache.evictKey(`pltracks:${playlistId}`);
  }
  async renamePlaylist(playlistId: string, serverId: string, title: string, token: string): Promise<void> {
    return this.inner.renamePlaylist(playlistId, serverId, title, token);
  }
  async deletePlaylist(playlistId: string, serverId: string, token: string): Promise<void> {
    await this.inner.deletePlaylist(playlistId, serverId, token);
    await this.cache.evictKey(`pltracks:${playlistId}`);
  }

  // --- pass-through (cheap / live / auth) ---

  createPin(): Promise<Pin> { return this.inner.createPin(); }
  pollPin(id: string): Promise<{ authToken: string | null }> { return this.inner.pollPin(id); }
  listServers(token: string): Promise<Server[]> { return this.inner.listServers(token); }
  listMusicLibraries(server: Server, token: string): Promise<Library[]> { return this.inner.listMusicLibraries(server, token); }
  listPlaylists(library: Library, token: string): Promise<Playlist[]> { return this.inner.listPlaylists(library, token); }
  search(library: Library, query: string, token: string): Promise<SearchResults> { return this.inner.search(library, query, token); }
  endpoint(serverId: string, token: string): Promise<{ baseUrl: string; token: string }> { return this.inner.endpoint(serverId, token); }
}
```

- [ ] **Step 3 (wire Runtime):** In `runtime.ts`: import `CachingPlexGateway` + `ListCacheStore` + `path`/`app` (already imported). Replace `readonly gateway = new PlexapiGateway()` with:
```ts
  private readonly realGateway = new PlexapiGateway();
  readonly listCache = new ListCacheStore(path.join(app.getPath("userData"), "list-cache"));
  readonly gateway = new CachingPlexGateway(this.realGateway, this.listCache);
```
and in `init()` add `await this.listCache.init();` (before/after the media cache init). `rt.gateway.endpoint(...)` in `ensureProxyEndpoint` still works (delegated). Field init order: `realGateway` and `listCache` must be declared before `gateway` (class fields initialise top-to-bottom).

- [ ] **Step 4:** `pnpm check` — green. Commit: `feat(cache): CachingPlexGateway decorator + wire into Runtime` + push.

---

### Task 5: IPC + renderer — pass validators (Phase 1 complete)

**Files:** `shared/ipc-contract.ts`, `preload/index.ts`, `main/ipc.ts`, renderer views (`ArtistsView`, `ArtistDetailView`, `AlbumDetailView`, `PlaylistView`), `state/playlists.tsx`.

Thread an optional `validator?: string` through the cached IPC list calls so the renderer can pass what it holds. Read each file first.

- [ ] **Step 1 (contract + preload):** Add an optional `validator?: string` trailing param to `listArtists`, `listAlbums`, `listTracks`, `listPlaylistTracks` in `MusexApi` and the preload bridges (`(libraryId, validator) => ipcRenderer.invoke(IPC.listArtists, libraryId, validator)` etc.). Channel strings unchanged.

- [ ] **Step 2 (main handlers):** Pass the validator through to `rt.gateway.*`. Example:
```ts
  ipcMain.handle(IPC.listTracks, async (_e, libraryId: string, albumId: string, validator?: string) => {
    const lib = rt.findLibrary(libraryId);
    await rt.ensureProxyEndpoint(lib.serverId);
    const tracks = await rt.gateway.listTracks(lib, albumId, rt.requireToken(), validator);
    return tracks.map((t) => ({ ...t, thumb: rt.proxy.artUrl(t.serverId, t.thumb) }));
  });
```
Do the same for `listArtists` (validator from the section — see Step 4), `listAlbums` (artist validator), `listPlaylistTracks` (playlist validator). Art baking stays.

- [ ] **Step 3 (renderer views pass validators):** Build validators with `listValidator` from `logic/list-validator`:
  - `AlbumDetailView`: `window.musex.listTracks(libraryId, album.id, listValidator(album.updatedAt))`.
  - `ArtistDetailView`: `window.musex.listAlbums(libraryId, artist.id, listValidator(artist.updatedAt))`.
  - `PlaylistView`: `window.musex.listPlaylistTracks(playlist.id, playlist.serverId, listValidator(live.updatedAt, live.trackCount))` (use the live store playlist so the validator reflects mutations).
  - `ArtistsView` (top-level library list): pass `undefined` for now (no cheap parent), OR a section validator if Step 4 surfaces one. `undefined` = always fetch (today's behaviour) — acceptable; the per-artist/album/playlist caches deliver the wins.

- [ ] **Step 4 (optional, library-list validator):** If feasible without much work, expose the music section's `updatedAt`/`scannedAt` on the `Library` model (add `updatedAt?: number`, map in `listMusicLibraries`) and have `ArtistsView` pass `listValidator(library.updatedAt)`. If it complicates, skip and leave artists uncached (documented).

- [ ] **Step 5:** `pnpm check` — green. Manual sanity: re-opening an album/playlist should now be instant (watch the dev terminal — no repeated upstream fetch for the same unchanged list). Commit: `feat(cache): pass list validators from renderer through IPC (instant re-opens)` + push.

---

### Task 6: Progressive paging for the cold path

**Files:** `caching-plex-gateway.ts` (+ inner `plex-gateway.ts` paged fetch), `shared/ipc-contract.ts`, `preload/index.ts`, `main/ipc.ts`, `PlaylistView.tsx` (+ a small `useProgressiveList` hook if helpful).

Goal: on a cache MISS for a long list, don't block on one giant fetch — load pages and render as they arrive. On a cache HIT the full list is already returned, so paging only applies cold.

- [ ] **Step 1 (gateway paged fetch):** Add to the inner `PlexapiGateway` a paged playlist-tracks fetch:
```ts
async listPlaylistTracksPage(playlistId: string, serverId: string, start: number, size: number, token: string): Promise<{ items: PlaylistTrack[]; total: number }>
```
Implement by fetching `/playlists/${playlistId}/items` via `fetchItems` with container options `{ "X-Plex-Container-Start": start, "X-Plex-Container-Size": size }` (verify the exact option keys against `@ctrl/plex`/Plex at implementation — context7), mapping items to `PlaylistTrack`. `total` = the playlist's `leafCount` (fetch once, or read from a `listPlaylists` lookup / the first page's container `totalSize`). Mirror on `CachingPlexGateway` as a pass-through (paged results are assembled+cached by the caller, see Step 3).

- [ ] **Step 2 (IPC):** Add `listPlaylistTracksPage` channel + `MusexApi` method + preload bridge + handler (bake art on `items`).

- [ ] **Step 3 (renderer progressive load):** In `PlaylistView`, when the cached full list isn't available, load page 0 (e.g. 100), render, then keep requesting pages in the background until `items.length >= total`, appending. Once fully assembled, write it to cache via the normal `listPlaylistTracks` path OR have the decorator cache assembled pages (simplest: after full assembly, the next open uses the validator-cached full list — so on full assembly, call `listPlaylistTracks(..., validator)` once to populate the cache, or have the page handler store into the cache when the last page lands). Keep it correct and explicit; avoid leaving the cache unpopulated after a progressive load (otherwise re-open re-pages). Document the chosen approach in a comment.

- [ ] **Step 4:** `pnpm check` — green. Commit: `feat(cache): progressive paged loading for long playlist tracks` + push.

> If paging the library track/album lists is also wanted, repeat the pattern; playlist tracks are the priority (the reported pain). Note in the commit if library paging is deferred.

---

### Task 7: Virtualized track lists

**Files:** `package.json` (+ dep), `ui/VirtualTrackList.tsx` (new), `PlaylistView.tsx`, `AlbumDetailView.tsx`, `SearchView.tsx`, `theme.css`.

- [ ] **Step 1 (dep):** Add `@tanstack/react-virtual@^3.14.2` to `packages/desktop` (verify it's still the latest with `npm view @tanstack/react-virtual version` at implementation; React-19 compatible). Run install; confirm `pnpm --filter @musex/desktop exec tsc` resolves it.

- [ ] **Step 2 (component):** Create `ui/VirtualTrackList.tsx` wrapping `useVirtualizer` (from `@tanstack/react-virtual`) around the track-list scroll container — renders only visible `TrackRow`s. Props: `tracks` (or a render-prop per row to keep TrackRow callers in control of `onPlay`/`onMenu`/`isPlaying`/`leading`), a `rowHeight` estimate, and the scroll-parent ref. Keep it generic enough for album (number leading), search (subtitle), and playlist (menu + playlistContext) rows — prefer a `renderRow(index) => ReactNode` prop so each view supplies its own `TrackRow`.

- [ ] **Step 3 (adopt):** Replace the `.track-list` `tracks.map(...)` in `PlaylistView`, `AlbumDetailView`, and the Songs group in `SearchView` with `VirtualTrackList`. Ensure the scroll container has a definite height (the views already scroll). Add any needed CSS (absolute-positioned virtual rows) to `theme.css`.

- [ ] **Step 4:** `pnpm check` — green. Manual: a long list scrolls smoothly and only a window of rows is in the DOM. Commit: `feat(perf): virtualized track lists (@tanstack/react-virtual)` + push.

---

### Task 8: Verification

- [ ] **Step 1:** `pnpm check` — full green.
- [ ] **Step 2 (manual smoke, dev):**
  1. Open a long playlist → first load progresses/loads; reopen it → **instant** (no upstream fetch in the terminal for the unchanged list).
  2. Add/remove a track → reopen → reflects the change (cache invalidated), then instant again.
  3. Album/artist re-opens are instant when unchanged.
  4. Quit + relaunch → first open of a previously-viewed list is **fast** (served from disk cache, validated).
  5. Long lists scroll smoothly; DOM holds only a window of rows.
  6. A changed-on-server list (edit in Plex web) refetches on next open (validator differs).
- [ ] **Step 3:** Note in `CLAUDE.md` (project) the list-cache location + validator approach if non-obvious for future sessions.

---

## Self-Review

- **Spec coverage:** cache + disk + exact validator revalidation (T1–T5); progressive paging cold path (T6); virtualization (T7); mutations invalidate (T4); search uncached (pass-through). Library-list validator handled (T5 Step 4, optional).
- **Type consistency:** decorator widens cached methods with optional `validator?` and still `implements PlexGateway`; `Runtime.gateway: CachingPlexGateway` exposes validator params + delegated `endpoint`; `listValidator` format identical everywhere it's built; cache keys (`artists:`/`albums:`/`tracks:`/`pltracks:`) consistent between cache-set and mutation-evict.
- **Risks/placeholders:** T6 paging option keys + T7 virtualizer API to be confirmed against current docs at implementation (flagged). No silent truncation — progressive load must populate the cache so re-open doesn't re-page (called out in T6 Step 3).
