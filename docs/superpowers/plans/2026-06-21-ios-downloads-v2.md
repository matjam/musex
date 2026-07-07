# iOS Downloads v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Background-continuing, auto-resuming, integrity-verified iOS downloads with live per-container progress — spec `docs/superpowers/specs/2026-06-21-ios-downloads-v2-design.md`.

**Architecture:** PR1 makes the existing foreground system *correct* (expected-size integrity, reconcile healing, a `TransferEngine` seam with the current JS engine behind it, per-container progress UI). PR2 adds the native Swift `modules/background-downloads` engine (background URLSession + persisted backlog + delegate-chained HLS) behind the same seam.

**Tech Stack:** TypeScript (core pure logic + mobile), Expo SDK 56 (expo-file-system `File`/`Directory`, expo-modules-core local modules), Swift (background `URLSession`), vitest.

## Global Constraints

- Core stays pure: no Node/DOM/RN imports; no `Date.now()`/`Math.random()` in new core logic — inject timestamps where needed (the existing `DownloadRecord.addedAt` pattern already flows in from callers).
- Every new model field MUST be forwarded in BOTH mappers (core `plex-mapping.ts` used by desktop, mobile `plex-parse.ts`) — the four-times-bitten rule.
- List-cache schema bumps land WITH the model change: desktop `"v6"` → `"v7"` (`packages/desktop/src/main/adapters/caching-plex-gateway.ts:17`), mobile `"m1"` → `"m2"` (`packages/mobile/src/cache/mobile-caching-gateway.ts:16`).
- Transfer concurrency stays **1** (politeness alongside live streaming) in both engines.
- No new `UIBackgroundModes`; `app.json` untouched (externally managed by EAS/release-please).
- JS-engine transfer behavior must stay identical for non-native environments (existing `download-manager.test.ts` keeps passing, adapted to the seam).
- `import type` for type-only imports (verbatimModuleSyntax). Biome formatting (`pnpm exec biome check --write <files>` before commit).
- After each task: `pnpm check` (repo root) exit 0, then `git add -A && git commit` and **push** (branch `feature/ios-downloads-v2`).
- Core test files are typechecked — no `@types/node`-dependent code in core tests.

---

## PR 1 — foreground-correct v2

### Task 1: `sizeBytes` on the media model (both mappers + schema bumps)

**Files:**
- Modify: `packages/core/src/models/index.ts` (MediaInfo, line ~52)
- Modify: `packages/core/src/logic/plex-mapping.ts` (RawPart + toTrack)
- Modify: `packages/core/src/logic/plex-mapping.test.ts`
- Modify: `packages/mobile/src/logic/plex-parse.ts` (parseTrack media block, line ~62)
- Modify: `packages/mobile/src/logic/plex-parse.test.ts` (add size assertion to an existing track fixture)
- Modify: `packages/desktop/src/main/adapters/plex-gateway.ts` (toTrackSafe parts mapping)
- Modify: `packages/desktop/src/main/adapters/caching-plex-gateway.ts:17` (`"v6"` → `"v7"`)
- Modify: `packages/mobile/src/cache/mobile-caching-gateway.ts:16` (`"m1"` → `"m2"`)

**Interfaces — Produces:** `MediaInfo.sizeBytes?: number` (bytes of the original file, from Plex part `size`), available on every Track both platforms produce.

- [ ] **Step 1: Failing test** — in `plex-mapping.test.ts`, extend the existing toTrack fixture's part with `size: 31415926` and assert `track.media.sizeBytes === 31415926`; add a case with no `size` asserting `sizeBytes === undefined`. Run `pnpm --filter @musex/core exec vitest run src/logic/plex-mapping.test.ts` → FAIL.
- [ ] **Step 2: Model + core mapper.**

```ts
// models/index.ts — MediaInfo gains:
  /** Size of the original media file in bytes (Plex part `size`). Drives
   *  download integrity verification (expectedBytes). */
  sizeBytes?: number;

// plex-mapping.ts — RawPart gains `size?: number;`, and toTrack's MediaInfo:
  const info: MediaInfo = {
    container: part.container ?? media.container ?? "",
    audioCodec: media.audioCodec ?? "",
    bitrate: media.bitrate,
    partId: String(part.id),
    partKey: part.key,
    sizeBytes: part.size,
  };
```

- [ ] **Step 3: Mobile parser** — in `plex-parse.ts` `parseTrack`, add `sizeBytes: num(part.size),` to the `media` object. Add the fixture assertion in its test.
- [ ] **Step 4: Desktop mapper** — in `plex-gateway.ts` `toTrackSafe`, the parts map becomes `parts: m.parts.map((p) => ({ id: p.id, key: p.key, container: p.container, size: p.size }))` (`MediaPart.size: number` verified in `@ctrl/plex/dist/src/media.d.ts:75`).
- [ ] **Step 5: Schema bumps** — desktop `schemaVersion: "v7"`, mobile `schemaVersion: "m2"` (comment why: `sizeBytes` added to the mapped Track shape).
- [ ] **Step 6:** `pnpm check` → exit 0. Commit `feat(core): map Plex part size to MediaInfo.sizeBytes (list-cache v7/m2)`, push.

### Task 2: expected-size integrity in the core download model

**Files:**
- Modify: `packages/core/src/logic/download-plan.ts` (DownloadJob)
- Modify: `packages/core/src/logic/download-state.ts` (DownloadRecord + reconcileRecords)
- Modify: `packages/core/src/logic/download-state.test.ts`

**Interfaces — Produces:**
- `DownloadJob.expectedBytes?: number` (from `track.media.sizeBytes`; meaningful for original-format transfers only).
- `DownloadRecord.expectedBytes?: number`.
- `reconcileRecords(records, presentKeys, sizes?: ReadonlyMap<string, number>)` — NEW optional third arg: a `downloaded` record that is present but whose on-disk size ≠ `expectedBytes` (both defined) is demoted to `"missing"`. Existing two-arg callers (desktop) are unaffected.

- [ ] **Step 1: Failing tests** in `download-state.test.ts`:

```ts
it("demotes a downloaded record whose on-disk size mismatches expectedBytes", () => {
  const rec = { ...base, key: "k1", state: "downloaded" as const, expectedBytes: 100 };
  const out = reconcileRecords([rec], new Set(["k1"]), new Map([["k1", 60]]));
  expect(out[0]?.state).toBe("missing");
});
it("keeps a downloaded record whose size matches, or that has no expectedBytes", () => {
  const a = { ...base, key: "a", state: "downloaded" as const, expectedBytes: 100 };
  const b = { ...base, key: "b", state: "downloaded" as const }; // AAC — no expected size
  const out = reconcileRecords([a, b], new Set(["a", "b"]), new Map([["a", 100], ["b", 42]]));
  expect(out.map((r) => r.state)).toEqual(["downloaded", "downloaded"]);
});
```

(Reuse the file's existing `base` record fixture; create one matching `DownloadRecord` if none exists.) Run → FAIL (extra arg unknown / no demotion).
- [ ] **Step 2: Implement.**

```ts
export function reconcileRecords(
  records: DownloadRecord[],
  presentKeys: ReadonlySet<string>,
  sizes?: ReadonlyMap<string, number>,
): DownloadRecord[] {
  return records.map((r) => {
    if (r.state !== "downloaded") return r;
    if (!presentKeys.has(r.key)) return { ...r, state: "missing" as const };
    const size = sizes?.get(r.key);
    if (r.expectedBytes !== undefined && size !== undefined && size !== r.expectedBytes) {
      return { ...r, state: "missing" as const }; // partial/corrupt — sync re-queues it
    }
    return r;
  });
}
```

Add `expectedBytes?: number` to `DownloadRecord` (doc: "Exact size of the original file when known; original-format records only — a committed file MUST match. Undefined for AAC transcodes.") and `DownloadJob`.
- [ ] **Step 3:** Tests pass; `pnpm check` → 0. Commit `feat(core): expectedBytes on download records + size-aware reconcile`, push.

### Task 3: core `downloadProgress` aggregator

**Files:**
- Create: `packages/core/src/logic/download-progress.ts` + `download-progress.test.ts`
- Modify: `packages/core/src/index.ts` (barrel export, alphabetical among `./logic/*`)

**Interfaces — Produces:**

```ts
export type ContainerDownloadState = "none" | "downloading" | "partial" | "complete";
export interface ContainerDownloadProgress {
  done: number; total: number; inFlight: number; failed: number;
  bytes: number;                    // bytes landed so far (downloaded + in-flight progress)
  expectedBytes: number | null;     // sum when EVERY counted record has one, else null
  fraction: number | null;          // bytes/expectedBytes when known, else done/total, null when total===0
  state: ContainerDownloadState;
}
export function downloadProgress(
  records: ReadonlyMap<string, DownloadRecord> | DownloadRecord[],
  keys: readonly string[],
): ContainerDownloadProgress;
```

Semantics: `total = keys.length`; a key with no record counts as not-started. `done` = downloaded; `inFlight` = queued|downloading; `failed` = failed|missing. `state`: `complete` when done===total && total>0; `downloading` when inFlight>0; `partial` when done>0 (some done, none in flight); else `none`. `bytes` sums record `bytes`; `expectedBytes` is the sum of `expectedBytes` over the counted keys only when all present records define it AND every key has a record — otherwise null (fraction falls back to done/total).

- [ ] **Step 1: Failing tests** covering: empty keys → total 0/fraction null/state none; mixed states counting; complete; bytes-blend fraction when all expectedBytes known; count-fraction fallback (one record lacking expectedBytes); array and Map record inputs.
- [ ] **Step 2: Implement** (normalize array→Map internally; single pass over keys). Export from `index.ts` (`export * from "./logic/download-progress";`).
- [ ] **Step 3:** `pnpm check` → 0. Commit `feat(core): per-container downloadProgress aggregator`, push.

### Task 4: core transfer types + pure job builder

**Files:**
- Create: `packages/core/src/logic/transfer-job.ts` + `transfer-job.test.ts`
- Modify: `packages/core/src/index.ts` (barrel)

**Interfaces — Produces:**

```ts
export interface TransferJob {
  key: string;
  mode: "original" | "hls";
  url: string;                       // original: signed file URL; hls: signed start.m3u8 URL
  headers: Record<string, string>;   // hls: token + profile-extra; original: {}
  destPath: string;                  // absolute filesystem path (no file:// scheme)
  expectedBytes?: number;            // original only — commit must match exactly
  stopUrl?: string;                  // hls only — best-effort Plex session stop
}
export interface TransferEndpoint { baseUrl: string; token: string }
export function buildTransferJob(opts: {
  job: DownloadJob; quality: StorageQuality; endpoint: TransferEndpoint;
  clientId: string; destPath: string; session: string;   // caller supplies session id (no Date.now in core)
}): TransferJob;
export type TransferEvent =
  | { kind: "progress"; key: string; bytes: number; segmentsDone?: number; segmentsTotal?: number }
  | { kind: "complete"; key: string; bytes: number }
  | { kind: "error"; key: string; message: string; terminal: boolean };
export interface TransferSnapshot { active: string[]; completed: { key: string; bytes: number }[]; failed: { key: string; message: string }[] }
```

`buildTransferJob` reproduces EXACTLY the URL construction currently inlined in `DownloadManager.runOriginalJob` (line 106: `${baseUrl}${plexPath}${…"&":"?"}X-Plex-Token=…`) and `runHlsJob` (`buildHlsStartUrl` + `TRANSCODE_PROFILE_EXTRA` headers + `stopSessionUrl`), keyed on `quality.mode`; `expectedBytes` passes through only for original mode.

- [ ] **Step 1: Failing tests** — original URL with `?`/`&` token join both cases + empty headers + expectedBytes passthrough; hls url = `buildHlsStartUrl(...)` output, headers contain `X-Plex-Token` + `X-Plex-Client-Profile-Extra`, stopUrl = `stopSessionUrl(...)`, expectedBytes absent.
- [ ] **Step 2: Implement + barrel.** `pnpm check` → 0. Commit `feat(core): TransferJob types + buildTransferJob`, push.

### Task 5: TransferEngine seam — JsTransferEngine + manager refactor + integrity wiring

**Files:**
- Create: `packages/mobile/src/downloads/transfer-engine.ts` (interface only)
- Create: `packages/mobile/src/downloads/js-transfer-engine.ts` + `js-transfer-engine.test.ts`
- Modify: `packages/mobile/src/downloads/download-manager.ts` (refactor onto the seam)
- Modify: `packages/mobile/src/downloads/download-manager.test.ts` (keep coverage; adapt construction)
- Modify: `packages/mobile/src/downloads/download-store.ts` (add `presentFileSizes()`, `path(key)`)
- Modify: `packages/mobile/src/state/store.tsx` (buildJob `expectedBytes`, bootstrap reconcile healing)

**Interfaces:**
- Consumes: Task 4's `TransferJob`/`TransferEvent`/`buildTransferJob`; Task 2's `expectedBytes`.
- Produces:

```ts
// transfer-engine.ts
import type { TransferEvent, TransferJob, TransferSnapshot } from "@musex/core";
export interface TransferEngine {
  submit(jobs: TransferJob[]): Promise<void>;
  cancel(keys: string[]): Promise<void>;
  reattach(): Promise<TransferSnapshot>;     // JS engine: always empty snapshot
  onEvent(cb: (e: TransferEvent) => void): () => void;
}
```

**Shape of the refactor (behavior-identical):**
- `JsTransferEngine` takes `{ store: FileStore; fetch: typeof fetch }` and owns the *execution* code moved verbatim from today's `DownloadManager`: the original download (`store.downloadUrl` → verify `expectedBytes !== undefined ? bytes === expectedBytes : bytes > 0`, mismatch → error event `size mismatch: got X want Y` and remove the file), the HLS stitch (`beginWrite`/segments/retry 60×700ms/ENDLIST/commit/stop-session — the fetch-segment + parse code moves here unchanged), an internal FIFO with concurrency 1, and event emission (`progress`/`complete`/`error`, all `terminal: true` on error — the JS engine has no retry-later).
- `DownloadManager` keeps: `enqueue` (dedupe via `store.has`, record `queued`), `removeDownload`, `drain()`, the `record()` bookkeeping — but its loop becomes: build the `TransferJob` via `buildTransferJob` (destPath from new `store.path(key)`; `session: \`${job.key}-${Date.now()}\`` — Date.now lives HERE, not core), mark `downloading`, `await engine.submit([tj])` + wait for that key's terminal event, map events → `record()` calls (`progress` → downloading+bytes, `complete` → downloaded+bytes with `expectedBytes` persisted on the record, `error` → failed). Constructor gains `engine: TransferEngine` in deps (store stays for has/remove/path).
- `DownloadStore` additions:

```ts
/** Absolute filesystem path for a key's final file (no file:// scheme) — what
 *  native/JS engines write to (`path + ".part"` during transfer). */
path(key: string): string {
  const uri = new File(this.dir, key).uri;
  return uri.startsWith("file://") ? decodeURI(uri.slice("file://".length)) : uri;
}
/** Sizes of present non-.part files, for size-verified reconcile. */
presentFileSizes(): Map<string, number> {
  const sizes = new Map<string, number>();
  if (!this.dir.exists) return sizes;
  for (const entry of this.dir.list()) {
    if (entry instanceof File && entry.name && !entry.name.endsWith(".part") && entry.size > 0)
      sizes.set(entry.name, entry.size);
  }
  return sizes;
}
```

(`presentNonEmptyKeys()` becomes `new Set(this.presentFileSizes().keys())` to avoid double listing. Extend the `FileStore` pick with `path` + `presentFileSizes`.)
- `store.tsx` wiring: `buildJob` adds `expectedBytes: track.media.sizeBytes`; bootstrap replaces the reconcile block with:

```ts
const fileSizes = downloadStore.presentFileSizes();
const presentKeys = new Set(fileSizes.keys());
await downloadIndex.reconcile(presentKeys, fileSizes);
// Delete corrupt files (record demoted to missing but a wrong-size file is present)
for (const r of downloadIndex.all()) {
  if (r.state === "missing" && presentKeys.has(r.key)) downloadStore.remove(r.key);
}
downloadIndex.resolveStaleInFlight(presentKeys);
```

(`DownloadIndex.reconcile` gains the optional `sizes` param, passing through to core `reconcileRecords`.) Construct `new JsTransferEngine({ store: downloadStore, fetch })` and pass as `engine` to the manager (`useMemo` deps updated).

- [ ] **Step 1: Failing engine tests** (`js-transfer-engine.test.ts`, fake `FileStore` + fake fetch — mirror the fakes in `download-manager.test.ts`): original success emits progress+complete; original size-mismatch (expectedBytes 100, store returns 60) emits terminal error + file removed; hls happy path (master→media→segments→ENDLIST) emits complete with summed bytes; hls no-ENDLIST aborts with error; 404-then-ok segment retry succeeds.
- [ ] **Step 2: Implement engine + refactor manager.** Adapt `download-manager.test.ts` construction (`engine: new JsTransferEngine({ store, fetch })` in deps); the manager's observable behavior (records written, onProgress calls, dedupe, removeDownload) must not change — existing assertions stay.
- [ ] **Step 3: Store + store.tsx wiring** (above). Run mobile tests: `pnpm --filter @musex/mobile test` → all pass.
- [ ] **Step 4:** `pnpm check` → 0. Commit `feat(mobile): TransferEngine seam + size-verified downloads + reconcile healing`, push.

### Task 6: progress UI — the four surfaces

**Files:**
- Create: `packages/mobile/src/ui/DownloadProgressBar.tsx`
- Create: `packages/mobile/src/state/use-download-progress.ts`
- Modify: `packages/mobile/app/(tabs)/library/index.tsx` (Downloaded header strip → real bar; tile in-flight badge)
- Modify: `packages/mobile/app/(tabs)/library/tracks.tsx` (album screen bar) and `packages/mobile/app/(tabs)/library/albums.tsx` (artist screen bar) and `packages/mobile/app/(tabs)/home/playlist.tsx` (playlist bar)
- Modify: `packages/mobile/app/(tabs)/settings/downloads.tsx` (active-downloads list)
- Modify: `packages/mobile/src/ui/TrackActionSheet.tsx` (Downloading… state)

**Interfaces — Consumes:** Task 3's `downloadProgress`; the store's `downloadsList()` + `downloadsVersion` (already in `useApp()`).

- [ ] **Step 1: Hook.**

```ts
// use-download-progress.ts
import { type ContainerDownloadProgress, downloadKey, downloadProgress, type Track } from "@musex/core";
import { useMemo } from "react";
import { useApp } from "./store";

/** Live download progress for a set of tracks (a container's contents).
 *  Recomputes on downloadsVersion bumps, so bars move as bytes land. */
export function useDownloadProgress(tracks: readonly Track[]): ContainerDownloadProgress {
  const { downloadsList, downloadsVersion } = useApp();
  // biome-ignore lint/correctness/useExhaustiveDependencies: downloadsVersion is the refresh trigger
  return useMemo(
    () => downloadProgress(downloadsList(), tracks.map((t) => downloadKey(t.serverId, t.media.partKey))),
    [tracks, downloadsList, downloadsVersion],
  );
}
```

(Verify `useApp()` exposes `downloadsList` + `downloadsVersion` — both exist per the store; export them if not already on the context value.)
- [ ] **Step 2: Bar component** — `DownloadProgressBar.tsx`: takes `progress: ContainerDownloadProgress`; renders null when `state === "none" || state === "complete"`; otherwise a 3px track (theme.border) with a fill (theme accent, width `${(fraction ?? 0) * 100}%`) and a caption `"{done}/{total} tracks · {formatBytes(bytes)}"` (+ `" of {formatBytes(expectedBytes)}"` when known; `formatBytes` from `@musex/core`). Follow existing component style (`theme` from `src/ui/theme`, plain `View`/`Text`).
- [ ] **Step 3: Integrations.**
  - **Downloaded header** (`library/index.tsx` ~224): replace the "Downloading N…" strip's `<Text>` with the bar fed by `downloadProgress(downloadsList(), activeAndDoneKeys)` — compute a whole-collection progress from ALL records with state queued/downloading/downloaded (keys = every record key) so the header reads "n/total". Simpler: keep the strip when `activeKeys.length > 0` and render `<DownloadProgressBar progress={wholeProgress}/>` where `wholeProgress = downloadProgress(records, records.map(r => r.key))`.
  - **Tile badge:** in the Downloaded grid's album tiles, overlay a small downloading indicator (an `ActivityIndicator size="small"` or a `Download` lucide glyph + fraction text) when that album group has in-flight records: compute per-album in-flight from `downloadsList()` grouped by `meta.albumId` (records where state queued/downloading), pass a `downloading?: boolean` prop through the existing tile render.
  - **Album/artist/playlist screens:** each already loads its `tracks` array — render `<DownloadProgressBar progress={useDownloadProgress(tracks)} />` directly under the `ActionBar`.
  - **Settings → Downloads:** above the totals row, when any record is queued/downloading, list up to 20 in-flight records (`meta.title` + per-track `formatBytes(bytes)`; queued ones dimmed "queued") with a header showing the whole-collection bar. Read via `downloadsList()` + re-render on `downloadsVersion`.
  - **TrackActionSheet:** where the downloaded badge is derived (`downloadRecordFor` — matches `state === "downloaded"` only), also look up the raw record; `queued`/`downloading` → show a "Downloading…" row state (disabled), distinct from the Download action.
- [ ] **Step 4:** `pnpm check` → 0 (UI is not unit-tested on mobile; the hook's logic is core-tested). Commit `feat(mobile): per-container download progress UI (4 surfaces)`, push.

### Task 7: PR1 wrap

- [ ] **Step 1:** Full `pnpm check` at root → exit 0; re-run mobile tests explicitly.
- [ ] **Step 2:** Add the CLAUDE.md arc bullet (downloads v2 PR1: sizeBytes/expectedBytes + v7/m2 bumps, size-verified commits + healing reconcile, TransferEngine seam, downloadProgress + 4 surfaces; PR2 native engine pending).
- [ ] **Step 3:** Commit, push, open **draft PR** titled `feat(mobile): downloads v2 — integrity, resume bookkeeping, per-container progress` with a body summarizing the above + noting PR2 follows. (JS bundle CI + native build-ios will run; no native change in PR1 so build-ios is skipped by the changes filter unless package.json moved.)

---

## PR 2 — the background engine (branch `feature/ios-background-downloads` off main after PR1 merges)

### Task 8: Swift module scaffold + Original path

**Files:**
- Create: `packages/mobile/modules/background-downloads/expo-module.config.json`

```json
{ "platforms": ["apple"], "apple": { "modules": ["BackgroundDownloadsModule"], "appDelegateSubscribers": ["BackgroundDownloadsAppDelegateSubscriber"] } }
```

- Create: `packages/mobile/modules/background-downloads/ios/BackgroundDownloads.podspec` (copy `modules/lock-screen-commands/ios/LockScreenCommands.podspec`, rename)
- Create: `packages/mobile/modules/background-downloads/ios/BackgroundDownloadsModule.swift`
- Create: `packages/mobile/modules/background-downloads/ios/BackgroundDownloadManager.swift`
- Create: `packages/mobile/modules/background-downloads/ios/BackgroundDownloadsAppDelegateSubscriber.swift`
- Create: `packages/mobile/modules/background-downloads/index.ts` (JS wrapper, safe-null like `modules/lock-screen-commands/index.ts`)

**Reference before writing Swift:** read `modules/lock-screen-commands/ios/LockScreenCommandsModule.swift` (Module DSL: `Name`, `Events`, `Function`, `OnStartObserving`) and verify the `ExpoAppDelegateSubscriber` protocol name/signature in `node_modules/expo-modules-core/ios/` (search `handleEventsForBackgroundURLSession`) — API details MUST come from the installed version, not memory.

**Design (Original mode this task):**
- `BackgroundDownloadManager` (singleton): lazy `URLSession(configuration: .background(withIdentifier: "net.stupendous.musex.downloads"))` with `sessionSendsLaunchEvents = true`, `isDiscretionary = false`; delegate = itself.
- **Backlog:** `[JobDescriptor]` (Codable: key, mode, url, headers, destPath, expectedBytes?, stopUrl?) persisted as JSON at `Application Support/musex-downloads/backlog.json` after every mutation. `submit(jobsJson)` appends (dedupe by key), then `fill()`.
- `fill()`: while active tasks < **1** and backlog has a job not yet active → start it. Original: `session.downloadTask(with: request)` with `task.taskDescription = key`.
- Delegate `urlSession(_:downloadTask:didFinishDownloadingTo:)`: look up job by taskDescription; verify `expectedBytes` (attributes of the temp file; mismatch → treat as failure/retry); `FileManager.moveItem` to `destPath` (create parent dir; remove existing); mark done (remove from backlog, persist); emit `onComplete { key, bytes }`; `fill()`.
- Delegate `urlSession(_:task:didCompleteWithError:)` (non-nil error): capture `(error as NSError).userInfo[NSURLSessionDownloadTaskResumeData]` → persist alongside the job; retry count += 1; if retries ≤ 5 re-create via `session.downloadTask(withResumeData:)` (or fresh task if none) with `earliestBeginDate = Date().addingTimeInterval(min(pow(2, retries) * 5, 300))`; else remove from backlog + emit `onError { key, message, terminal: true }`; `fill()`.
- Progress: `urlSession(_:downloadTask:didWriteData:totalBytesWritten:totalBytesExpectedToWrite:)` → emit `onProgress { key, bytes }` throttled to ~1/s per key (store last-emit timestamps).
- `cancel(keys)`: remove from backlog, cancel matching tasks, delete `destPath + ".part"` leftovers; persist.
- `reattach()`: returns `{ active: [keys with live tasks or backlog], completed: [...], failed: [...] }` from a persisted "results since last reattach" list (append results there in the delegate too; clear on reattach).
- `BackgroundDownloadsAppDelegateSubscriber`: implements `application(_:handleEventsForBackgroundURLSession:completionHandler:)` → if identifier matches, stash the handler on the manager; the manager calls it in `urlSessionDidFinishEvents(forBackgroundURLSession:)` (dispatch to main).
- `BackgroundDownloadsModule` (Module DSL): `Name("BackgroundDownloads")`, `Events("onProgress", "onComplete", "onError")`, `AsyncFunction("submit") { (jobsJson: String) ... }`, `AsyncFunction("cancel") { (keys: [String]) ... }`, `AsyncFunction("reattach") { () -> String ... }` (JSON strings across the bridge — matches lock-screen-commands' simplicity; JS wrapper does JSON.parse/stringify).

- [ ] **Step 1:** Write the module (Original mode only; `mode == "hls"` jobs are rejected in `submit` with an `onError`... no — accept + leave in backlog untouched this task; Task 9 handles them. Simplest: this task `submit` filters HLS jobs out with a terminal `onError "hls not yet supported"` — Task 9 replaces that).
- [ ] **Step 2:** JS wrapper `index.ts`: `requireNativeModule("BackgroundDownloads")` in try/catch → exported `BackgroundDownloadsNative | null` + typed `addListener` helpers (copy the lock-screen-commands pattern incl. its test-safety comment).
- [ ] **Step 3:** `pnpm check` → 0 (Swift isn't compiled by check). Sanity-compile: `pnpm --filter @musex/mobile exec expo prebuild --platform ios --clean` then `xcodebuild -workspace ... -scheme musex -sdk iphonesimulator build` OR rely on CI `build-ios` (native inputs changed → it runs). Commit `feat(mobile): background-downloads native module (Original mode)`, push.

### Task 9: Swift HLS chaining

**Files:** Modify `BackgroundDownloadManager.swift` (+ small `HlsJobState` Codable struct).

**Design:** an HLS job runs as a chain on the SAME background session:
1. Playlist fetches use `session.downloadTask` too (a data task can't run in a background session) — download the master to a temp file, read + parse (port `parseHlsMaster`/`parseHlsMedia` line rules to Swift: variant = first non-comment line after `EXT-X-STREAM-INF`; segments = non-comment lines; ended = `#EXT-X-ENDLIST` present).
2. Persist `HlsJobState { segmentUrls: [String], nextIndex: Int, bytes: Int64, mediaUrl: String }` on the job; enqueue segment task `nextIndex` (one at a time — the job occupies the session's single slot).
3. Segment complete → append the temp file's bytes to `destPath + ".part"` (`FileHandle(forWritingAtPath:)` seekToEnd/write — create on first segment), `nextIndex += 1`, persist, emit throttled `onProgress { key, bytes, segmentsDone, segmentsTotal }`, enqueue next (or finish).
4. Segment HTTP 404/5xx (check `(task.response as? HTTPURLResponse)?.statusCode` in didComplete) → re-enqueue SAME index with `earliestBeginDate = +3s` (cap 60 attempts per segment — mirror JS policy); other 4xx → terminal error (abort: delete `.part`, remove job, emit).
5. All segments done → move `.part` → `destPath`, fire-and-forget `stopUrl` (a plain `session.dataTask` on a separate default session is fine here — it's best-effort), emit `onComplete`, `fill()`.
6. Resume across kill: `HlsJobState.nextIndex` is persisted — on relaunch (`reattach`/session events) the manager re-reads backlog and continues from `nextIndex` (the `.part` file already holds segments < nextIndex).

- [ ] **Step 1:** Implement + remove Task 8's HLS rejection. Keep every persistence write cheap (single JSON file rewrite is fine at this scale).
- [ ] **Step 2:** `pnpm check` → 0; native compile via prebuild/xcodebuild or CI. Commit `feat(mobile): native HLS segment chaining (AAC background downloads)`, push.

### Task 10: NativeTransferEngine + selection + reattach + quality-change cancel

**Files:**
- Create: `packages/mobile/src/downloads/native-transfer-engine.ts` + `native-transfer-engine.test.ts`
- Modify: `packages/mobile/src/state/store.tsx` (engine selection, bootstrap reattach folding, quality-change cancel)
- Modify: `packages/mobile/src/downloads/download-index.ts` (`resolveStaleInFlight(presentKeys, activeKeys?)`)
- Modify: `packages/mobile/src/downloads/download-manager.ts` (submit-and-continue for native: don't await terminal events per job — the native engine is fire-and-forget; events flow back asynchronously)

**Key wiring decisions (write them exactly):**
- `NativeTransferEngine` wraps the module: `submit` → JSON.stringify jobs; events → `TransferEvent` mapping; `reattach()` → parse snapshot. Constructor takes the nullable native module (injected — tests pass a fake).
- **Manager duality:** with the JS engine the manager awaits each job (today's sequencing); with the native engine `enqueue` records `queued`, submits ALL jobs immediately (native owns sequencing), and a persistent event subscription maps events → `record()` (downloading/downloaded/failed) — the manager keeps NO in-memory queue for native. Implement as: `DownloadManagerDeps.engine` + `engineIsNative: boolean` (or `engine.ownsQueue: boolean` on the interface — cleaner; JS engine `ownsQueue = false`, native `true`).
- **Bootstrap:** after `downloadIndex.load()`, if native: `const snap = await engine.reattach()`; fold: completed → record downloaded (bytes; verify file present); failed → failed; then `resolveStaleInFlight(presentKeys, new Set(snap.active))` — active keys are NOT dropped (they're genuinely in flight natively).
- **Quality change** (`setStorageQuality` in store.tsx): collect index records with state `queued` (not yet downloading), `engine.cancel(theirKeys)`, drop their records, re-enqueue via `downloadManager.enqueue(rebuiltJobs)` so URLs match the new mode. (Records mid-`downloading` finish in the old mode — acceptable, document it.)
- **Cache eviction on complete** already rides `onProgress` in store.tsx — events from the native engine flow through the same `record()` → `onProgress` path, so no change; verify.

- [ ] **Step 1: Failing tests** for `NativeTransferEngine` (fake module: capture submit JSON, emit events, canned reattach snapshot) — submit serializes `TransferJob[]` faithfully; events map 1:1; reattach parses; null module → engine reports unavailable (`static available(mod): boolean` or factory returns null — pick the factory: `createNativeTransferEngine(mod): TransferEngine | null`).
- [ ] **Step 2: Implement + wire store.tsx:** `const nativeEngine = createNativeTransferEngine(BackgroundDownloadsNative); const engine = nativeEngine ?? new JsTransferEngine({ store: downloadStore, fetch });` in the manager's `useMemo`. Add `resolveStaleInFlight` second param (default `undefined` → old behavior; existing test untouched + new test: active natively → kept as downloading).
- [ ] **Step 3:** `pnpm check` → 0; mobile tests green. Commit `feat(mobile): native background transfer engine wiring + reattach`, push.

### Task 11: PR2 wrap + on-device acceptance

- [ ] **Step 1:** Full `pnpm check`; verify CI `build-ios` will trigger (native inputs changed: `modules/` matches the changes filter in `.github/workflows/ci.yml:30`).
- [ ] **Step 2:** CLAUDE.md arc bullet update (native module mechanics: background session id, backlog persistence path, delegate refill, resumeData, HLS nextIndex resume, AppDelegateSubscriber; JS fallback retained; quality-change cancel semantics).
- [ ] **Step 3:** Push; open draft PR `feat(mobile): background downloads — native URLSession engine`. Body includes the **on-device acceptance checklist** (the user runs it; requires a dev-client rebuild — `expo prebuild` + `expo run:ios` or an EAS dev build):
  1. Start a large sync → background the app → tracks keep landing (watch Settings → Downloads on return).
  2. Force-kill mid-sync → wait → reopen: progress advanced while dead (background relaunch worked).
  3. Airplane mode mid-file → restore network → file completes without restarting from zero (Original) / resumes at segment (AAC).
  4. Interrupt every way you can → no track ever shows downloaded but unplayable (integrity).
  5. Progress bars live on all four surfaces.
  6. AAC-in-background throughput verdict: acceptable, or fall back to "Original unattended / AAC foreground+resume" (a one-line contract change: native engine rejects hls jobs when backgrounded — decide only if needed).

---

## Self-review notes

- **Spec coverage:** sizeBytes+schema bumps (T1) ✓; expectedBytes + size-aware reconcile + healing + corrupt-file deletion (T2/T5) ✓; downloadProgress (T3) ✓ + four UI surfaces (T6) ✓; TransferJob/TransferEngine/JsTransferEngine behavior-identical (T4/T5) ✓; native module Original (T8), HLS chaining + mid-file resume (T9), reattach/selection/quality-cancel (T10) ✓; no new UIBackgroundModes (none added anywhere) ✓; two PRs (T7/T11) ✓; on-device acceptance + AAC throughput decision (T11) ✓.
- **Type consistency:** `TransferJob.mode: "original" | "hls"` used in T4/T5/T8/T9; `downloadProgress(records, keys)` matches T6's hook; `reconcileRecords` 3-arg matches T5's `DownloadIndex.reconcile(presentKeys, sizes)`; `store.path(key)`/`presentFileSizes()` defined in T5, consumed in T5/T10.
- **Known judgment points for implementers:** Swift API names MUST be verified against the installed `expo-modules-core` (the plan says so in T8); UI integration steps name anchors, not diffs — read the file first.
