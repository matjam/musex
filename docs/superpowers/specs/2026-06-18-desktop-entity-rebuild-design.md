# Desktop Entity Rebuild (SP1) Design

**Date:** 2026-06-18
**Status:** Approved (design, brainstormed with the visual companion); proceeding to plan + build.
**Context:** Second piece of the UI-consistency arc, on the SP0 foundation (`EntityRef` + `resolveEntity`, `FollowService` + `FollowStore`/`MonitorBackend` ports, design tokens + entity-state vocabulary). Today the desktop navigates entities inconsistently — an unowned artist opens a side panel from Discover, a full `ExternalArtistView` from Similar, or dead text elsewhere; acquisition is inline in some places and a page in others; after acquiring you're not taken anywhere; Similar loses context; there's no external-album view; badges don't navigate. SP1 rebuilds the desktop entity experience on SP0 so **the navigation path stops mattering**: one artist page, one album page, reached identically from everywhere, each rendering owned + unowned + acquisition inline, with Follow (= acquire + monitor) and acquisition status that flow naturally.

## Decisions locked in brainstorming (visual companion)

1. **Unified entity pages.** One artist page + one album page handle owned (Plex) **and** unowned (last.fm-only) **and** acquisition states inline. Every entry point (search, similar, discover, a track's artist link, a home card) resolves via `resolveEntity` to the **same** page. `ExternalArtistView` and `SimilarView`'s external branch collapse into the unified pages; there is no separate external view and no "open a panel instead of a page."
2. **Discography = one mixed list, status badges (option A).** On the artist page, albums render in one list (release order) with **status only** badges (In library / Acquiring / Not in library / Downloaded) — **not** per-album Get buttons. Acquisition is artist-level.
3. **Follow = acquire + monitor (the one acquisition action).** `follow(artist)` → the provider acquires the full discography + monitors (SP0 `FollowService` → `MonitorBackend` → Lidarr `acquireArtist`); the headline action on every artist/unowned-album surface. `follow(album/track)` = local favorite. A **quiet secondary "Get just this album"** (⋯ / context menu) covers the cherry-pick case via Lidarr's album-level monitor. "Follow/Following" replaces "Monitor/Watch" in the UI.
4. **Acquisition flows inline; never dumped.** Follow/Get from anywhere → you **stay put**; badges update (Not in library → Acquiring → In library). A **conditional top-bar activity pill** (shown only while acquiring) opens a popover with in-flight progress + "View all". A **persistent sidebar "Activity" entry** opens the full Activity page (history + followed artists + queue) — the repurposed `AcquiringView`. You're never force-navigated after acquiring.
5. **Side panel = context only.** The `EntityPanel` is reserved for **now-playing + track detail** (stats / similar / credits). It is **not** an entity-navigation destination; entity clicks always go to the unified page. This fixes the panel-vs-view seam + the panel-context-instability.
6. **One card component + the shared badge vocabulary.** A single card (used in the Artists grid, Search's in-library + not-in-library sections, Similar rail, Discover rows, Home) with identical hover action (Play if owned, Follow if not), the SP0 entity-state badge (color/icon from the vocabulary), a ⋯ menu, and names that **always** link to the unified page. **Badge density: non-default states only** — plain owned/in-library cards show no badge; Following / Acquiring / Not-in-library / Downloaded do.

## Architecture

### Consume SP0 + wire its ports (desktop adapters land here)
- **`resolveEntity`** drives all entity navigation: every clickable entity emits an `EntityRef`; a renderer `useEntityNav` maps `resolveEntity(ref).nav` (`NavTarget`) to the (now-unified) artist/album view. Owned vs unowned no longer branches the destination.
- **`FollowService`** wired with desktop adapters: a **`FollowStore`** over `electron-store` (album/track favorites + any provider-less artist follow) and a **`MonitorBackend`** over the existing acquisition provider (`acquireArtistByName` = follow; the unmonitor path = unfollow; `listMonitoredArtists`/`isWatchingNewReleases` = isFollowed/list). These are the SP0-deferred adapters.
- **Design tokens / entity-state vocabulary:** `ui/theme.css`'s `:root` vars are reconciled to SP0 `tokens` (single source of truth — generate/align the CSS vars from `colors`/`space`/`radius`). Badges render from the SP0 `ENTITY_STATE` table (color token + lucide icon + label) + `entityState(resolved, flags)`.

### View changes (renderer)
- **`ArtistView` (unified)** — merge `ArtistDetailView` + `ExternalArtistView` into one view that takes an `EntityRef` (owned or external). Header (art, name, status, **Follow** headline, Play/Shuffle when owned, genres/stats), the **mixed discography** (owned + acquirable + acquiring, status badges, click → album page), the **Similar rail** (mixed owned/unowned, each → its unified page), and the last.fm **About** inline. Discography for an unowned artist = the provider/last.fm discography (`externalDiscography`); for a partly-owned artist = owned albums ∪ the rest with status.
- **`AlbumView` (unified)** — handle owned (playable track list + ♥ favorite + per-track downloaded/cached availability) **and** unowned (last.fm track list, primary **Follow [artist]**, quiet **Get just this album** secondary). One page shape.
- **`SimilarView`** — its items resolve through `resolveEntity` → the unified artist/album pages (owned + unowned alike); the external-URL/external-artist-view divergence is removed.
- **`SearchView` / `DiscoverView` / `HomeView` / `PluginSections`** — entity cards use the **one card component** + `resolveEntity` navigation. The "open a panel for an unowned artist" behavior is removed; unowned cards navigate to the unified artist page like everything else. Search keeps its "in your library" + "not in your library" sections, both using the same card.
- **`ActivityView`** (renamed from `AcquiringView`) — the full acquisition activity: in-flight queue + history + **Followed artists** (the old "Watching"). Reached from the conditional top-bar pill's "View all" **and** a persistent sidebar **Activity** entry.
- **`EntityPanel`** — narrowed to now-playing + track-detail context; its artist/album/song "navigate" affordances become entity links (→ unified pages) but the panel itself is never the destination of an entity click.
- **`GridCard`** → the consistent card: hover Play (owned) / Follow (unowned), the SP0 badge (non-default states only), a ⋯ secondary menu (Get just this album, Follow, Play next, …), name → unified page.
- **Top bar** — add the conditional **acquisition activity pill** (visible only while the acquisition status feed has in-flight items) → popover.
- **Nav state (`app.tsx`)** — the `external-artist` view case is removed (folded into the unified `artist` view, which now accepts an `EntityRef` rather than a Plex-only `Artist`); `acquiring` → `activity`. `EntityLink`/`resolveEntityTarget` are replaced by SP0's `resolveEntity`. Breadcrumb artist resolution uses the track's `artistId` consistently (fixes the compilation dead-end).

## Data flow

- **Navigate:** any entity click → `EntityRef` → `resolveEntity` → `nav` → the unified `ArtistView`/`AlbumView` (owned or external). The view fetches owned data (gateway) and/or external data (the acquisition provider / last.fm via the existing `externalDiscography`/similar/artistInfo) based on `ref.source` + ownership cross-check, and renders one coherent page.
- **Follow:** Follow button → `FollowService.follow(ref)` → (artist) `MonitorBackend` acquire+monitor → the existing acquisition status feed drives inline badges + the activity pill. `isFollowed` seeds the button state. Unfollow → unmonitor.
- **Get just this album:** ⋯ → the existing `acquireAlbum(providerRef)` → inline album status.
- **Activity pill:** subscribes to the acquisition status feed; visible iff in-flight count > 0; popover lists items + progress; "View all" → `ActivityView`.

## Error handling / offline

- Reuse the existing connectivity gating: Follow/Get + external fetches disabled offline with the inline "you're offline" treatment (the existing pattern); owned playback/browse unaffected. `PlexAuthError` → re-auth (unchanged). A provider that's absent (no Lidarr) → unowned entities are still explorable (last.fm data) but Follow/Get show "needs an acquisition plugin" rather than dead text.

## Testing

- **Pure (SP0):** `resolveEntity`/`FollowService` already tested in core.
- **Desktop adapters (new, unit-tested):** the `electron-store` `FollowStore` (round-trip/list/remove) + the `MonitorBackend`-over-acquisition-provider (follow→acquireArtistByName, isFollowed→listMonitoredArtists, unfollow path) against fakes.
- **Desktop pure helpers:** any new renderer-pure mapping (e.g. building the unified discography from owned ∪ external) tested.
- **UI:** renderer views aren't unit-tested here (consistent with the existing desktop UI); the bar is `pnpm check` (typecheck ×2 + biome + tests) green, and **on-desktop acceptance by the user** (navigate similar→discover→artist→follow→watch the pill; owned/unowned/album pages; consistent cards/badges).

## Non-goals (SP1)

- **Mobile** — SP2 (mirrors this minus acquisition).
- **No new acquisition mechanics** — reuse `acquireArtist`/`acquireAlbum`/monitoring as the `MonitorBackend`.
- **No new last.fm/provider data** beyond what `externalDiscography`/similar/artistInfo already expose.
- **No cross-device sync** (favorites local per SP0).
- A full visual restyle beyond aligning to the SP0 tokens + the card/badge vocabulary is out — this is structural consistency + the entity flow, not a pixel redesign.

## Success criteria

- One `ArtistView` + one `AlbumView` handle owned + unowned + acquisition inline, reached identically from every entry point (no `ExternalArtistView`, no panel-as-destination, no dead text). 
- Follow (artist) = acquire+monitor via `FollowService`; the quiet per-album Get works; "Following" vocabulary throughout.
- Acquisition is inline + the conditional pill + the `ActivityView`; you're never force-navigated.
- One card component + the SP0 badge vocabulary (non-default states only) across all grids/rows; names always navigate.
- The `EntityPanel` is context-only. `pnpm check` green; desktop behavior verified by the user.
