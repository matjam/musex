# Spike: native iOS background download for library sync (AAC)

**Date:** 2026-06-20
**Status:** proposed — needs on-device validation (cannot be tested from the dev env / CI; iOS background behavior only manifests on a real device).

## Problem

While "sync entire library" is on, downloads should continue when the app is
backgrounded or the screen is locked. Today they don't, for AAC:

- **AAC** downloads transcode via Plex **HLS** — a `.m3u8` playlist + many `.ts`
  segments fetched and **stitched in JavaScript**. iOS **suspends JavaScript**
  the moment the app isn't active (unless audio is playing), so the stitch stops.
- **Original** downloads are a **single file** handed to `expo-file-system`'s
  download task, which defaults to a **background `URLSession`** — iOS keeps that
  transfer running while suspended. So Original already backgrounds the *current*
  file, but the JS download loop is sequential (one track at a time), so the
  *next* track doesn't start until the app is awake again.

## Why native Swift

A background `URLSession` (`URLSessionConfiguration.background(withIdentifier:)`)
is the only iOS mechanism that continues transfers while the app is suspended and
**wakes the app's session delegate** on completion. That delegate is native
(Swift) — it runs even when JS is frozen. The app already ships local Swift Expo
modules (`modules/lock-screen-commands/`), so a `modules/library-sync-downloader`
module fits the existing pattern.

## Proposed module shape

`modules/library-sync-downloader` (Swift, `platforms: ["apple"]`):

- `enqueue(jobs: [{ trackId, key, startUrl, headers, destPath, mode }])`
- Maintains a background `URLSession`; downloads each job, emits
  `onProgress` / `onComplete` / `onError` JS events.
- **Original mode:** one background download task per track → dest file. Trivial,
  reliable, unattended. Hand iOS the whole batch at once (vs today's sequential JS).
- **AAC mode:** the hard part (below).

JS side: `src/adapters/native-downloader.ts` wraps it, no-ops when the native
module is absent (Expo Go / vitest), same as `lock-screen-commands`. The
`DownloadManager` delegates to it instead of the JS fetch/stitch when present.

## The two unknowns to validate on-device (the spike)

1. **Plex serves AAC HLS segments on-demand** — a segment 404s until the
   transcoder produces it (that's why the JS loop retries with backoff). A
   background `URLSession` downloads a *fixed* URL list and does **not** run
   app-logic retries while suspended. Validate one of:
   - (a) Drive segment fetches from the session delegate's wake windows
     (download segment N, on completion enqueue N+1; 404 → re-enqueue after a
     delay). Works but slow + many wake cycles — measure throughput.
   - (b) Whether Plex can be asked to **pre-produce** the whole transcode so all
     segments are immediately downloadable (then a fixed-list background batch
     works). Test against a real PMS.
2. **iOS background *logic* budget** — arbitrary Swift between transfers gets only
   seconds–minutes (`beginBackgroundTask`); only the `URLSession` *transfer* is
   unlimited. The segment **concatenation** must ride the delegate callbacks
   (append each downloaded segment to the output file in the delegate), not a
   long-running loop. Validate that appending in the delegate keeps up.

## Recommendation / sequencing

1. **Done first (this PR):** make the foreground experience correct — incremental
   visibility (debounced index writes + reactive `downloadsVersion`), resume an
   interrupted sync without re-downloading, no AsyncStorage storm. This is needed
   regardless of background.
2. **Spike next:** prototype the native module for **Original** first (low-risk,
   immediate unattended-background win), measuring whether to also batch many
   tasks to iOS at once. Then attempt **AAC** path (a) and measure throughput +
   wake-cycle behavior on a device.
3. Decide from the spike data whether AAC-in-background is worth the complexity or
   whether "Original = background, AAC = foreground/while-playing" is the shipped
   contract.

**Hard constraint to keep in mind:** "fits on a phone (AAC)" and "downloads the
whole library unattended in the background" pull against each other on iOS; the
spike is about how close native code can get, not a guarantee it fully closes the
gap.
