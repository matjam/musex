# iOS Downloads v2 — background, resume, integrity, progress

**Date:** 2026-06-21
**Status:** Approved (approach A chosen by user); first sub-project of the iOS polish arc (Downloads v2 → CarPlay → iPad).
**Builds on:** the Phase C downloads system (PR #56), library sync (#98/#99), play-caching (#100), and the spike `docs/superpowers/spikes/2026-06-20-ios-native-background-sync-spike.md` (native background-URLSession module — proposed there, built here).

## Problem (all four confirmed by the user, verified in code)

1. **Downloads stall when the app backgrounds.** AAC (the iOS default since #98) is HLS-stitched in JavaScript — iOS freezes JS when the app isn't active (unless audio is playing), so the stitch stops mid-file. Original rides a background-capable `File.createDownloadTask`, but the queue loop is JS — the current file finishes, the next never starts.
2. **Downloads don't continue after kill/relaunch.** #99's `resolveStaleInFlight` recovers the *bookkeeping* on next foreground, but nothing downloads until the user reopens the app.
3. **Partial/corrupt files.** There is no integrity verification anywhere: no expected size, no completeness check beyond "the task returned". Commit = move `.part` into place.
4. **No progress visibility.** Per-track bytes exist internally but there's no `expectedBytes` and no per-container aggregation; the UI can only show "Downloading N tracks…" and an aggregate byte total.

## Approach (decided: A)

A native Swift background-download module owns all transfers via a background `URLSession`; JS/core keeps deciding *what* to download. Rejected: B (community `react-native-background-downloader` — can't do HLS stitching, so the default AAC mode stays broken) and C (BGProcessingTask — discretionary windows, not "keeps downloading when I switch apps now").

## Architecture

### 1. TransferEngine seam (mobile)

`DownloadManager` remains the orchestrator — queue policy, origin semantics (`manual`/`sync`/`cache`), dedupe, quality selection — but transfer execution moves behind an interface:

```ts
interface TransferEngine {
  submit(jobs: TransferJob[]): Promise<void>;   // hand jobs to the engine (idempotent per key)
  cancel(keys: string[]): Promise<void>;
  reattach(): Promise<TransferSnapshot>;        // on launch: engine's current state (active/completed/failed while JS was away)
  onEvent(cb: (e: TransferEvent) => void): () => void;
}
```

- **`NativeTransferEngine`** wraps the new `modules/background-downloads` module (iOS dev-client/production builds).
- **`JsTransferEngine`** wraps today's fetch/stitch code (kept for Expo Go, the simulator without the module, and as the reference implementation for tests).
- **`RoutingTransferEngine` (added 2026-07-08 — the AAC fallback contract INVOKED, see Delivery):** when the native module is present, transfers are routed **by job mode**: `mode:"hls"` (AAC) → the JS engine (foreground), `mode:"original"` → the native background engine. Field debugging on-device proved PMS **reaps an AAC/HLS transcode session within ~1-2s of the transcoder finishing unconsumed**, and a **same-client second `start` request 400s** — so the native engine's chained background tasks (seconds apart by design, one URLSession task per delegate step) always 404'd at the media playlist ("hls media http 404"), while the JS engine's back-to-back fetches consume the playlists inside the window. Unstopped sessions also saturate the server, so prompt consumption + the stop-session fire matter. The router reports `ownsQueue: true` (the manager batch-submits; the JS engine's internal FIFO makes fire-and-forget submission safe), fans `cancel` to both engines (each ignores unknown keys), merges both `reattach` snapshots (JS side always empty), and fans event subscriptions in. JS-side HLS jobs die with the app; their records are recovered on relaunch by `resolveStaleInFlight` (not in the merged `active` set → dropped, next sync re-queues). **Future option (later spike):** native HLS could work by running the playlist + segment fetches as immediate data-tasks inside delegate wake windows instead of chained background tasks.
- Selection: native module loads (`requireNativeModule` try/catch, same pattern as `lock-screen-commands`) → `RoutingTransferEngine({ hls: js, original: native })`; module absent → plain JS engine.
- `TransferJob` carries everything the native side needs to run unattended: `{ key, mode: "original" | "hls", url, headers, destPath, expectedBytes?, stopUrl? }`. Pure type; lives in core (`logic/transfer-job.ts`) since desktop may adopt the same shape later.

### 2. Native module `modules/background-downloads` (Swift, `platforms: ["apple"]`)

Same local-Expo-module pattern as `lock-screen-commands` (expo-module.config.json + podspec + Swift; JS wrapper no-ops when the native binary is absent).

- **One background `URLSession`** (`URLSessionConfiguration.background(withIdentifier: "net.stupendous.musex.downloads")`, `sessionSendsLaunchEvents = true`, `isDiscretionary = false`).
- **Persisted backlog:** JS submits the full queue as job descriptors; the module persists them (JSON in Application Support) and keeps a small window of URLSession tasks scheduled (**concurrency 1** — parity with the deliberate "gentle alongside live streaming" policy), refilling from the backlog *inside the delegate*. The whole batch therefore drains while the app is suspended **or killed**: iOS relaunches the app in the background when session events arrive.
- **App relaunch wiring:** an `ExpoAppDelegateSubscriber` implements `application(_:handleEventsForBackgroundURLSession:completionHandler:)` — recreates the session, lets the delegate continue chaining/refilling, calls the completion handler when idle. No hand-edits to the generated AppDelegate (survives `expo prebuild`).
- **Original jobs:** one `URLSessionDownloadTask` per track. Completion → verify size (see Integrity) → move the temp file to `destPath` → emit `onComplete`. Failure → capture `resumeData` when available, persist it, retry with `earliestBeginDate` backoff (bounded attempts); terminal → emit `onError`.
- **HLS (AAC) jobs [BUILT but NOT ROUTED TO since 2026-07-08 — PMS session reaping defeats it; see `RoutingTransferEngine` above]:** delegate-chained. Data-task the master + media playlists, then download segments one at a time; each completed segment's bytes are appended to `destPath + ".part"` *in the delegate* (no long-running loop — this is the spike's constraint #2). A 404 (Plex hasn't transcoded that segment yet) re-enqueues the same segment with `earliestBeginDate` backoff (bounded, mirroring the JS engine's segment-retry policy — now 180×700ms ≈ 2 min in JS: long tracks' deep segments outlived the old 60×700ms budget because Plex paces the transcoder). Per-job progress (segment index, bytes) is persisted, so a kill resumes mid-file at segment granularity. ENDLIST + all segments appended → move `.part` → dest, emit `onComplete`, best-effort fire the Plex `stopSessionUrl`. **Known gap (harmless while HLS doesn't route here): the Swift manager fires `stopUrl` only on success paths (`finalizeHls`/already-committed); `failTerminal` never fires it, so a terminal native HLS failure would leave the transcode session to PMS's own reaper.**
- **Events to JS:** throttled `onProgress { key, bytes, expectedBytes?, segmentsDone?, segmentsTotal? }`, `onComplete { key, bytes }`, `onError { key, message, terminal }`. `reattach()` returns `{ active: [...], completed: [...], failed: [...] }` accumulated while JS was away; the store folds that into the `DownloadIndex` on bootstrap (extending the existing `resolveStaleInFlight` pass).
- **Cancellation:** `cancel(keys)` removes backlog entries + cancels live tasks + deletes `.part` files. Used by remove-download, sync removals, and quality-mode changes (a mode change invalidates queued jobs' URLs).

### 3. Integrity (core + both engines)

- **`Track.media.sizeBytes?`** — mapped from Plex's part `size` attribute in BOTH mappers (desktop `to*Safe` in `plex-gateway.ts`, mobile `plex-parse.ts`) per the four-times-bitten model-field rule. **List-cache schema bumps: desktop v6→v7, mobile m1→m2** (mapped shape changed).
- **`DownloadRecord.expectedBytes?`** — while queued/downloading it holds the catalog estimate (`sizeBytes`, Original jobs only; pinned once at enqueue). On the terminal complete the manager overwrites it with the ACTUAL delivered byte size — for BOTH Original and AAC — which becomes the authoritative value reconcile verifies against.
- **Commit rule (both engines):** Original — the catalog `expectedBytes` is a **truncation guard only**: a delivery **smaller** than it fails (file removed, retried); a delivery equal to or **differing above** it is accepted with a logged warning — the **delivered size wins**. (The Plex catalog can drift from the file actually served; rejecting any difference caused an infinite download→fail→delete→re-queue loop via library sync.) AAC — ENDLIST seen + every segment appended (segment count is the completeness proof).
- **Reconcile:** the bootstrap reconcile compares each `downloaded` record's actual on-disk size (store gains `presentFileSizes(): Map<key, bytes>` beside `presentNonEmptyKeys()`) against its committed-actual `expectedBytes`; mismatch → demote to `missing`, which the next sync pass re-queues. Because the committed value is the delivered size, catalog drift can never demote a good file. (Records committed before v2 have no `expectedBytes` → presence + non-empty remains their reconcile check, as today.)
- **Stale in-flight resolution is size-gated:** a record left `queued`/`downloading` by a previous run is promoted to `downloaded` only when its file's on-disk size matches the record's `expectedBytes` (or the record has none) — promotion stamps `bytes`/`expectedBytes` with the actual size; a present-but-mismatched file is a partial (record dropped, file deleted); absent → dropped. Mere file presence never promotes.
- **Residual caveat (deliberate, logged):** a file that SHRANK on the Plex server after its last scan under-delivers vs the catalog and will fail + retry on every sync trigger until Plex rescans it. Accepting under-delivery instead would record truncated files as good, which is worse.
- **No checksums** — Plex does not expose a content hash for media parts; exact size is the strongest available truth for Original, segment-completeness for AAC. Explicit non-goal.

### 4. Progress (core aggregation, UI rendering)

- **Core:** pure `downloadProgress(records, keys)` (`logic/download-progress.ts`) — given the index's records and a container's track keys, returns `{ done, total, inFlight, failed, bytes, expectedBytes: number | null, fraction: number | null, state: "none" | "downloading" | "partial" | "complete" }`. `fraction` blends bytes when expectedBytes is known and falls back to done/total counts otherwise (AAC). Complements the existing `groupDownloadsByAlbum`.
- **Feeding it:** engine `onProgress` events update `DownloadRecord.bytes` (+ the new segment fields) through the existing debounced index write + throttled `downloadsVersion` bump — aggregates move live with no new reactivity machinery.
- **UI (four surfaces):**
  1. **Library → Downloaded segment:** the header strip becomes a real progress bar (`n/total tracks · X of Y` when bytes are known); album tiles show a small progress ring/badge while any of their tracks are in flight.
  2. **Album / artist / playlist screens:** a thin progress bar under the ActionBar while that container has in-flight downloads (`downloadProgress` keyed by the screen's track keys).
  3. **Settings → Downloads:** an active-downloads list (track title, per-track progress) above the existing totals.
  4. **TrackActionSheet:** a "Downloading…" state distinct from downloaded/not.

### 5. Permissions / config / build

- **No new `UIBackgroundModes`** — background `URLSession` transfers + delegate relaunch need no background-mode entry (BGTaskScheduler would, and we don't use it). `app.json` is untouched (it's externally managed by EAS/release-please; avoiding churn there is a feature).
- Native module → **dev-client rebuild** (`expo prebuild` + `expo run:ios` / EAS build). CI `build-ios` compiles the Swift (catches compile errors); behavioral validation is on-device.

### 6. What changes where

- **core:** `sizeBytes` on the media model; `expectedBytes` (+ segment fields) on `DownloadRecord`; `TransferJob` types; `downloadProgress`; the size-aware reconcile. All pure, all unit-tested.
- **mobile:** the Swift module; `NativeTransferEngine`/`JsTransferEngine` + selection; `DownloadManager` refactor to the seam (behavior-identical when JS engine is active); store wiring (reattach on bootstrap, events → index, cancel on mode change); the four progress UI surfaces; `DownloadStore.presentFileSizes`.
- **desktop:** the `sizeBytes` mapper + list-cache v7 bump only. No behavior change (desktop adopting expectedBytes verification is a possible follow-up, out of scope).

## Delivery — two shippable PRs

1. **PR 1 (foreground-correct v2):** core model + integrity + progress aggregator + reconcile healing + the TransferEngine seam with `JsTransferEngine` + all progress UI. Everything works today, still foreground-bound; behavior-identical transfers.
2. **PR 2 (background engine):** the Swift module + `NativeTransferEngine`, Original path first, then AAC delegate-chaining (the spike's sequencing). Ends with the on-device measurement: if AAC-in-background throughput is unacceptable (excessive wake cycles / crawl), the shipped contract degrades to "Original = fully unattended background; AAC = progresses while foregrounded or playing, resumes perfectly" — user decides after seeing it run.
   **→ Contract INVOKED (2026-07-08), for correctness rather than throughput:** field evidence showed native AAC never completes at all — PMS reaps the transcode session ~1-2s after the transcoder finishes unconsumed and 400s a same-client re-start, so the seconds-apart chained background tasks 404 at the media playlist every time (and every attempt leaves an unstopped session saturating the server). Shipped shape = `RoutingTransferEngine`: **AAC = JS engine, foreground (or while audio plays), perfect resume via `resolveStaleInFlight` + sync re-queue; Original = native, fully unattended background.**

## Testing

- **Core:** unit tests for `downloadProgress` (counts, bytes-blend, AAC fallback, empty), size-aware reconcile (mismatch → missing; AAC unaffected), `TransferJob` construction.
- **Mobile JS:** `DownloadManager`-over-seam tests with a fake engine (submit/cancel/reattach/event folding); `JsTransferEngine` keeps the existing manager test coverage; `NativeTransferEngine` tested against a fake native module (event mapping, snapshot folding).
- **Swift:** compiled by CI `build-ios`; no unit harness (Expo local modules).
- **On-device acceptance (user):** start a large sync → background the app → tracks keep landing; force-kill → downloads continue, app relaunches in background; airplane mode mid-file → later resumes without restarting the file; interrupted downloads never show as downloaded (integrity); progress bars move live on all four surfaces; partials committed under v2+ get detected and re-queued on the next launch (pre-v2 records carry no expectedBytes, so only presence/non-empty checks apply to them).

## Non-goals

- Android background downloads (Android arrives later; the seam + core types are ready for it).
- Checksum verification (no hash available from Plex).
- Changing sync/cache/eviction semantics, quality defaults, or the concurrency-1 politeness policy.
- Gapless playback, CarPlay, iPad (later sub-projects of this arc).

## Success criteria

- All four symptoms gone on-device: background continuation (suspended AND killed), automatic resume from where it left off, zero partials recorded as downloaded (v2+ records are size-verified on boot; pre-v2 records lack expectedBytes and keep presence-only checks), and live per-container progress on the four surfaces.
- `pnpm check` green; desktop behavior unchanged (mapper-only diff); JS-engine path behavior-identical for non-native environments.
