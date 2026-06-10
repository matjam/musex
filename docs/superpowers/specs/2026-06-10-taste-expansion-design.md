# Taste Expansion — Design

**Status:** approved direction, spec for review
**Date:** 2026-06-10

## Goal

An opt-in feature that **automatically acquires music the user might like** —
a blend of "more like what you love" and "adjacent but different" — using the
last.fm similarity graph for discovery and Lidarr for acquisition. Fully
automatic (no manual review queue), but with tunable knobs and complete
visibility into what was tried, what landed, and why.

Decisions locked in discussion:

- Budget: tunable **albums/week**, default **2**.
- **Conservative → aggressive slider** governs how adventurous discovery is.
- **Fully automatic** — no approval step. Visibility + undo instead.
- Lidarr sometimes never finds a requested album: **retry once, then abandon
  and try something else** (the budget slot is refunded).
- last.fm is discovery source #1; the coordinator is provider-agnostic so an
  LLM (or any other) discovery plugin can be added later without rework.

## Discovery algorithm

Seeds come from the existing taste profile (top artists by decayed affinity).
For each cycle the coordinator builds a candidate pool:

- **Near candidates (one hop):** `artist.getSimilar(seed)` for each seed;
  keep results with match ≥ the slider's near-floor. Score =
  `match × seed affinity`.
- **Far candidates (two hops):** take a strong near candidate, fetch *its*
  similar artists, and keep ones whose best match back to ANY seed is *below*
  the slider's ceiling — connected to the user's taste but not directly.
  These are the "new taste" bets.

Filtering, in order: artists already in the library (cached `listArtists`),
artists already in the **ledger** in any state (suggested / requested /
landed / abandoned / rejected — never re-suggest), then blend near/far per
the slider's share and rank by score.

For each picked artist we acquire **one album** — the entry point, not the
discography: last.fm `artist.getTopAlbums` picks it; the Lidarr plugin's
existing `lookupArtistAlbums` resolves it to an acquirable `providerRef`
(fuzzy title match; fall back to the artist's most popular album per Lidarr
ordering if last.fm's top album isn't in MusicBrainz).

Every pick records **provenance**: seed artist, match score, hop count
(1 = "similar to X", 2 = "a step beyond X via Y"). Shown verbatim in the UI.

## Aggressiveness slider

One 0–100 slider (default 50), mapped to all tuning parameters by a pure
function `expansionParams(aggressiveness)` (linear interpolation between
anchor points):

| Parameter                         | 0 (conservative) | 50 (default) | 100 (aggressive) |
| --------------------------------- | ---------------- | ------------ | ---------------- |
| Seed artists considered           | top 5            | top 10       | top 20           |
| Near: minimum match               | 0.70             | 0.55         | 0.40             |
| Far share of picks                | 10%              | 30%          | 50%              |
| Far: max match back to seeds      | 0.30             | 0.45         | 0.60             |
| Deepen after N weighted plays     | 10               | 6            | 3                |
| Deepening action                  | +1 album         | +1 album     | monitor artist   |

## Budget & scheduling

- Budget = attempts that entered `requested` within a **trailing 7-day
  window**, excluding abandoned/rejected ones (abandonment refunds the slot,
  per the "try something else" decision).
- The coordinator runs **on launch (delayed ~2 min, after session restore)
  and every 6 hours**: advance attempt lifecycles first, then, if under
  budget and enabled, discover + request new picks.
- Settings has a **"Run a cycle now"** action button for testing/impatience —
  same code path, budget still applies (crank albums/week up while testing).

Gates: setting enabled AND signed in AND a similar provider (last.fm) AND an
acquisition provider (Lidarr) are available. Missing pieces → status line in
Settings says exactly what's missing, coordinator idles.

## Attempt lifecycle

```
suggested → requested → landed                      (success: visible in library)
                      → stalled → requested (retry) (not found after 48h: re-search once)
                                → abandoned          (still nothing after second 48h:
                                                      unmonitor album in Lidarr, refund
                                                      budget slot, next cycle picks a
                                                      replacement)
any state → rejected                                 ("Not for me": unmonitor + never again)
```

- **Landed detection:** the artist appears in the cached library artist list
  (we only acquire artists the user doesn't own, so artist presence ⇒ our
  album landed). Plex picks the file up from Lidarr's import as usual.
- **Stall detection:** the acquisition provider's existing status feed
  (queue + wanted/missing). In Lidarr's queue ⇒ keep waiting; missing with
  no queue entry after the window ⇒ stalled.
- Retry = re-issue the album acquisition (ensure-monitored + AlbumSearch);
  idempotent against an already-monitored album.

## Surfaces

1. **Settings → "Taste Expansion" section** (host feature, not plugin
   settings): on/off toggle (default OFF), albums-per-week (1–10), the
   aggressiveness slider, a status line (enabled/missing-provider/last run),
   and "Run a cycle now".
2. **Downloads view → "Expansions" feed** (above the existing Lidarr queue):
   every ledger entry with state chip (Suggested / Requested / Waiting /
   Landed / Abandoned / Rejected), provenance line ("because you listen to
   Boards of Canada — similarity 0.81"), timestamps, and a **"Not for me"**
   action on non-rejected entries.
3. **Home → "New discoveries" row**: landed expansions from the last 30 days,
   rendered as album/artist cards (navigable, playable) — closes the loop so
   bets get listened to and therefore scored by the taste profile.

## Feedback loop

- The taste profile already scores plays/skips per artist; landed expansion
  artists accrue affinity like anything else.
- **Deepening:** when a landed expansion artist's weighted plays cross the
  slider's threshold, the next cycle acquires one more album (or, at
  aggressive settings, monitors the whole artist via the existing
  `acquireArtist` path). Deepening consumes budget like any other attempt.
- **Rejection:** "Not for me" unmonitors the album in Lidarr and permanently
  blacklists the artist in the ledger. (Skip-derived deranking of the
  *neighborhood* falls out of the taste profile naturally — a rejected seed
  stops being a seed.)

## Architecture

Hexagonal, same shape as radio/smart playlists:

- **`packages/desktop/src/logic/taste-expansion.ts` (pure, fully tested):**
  `expansionParams()`, candidate blending/scoring/filtering
  (`planPicks(seeds, similarLists, owned, ledger, params, budget)`),
  lifecycle transitions (`advanceAttempts(ledger, statusFeed, libraryArtists,
  now)`), budget accounting. No I/O — everything injected.
- **`packages/desktop/src/main/expansion/coordinator.ts`:** owns the timer,
  fetches taste snapshot / similar lists / acquisition status, applies the
  pure planner, calls the acquisition provider, persists the ledger
  (electron-store file `expansion-ledger`), exposes status.
- **Plugin API (additive, apiVersion stays 1):**
  - `SimilarProvider.topAlbums?(artistName)` → `{ title: string }[]`
    (last.fm `artist.getTopAlbums`).
  - `AcquisitionProvider.cancelAlbum?(providerRef)` → unmonitor (Lidarr:
    PUT album monitored=false). Used by abandon + Not-for-me.
- **IPC:** `expansionGetState` (prefs + ledger feed + status),
  `expansionSetPrefs`, `expansionRunNow`, `expansionReject(artistKey)`.
- An LLM discovery plugin later = another similar-shaped candidate source the
  coordinator merges in; budget/ledger/lifecycle identical.

## Ledger entry (persisted)

```ts
{
  artistKey: string;        // lower(artistName) — dedupe/blacklist key
  artistName: string;
  albumTitle: string;
  providerRef?: string;     // acquisition handle once resolved
  state: "suggested" | "requested" | "landed" | "abandoned" | "rejected";
  retried: boolean;
  provenance: { seed: string; match: number; hop: 1 | 2; via?: string };
  deepening: boolean;       // true when this is a deepening pick, not a discovery
  createdAt: number; requestedAt?: number; landedAt?: number;
  abandonedAt?: number; rejectedAt?: number;
}
```

## Testing

- Pure logic: unit tests for params interpolation, near/far blending,
  exclusion (owned / every ledger state), budget windows incl. refunds,
  lifecycle transitions (request → stall → retry → abandon; landed detection),
  deepening thresholds.
- Coordinator: exercised with fake providers/store (same pattern as the
  playback monitor tests).
- No new env-gated e2e; the real-world loop is observable via the Expansions
  feed and Show Logs.

## Out of scope (deliberately)

- LLM discovery provider (architecture anticipates it; not built now).
- Multi-provider score arbitration beyond simple merge.
- Track-level acquisition (Lidarr is album-granularity).
- Cleaning up orphaned (album-less, unmonitored) artists in Lidarr after
  abandonment — noted as a known cosmetic leftover.
