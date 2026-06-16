# Discovery UI Consistency — Design

**Date:** 2026-06-15
**Status:** Approved (brainstormed with visual mockups)
**Branch:** `feature/discovery-ui-consistency`

## Problem

Navigating music discovery in musex is inconsistent. Concretely (from a full
inventory of the renderer):

- **Action buttons are per-view one-offs.** Icon-button sizes vary (`.play-btn`
  46px, `.shuffle-btn` 40px, `.album-more-btn` 36px). The "Similar" action is an
  icon-only `.shuffle-btn` in the artist header but a labeled `.detail-secondary`
  pill in the track panel. "Monitor" is a `.settings-btn` pill in the artist-info
  panel but an icon-only `.shuffle-btn` in the external-artist view.
- **Monitoring/acquisition state is surfaced three different ways** and in two
  unrelated badge systems (`grid-card-badge--*` vs `expansion-chip--*`). The
  external-artist view shows it redundantly (inline text *and* a badge); the
  artist-info panel shows it only as button text; some views not at all.
- **Monitored state is fetched once per view mount** and goes stale until you
  revisit — monitoring an artist in one place doesn't update its badge elsewhere.
- **The side panel has three unrelated shapes** (track = album art; artist-info =
  artist image + bio; queue) with no shared anatomy, and no "now playing" cue.
- **Entity names aren't reliably navigable** — artist/album names are clickable
  in some views and dead text in others (e.g. track-row subtitles).

## Goals

A single, consistent system for browsing artists → albums → songs and finding
similar music, where: action buttons are uniform, monitoring/download state is
obvious and consistent, the side panel slides in with the relevant artwork and
info, and every entity name is navigable.

This is primarily a **consistency refactor**: introduce four shared building
blocks and adopt them across the discovery views. Exactly one new behavior (a
reactive monitoring store) is in scope.

## Design

### 1. `ActionBar` — the shared entity header action bar

A single component rendered by Artist, Album, Genre, Mix, and External Artist
headers (and reused inside `EntityPanel`). Layout (the approved "Hybrid"):

- **Primary `Play`** — large round green icon button.
- **Icon-only** circular buttons for routine transport: `Shuffle`, and an
  overflow `⋯` menu (Play next, Add to queue, Start radio, Rate — the
  less-common actions).
- **Labeled pills** for the discovery/monitor actions: `✦ Similar`, and
  `Monitor` (a toggle pill reading `Monitor` / `Monitoring`, lit green when on).

One standardized icon-button size (a single CSS token, e.g. 40px) replaces the
36/40/46 spread; Play stays visually dominant via color, not size mismatch.

The set of actions is **prop-driven** so each context shows the applicable
subset (an album has no "Monitor"; an external artist has no local "Play all"
until owned). Actions not applicable are omitted, not disabled-and-shown.

CSS: new classes `.action-bar`, `.action-play`, `.action-icon` (the one icon
size), `.action-pill` + `.action-pill--on`. The old `.play-btn`,
`.shuffle-btn`, `.album-more-btn`, `.detail-secondary` collapse into these.

### 2. `StateBadge` — one acquisition-state vocabulary

A single component + class family for an album/track's acquisition state,
replacing both `grid-card-badge--*` and `expansion-chip--*`:

| state | label | colour token |
|-------|-------|--------------|
| `owned` | ✓ In library | green solid |
| `downloading` | ↓ Downloading {pct}% | yellow border |
| `downloaded` | ✓ Downloaded | green border |
| `requested` | • Requested | purple border |
| `available` | + Get | green tint (also the hover action) |
| `unavailable` | ✕ Unavailable | red border, dimmed card |

Used on every album/track card and row (grid cards, discography, search
external section, downloads/expansions feed). `StateBadge` maps an acquisition
state enum → label + class; the Downloads view's expansion chips reuse it.

### 3. Monitoring indicator — subtle + live

- Artist header & panel: the `Monitor` pill lights green, plus a one-line
  **status line** under the action bar (`● Watching for new releases · N
  downloading`). No separate redundant badge/text.
- Artist **cards** elsewhere (search, similar grids): a small bell corner-marker
  when monitored. One marker, one place.
- **Reactive state (the one new behavior):** a renderer-side monitoring store
  holds the set of monitored artists (and watch state), seeded from
  `acquisitionMonitoredArtists()` / `listWatchedArtists()` and updated optimistically
  on monitor/unmonitor/watch toggles. All monitor indicators subscribe to it, so
  toggling anywhere updates everywhere immediately (fixes stale-until-revisit).
  Backed by the existing IPC; no main-process changes required beyond what
  already exists. Reconciled on focus/refetch.

### 4. `EntityPanel` — one sliding panel for artist / album / song

Replaces `TrackDetailPanel` + `ArtistInfoPanel` with a single component (the
`queue` panel kind is unchanged). Anatomy (approved "Hero + About"):

1. **Hero artwork** at the top — round for artist, square for album/song;
   sourced from the entity thumb (or artist image for artists).
2. Title + **clickable breadcrumb** (`EntityLink`s).
3. **"Now playing"** cue when the panel's entity is the current track.
4. The **`ActionBar`** (same component as §1), applicable subset.
5. **Details** — metadata + listening stats (plays/skips/last-played) for tracks;
   album/year/track-count for albums; album count for artists.
6. **About** — biographical / notes text when a source supplies it (artist bio
   from the last.fm `artistInfo` provider today; song/album notes via plugin
   `contributeTrackDetail` and, optionally later, `album.getInfo`). Attributed
   ("via last.fm"), and **omitted entirely when empty** (never an empty box).
7. Plugin-contributed detail sections render below, under their own headings.

The panel keeps the existing slide-in animation and resizable width. Panel kind
becomes `entity` with a payload `{ kind: "artist"|"album"|"song", ref }`
(plus the unchanged `queue`).

### 5. `EntityLink` — navigable names everywhere

A small component wrapping an artist/album/song name in a consistent quiet link.
Clicking navigates: owned → the entity's detail view; unowned artist → the
external-artist view (or external URL when no acquisition provider). Adopted in
track rows/subtitles, panels, search, similar, and downloads — anywhere a name
appears. All navigations push back/forward history (existing nav-history).

A single **"Similar" entry point**: the `✦ Similar` pill in the `ActionBar`
(artist → similar artists, song → similar songs), plus a "Find similar" item in
context menus. The old icon-button-vs-pill mismatch is removed.

## Data flow

- Monitoring store: `acquisitionMonitoredArtists()` + `listWatchedArtists()` seed
  it on first need; `acquireArtistByName` / `newReleaseWatchSet` toggles update it
  optimistically and reconcile from the IPC result. Indicators read from the store.
- Acquisition state for badges continues to come from the existing
  acquisition/discography IPC; `StateBadge` is purely presentational.
- About/info continues to come from the existing plugin provider IPC
  (`artistInfoGet`, `trackDetailGet`); `EntityPanel` just renders it in the
  About section, hidden when null.

## Error handling

- Missing artwork → existing placeholder fallback (unchanged).
- Info/About provider error or null → section omitted (no error surfaced; this
  is supplementary content).
- Monitoring toggle failure → optimistic store update reverts and a toast
  surfaces (consistent with existing optimistic patterns, e.g. audio prefs).

## Testing

Most of this is React/CSS composition with no pure logic to TDD. Targeted tests:

- `StateBadge` state→label/variant mapping (pure) — unit test.
- The monitoring store reducer/logic (seed, optimistic toggle, reconcile,
  revert-on-error) — unit test (pure module, no React).
- `EntityLink` navigation target resolution (owned vs unowned vs no-provider) —
  pure helper, unit test.
- Component rendering verified manually (`pnpm dev`) + `pnpm check` (typecheck +
  lint + existing suite) is the bar; no snapshot tests (the project has none).

## Scope / non-goals

- **In scope:** `ActionBar`, `StateBadge`, `EntityPanel`, `EntityLink`, the
  reactive monitoring store, and adopting them across Artist, Album, Genre, Mix,
  External Artist, Search, Similar, Downloads, Home cards, track rows, and the
  side panel. Retire the superseded classes/components.
- **Non-goals:** new acquisition providers; main-process/plugin-API changes;
  redesigning the Home/Discover row composition; the queue panel. Rich album/song
  `About` via `album.getInfo` is an optional follow-on, not a blocker.

## Build sequence

1. **Primitives:** CSS tokens (one icon-button size) + `ActionBar`, `StateBadge`,
   `EntityLink` components, with unit tests for the pure mappings.
2. **Monitoring store:** reactive store + tests; wire monitor/watch toggles and
   indicators to it.
3. **EntityPanel:** unify track + artist-info panels into one component (hero
   artwork, breadcrumb, ActionBar, now-playing, details, About); update the panel
   state kind.
4. **Adoption:** replace per-view buttons/badges with the shared components;
   make all names `EntityLink`s; single Similar entry point. Retire superseded
   classes/components.
5. **Verify:** `pnpm check`, build, manual pass over each view.
