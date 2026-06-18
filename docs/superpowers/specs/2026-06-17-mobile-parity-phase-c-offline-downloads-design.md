# Mobile Feature Parity — Phase C: Downloads + Offline + Transcoded Storage Design

**Date:** 2026-06-17
**Status:** Approved (design); proceeding to plan + build per user delegation
**Context:** Third mobile parity phase. Pin tracks/albums for offline, play them (and browse the on-device collection) while Plex is unreachable, and optionally store downloads transcoded to AAC. Mirrors desktop's combined offline+downloads+transcode feature, adapted to iOS. Builds on Phase A (#53) + Phase B (#55).

## Goal

Let the user download tracks/albums to the device, browse + play them offline, with an Original↔AAC storage choice — reusing the core download/offline/transcode logic, adding iOS adapters (expo-file-system store, download manager, connectivity monitor) and UI (a Downloaded collection, download affordances, an offline banner, a storage settings pane).

## Decisions locked in brainstorming

- **Transcoded storage: Original ↔ AAC** (match desktop) — AAC via the core HLS segment-stitch (`transcode-url.ts`), with a bitrate select.
- **Connectivity:** `@react-native-community/netinfo` (instant network-loss) + a debounced **Plex-reachability probe** (catches "network up, server unreachable"); a `PlexAuthError` NEVER counts as offline (sign-in owns that).
- **IA:** the on-device collection is a 4th **Library segment ("Downloaded")**; storage *controls* live in **Settings → Downloads**; you **download** from the track action sheet (+ album/artist Download actions).
- **Offline scope:** offline = play the **Downloaded** collection + graceful degradation everywhere else. Full *cached-library* offline browse (Artists/Albums/Tracks with no connection) is a **deliberate non-goal** (mobile has no list cache yet — its own follow-up).

## Architecture

**Core (mostly exists; one promotion):**
- Already in core (verified): `download-plan.ts`, `download-state.ts` (`DownloadRecord`/`DownloadStatus`/`StorageQuality`/`reconcileRecords`/`groupDownloadsByAlbum`/`recordsToTracks`), `offline-availability.ts` (`trackAvailability`), `transcode-url.ts` (`buildHlsStartUrl`/`parseHlsMaster`/`parseHlsMedia`/`TRANSCODE_PROFILE_EXTRA`/`TRANSCODE_BITRATES`).
- **Promote** the desktop renderer helpers `downloaded-records.ts` + `downloaded-set.ts` into core (deferred from the shared-logic promotion) — pure lookup/set helpers over `DownloadRecord`/`Track`; barrel-export; tests move with them. Desktop re-points to the core versions.

**Mobile adapters (new, `packages/mobile/src/downloads/`):**
- **`DownloadStore`** — files under `expo-file-system` document directory `downloads/`, keyed by a stable per-track key (`cacheKey(serverId, partKey)` — the same key the stream resolver will look up). `.part`→atomic-rename on commit; `commit()` rejects on write failure; `remove()` key-validated. Never evicts (pinned).
- **`DownloadIndex`** — `DownloadRecord[]` persisted in async-storage (`musex.downloads-index`); records store full `media` (container/audioCodec/partId/bitrate) so `recordsToTracks` can reconstruct play-ready `Track`s offline.
- **`DownloadManager`** — sequential (concurrency 1). `mode==="original"` → `expo-file-system` download of the direct part URL (token in query/header) + validation. `mode==="aac"` → HLS segment-stitch: `buildHlsStartUrl` → fetch master (`X-Plex-Client-Profile-Extra` header + token) → `parseHlsMaster` → media playlist → `parseHlsMedia` → fetch each segment (bounded retry; token header) → append to the file → require `#EXT-X-ENDLIST` before commit → best-effort `stop` session. Progress events to the store.
- **`ConnectivityMonitor`** — netinfo subscription + a debounced Plex probe (`AbortSignal.timeout`); emits `online`/`offline`; `PlexAuthError` never offline.

**Playback of downloads:** the mobile stream resolver (`logic/stream-ref.ts` + the resolver adapter) gains a **local-first** branch: if a track is downloaded, return its `file://` URI (offline-capable, zero bandwidth); else the existing direct/HLS-transcode decision. The engine plays a `file://` source like any other.

## Features

- **Download actions** — a **Download** row in `TrackActionSheet` (→ enqueue the track); "✓ Downloaded · Remove" when present; album + artist screens get a **Download** action (enqueue all their tracks). Disabled when offline (you can't fetch new downloads offline).
- **On-device collection** — a 4th **Library segment "Downloaded"**: album-grouped tiles (via `groupDownloadsByAlbum`/`recordsToTracks`), a **Play all / Shuffle all** header (reuse `ActionBar`/`session`), an in-flight **active-download strip** (progress), total size, per-album **Remove**. Playable like a collection.
- **Offline mode** — an app-wide **Offline banner** (netinfo+probe driven) exposed via the store (`connectivity: "online"|"offline"`); server-dependent surfaces show friendly offline empty-states (Search, un-downloaded album rows dimmed/disabled), and Download/last.fm (similar/bio/radio) actions hide/disable offline. The Downloaded segment + playing downloaded tracks keep working.
- **Storage settings** (Settings → Downloads) — Original↔AAC mode + AAC bitrate (`TRANSCODE_BITRATES`), total downloads size, **Remove all**. Validated (mode ∈ {original,aac}, bitrate ∈ TRANSCODE_BITRATES).

## Core changes (complete list)

1. Promote `downloaded-records.ts` + `downloaded-set.ts` to `packages/core/src/logic/` (+ their tests); barrel-export; desktop re-points its imports to `@musex/core`. (`download-plan`/`download-state`/`offline-availability`/`transcode-url` already in core — no change.)

## Mobile additions

- `src/downloads/{download-store,download-index,download-manager,connectivity-monitor}.ts` (+ tests for the manager + monitor + index).
- Store wiring: construct + expose the download manager/index + `connectivity`; `downloadTracks`/`downloadAlbum`/`downloadArtist`/`removeDownload`/`downloadedTracks`/`downloadsList`; reconcile on bootstrap (drop 0-byte). Wire the connectivity state into the UI.
- Stream resolver: local-`file://`-first branch when a track is downloaded.
- UI: Library **Downloaded** segment; **Settings → Downloads** pane (storage quality + size + remove-all) + a link row; `TrackActionSheet` Download/Remove row; album/artist Download action; the app-wide **Offline banner**; offline degradation across Search + album rows + online-only actions.
- Storage-quality config persisted (async-storage); downloads index persisted (async-storage); files in expo-file-system document dir.

## Dependencies

- `expo-file-system` (download + read/write/append files; verify the SDK-56 API — new `File`/`Directory` vs legacy) — native → **dev-client rebuild**.
- `@react-native-community/netinfo` (connectivity) — native → dev-client rebuild.

## Testing

- **Core:** promoted `downloaded-records`/`downloaded-set` keep their tests (run in core). (`download-*`/`offline-availability`/`transcode-url` already tested.)
- **Mobile:** `DownloadManager` with fake `fetch` + a fake filesystem — original (single download + validation) and AAC (HLS-stitch: master→media→segments→ENDLIST gate→stitched file; fail without ENDLIST). `ConnectivityMonitor` decisions (debounce threshold; PlexAuthError ≠ offline). `DownloadIndex` round-trip + reconcile. Stream-resolver local-first branch.
- **Verification bar:** full `pnpm check` green before every commit; controller re-runs before push.
- **On-device acceptance (user):** download a track/album (Original + AAC); play it offline (airplane mode); the Downloaded segment browses/plays; un-downloaded tracks degrade; the offline banner appears/clears; storage settings + Remove all work. Requires a dev-client rebuild (native deps).

## Non-goals / deferred

- Full cached-library offline browse (Artists/Albums/Tracks without a connection) — needs a mobile list cache; own follow-up.
- Background downloading while the app is closed/suspended (iOS background-transfer complexity) — downloads run while the app is foregrounded.
- Offline scrobble queue (last.fm scrobbles are best-effort online).
- A media (LRU) cache distinct from pinned downloads — desktop has both; mobile Phase C ships pinned downloads only.

## Success criteria

- `downloaded-records`/`downloaded-set` live in core; desktop consumes them (no behavior change).
- Mobile: download tracks/albums/artists (Original or AAC), play them offline, browse the Downloaded collection, remove downloads; an offline banner + graceful degradation; Settings → Downloads storage controls.
- New adapters + the manager/monitor/resolver branch unit-tested; `pnpm check` green.
