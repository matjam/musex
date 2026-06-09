# Albums & Tracks Views + Nav Icons + Library-List Caching — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Make the sidebar **Albums** and **Tracks** items real, navigable views (flat, library-wide, with a 3-way sort: A–Z / by artist / recently added), give all nav items **lucide-react** icons, and extend caching to the library-wide lists (validated by the music section's `updatedAt`).

**Architecture:** New gateway methods `listAllAlbums(library, sort)` and paged `listAllTracksPage(library, sort, start, size)` (Plex section search with a sort param); the `Library` model gains `updatedAt` (the section's, mapped in `listMusicLibraries`) so library-wide lists get an exact cache validator. `CachingPlexGateway` caches `listAllAlbums` keyed by `(lib, sort)`; the huge tracks list reuses the progressive-paging + virtualization patterns. Renderer adds `AlbumsView`, `TracksView`, a small `SortSelector`, and lucide icons in the sidebar.

**Tech Stack:** TS 6, React 19, Vitest 4, Biome 2, `@ctrl/plex` 6, `@tanstack/react-virtual` 3, `lucide-react` 1.17.0 (React-19 compatible — verified).

**Conventions:** core/main/logic `.js` imports; test/renderer no extension; `import type`; Biome; `noUncheckedIndexedAccess`. `git add -A`; commit to `main`; push each commit. Each task ends GREEN on `pnpm check`. The decorator caches via validator keys (see Spec 2c plan / `CachingPlexGateway`); reuse `VirtualTrackList`, `useProgressiveList`, `listValidator`, `SortSelector`.

---

### Task 1: Core — `LibrarySort`, `Library.updatedAt`, port methods, fake, sort-map

**Files:** `packages/core/src/models/index.ts`, `ports/plex-gateway.ts`, `testing/fakes.ts`, `index.ts`; new `packages/desktop/src/logic/library-sort.ts` + test.

- [ ] **Step 1 (models):** add `updatedAt?: number;` to the `Library` interface. Add a `LibrarySort` type to models: `export type LibrarySort = "title" | "artist" | "added";`.

- [ ] **Step 2 (port):** add to `PlexGateway` (these are extra methods; the decorator/real gateway implement them):
```ts
  listAllAlbums(library: Library, sort: LibrarySort, token: string): Promise<Album[]>;
  listAllTracksPage(
    library: Library, sort: LibrarySort, start: number, size: number, token: string,
  ): Promise<{ items: Track[]; total: number }>;
```

- [ ] **Step 3 (fake):** implement both on `FakePlexGateway` over its seeded data (flatten `albums`/`tracks` maps; apply a simple sort by the chosen field — title/artist/`updatedAt`; for the page method slice `[start, start+size]` and return `{ items, total: all.length }`). Read the fake first for field names.

- [ ] **Step 4 (sort-map helper, TDD):** new `packages/desktop/src/logic/library-sort.ts` mapping `LibrarySort` → the Plex `sort` query string, with a test. **Verify the exact Plex sort field strings against context7/@ctrl/plex + Plex docs at implementation** — starting point (confirm/adjust):
```ts
import type { LibrarySort } from "@musex/core";
/** Map our sort enum to Plex's `sort` query field. VERIFY field names against Plex. */
export function plexSort(sort: LibrarySort): string {
  switch (sort) {
    case "title": return "titleSort";
    case "artist": return "artist.titleSort";
    case "added": return "addedAt:desc";
  }
}
```
Test each branch returns the mapped string.

- [ ] **Step 5 (export):** export `LibrarySort` from core barrel.

- [ ] **Step 6:** `pnpm --filter @musex/core test && pnpm --filter @musex/core exec tsc --noEmit`, then the desktop won't fully typecheck until Task 2 (port grew) — that's expected. Commit `feat(core): LibrarySort, Library.updatedAt, listAllAlbums/listAllTracksPage port + fake` + push. (Then `pnpm check` will be red on desktop until Task 2; note this in the report.)

---

### Task 2: Gateway — implement library-wide album/track listing + map section updatedAt

**Files:** `packages/desktop/src/main/adapters/plex-gateway.ts`

**Verify the Plex section-search + sort + paging API via context7 + installed types first** (the `listPlaylistTracksPage` precedent used `server.query()` with `X-Plex-Container-Start/Size` baked into the path — `fetchItems`' `options` arg is client-side filtering, NOT URL params).

- [ ] **Step 1 (map section updatedAt → Library):** in `listMusicLibraries`, set `updatedAt` on each returned `Library` from the section's `updatedAt`/`scannedAt` (`LibrarySection` exposes `updatedAt: Date` / `scannedAt: Date`). Use `.getTime()`. This gives library-wide lists their validator.

- [ ] **Step 2 (listAllAlbums):**
```ts
async listAllAlbums(library: Library, sort: LibrarySort, token: string): Promise<Album[]> {
  try {
    const section = await this.musicSection(library, token);
    const albums = await section.searchAlbums({ sort: plexSort(sort) });
    return albums.map((a) => toAlbumSafe(a, library.serverId));
  } catch (err) { asPlexAuthError(err); }
}
```
(Import `plexSort` from `../../logic/library-sort.js` and `LibrarySort` from `@musex/core`.)

- [ ] **Step 3 (listAllTracksPage):** page the section's tracks via `server.query()` with container params + sort (mirror `listPlaylistTracksPage`'s approach, but against `/library/sections/{sectionKey}/all?type=10&sort={plexSort}`). Map raw metadata to `Track` (reuse `toTrackSafe` / the same instantiation the page method used). `total` = `MediaContainer.totalSize`. Confirm `type=10` (track) + the section `all` path against Plex docs.

- [ ] **Step 4:** `pnpm check` — must be GREEN again (Task 1's port additions now implemented). Biome clean.

- [ ] **Step 5:** Commit `feat(plex): library-wide listAllAlbums + paged listAllTracks + section updatedAt` + push.

---

### Task 3: Decorator + IPC — cache + expose the new lists

**Files:** `caching-plex-gateway.ts`, `shared/ipc-contract.ts`, `preload/index.ts`, `main/ipc.ts`

- [ ] **Step 1 (decorator):** add to `CachingPlexGateway`:
  - `listAllAlbums(library, sort, token, validator?)` → cached with key `allalbums:${library.id}:${sort}` (sort in the key — different sorts are different cached lists; validator = the library's `updatedAt`). Reuse the `cached()` helper.
  - `listAllTracksPage(...)` → pass-through (paged results not individually cached, like `listPlaylistTracksPage`).
  Keep `implements PlexGateway` (extra optional `validator?` is fine).

- [ ] **Step 2 (contract + preload):** channels + `MusexApi`:
```ts
  listAllAlbums(libraryId: string, sort: LibrarySort, validator?: string): Promise<Album[]>;
  listAllTracksPage(libraryId: string, sort: LibrarySort, start: number, size: number): Promise<{ items: Track[]; total: number }>;
```
(import `LibrarySort` into the contract). Preload bridges forward all args.

- [ ] **Step 3 (handlers):** in `ipc.ts`, add handlers that `ensureProxyEndpoint`, call the gateway with the validator (albums) / paging (tracks), and **bake art URLs** on results (`rt.proxy.artUrl(...)` per item — albums' `thumb`, tracks' `thumb`). Mirror existing handlers.

- [ ] **Step 4:** `pnpm check` green (contract test covers new channels). Commit `feat(ipc): library-wide albums (cached) + paged tracks channels` + push.

---

### Task 4: Renderer — lucide icons, SortSelector, `tracks` view

**Files:** `package.json` (+dep), `ui/Shell.tsx`, new `ui/SortSelector.tsx`, `state/app.tsx`, `ui/theme.css`

- [ ] **Step 1 (dep):** `npm view lucide-react version` (confirm ~1.17.0), add `lucide-react@^1.17.0` to `packages/desktop`, `pnpm install`. If `ERR_PNPM_IGNORED_BUILDS`, follow CLAUDE.md (it's plain JS, shouldn't need allowlisting). Commit lockfile changes with this task.

- [ ] **Step 2 (icons in Shell):** import icons from `lucide-react` and replace each `<span className="nav-ic" />` with the matching icon (size ~16, `strokeWidth` ~2): Home→`Home`, Search→`Search`, Artists→`Mic2` (or `Users`), Albums→`Disc3`, Tracks→`Music` (or `ListMusic`), Settings→`Settings`. For the **Playlists** rail header, a `ListMusic` icon next to "Playlists" is a nice touch (optional). Keep the existing `.nav-item` layout; icons sit where `.nav-ic` did (`.nav-ic` had a fixed 16px box — set the lucide icon to 16px and keep the `gap`). Adjust `.nav-ic` CSS or drop the class on real icons.

- [ ] **Step 3 (SortSelector):** create `ui/SortSelector.tsx` — a small control for `LibrarySort`:
```tsx
import type { LibrarySort } from "@musex/core";
const OPTIONS: { value: LibrarySort; label: string }[] = [
  { value: "title", label: "Title" },
  { value: "artist", label: "Artist" },
  { value: "added", label: "Recently added" },
];
export function SortSelector({ value, onChange }: { value: LibrarySort; onChange: (s: LibrarySort) => void }) {
  return (
    <select className="sort-select" value={value} onChange={(e) => onChange(e.target.value as LibrarySort)}>
      {OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
    </select>
  );
}
```
Add `.sort-select` CSS to `theme.css` (themed dark select).

- [ ] **Step 4:** `pnpm check` green. Commit `feat(ui): lucide nav icons + SortSelector component` + push. (The `tracks` View type + route are added in T6 with the view itself, so each commit compiles.)

---

### Task 5: Renderer — AlbumsView + Artists caching

**Files:** new `ui/views/AlbumsView.tsx`, `ui/Shell.tsx`, `ui/views/ArtistsView.tsx`

- [ ] **Step 1 (AlbumsView):** a grid of all albums (mirror `ArtistsView` structure) with a header that includes the title + `SortSelector`. Local `sort` state (default `"title"`). Fetch via `window.musex.listAllAlbums(library.id, sort, listValidator(library.updatedAt))` (validator from the section `updatedAt`). Re-fetch when `sort` or `library` changes. Each album card navigates to `{ name: "album", album }`. Loading/error/empty states like ArtistsView. (Grid stays unvirtualized like ArtistsView; note grid virtualization as a follow-up if a huge library is slow.)

- [ ] **Step 2 (wire Albums nav):** in `Shell.tsx`, the **Albums** button currently routes to `artists` and is `dim` — change it to navigate to `{ name: "albums" }`, remove `dim`, and add `case "albums": return <AlbumsView />;` to `renderContent` (it currently falls through to ArtistsView). Set `albumsActive = view.name === "albums"`.

- [ ] **Step 3 (Artists caching follow-up):** `ArtistsView` now passes the library validator: `window.musex.listArtists(library.id, listValidator(library.updatedAt))` so the artists list is cached too (the IPC `listArtists` handler already accepts an optional validator and forwards it; confirm and wire).

- [ ] **Step 4:** `pnpm check` green. Manual: Albums grid loads, sort changes reorder, reopen is instant (cached). Commit `feat(albums): library-wide Albums view with sort + cache; cache Artists list` + push.

---

### Task 6: Renderer — TracksView (virtualized + progressive + sort)

**Files:** new `ui/views/TracksView.tsx`, `ui/Shell.tsx`, possibly generalize `ui/hooks/useProgressiveList.ts`

- [ ] **Step 1 (progressive hook for tracks):** the all-tracks list is large → reuse the progressive-paging + virtualization pattern. Either generalize `useProgressiveList` to accept page-fetcher + full-list-fetcher callbacks (preferred — then both playlist and library tracks use it), or add a sibling hook `useProgressiveTracks(libraryId, sort, validator)` that pages via `window.musex.listAllTracksPage` and primes the cache via a full `listAllTracks` path. If generalizing, keep `PlaylistView` working (adapt its call). Choose the cleaner option and keep it correct (terminate on empty page; cancel on unmount/sort-change — the existing hook already has these guards). **Avoid the cold double-fetch** if you can prime the cache from the assembled pages; otherwise match the playlist behaviour and note it.
  - Note: there's no cached full `listAllTracks` method yet — if you want cache-prime via a full list, either add a `listAllTracks` (non-paged, cached) gateway+IPC method, OR cache the assembled pages directly. Pick one; document it. (Caching the assembled full list keyed `alltracks:${lib}:${sort}` with the library validator is the goal so re-open is instant.)

- [ ] **Step 2 (TracksView):** header (title + `SortSelector`, local `sort` state default `"title"`) + a **virtualized** track list (`VirtualTrackList`) fed by the progressive items. Each row uses `TrackRow` with `showSubtitle` (artist · album), `onPlay` = play the loaded tracks from that index (`playTracks(items, i)`), and the `onMenu` context-menu (add-to-playlist), same pattern as SearchView. Loading/paging/empty states.

- [ ] **Step 3 (wire Tracks nav):** add `| { name: "tracks" }` to the `View` union in `state/app.tsx`. In `Shell.tsx`, replace the dim Tracks placeholder with a functional button → `{ name: "tracks" }`; add `case "tracks": return <TracksView />;`; `tracksActive = view.name === "tracks"`.

- [ ] **Step 4:** `pnpm check` green. Manual: Tracks view streams in, scrolls smoothly (virtualized), sort reorders, clicking plays, ⋯ adds to playlist; reopen instant (cached). Commit `feat(tracks): library-wide Tracks view (virtualized, paged, sortable)` + push.

---

### Task 7: Verification

- [ ] **Step 1:** `pnpm check` — full green.
- [ ] **Step 2 (manual smoke, dev):**
  1. Sidebar items have icons; **Albums** and **Tracks** are no longer dim.
  2. Albums → grid of all albums; sort selector reorders (Title/Artist/Recently added); click an album → album detail → play.
  3. Tracks → large list streams in, scrolls smoothly; sort reorders; click a track plays; ⋯ → add to playlist works.
  4. Reopen Albums/Tracks/Artists → instant (cached); change something in Plex → next open refetches (validator differs).
  5. Quit/relaunch → first open still reasonably fast (list cache on disk).
- [ ] **Step 3:** if the `useProgressiveList` generalization or a new `listAllTracks` cache method changed shared behaviour, ensure `PlaylistView` still works and note any architecture change in `CLAUDE.md`.

---

## Self-Review

- **Coverage:** Albums view (grid + sort + cache) — T5; Tracks view (virtual + paged + sort + cache) — T6; nav icons (lucide) — T4; library-list caching via `Library.updatedAt` validator (albums/tracks/artists) — T1/T3/T5. Sort = 3-option selector in both views — T4/T5/T6.
- **Type consistency:** `LibrarySort` from core used in gateway/decorator/IPC/views; `listAllAlbums`/`listAllTracksPage` signatures match across port/decorator/IPC; cache key includes sort (`allalbums:{lib}:{sort}`); validator = `listValidator(library.updatedAt)` everywhere a library-wide list is fetched.
- **Sequencing:** T1 grows the port → desktop red until T2 (expected, restored T2). T4 routes `tracks`→TracksView created in T6, and `albums`→AlbumsView in T5; keep `pnpm check` green per commit by ordering: T4 adds the `tracks` View type + Shell icon changes but should stub or defer the `case "tracks"`/`case "albums"` routes until T5/T6 — OR add minimal stubs in T4 and replace in T5/T6. Implementer: keep each commit compiling (stub views if needed).
- **Risks (verify at impl):** Plex sort field strings (`titleSort`/`artist.titleSort`/`addedAt:desc`) and the section tracks paging path (`/library/sections/{key}/all?type=10`) — confirm via context7. `lucide-react` version at install. Grid virtualization for Albums deferred (render-all like Artists).
