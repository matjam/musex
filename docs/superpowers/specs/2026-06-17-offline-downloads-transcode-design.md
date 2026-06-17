# Offline + Local Downloads + Transcoded Storage — Design

**Date:** 2026-06-17
**Status:** Approved-in-conversation as ONE combined feature, **desktop only** (Electron). Mobile is a later follow-up with its own adapters/spec.
**Branch:** `feature/offline-downloads-transcode` (one musex PR; internal clusters in order — see Decomposition).

## Goal

Let the user **download** tracks / albums / artists to the device as pinned, guaranteed-present copies (distinct from the LRU media cache), **work seamlessly while disconnected** from Plex (browse what's local + cached metadata, with a single red "Offline" marker and friendly messaging for online-only actions), and optionally **transcode stored copies** to **MP3 at a user-chosen bitrate** (e.g. 256k) to trade quality for space. As part of this, the existing acquisition "Downloads" view is **repurposed into a badge + filter** so its sidebar slot can host the new offline home base.

## The three capabilities + the rework

1. **Pinned downloads** — user downloads tracks/albums/artists; files are pinned (never LRU-evicted), recorded in an authoritative index with a metadata snapshot, and playable offline.
2. **Seamless offline** — Plex unreachable → the app keeps working: downloaded + media-cached audio plays, cached metadata browses, a small red "Offline" pill shows top-right, un-downloaded/un-cached items are dimmed, and online-only actions degrade with a friendly message. Stay-in-place (no forced navigation).
3. **Transcoded storage** — a global Settings choice (Original ↔ **MP3 at a selectable bitrate**) governs what gets written to disk for **both downloads and the media cache**. The first live listen always streams the original; only the stored copy is affected. Delivery confirmed by spike — see *Transcode — confirmed by spike*.
4. **Acquisition rework** — the dedicated "Downloads" (acquisition/Lidarr/taste-expansion/watched) view stops being a top-level destination; acquisition status becomes an **amber "Acquiring" badge** on items plus an **"Acquiring" filter view**; its sidebar slot is taken by the new **"On this device"** destination.

## Decisions locked in brainstorming

- **Combined, desktop-only.**
- **Separate downloads store** (`userData/downloads/`) + a downloads **index**; downloaded tracks **bypass the LRU cache entirely** (never double-stored; prefetch skips them). Proxy serve order becomes **downloads → media cache → upstream**.
- **Badge language:** green ✓ = downloaded (pinned, offline-playable); amber ⧗ = acquiring (plugin); blue ring + % = downloading. On both cards and track rows.
- **Filter:** a sidebar **"On this device"** destination (the offline home base, replaces the old Downloads slot) **plus** an in-view **All · Downloaded · Acquiring** segmented toggle in library views.
- **Offline browse:** **stay where you are, degrade gracefully.** To make full-library browse work offline, **start caching the top-level artists list** (validated by the library `updatedAt`/`scannedAt` the staleness fix already refreshes) — the one list not cached today.
- **Offline playability rule:** a track is full-color & playable offline iff it is **downloaded ∪ media-cached**; otherwise dimmed with a "reconnect to play" hint. Applies to album cards **and** track rows.
- **Transcode (spike done — see below):** **MP3 only**, single-file via `start.mp3?protocol=http`; bitrate via `musicBitrate` (VBR ceiling); selectable 128/192/256/320. Non-MP3 codecs come from Plex only as HLS segments, so they're out of scope (would need segment-stitching).
- **Settings:** one consolidated **Library → "Downloads & Storage"** pane (storage quality + downloads size/remove + existing media-cache controls).

## Transcode — confirmed by spike (2026-06-17)

A throwaway env-gated spike against a real PMS (since removed) established:

- **Single-file delivery:** `GET {base}/audio/:/transcode/universal/start.mp3?…&protocol=http&directPlay=0&directStream=0&audioCodec=mp3` returns one continuous MP3 (`Content-Type: audio/mpeg`, chunked, no Content-Length, no Range support). Read to EOF and save. **No HLS, no segment stitching.**
- **Bitrate control:** the `musicBitrate=<kbps>` query param. Output is **VBR** with that value as a quality ceiling, so the file lands at or below nominal depending on content (decision endpoint reported 128→121, 256→243, 320→304 kbps; a sparse track's actual file can average well under the ceiling — expected). Offer **128 / 192 / 256 / 320**.
- **Codec: MP3 only.** The `audioCodec` query param is ignored; the target codec is driven by the client profile, and the single-file HTTP path only ever yields MP3 — aac/opus/vorbis/flac/alac/pcm all fell back to MP3. Non-MP3 codecs are delivered by Plex only via HLS/DASH segments, so supporting them would require the segment-stitching path we ruled out. Out of scope.
- **Session lifecycle:** Plex serializes transcode sessions — rapid back-to-back `start`s 400. Use a fresh session id per download, download sequentially (concurrency 1, which the queue already does), and call `/audio/:/transcode/universal/stop?session=<id>` when each file completes.
- **Decision endpoint:** `/audio/:/transcode/universal/decision` (same params) returns the would-be codec/bitrate **without** starting a session — useful for a pre-flight check if ever needed.
- **Playback:** the saved MP3 plays through the existing proxy→mpv path unchanged (mpv decodes it); the first *live* listen still direct-plays the original.

## Architecture

Hexagonal as always: pure decision logic in `@musex/core`; Electron-main adapters for the stores, the downloader, and connectivity; renderer is UI only and learns availability/connectivity over typed IPC.

### Core (`@musex/core`, pure, tested)

- **`logic/download-plan.ts`** — expand a download request (track | album | artist) into a concrete list of track download jobs; dedupe against what's already downloaded/in-flight.
- **`logic/offline-availability.ts`** — given a track's local state (downloaded? cached?) and connectivity, decide its UI state: `playable` | `dimmed-offline` | `playable-online`. Pure, drives the dimming.
- **`logic/transcode-url.ts`** — pure, tested builder for the confirmed single-file MP3 URL: `/audio/:/transcode/universal/start.mp3` with `protocol=http`, `directPlay=0`, `directStream=0`, `audioCodec=mp3`, `musicBitrate=<kbps>`, `path=/library/metadata/<id>`, `mediaIndex/partIndex/offset=0`, a fresh session id, and the X-Plex client-identity params (token injected by the proxy/main, never the renderer). A matching `stopSessionUrl(session)` builder for teardown.
- **`logic/download-state.ts`** — the `DownloadRecord` state machine (`queued → downloading → downloaded | failed`, plus `removing`) and index reconciliation rules (orphaned files, partials, settings-change format mismatch).
- **Models:** extend the domain so a `Track`/`Album`/`Artist` can carry an optional `local?: { state, format? }` availability hint (populated host-side; core stays pure). New `DownloadRecord`, `DownloadProfile`, `Connectivity` types + port interfaces.
- **Ports:** `DownloadStore` (put/has/path/remove/list/bytes), `Downloader` use-case orchestration is core; `ConnectivitySource` (observe reachability).

### Main (Electron) adapters

- **`main/adapters/download-store.ts`** — `userData/downloads/`; shares a small base with `MediaCache` (atomic `.part` → rename, Range/206 serve). Files keyed `SHA256(serverId:plexPath)` (same scheme; a downloaded file's format is recorded in the index, not the key). **Owner-writable** (auto-update constraint).
- **`main/adapters/download-index.ts`** — persists `DownloadRecord[]` (electron-store `downloads`): `{ trackKey, serverId, plexPath, format, state, bytes, addedAt, metaSnapshot }`. `metaSnapshot` = enough to browse offline (artist/album/title/index/duration/art plexPath/genres). The index is the **authoritative offline-browse source** for downloaded content.
- **`main/download/download-manager.ts`** — the coordinator: a **sequential** queue (concurrency 1, politeness — same rationale as prefetch), per-track fetch (original part URL, or the transcode strategy when the profile says so), write-through to `DownloadStore`, progress + state events pushed to the renderer (`musex:downloads:progress`), retry is bounded + user-initiated on failure (no silent infinite retry). `will-quit` → graceful stop; resume queued on next launch.
- **`main/adapters/connectivity-monitor.ts`** — single source of truth for Plex reachability. Combines: outcomes of real gateway calls (success → online, transient network failure → offline), the `LibraryWatcher` websocket state, and a lightweight periodic probe (`server.query("/")` with a short timeout) when idle. Debounced (don't flap on one blip). Emits `musex:connectivity:changed { online }`. `PlexAuthError` is **not** "offline" — it still routes to sign-in.
- **`StreamProxy` changes** — `resolve()`/serve: check `DownloadStore` first → serve local file (always, regardless of connectivity or cache setting); else media cache; else upstream. When offline and a track is neither downloaded nor cached, fail fast with a typed "unavailable offline" error (renderer already has the dimmed state). Prefetch + cache write-through **skip** tracks present in `DownloadStore`. Cache write-through and download fetch both consult the **storage-quality profile** to decide original-vs-transcode.
- **`CachingPlexGateway` change** — add caching for the **top-level artists list** (`listArtists` for the library root) with a validator from the library `updatedAt`/`scannedAt`. List-cache schema version bumped if the entry shape changes.
- **Availability IPC** — `getLocalAvailability(serverId, plexPaths[]) → state[]` (downloaded ∪ cached presence) so the renderer can dim. Batched per visible list.
- **Transcode profile** — persisted in the main electron-store (`storageQuality: { mode: "original" | "mp3", bitrateKbps: 128 | 192 | 256 | 320 }`). IPC `musex:storage:getQuality/setQuality`.

### Renderer (UI only)

- **Badges** — a shared component drawing the three badge states on cards + rows, fed by `track.local` / acquisition status.
- **In-view filter** — `All · Downloaded · Acquiring` toggle in library views; offline, defaults to behaving sensibly (un-downloaded dimmed, not hidden — choice A).
- **"On this device" view + sidebar entry** — takes the old Downloads slot. Active/queued downloads strip (progress + cancel) on top; downloaded content browseable Albums/Artists/Tracks (from the index, works offline); total storage; per-item remove + bulk Manage.
- **Offline marker** — a small red "Offline" pill, top-right of the top bar; visible only while disconnected; driven by connectivity state in the app reducer.
- **Graceful degradation** — online-only actions (full search, acquire/monitor, plugin lookups) disabled with a tooltip + the friendly inline message when offline.
- **Download actions** — context menu (album/artist/track) "Download …" / "Remove download"; album & artist header "Download" button with progress→done states.
- **Settings** — "Downloads & Storage" pane under the Library category (storage quality: **Original ↔ MP3** toggle + a bitrate select when MP3; downloads size + remove-all; existing cache enable/size/clear). The pane wiring follows the categorized-settings pattern already in `SettingsView`.

### Acquisition rework specifics

- Remove the **"Downloads" top-level nav entry**; "On this device" takes the slot.
- Acquisition status → amber **"Acquiring" badge** on items + the **"Acquiring" filter**. The filter view preserves the existing acquisition surface that still has value: in-flight acquisitions with provenance ("because you listen to X") and **Not-for-me/reject**, and the **watched-for-new-releases** list. (i.e. the old `DownloadsView` content survives, reached via the filter rather than a dedicated destination — features are **not** deleted, only re-homed.)
- **Open question for spec review:** keep watched-artists + the expansion feed inside the "Acquiring" filter view (proposed), or move watched-artists to Settings → Discovery? Default in this spec: keep them in the Acquiring view (least disruptive).

## Data flow

- **Download:** UI action → `musex:downloads:add(ref)` → `DownloadManager` expands via `download-plan` → enqueue jobs → per job: resolve fetch URL (original/transcode per profile) → stream to `DownloadStore` (`.part` → rename) → update `DownloadIndex` + emit progress → badge / "On this device" update live.
- **Playback (unchanged engine):** `PlaybackSession.resolve(track)` → IPC → `StreamProxy.resolve` → if downloaded, a proxy URL that serves the **local file**; mpv decodes whatever format it is. Offline, downloaded/cached tracks resolve+play identically; others resolve to the unavailable error.
- **Connectivity:** `ConnectivityMonitor` → `musex:connectivity:changed` → reducer `online` flag → marker + degradation + dimming inputs.
- **Offline browse:** library views render from list cache (now incl. artists) + `getLocalAvailability` for dimming; "On this device" renders from the download index (always available).

## Error handling

- **Download failure:** hard-fail the track, log with context, mark `state:"failed"` in the index, surface in the "On this device" active strip with a Retry. **No silent infinite retry**; bounded user-initiated retry only. Partial files use `.part` and are reconciled on launch.
- **Disk full / write error:** stop the queue, mark failed, surface; never corrupt the index.
- **Offline:** gateway/connectivity failures degrade quietly (no error-spam views); the marker explains why; `PlexAuthError` (401/403) still drops to sign-in (offline ≠ unauthenticated).
- **Transcode session serialization:** Plex refuses rapid back-to-back transcode `start`s (spike finding). The download queue is sequential (concurrency 1) and stops each session after a file completes, so this is a non-issue — never fire transcode starts concurrently.
- **Settings-change format mismatch:** existing stored files keep their old format (still playable); only new writes use the new profile; the index records each file's actual format for display.
- No empty `catch {}`; every error path either recovers, surfaces, or logs-and-stops.

## Testing

- **Core (primary):** `download-plan`, `offline-availability`, `transcode-url`, `download-state` reconciliation — unit-tested against fakes (`FakeDownloadStore`, fake connectivity).
- **Adapters:** `DownloadStore` (put/serve/remove/bytes, atomic publish), `DownloadIndex` persistence + reconciliation, `ConnectivityMonitor` (online/offline/auth transitions, debounce) with a fake gateway, `StreamProxy` serve-order (downloads→cache→upstream) + prefetch-skip-downloaded.
- **Renderer:** filter logic, dimming from availability, offline degradation gating — where pure/extractable.
- **Transcode:** `transcode-url` builder unit-tested (pure). Delivery/bitrate/codec were already answered by the (now-removed) spike — findings recorded above.
- `pnpm check` green throughout; full check before every push (local bar = CI bar).

## Decomposition (one PR, internal clusters, in order)

0. **Transcode spike — DONE (2026-06-17).** Findings recorded above; the throwaway probe + credential helper were removed.
1. **Download store + index + manager + core logic** — pinned store, index, sequential downloader, serve-order + prefetch-skip, availability IPC. (Downloads work; no UI yet beyond a temporary trigger in tests.)
2. **Connectivity + offline metadata** — `ConnectivityMonitor`, connectivity IPC + reducer flag, artists-list caching.
3. **UI** — badges, in-view filter, "On this device" view + sidebar swap, offline marker, dimming, graceful degradation, download actions in menus/headers.
4. **Transcode wiring** — `transcode-url` builder + storage-quality profile + Settings pane + download/cache write-path use the confirmed single-file MP3 route + `musicBitrate`.
5. **Acquisition rework** — badge + "Acquiring" filter view; re-home expansion/watched; remove old Downloads nav slot.
6. Full check, CLAUDE.md update, PR.

## Risks

- **Transcode delivery** — RESOLVED by the spike (single-file MP3 via `start.mp3?protocol=http`, `musicBitrate` controls VBR bitrate). No remaining unknown.
- **Connectivity detection flapping** — mitigated by debounce + combining multiple signals; offline ≠ auth-failure.
- **Index/file drift** — reconcile on launch (orphan files, partials, removed-from-Plex).
- **Scope** — large; mitigated by the ordered clusters each keeping `pnpm check` green, mirroring the plugin-arc execution that worked.

## Out of scope

- Mobile (Expo/iOS) downloads + offline — own spec + adapters later (its audio/transcode path differs).
- Auto-downloading future albums for a "downloaded" artist (that's the existing watch-for-new-releases acquisition feature; not extended here).
- Local full-text search offline (online-only message for now; the Downloaded filter + "On this device" cover the offline browse need).
- Per-track/album transcode overrides (the storage-quality setting is global).
