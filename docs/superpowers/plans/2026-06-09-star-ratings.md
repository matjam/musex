# Star Ratings (Plex-backed) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** 5-star ratings for tracks and artists, stored in Plex (`userRating`, 0–10 scale; star = 2 points; clear = rating `-1`). Clickable stars: now-playing bar (current track), artist page header (artist), hover on every `TrackRow` list (album/tracks/search/playlist), and the track detail panel. Existing ratings display wherever stars are clickable.

**Verified (2026-06-09):** `@ctrl/plex` audio types expose `userRating?: number`; no audio `rate()` method — endpoint from the Video impl: `PUT /:/rate?key=<ratingKey>&identifier=com.plexapp.plugins.library&rating=<n>` via `server.query({path, method:"put"})`. Reading a single item: `GET /library/metadata/<id>` → `MediaContainer.Metadata[0].userRating`.

**Decisions:** whole stars only; click current rating again → clear; queue drawer excluded v1; albums not ratable v1 (tracks + artists only, per request). List cache stores mapper output → **schema bump v2→v3** (Track/Artist gain `userRating`). On rate, evict exactly-addressable list keys (`tracks:{albumId}`, `alltracks:{libraryId}:{title|artist|added}`); playlist lists may stay stale across restarts — the renderer session overlay covers live UI, and validators refresh them eventually.

---

### Task 1: Backend — model, gateway, rate + eviction, IPC

- **Core models:** `Track.userRating?: number` (0–10), `Artist.userRating?: number`. Update `makeTrack` fake only if needed (optional field — no fixture churn).
- **Core port (`PlexGateway`):** `rateItem(serverId: string, itemId: string, rating: number | null, token: string): Promise<void>` (null → clear) and `getUserRating(serverId: string, itemId: string, token: string): Promise<number | null>`. Add to `FakePlexGateway` (in-memory map; tests).
- **Mapping:** `toTrack`/`toArtist` read `raw.userRating`; **`toTrackSafe` MUST forward `t.userRating`** (lesson from the artistId bug — the mapper test alone doesn't cover the boundary; also forward on the artist mapping call site). Update `plex-mapping.test.ts` expectations.
- **`PlexapiGateway`:** `rateItem` → `connect(serverId)` then `query({ path: "/:/rate?key=<id>&identifier=com.plexapp.plugins.library&rating=<n or -1>", method: "put" })`. `getUserRating` → `query({ path: "/library/metadata/<id>" })`, read `MediaContainer.Metadata[0].userRating ?? null`.
- **`CachingPlexGateway`:** delegate both; after a successful `rateItem`, evict (vkey'd) `tracks:{albumId}` when the caller passes albumId and `alltracks:{libraryId}:{sort}` for all three sorts when libraryId passed — signature: `rateItem(serverId, itemId, rating, token, opts?: { albumId?: string; libraryId?: string })` on the caching class only (core port stays minimal; ipc calls the caching class directly like `endpoint()`). Bump the schema const `v2` → `v3` (update its comment: v3 = userRating on Track/Artist). Test the eviction with the existing caching-gateway test patterns.
- **IPC:** `rateItem: "musex:rateItem"` — `rateItem(args: { serverId; itemId; rating: number | null; albumId?; libraryId? })`, validation: rating null or integer 0..10. `getUserRating: "musex:getUserRating"` — `(serverId, itemId) → number | null`. Preload + handlers (`rt.gateway.rateItem(...)` with opts; ensure token via `rt.requireToken()`).
- `pnpm check` green; commit `feat(ratings): Plex userRating on tracks/artists — model, gateway rate/read, cache v3 + eviction, IPC`.

### Task 2: Renderer — stars everywhere

- **`state/ratings.tsx`:** `RatingsProvider` (mount in App.tsx inside the signed-in tree) with a `Map<itemId, number | null>` session overlay. `useRatings()` → `{ ratingFor(id, fallback?: number): number | null; rate(args: {serverId; itemId; stars: number | null; albumId?; libraryId?}): void }` — `rate` optimistically sets the overlay (stars*2 / null) then fires the IPC (on failure: revert overlay + console.error).
- **`ui/StarRating.tsx`:** props `{ value10: number | null; onRate?: (stars: number | null) => void; size?: number }`. Five lucide `Star`s; filled = `fill="currentColor"` (gold-ish `--yellow`), empty = outline at low opacity. Hover preview (local state, mouseleave resets). Click star n → `n === currentStars ? onRate(null) : onRate(n)`. Read-only when no `onRate`. Buttons with `aria-label="Rate n stars"`, `title` shows "n stars" / "Clear rating".
- **`TrackRow`:** stars sit between `track-main` and the menu/duration. Visible always when rated; unrated → visible only on row hover (CSS: `.track-row .star-rating { visibility: hidden } .track-row:hover .star-rating, .track-row .star-rating.rated { visibility: visible }`). Clicks must `stopPropagation` (don't select/play the row). Needs `serverId`/`albumId` from the track + `libraryId` from `useApp().library` — read library inside TrackRow (it's already context-connected via TrackSubLinks pattern).
- **`NowPlayingBar`:** stars (size ~13) next to the title/sub block (`np-meta`), rating the current queue track.
- **`ArtistDetailView`:** stars in the artist header next to the Play/Shuffle actions; initial value = `artist.userRating ?? null` BUT artists navigated via links lack the field → on mount fetch `getUserRating(artist.serverId, artist.id)` and seed the overlay; rate with no albumId/libraryId opts.
- **`TrackDetailPanel`:** stars under the artist/album links.
- **CSS:** `.star-rating` row of tight buttons (no background, pointer, no drag region issues), `.star-rating .filled { color: var(--yellow) }`.
- All views pass through automatically via TrackRow; verify SearchView/PlaylistView/TracksView/AlbumDetailView render unchanged otherwise.
- `pnpm check` green; commit `feat(ui): clickable 5-star ratings — now-playing bar, artist page, track rows, detail panel`.

**Manual acceptance:** rate a track from All Songs hover → stars persist in the row, the bar (when playing it), and the panel; visible in Plex Web; restart → rating still shown (fresh fetch, v3 cache); click same star count → cleared everywhere; rate an artist on its page; album-view tracks show ratings after restart (eviction worked).
