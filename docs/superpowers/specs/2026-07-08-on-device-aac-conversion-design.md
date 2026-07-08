# On-device AAC conversion — transparent background library sync

**Date:** 2026-07-08
**Status:** Approved (user: "we should build it then… I want it to trickle in while it can"). Builds on Downloads v2 (#103/#105) + the AAC routing fix (PR #107 — this branch is stacked on it).
**Problem:** AAC downloads depend on Plex HLS transcode sessions, which the PMS reaps ~1–2s after the transcoder finishes unconsumed (field-proven with live probes). Any scheme that asks the server to transcode therefore needs a live, fast-fetching process — so AAC sync only progresses foregrounded or while playing. The user wants sync to be **transparent**: enable it, charge the phone, the library trickles in.

## The idea — flip who transcodes

Stop asking Plex. For AAC-mode downloads (native engine available):

1. **Download the ORIGINAL file** via the native background engine — plain single-file GETs, the path that already drains unattended (suspended or killed; resumeData; delivered-size integrity). This is the slow part, and it is now fully transparent.
2. **Convert to AAC on the phone** with the hardware encoder (AVFoundation), in a small native conversion queue that drains during ANY execution: foreground, and the ~30s wake window each completed background download already produces. Convert → keep the `.m4a`, delete the temp original. Hardware AAC runs many× realtime at near-zero battery.
3. **No Plex transcode session exists at any point** — the reaping problem is eliminated, not worked around.

Expectation set by the user: NOT instant in background — a trickle. Mechanically: downloads proceed continuously; conversions batch in each wake window (a window comfortably converts more tracks than one download delivers, so the backlog stays near zero in steady state; any leftovers drain on next execution).

## Design

### Transfer mode `"convert"`
- `TransferJob.mode` gains `"convert"`: `url` = the original-file URL (same as `"original"`), plus `targetBitrateKbps`. Core `buildTransferJob` emits it when asked (a new `opts.convert: boolean`); the MANAGER decides when to ask (core stays capability-blind).
- **Routing rule (manager/router):** quality mode `aac` + native engine available + **not on cellular** → `"convert"` (native). Quality `aac` on cellular, or no native module (Expo Go) → `"hls"` via the JS engine (today's behavior — server transcode, ~3× less data). Quality `original` → unchanged. Cellular detection via the existing NetInfo subscription (connectivity monitor exposes the connection type).
- Rationale for the cellular carve-out: the convert path pulls the original (~3× the bytes of the AAC). On WiFi/LAN — where a library sync belongs — that's irrelevant; on cellular it isn't.

### Native side (`modules/background-downloads`)
- `"convert"` jobs download exactly like `"original"` but land at `destPath + ".orig"` (temp), then enqueue a **conversion**: persisted conversion backlog (same JSON state file), drained serially by an `AVAssetExportSession`/`AVAudioConverter` pipeline (AAC-LC at `targetBitrateKbps`, `.m4a` output) wrapped in `beginBackgroundTask` so a wake window can finish the in-flight conversion cleanly.
- Conversion completion: verify the output is non-empty and the asset is readable → move to `destPath` → delete `.orig` → emit `onComplete { key, bytes: <m4a size> }` (delivered-size-authoritative, as everywhere). Conversion failure → retry once → terminal `onError` (+ delete both files).
- The record stays `downloading` until conversion completes (a pending `.orig` is not the artifact). `reattach()`/the persisted backlog treat downloaded-but-unconverted jobs as active; a relaunch resumes conversion without re-downloading (the `.orig` is kept and re-verified by size against the download's delivered bytes).
- Original download integrity unchanged (truncation guard vs catalog size on the `.orig`).

### Record/model touches
- On convert-complete, the manager patches the record's media meta to the actual artifact (`container: "m4a"`, `audioCodec: "aac"`, drop the original's bitrate in favor of the target) so `recordToTrack` reconstructs truthfully. `format` stays `"aac"`.
- Existing MPEG-TS-stitched files from the HLS path remain valid and playable; no migration.
- Storage quality settings unchanged (`TRANSCODE_BITRATES` reused as the conversion bitrate).

### What this does NOT change
- Original-quality downloads, the JS engine, desktop, the HLS code paths (JS engine keeps HLS for cellular/Expo Go; the unrouted Swift HLS chain stays parked).
- No `BGTaskScheduler` in this arc (a `BGProcessingTask` "bonus window" leg could be added later on top of the same conversion queue if wake-window drainage ever proves insufficient — the design leaves that door open, but the wake-window math says it won't be needed).

## Testing
- Core: `buildTransferJob` convert-mode emission; routing decision (pure fn over `{quality, nativeAvailable, connectionType}` → mode — extract it so it's unit-testable).
- Mobile JS: manager/router tests for the new mode (fake engines); record-meta patch on complete.
- Swift: compiles via prebuild/xcodebuild locally + CI `build-ios`; conversion correctness only provable on-device.
- **On-device acceptance (user):** enable sync on WiFi, background the app (no music playing), watch tracks trickle in over an hour; kill the app, confirm continued progress; play converted tracks (m4a) offline; a cellular sanity check that AAC downloads still use the server-transcode path.

## Success criteria
Sync enabled + phone idle on charger (app backgrounded/killed, nothing playing) → downloaded-track count and disk size grow unattended on WiFi; converted files play; `pnpm check` + `build-ios` green; no Plex transcode sessions created by the convert path (verifiable in PMS dashboard).
