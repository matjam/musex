# On-Device AAC Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AAC library sync trickles in transparently while the app is backgrounded/killed on WiFi — by downloading the ORIGINAL via the unattended native engine and converting to AAC on-device — spec `docs/superpowers/specs/2026-07-08-on-device-aac-conversion-design.md`.

**Architecture:** New `TransferJob` mode `"convert"` (original-file download → native AVFoundation AAC conversion). A pure core `transferModeFor` decides original/convert/hls from quality + native availability + connection type (cellular keeps the server-transcode JS path). The Swift module gains a persisted conversion backlog drained serially inside `beginBackgroundTask` wake windows.

**Tech Stack:** TypeScript core/mobile, Swift + AVFoundation (`AVAssetExportSession` m4a/AAC), @react-native-community/netinfo (connection type), existing background-URLSession module.

## Global Constraints

- Branch `feature/on-device-aac-conversion` (stacked on PR #107's branch — do NOT rebase/merge anything).
- Core stays pure (no Date.now/platform imports); the MANAGER owns capability/connection knowledge, core just decides from inputs.
- Delivered-size-authoritative integrity everywhere: the convert path's terminal `complete` reports the **m4a size**; the `.orig` download keeps the truncation guard vs catalog size.
- Records stay `downloading` until conversion completes; a relaunch must resume conversion **without re-downloading** (persisted backlog + kept `.orig`).
- JS engine/HLS path unchanged (still serves cellular + Expo Go). Original-quality unchanged. Desktop unchanged.
- Per task: biome `--write` on touched files → root `pnpm check` exit 0 → `git add -A` commit → push. Swift tasks additionally: `xcodebuild -workspace packages/mobile/ios/musex.xcworkspace -scheme musex -sdk iphonesimulator -configuration Debug build` → BUILD SUCCEEDED (prebuild + pod install first if `ios/` stale).

---

### Task 1: core — `"convert"` mode + `transferModeFor`

**Files:**
- Modify: `packages/core/src/logic/transfer-job.ts` (+ its test)
- Create: `packages/core/src/logic/transfer-mode.ts` + `transfer-mode.test.ts`
- Modify: `packages/core/src/index.ts` (barrel export, alphabetical)

**Interfaces — Produces:**
```ts
// transfer-job.ts
export interface TransferJob {
  mode: "original" | "hls" | "convert";
  /** convert only — the on-device AAC target bitrate. */
  targetBitrateKbps?: number;
  // …existing fields unchanged; convert uses `url` = the original-file URL,
  // headers {}, expectedBytes = catalog size (truncation guard on the .orig).
}
// buildTransferJob opts gains `convert?: boolean` — when true AND quality.mode==="aac",
// emit mode:"convert" with the ORIGINAL-file url (same construction as mode:"original")
// + targetBitrateKbps: quality.bitrateKbps + expectedBytes; no stopUrl, headers {}.
// convert:false/undefined behaves exactly as today.

// transfer-mode.ts
export type ConnectionType = "wifi" | "cellular" | "other" | "none";
export function transferModeFor(i: {
  qualityMode: "original" | "aac";
  nativeConvertAvailable: boolean;
  connectionType: ConnectionType;
}): "original" | "hls" | "convert";
// original → "original". aac + nativeConvertAvailable + connectionType !== "cellular" → "convert".
// aac otherwise → "hls". ("other"/"none" count as non-cellular: wired/unknown ≈ wifi;
// offline enqueues just wait — the engine retries.)
```

- [x] **Step 1 — failing tests:** transfer-mode table test (original always; aac+native+wifi→convert; aac+native+cellular→hls; aac+no-native→hls; aac+native+other→convert). buildTransferJob convert case: url equals the mode:"original" url for the same job, `mode:"convert"`, `targetBitrateKbps: 256` from quality, expectedBytes passthrough, no stopUrl.
- [x] **Step 2 — implement + barrel.** `pnpm check` → 0. Commit `feat(core): convert transfer mode + transferModeFor routing decision`, push.

### Task 2: connection type through the ConnectivityMonitor

**Files:**
- Modify: `packages/mobile/src/downloads/connectivity-monitor.ts` (+ test)
- Modify: `packages/mobile/src/state/store.tsx` (NetInfo wiring ~line 337)

**Interfaces — Produces:** `ConnectivityDeps.subscribe` callback gains `type?: string` (NetInfo's `state.type`: "wifi" | "cellular" | …); `ConnectivityMonitor.connectionType(): ConnectionType` (core type; map "wifi"→"wifi", "cellular"→"cellular", null/undefined/"none"→"none", else "other"; default "other" before the first event so a cold enqueue doesn't false-cellular). store.tsx passes `type: state.type` in the NetInfo subscription and exposes the monitor's `connectionType` getter to the manager (Task 3).

- [x] **Step 1 — failing tests:** subscribe emits type → `connectionType()` reflects it; default before events is "other"; "none" when disconnected.
- [x] **Step 2 — implement + wire store's NetInfo callback.** `pnpm check` → 0. Commit `feat(mobile): connectivity monitor exposes connection type`, push.

### Task 3: manager/router wiring + record-meta patch

**Files:**
- Modify: `packages/mobile/src/downloads/download-manager.ts` (+ test)
- Modify: `packages/mobile/src/downloads/routing-transfer-engine.ts` (+ test)
- Modify: `packages/mobile/src/downloads/native-transfer-engine.ts` (capability flag)
- Modify: `packages/mobile/src/state/store.tsx` (deps wiring)

**Interfaces:**
- Consumes: Task 1's `transferModeFor`/`ConnectionType`, Task 2's `connectionType()`.
- Produces: `DownloadManagerDeps` gains `getConnectionType: () => ConnectionType` and `nativeConvertAvailable: boolean` (store passes `transferEngine instanceof RoutingTransferEngine`-equivalent — cleaner: `TransferEngine` gains optional `readonly supportsConvert?: boolean`; native engine sets true, router forwards its original-engine's flag, JS engine leaves undefined).
- In `enqueueNative` (and the JS-path `runJob`), replace the `quality.mode === "aac"` branching input to `buildTransferJob` with: `const mode = transferModeFor({ qualityMode, nativeConvertAvailable: !!engine.supportsConvert, connectionType: deps.getConnectionType() }); buildTransferJob({ …, convert: mode === "convert" })`. The pinned per-job `format` stays `"aac"` for convert jobs (the artifact is AAC).
- Router: `submit` sends `"convert"` jobs to the **original** engine (they're native downloads+conversions); `"hls"` → hls engine (unchanged).
- **Record-meta patch on complete:** when a convert-mode job completes, the manager's record write also patches `meta`: `{ ...job.meta, container: "m4a", audioCodec: "aac", bitrate: targetBitrateKbps }` so `recordToTrack` reconstructs the real artifact. (Manager knows the mode from its `submitted`/queue entry — carry it there.)

- [x] **Step 1 — failing tests:** manager routes aac→convert when supported+wifi (fake engine captures mode), aac→hls on cellular fake, convert-complete patches record meta (container m4a/codec aac/bitrate target), router sends convert jobs to the original engine.
- [x] **Step 2 — implement + store wiring.** `pnpm check` → 0. Commit `feat(mobile): route AAC to native convert on WiFi (record meta patched)`, push.

### Task 4: Swift — conversion queue

**Files:**
- Modify: `packages/mobile/modules/background-downloads/ios/BackgroundDownloadManager.swift`
- (Read `modules/background-downloads/ios/BackgroundDownloadsModule.swift` for event plumbing; no module-interface change — events/functions unchanged.)

**Design (follow exactly; verify AVFoundation API against the SDK while writing):**
- `JobDescriptor` gains `mode == "convert"` handling + `targetBitrateKbps: Int?`. A convert job downloads exactly like `"original"` (same task path, same truncation guard vs `expectedBytes`) but `moveIntoPlace` targets `destPath + ".orig"` and then **enqueues a conversion** instead of completing: append `key` to a persisted `pendingConversions: [String]` in the state file, then `drainConversions()`.
- `drainConversions()` — serial, one at a time, on the manager's queue: wrap each conversion in `UIApplication.shared.beginBackgroundTask` (end it in ALL exits) so a wake window can finish the in-flight one. Convert `destPath + ".orig"` → `destPath + ".m4a.tmp"` via `AVAssetExportSession` (`AVAssetExportPresetAppleM4A`, `outputFileType: .m4a`) — note the preset ignores custom bitrates; if `targetBitrateKbps` control matters use `AVAssetReader`+`AVAssetWriter` with `AVFormatIDKey: kAudioFormatMPEG4AAC, AVEncoderBitRateKey: targetBitrateKbps*1000` — implement the reader/writer path (bitrate is a user setting; honoring it is the point). On success: verify output non-empty → move to `destPath` → delete `.orig` → remove from `pendingConversions` → persist → emit `onComplete { key, bytes: m4aSize }` → next.
- Failure: one retry (track `conversionAttempts` on the job); second failure → delete `.orig` + `.tmp`, remove job + pending entry, `failTerminal(key, "conversion failed: <error>")`.
- **Resume:** on cold start / `reattach()`, jobs with a present `.orig` whose size ≥ expectedBytes (or no expected) go straight to `pendingConversions` (no re-download); `.orig` smaller than expected → delete + restart the download. `reattach()` reports pending-conversion keys as `active`.
- Drain triggers: after every convert-download completion; at session-recreation/cold-start (after state load); and at `urlSessionDidFinishEvents` (before calling the stashed completion handler, convert AT MOST the in-flight one — don't hold the handler hostage; kick an async drain with beginBackgroundTask for the rest).
- `cancel(keys)` also removes `.orig`/`.tmp` files + pending entries.

- [x] **Step 1 — implement.** `pnpm check` → 0 (JS untouched here but run it), then prebuild/xcodebuild → BUILD SUCCEEDED (iterate until clean).
- [x] **Step 2 —** Commit `feat(mobile): native on-device AAC conversion queue (reader/writer pipeline)`, push.

### Task 4b: Background App Refresh awareness (user request)

**Files:**
- Modify: `packages/mobile/modules/background-downloads/ios/BackgroundDownloadsModule.swift` + `modules/background-downloads/index.ts`
- Modify: `packages/mobile/app/(tabs)/settings/downloads.tsx`

**Design:**
- Swift: `Function("getBackgroundRefreshStatus")` → read `UIApplication.shared.backgroundRefreshStatus` **on the main thread** (`.runOnQueue(.main)` in the Module DSL, or dispatch) → return `"available" | "denied" | "restricted"`. JS wrapper exposes `getBackgroundRefreshStatus(): string | null` (null when the native module is absent — same safe-null pattern).
- Settings → Downloads: under the "Sync entire library" section, when sync is enabled AND the status is `denied`/`restricted`, render a dim warning row (lucide `Info` icon + text): "Background App Refresh is off — sync only progresses while musex is open or playing music. Enable it in iOS Settings to let downloads trickle in the background." The row is a Pressable → `Linking.openSettings()` (opens this app's iOS settings page, which contains the toggle). When status is `available` or null, render nothing. Read the status once per screen focus (simple `useEffect` on mount is fine).

- [x] **Step 1 —** Swift getter + wrapper; settings row per above. `pnpm check` → 0; xcodebuild BUILD SUCCEEDED (combined with Task 4's build iteration is fine).
- [x] **Step 2 —** Commit `feat(mobile): warn when Background App Refresh is off for library sync`, push.

### Task 5: wrap

- [x] **Step 1 —** Full `pnpm check` + final xcodebuild BUILD SUCCEEDED.
- [x] **Step 2 —** CLAUDE.md arc bullet (convert mode + transferModeFor + cellular carve-out; .orig/persisted pendingConversions/reader-writer AAC pipeline/beginBackgroundTask drains; resume-without-redownload; record-meta patch; delivered-size = m4a).
- [x] **Step 3 —** Update the spec only if implementation diverged. Commit `docs: on-device AAC conversion arc bullet`, push. NO PR (controller).

---

## Self-review notes
- Spec coverage: convert mode+routing (T1/T3), cellular carve-out via connection type (T2/T3), Swift queue/wake-window drains/resume/retry-once (T4), record-meta + delivered-size (T3/T4), JS/HLS untouched (constraints), acceptance = user on-device (spec).
- Consistency: `transferModeFor`→`buildTransferJob.convert` (T1) consumed in T3; `supportsConvert` defined T3 and used only there; `targetBitrateKbps` flows T1→T4; `ConnectionType` defined T1 (core) consumed T2/T3.
- Placeholder scan: the one open implementation choice (export-session vs reader/writer) is resolved in-plan: reader/writer, because the bitrate setting must be honored.
