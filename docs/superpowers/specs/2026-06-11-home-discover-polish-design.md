# Home/Navigation Polish + In-App Discovery & Acquisition UX — Design

**Date:** 2026-06-11
**Status:** Approved (user: "make your best guess — consistent and logical; I'll review and iterate once the work is done")

One batch, one PR (project rule: logical sets of UI improvements group into a
single PR). Eleven items from the user, grouped into three clusters.

---

## Cluster A — Home & shell polish

### A1. Section-label spacing
`.browse-title` sits too close to the tile grid below it. Add breathing room:
`.home-row .browse-title { margin-bottom: 14px; }` (scoped to home rows so
browse views are untouched; adjust to taste against the existing 26px
`.home-row` bottom margin).

### A2. Smart-mix tile art (generated from the mix's albums)
Smart playlist tiles (For You / Top Rated / Heavy Rotation / Rediscover)
currently show a gradient icon; mood-mix tiles already get a 2×2 `CardCollage`.
Make smart tiles match: compose each mix's content **in the background on
Home** and collage its album art.
- New pure function in `logic/smart-playlists.ts`:
  `smartMixThumbs(kind, tracks, taste, count): (string | undefined)[]` —
  for `top-rated`/`heavy-rotation`/`rediscover` it reuses
  `computeSmartPlaylist` and returns the result's track thumbs (track thumb =
  album art); for `for-you` (full composition is an expensive multi-IPC
  fan-out) it **approximates**: thumbs of tracks by the taste snapshot's top
  artists. Dedupe thumbs before returning.
- HomeView already fetches `listAllAlbums`; additionally fetch
  `listAllTracks` + `getTasteSnapshot` in the same background effect, feed
  `smartMixThumbs` → `sampleThumbs(thumbs, 4, kind)` → `CardCollage` on the
  smart cards (keep the kind icon as a small corner glyph chip so the cards
  stay distinguishable). Tiles render immediately with the icon placeholder
  and fill in as data arrives.

### A3. Playlist tile art fallback (e.g. "Recently Played" has no art)
Plex playlists without a composite `thumb` render an empty tile. Fallback: for
playlists with no `thumb`, fetch the first page of tracks
(`listPlaylistTracksPage(id, serverId, 0, 8)`) in the background and render a
`CardCollage` from `sampleThumbs(trackThumbs, 4, playlist.id)`. Applies to the
Home "Your playlists" row (the playlist browse view, if any, reuses the same
component if trivial — otherwise out of scope).

### A4. Hide empty-playlist tiles
Home "Your playlists" row filters `p.trackCount > 0` before slicing the top 8.
Sidebar still lists them (with the 0 badge from A5 making the why visible).

### A5. Sidebar playlist count badges
Each playlist nav item gets a right-aligned muted count: `<span
className="nav-badge">{p.trackCount}</span>`, CSS: small, `var(--muted)`,
doesn't shift the label; consistent with the existing nav-item look.

### A6. Sidebar library order
Reorder the Library nav items to: **Artists, Albums, Tracks, Genres**
(currently Albums, Artists, Genres, Tracks).

### A7. Open on Home
`state/app.tsx` `restore-done` case sets `view: { name: "home" }` (currently
`"albums"`). The `signed-in` case already goes home.

---

## Cluster B — Navigation history

Back/forward buttons immediately **left of the search box** in the TopBar,
stepping through view-navigation history.

- **State:** lives in the app reducer (`state/app.tsx`). Add
  `back: View[]` and `forward: View[]` to `AppState`.
  - `navigate`: if the new view differs from the current one (compare by
    `JSON.stringify` — View objects are small and serializable), push the
    current view onto `back` (capped at 50), clear `forward`.
  - `set-search`: when it switches the view to `search` from a non-search
    view, that counts as one navigation push (typing more keystrokes while
    already on search pushes nothing).
  - New actions `nav-back` / `nav-forward`: pop one side, push current onto
    the other, set the view. No-ops when the stack is empty.
  - `signed-in` / `restore-done` reset both stacks.
- **UI:** `TopBar` renders two icon buttons (lucide `ChevronLeft` /
  `ChevronRight`, `no-drag`) in a group anchored to the left edge of the
  centered search box; disabled (dimmed, non-interactive) when their stack is
  empty.
- **Keyboard:** `⌘[` back, `⌘]` forward in `useKeyboardShortcuts` (standard
  macOS history keys); listed in the Shortcuts modal.
- Views holding object payloads (`album`, `artist`, `playlist`…) are restored
  by re-rendering with the stored object — same as the existing back-less
  navigation, no refetch semantics change. History is session-only (not
  persisted).

---

## Cluster C — Discovery & acquisition UX

The principle (user): **last.fm is the source of truth for what exists;
Lidarr for what can actually be fetched.** Surface acquisition inline instead
of bouncing offsite, and show monitored state in the UI.

### C1. Plugin API additions (all optional — apiVersion stays 1)
- `SimilarProvider.artistInfo?(artistName): Promise<ArtistInfo | null>` where
  `ArtistInfo = { name: string; bio?: string; url?: string; listeners?:
  number; playCount?: number; imageUrl?: string }`. lastfm implements via
  `artist.getInfo` (bio summary stripped of its trailing `<a href…>` link
  tag, stats, last.fm URL).
- `AcquisitionProvider.listMonitoredArtists?(): Promise<string[]>` — lidarr
  implements: `GET /api/v1/artist`, filter `monitored`, return names.
- Host fan-outs (`plugin-host.ts`): `artistInfo(name)` (first provider with a
  non-null answer), `listMonitoredArtists()` (union across providers,
  **cached for 60s** host-side — it backs tile badges and must be cheap).
- IPC: `musex:artistInfo:get` (name → ArtistInfoDto | null),
  `musex:acquisition:monitoredArtists` (→ string[]).

### C2. Merged external discography ("what exists" ∪ "what's fetchable")
New host method `externalDiscography(artistName)` (IPC
`musex:acquisition:discography`) that merges:
1. `lookupArtistAlbums` fan-out (lidarr — authoritative per-album state:
   owned/downloaded/downloading/requested/available, providerRef), with the
   existing owned cross-check;
2. `topAlbums` fan-out (lastfm — titles that exist in the world);
   titles known to last.fm but absent from every acquisition provider are
   appended with `state: "unavailable"` (visible, not monitorable — "if it's
   not on lidarr, it's not there"). Title matching is case-insensitive.
`ExternalArtistView` switches from `acquisitionLookupArtist` to this (the old
IPC channel stays for compatibility with nothing else using it removed).

### C3. Discover page: monitor inline, info in the side panel
- **Unowned artist tiles** (`PluginSections`): hover action button (lucide
  `Download`, same overlay as ExternalArtistView's album action) →
  `acquisitionAcquireArtistByName(name)` (= monitor whole artist in Lidarr) →
  toast via existing plugin-notify; the tile's badge flips to "monitored".
- **Tile click (unowned):** opens a new right side panel — panel kind
  `artist-info` (extends the existing `track`/`queue` panel system; panel
  state gains a payload: `{ kind: "artist-info"; artistName: string }`).
  Panel content (`ArtistInfoPanel`): artist name, last.fm image, bio text,
  listeners/plays, a "View on last.fm" link (`openExternal`), and two
  actions: **Browse albums** (→ navigate `external-artist` view — the merged
  discography from C2, where per-album monitor lives) and **Monitor artist**
  (acquireArtistByName). If the artist turns out to be owned, an "In your
  library" button navigates to the library artist instead.
- **Owned artist tiles** keep navigating straight to the library artist view
  (unchanged).
- `openExternal`-only fallback (no acquisition provider) keeps current
  behavior.

### C4. Owned-artist page: albums you don't have
`ArtistDetailView` gains a lazy "Not in your library" section below the owned
albums grid (only when an acquisition provider is enabled): fetches
`externalDiscography(artist.name)`, filters out owned, renders album cards
with the Download hover action (monitor album via existing
`acquisitionAcquire`) and per-album state badges — same card vocabulary as
ExternalArtistView. Empty result → section hidden.

### C5. Monitored indicators
- Discover/unowned artist tiles: badge "monitored" (distinct accent variant)
  when the name is in `listMonitoredArtists` (fetched once per
  Discover/section render from the 60s host cache).
- `ExternalArtistView` header: a "Monitoring artist" chip when monitored
  (same data), alongside the existing watch-new-releases bell.
- Album-level state badges (requested/downloading/…) already exist and serve
  as the album-tile indicator everywhere album cards render.

---

## Testing

- Pure logic: `smartMixThumbs` (per kind, dedupe, for-you approximation) in
  `smart-playlists.test.ts`; nav-history reducer transitions (push/dup-guard/
  back/forward/caps/reset) — extract the history arithmetic into
  `logic/nav-history.ts` (pure: `pushHistory`, `goBack`, `goForward` over
  `{back, current, forward}`) and test it; discography merge logic
  (`logic/discography-merge.ts`, pure: lidarr list + lastfm titles → merged
  list with unavailable fill) and test it.
- Plugin shapes: lastfm `artistInfo` parse + lidarr `listMonitoredArtists`
  request shape pinned in the plugins' existing routed-HTTP test style.
- Everything else is view wiring — verified live at the end (single e2e pass
  over all items).

## Out of scope (deliberate)

- Persisting navigation history across restarts.
- Playlist-art fallback outside the Home row component (unless it falls out
  free via a shared component).
- MusicBrainz or any new metadata source; per-track acquisition (Lidarr is
  album-level).
- Un-monitoring from the UI (Downloads view "Not for me" already covers the
  expansion path; full monitor management stays in Lidarr).
