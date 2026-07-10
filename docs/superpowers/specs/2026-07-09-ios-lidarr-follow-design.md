# iOS Lidarr Follow — Design

**Date:** 2026-07-09
**Status:** Approved for planning
**Surfaces:** `@musex/core`, `@musex/mobile` (desktop: one parity check only)

## Goal

Favorite/follow an artist on iOS and have the user's Lidarr server acquire their
back catalog and keep watching for new releases — with a UI surface that is safe
for public App Store distribution. The phone talks to Lidarr directly (a small
first-party client); there is no plugin system, no sandbox, and no acquisition
UI on iOS.

## App Store posture (why the design is shaped this way)

- The **only** user-facing verb is **Follow** (a heart), which is standard
  music-app favoriting. No download queue, no acquisition status, no per-album
  "Get", no "downloading" language anywhere on iOS.
- Lidarr is named truthfully in exactly one place: a Settings → Lidarr
  connection pane (URL + API key + test). The app is fully functional without
  it. This keeps us honest under guideline 2.3.1 (nothing hidden from review)
  while minimizing 5.2.3 surface (review precedent: Helmarr ships full
  Lidarr/torrent-client management UIs and passes).
- No remote flags, no review-detection, ever. If App Review ever objects, the
  fallback is: delete the settings pane and switch the monitor backend to an
  intent-sync channel (e.g. last.fm tags read by desktop). The UI surface does
  not change in that fallback — that is deliberate.

## Follow semantics — one verb, one meaning (parity with desktop)

`follow(artist)` → Lidarr:

1. `GET /api/v1/artist/lookup?term=<name>` — exact case-insensitive
   `artistName` match, else first result; take `foreignArtistId`.
2. Not yet in Lidarr: `POST /api/v1/artist` with `monitored: true`,
   `monitorNewItems: "all"`,
   `addOptions: { monitor: "all", searchForMissingAlbums: true }`, quality /
   metadata profile and root folder discovered via
   `GET /api/v1/qualityprofile` / `metadataprofile` / `rootfolder` (first entry
   of each; friendly error if any list is empty). Handle the add race
   (`400` + `ArtistExistsValidator` → re-resolve to the existing artist).
3. Already in Lidarr: full-resource `PUT` setting `monitored: true` +
   `monitorNewItems: "all"`, then `PUT /api/v1/album/monitor` (all album ids) +
   `POST /api/v1/command { name: "ArtistSearch", artistId }`.
4. **Lidarr#3597 re-assert** after any add: re-GET the artist; if
   `monitored !== true || monitorNewItems !== "all"`, PUT the full resource
   back forcing both.

`unfollow(artist)` → full-resource PUT with `monitorNewItems: "none"` **only**
(keeps acquired media and separately-monitored albums; matches desktop's
`ProviderMonitorBackend.unfollow`).

`isFollowed(artist)` = `monitored === true && monitorNewItems === "all"`
(Lidarr) OR present in the local follow store. `listFollowed()` merges both
(dedup by `followKey`) — because phone and desktop point at the **same Lidarr**,
artist follow state converges across devices for free.

**Scope: artist-only.** No album/track favoriting in this pass (the core
`FollowService` supports it; mobile does not expose it yet).

**Desktop parity check (small, this arc):** desktop `follow` calls
`acquireArtistByName`, which may not set `monitorNewItems: "all"` on an
already-added artist. Verify against the lidarr plugin source
(`~/src/musex-plugins`) and, if the gap is real, fix the plugin (its own
release) or the desktop backend so Follow means "keeps checking forever" on
both surfaces.

## Architecture

### `@musex/core` (pure, tested — new)

- **`logic/lidarr-protocol.ts`** — first-party Lidarr client, modeled on
  `lastfm-protocol.ts`:
  - `LidarrHttpResponse { ok, status, text(): Promise<string> }` and
    `LidarrHttp = (url, init: { method, headers, body? }) => Promise<LidarrHttpResponse>`
    (core has no DOM lib; hosts inject their fetch).
  - `LidarrClient { get/post/put }` — `X-Api-Key` header, `Accept:
    application/json`, baseUrl trailing-slash normalization, non-2xx →
    `LidarrError(status, bodyText)`, empty body → undefined.
  - Operations implementing the `MonitorBackend` semantics above:
    `lidarrFollowArtist`, `lidarrUnfollowArtist`, `lidarrIsFollowed`,
    `lidarrListFollowed`, plus `lidarrTestConnection`
    (`GET /api/v1/system/status` → version) and
    `lidarrSearchArtists(term)` (`artist/lookup`, for federated search).
  - The desktop plugin (separate repo, sandboxed) keeps its own copy of this
    protocol; no dedup is possible across the sandbox boundary and none is
    attempted.
- **`logic/follow-outbox.ts`** — pure pending-operation queue decisions:
  `OutboxOp { type: "follow" | "unfollow", artistName, at }`;
  `enqueueOp(ops, op)` coalesces per artist (a follow followed by an unfollow
  of the same artist cancels both ways — last intent wins, one op per artist);
  `flushPlan(ops)` returns ops in FIFO order. No I/O, no clock (timestamps
  injected).

### `@musex/mobile` (new)

- **`src/adapters/follow-store.ts`** — `AsyncStorageFollowStore implements
  FollowStore` (core port; first mobile impl). JSON array of `FollowRecord`
  under async-storage key `musex.follows`; dedup by key on add (mirrors
  desktop's `ElectronFollowStore`).
- **`src/lidarr/config.ts`** — `LidarrConfig { baseUrl }` persisted
  under `musex.lidarr` (async-storage, same pattern as `lastfm-store.ts`;
  "configured" = baseUrl and API key both present — no separate enabled flag);
  API key in expo-secure-store key `lidarr-apikey` with
  `AFTER_FIRST_UNLOCK` accessibility (+ the standard rewrite-on-load
  migration), matching the existing keychain rules.
- **`src/lidarr/lidarr-monitor-backend.ts`** — `implements MonitorBackend`
  over the core client with RN `fetch` injected. Unconfigured (no baseUrl/key)
  → every call throws a typed `LidarrNotConfigured` error the outbox treats as
  "park, don't retry-hammer".
- **`src/lidarr/outbox.ts`** — persisted outbox (async-storage
  `musex.lidarr-outbox`) wrapping the backend as a decorator that also
  implements `MonitorBackend`:
  - `follow`/`unfollow` attempt the live call; on failure (offline,
    unreachable, unconfigured) the op is enqueued via core `enqueueOp` and the
    call resolves successfully (the local `FollowStore` record is the source
    of truth for the heart).
  - Flush triggers (event-driven, no polling): app bootstrap, connectivity →
    online, app returns to foreground, Lidarr config saved. Flush walks
    `flushPlan` FIFO; first failure stops the pass (next trigger resumes).
  - A `401` from Lidarr parks the outbox (ops kept, no further attempts until
    config changes) — bad API key is only surfaced in the settings pane's
    Test connection.
  - `isFollowed`/`listFollowed` overlay pending ops onto backend results so
    the UI reflects intent immediately.
- **store.tsx wiring** — same shape as `LastfmService`: config in a ref
  hydrated at bootstrap, `FollowService` built in `useMemo` from
  `AsyncStorageFollowStore` + the outbox-wrapped backend; store exposes
  `followArtist(ref)`, `unfollowArtist(ref)`, `isArtistFollowed(ref)`,
  `getLidarrConfig` / `setLidarrConfig` / `setLidarrApiKey` /
  `testLidarrConnection`.

## UI

- **Artist header (owned)** — `app/(tabs)/library/albums.tsx` `ArtistHeader`:
  heart toggle next to the existing Radio control. Filled = followed. Tap to
  follow (instant fill); tap again to unfollow via a confirm action sheet
  ("Unfollow <artist>? Music already in your library stays."). lucide-only
  icons per project convention.
- **Similar-artists rail** — stop dropping unowned artists
  (`albums.tsx` resolution effect). Unowned entries render in the rail with a
  dimmed/`unowned` treatment and navigate to the external artist page. Owned
  entries unchanged.
- **External artist page** — new route
  `app/(tabs)/library/external-artist.tsx` (`?name=`): circular art
  placeholder, name, last.fm bio (HTML-stripped) + its own similar rail +
  the Follow heart. No track list, no album grid, no acquisition language.
  Reachable from the similar rail and search.
- **Search** — a "Not in your library" section under library results, fed by
  `lidarrSearchArtists(term)`; rendered only when Lidarr is configured and
  the device is online. Rows navigate to the external artist page.
- **Settings → Lidarr** — new pane `app/(tabs)/settings/lidarr.tsx` (+ row in
  `index.tsx`, stack entry in `_layout.tsx`), modeled on the last.fm pane:
  Server URL + API key inputs, Test connection button
  (`lidarrTestConnection` → version or error text), and a help note that
  covers the self-signed limitation (below).
- **Deliberately absent on iOS:** activity/queue UI, per-album Get, the
  `acquiring`/`downloading` entity badges, any acquisition status. New music
  simply appears in the library via the normal Plex sync.

## Error handling & constraints

- Non-2xx → `LidarrError`; callers never silently swallow (log + outbox or
  log + surface in settings test).
- Follow never visibly fails: local record always written; Lidarr delivery is
  eventually-consistent via the outbox.
- No retry loops: flush is event-driven; a failing pass stops and waits for
  the next trigger. 401 parks the outbox until config changes.
- **Self-signed HTTPS is unsupported on iOS** — RN `fetch` cannot skip cert
  validation and desktop's `allowSelfSigned` has no RN equivalent. Supported:
  plain-HTTP LAN (already permitted by the existing
  `NSAppTransportSecurity → NSAllowsLocalNetworking = true`; no ATS changes
  needed) and valid-cert HTTPS. Documented in the settings pane help text.
- No native module changes, no dev-client rebuild required (pure JS/TS).

## Testing

- Core `lidarr-protocol`: fake `LidarrHttp` covering add-new (profile
  discovery, body shape), already-added (PUT + album/monitor + ArtistSearch),
  add race (`ArtistExistsValidator`), #3597 re-assert, unfollow
  (monitorNewItems only), isFollowed/listFollowed mapping, error mapping.
- Core `follow-outbox`: coalescing (follow+unfollow cancel), one-op-per-artist,
  FIFO flush plan.
- Mobile: `AsyncStorageFollowStore` and the outbox decorator against fake
  async-storage / fake backend (park-on-401, flush-on-trigger, overlay
  semantics), fake secure-store per the existing `vi.mock` pattern.
- On-device acceptance (user's): configure Lidarr → follow an unowned artist
  from the similar rail → Lidarr adds + searches → music lands in Plex →
  appears on the phone; follow while offline → outbox delivers on reconnect;
  heart state consistent with a follow made on desktop.

## Non-goals

- Album/track favoriting UI on mobile (core supports it; later pass).
- Any acquisition status UI on iOS.
- Self-signed HTTPS support on iOS.
- A "Followed artists" list view (candidate follow-up; `listFollowed` already
  provides the data).
- Desktop changes beyond the `monitorNewItems` parity check.
- Intent-sync (last.fm tag mailbox) — designed as the App-Review fallback,
  not built now.
