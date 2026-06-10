# Genres, "For You" Mix, Listening Stats — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Header = design (agreed 2026-06-10).

**Three features:**
1. **Genre dynamic playlists** — a Genres view (grid of genre cards with album counts) → clicking a genre shows a dynamic playlist (all tracks from albums tagged with it) with Play/Shuffle.
2. **"For You" mix** — a 4th Smart playlist that blends (a) tracks from owned artists SIMILAR to your taste-profile top artists, preferring rarely/never-played material, and (b) under-played tracks from your top artists themselves. Purpose: resurface music you own but don't listen to. Composed client-side from existing IPC: `getTasteSnapshot` (topArtists + stats) + `similarGet({kind:"artist"})` per top artist (returns OWNED matches with artistId) + cached `listAlbums`/`listTracks`.
3. **Listening stats surfaced** — TrackDetailPanel gains a "Listening" section: Plays, Skips, Last played (relative time), from the taste snapshot (key `lower(artist)␟lower(title)`).

**Verified:** `@ctrl/plex` Artist/Album/Track all expose `genres?: Genre[]` (`Genre extends MediaTag`, `.tag: string`). Genre playlists use ALBUM genres (best-tagged level in Plex music libraries); track membership = album join.

**Decisions:** `Album.genres?: string[]` + `Artist.genres?: string[]` in core models (tracks NOT — rarely tagged, join via album). List-cache schema **v4 → v5**. Genres view sorts by album count desc; genres with 1 album still listed. "For You" caps 100 tracks, deterministic ordering (no Math.random in logic — order by composed score), pure + tested composer. Stats panel reads are point-in-time per selection (no live updates needed).

### Task 1: Genres
- Models: `genres?: string[]` on Album + Artist. Mapping: `RawAlbum/RawArtist.genres?: {tag?: string}[]` → `toAlbum/toArtist` map to `string[]` (filter empty; omit field when none). **Safe-mapping boundary** (`toAlbumSafe`/`toArtistSafe` in plex-gateway.ts) forwards `genres` (the thrice-bitten boundary — verify every call site). Mapping tests.
- Cache: `vkey()` v4 → v5 (comment: v5 = genres on Album/Artist).
- Pure logic `logic/genres.ts` (+tests): `genreIndex(albums): { genre: string; albumCount: number }[]` (case-preserving display name keyed case-insensitively, counts, sorted count desc then name) and `tracksForGenre(genre, albums, tracks): Track[]` (albums tagged with genre case-insensitively → tracks whose albumId ∈ set; sorted artist → album → trackNumber).
- Views: View union `{name:"genres"}` + `{name:"genre"; genre: string}`. Sidebar: "Genres" nav (lucide `Tags`) between Artists and Tracks. `GenresView`: fetch cached `listAllAlbums(libraryId,"title",validator)` → genreIndex → grid of simple genre cards (name + "N albums"; reuse browse-grid + a `.genre-card` — a GridCard without art is odd; use a styled tile div). `GenreView`: breadcrumb "Genres › <genre>", Play/Shuffle header buttons, fetch allAlbums + allTracks (both cached) → tracksForGenre → VirtualTrackList with standard TrackRow wiring (selection/activate/menu).
- Commit: `feat(genres): genre index + per-genre dynamic playlists (cache v5)`

### Task 2: "For You" mix + listening stats panel
- Pure composer `logic/for-you.ts` (+thorough tests): 
```ts
composeForYou(input: {
  ownTop: { artistId: string; name: string; score: number }[];      // resolved owned top artists
  similarOwned: { artistId: string; name: string; viaArtist: string }[]; // owned artists similar to taste
  tracksByArtist: Map<string, Track[]>;                              // artistId -> their tracks
  stats: Map<string, { plays: number; skips: number; lastPlayedMs: number }>; // smartTrackKey
  nowMs: number;
}): Track[]
```
Scoring per track: base = unexplored bonus (plays 0 → +3; lastPlayed > 90d → +2; > 30d → +1), + rating bonus ((stars−3) when rated), − skip penalty (skips × 0.5), + source bonus (similar-artist track +1 — the discovery angle). Exclude tracks with skips ≥ 3 && plays ≤ 1 (you keep skipping it). Interleave per-artist (max 4 tracks per artist) ordered by score desc; cap 100. Deterministic.
- Renderer: `SmartKind` + `"for-you"` (`SMART_TITLES`: "For You"); sidebar Smart entry (lucide `Wand2`). `SmartPlaylistView` for-you branch: `getTasteSnapshot` → top 5 artists by score → resolve OWN artists: `library`-side resolution — match top-artist names against owned via `window.musex.search`? Simpler + already-built: call `similarGet({kind:"artist", name})` for each top artist (owned items carry artistId) AND ALSO resolve the seed artist itself by searching `window.musex.search(libraryId, name)` artists exact-ish match. Collect owned artistIds (cap ~12 artists total: 5 own + similar owned). For each: cached `listAlbums` → cached `listTracks` per album (cap albums/artist ~6 by year desc? keep all; tracks volume fine) → build tracksByArtist → composeForYou with stats + topArtists. Loading state notes "Mixing from your taste profile…". Empty state: "Play and rate more music first — For You needs a taste profile." Guard: similarGet needs a provider; when zero similar results, compose from own top artists only (still useful).
- **Stats panel:** TrackDetailPanel "Listening" `detail-meta` block: Plays / Skips / Last played ("3 days ago" — small pure `relativeTime(ms, now)` helper in renderer util with tests optional) from `getTasteSnapshot` fetched per selection (reuse the existing per-selection effect pattern; show the block only when a stat exists; "Never played" when absent → show block with Plays 0? Show only when stats exist, else a single muted line "Not played yet").
- Commit: `feat(smart): For You mix — taste + similar-owned resurfacing; listening stats in the track panel`

**Manual acceptance:** Genres shows your library's genres with counts; a genre page plays/shuffles its tracks; For You fills with under-played tracks from artists you like + owned similar artists (needs last.fm connected for the similar half); selecting a played track shows Plays/Skips/Last played.
