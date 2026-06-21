# Library Sync (download-all mirror) — design

**Date:** 2026-06-20
**Status:** approved (build in a single PR)
**Surfaces:** iOS (mobile) + desktop, sharing pure logic in `@musex/core`.

## Goal

A "Sync entire library to this device" toggle. While ON, the device mirrors the
selected Plex music library: new music in Plex is downloaded, music removed from
Plex is deleted locally. On iOS the default download format becomes **AAC 256**
so a whole library fits on a phone. Enabling shows a size estimate + confirm.

## Non-goals

- Background sync while the app is closed (mobile keeps the Phase-C limit:
  downloads only progress while the app is open).
- Selective/partial sync, per-playlist sync, or a size cap (whole library only).
- Changing the desktop default format (stays whatever the user has; only the
  **iOS** default flips to AAC 256).

## Decisions (from brainstorming)

- **Surface:** iOS + desktop; decision logic shared in core, only I/O glue per surface.
- **iOS default:** global → AAC 256 (every download, not just bulk). Persisted user choices untouched.
- **Size:** estimate + confirm before enabling.
- **On Plex remove:** mirror exactly — delete the local copy.
- **On disable:** delete all **sync-origin** downloads; manual pins that are still
  in the library are preserved.
- **Continuous:** keep in sync as Plex adds/removes music.

## Architecture

### Pure core (`@musex/core`) — written + tested once

`logic/library-sync.ts`:

```ts
// Diff the authoritative library against what's downloaded.
export interface SyncPlan { toDownload: Track[]; toRemove: string[]; } // toRemove = download keys
export function planLibrarySync(
  libraryTracks: Track[],
  downloaded: DownloadRecord[],
  opts: { allowRemovals: boolean }, // SAFETY: caller opts in only on a trusted full fetch
): SyncPlan;

// Size estimate for the confirm dialog.
export function estimateSyncBytes(tracks: Track[], quality: StorageQuality): number;
```

- Keyed on the existing `downloadKey(serverId, plexPath)` (`logic/download-lookup.ts`).
- `toDownload` = library tracks whose key is not already a `downloaded`/`downloading` record.
- `toRemove` = records with `origin === "sync"` whose key is absent from `libraryTracks`
  — **only when `opts.allowRemovals` is true**. When false, `toRemove` is always `[]`.
- `estimateSyncBytes`: AAC → `Σ (durationMs/1000) × (bitrateKbps × 1000 / 8)`;
  Original → `Σ media.bitrate`-based when present, else the AAC estimate as a
  conservative floor (we never have exact original sizes until downloaded).

`logic/download-state.ts`: add `origin: "manual" | "sync"` to `DownloadRecord`
(optional in stored JSON; `reconcileRecords`/readers default missing → `"manual"`
for back-compat). `DownloadMeta` already carries container/codec/bitrate/duration
needed by the estimate.

### Removal safety (the "make it safe" requirement)

`planLibrarySync` returns removals **only** when the caller passes
`allowRemovals: true`. Each surface's coordinator sets that **only** after a
library enumeration that is **online and fully successful**. Any failure, offline
state, `OfflineUnavailable`, or partial/empty result → `allowRemovals: false` →
that cycle is **additive only**, never deletes. A Plex hiccup or a dropped
connection can therefore never wipe the device. This is unit-tested in core
(false ⇒ empty `toRemove` even when the library list is empty) and in each
coordinator (a throwing/empty fetch removes nothing).

### Per-surface plumbing (glue, no decisions)

A `SyncCoordinator` (one small class per surface, same shape):

```
reconcile():
  if not enabled: return
  try {
    tracks = await gateway.listAllTracks(library, sort, token)  // authoritative full fetch
  } catch { return }                 // offline/error → do nothing (never removes)
  plan = planLibrarySync(tracks, index.all(), { allowRemovals: true })
  await downloadManager.enqueue(plan.toDownload as sync-origin)
  for key in plan.toRemove: await downloadManager.removeDownload(key)
```

- **Sync-origin tagging:** when the coordinator enqueues, the resulting
  `DownloadRecord`s are written with `origin: "sync"`. Manual downloads (the
  existing per-track/album/artist actions) write `origin: "manual"`.
  Implementation: thread an `origin` through the enqueue/record path
  (`DownloadJob`/`record()`), defaulting to `"manual"`.
- **Enable:** estimate (from a fresh/cached list) → confirm → persist `enabled` →
  `reconcile()`.
- **Disable:** persist `enabled = false` → remove every record with
  `origin === "sync"` (manual pins remain).

**Triggers (reconcile()):**
- **Desktop:** the existing Runtime `onChange` (driven by `LibraryWatcher` ws +
  poll) already fires on library changes → call `reconcile()`. Also on enable +
  app launch (when enabled).
- **Mobile:** `AppState` → active (foreground), `ConnectivityMonitor` →
  online, after a library refresh, on enable, and on launch. No timers, no
  background work.
- **Library switch:** switching the selected library re-evaluates; sync is
  per-selected-library (the `enabled` flag is global, the mirror targets the
  currently-selected library).

### iOS AAC 256 default

`packages/mobile/src/downloads/storage-config.ts`:
`DEFAULT_STORAGE_QUALITY.mode = "aac"` (bitrate already 256). `validate()` keeps
falling back to `"original"`/`256` for malformed *stored* values, but the unset
default is now AAC 256. Existing persisted choices are unaffected.

## UI

- **Mobile — Settings → Downloads:** a "Sync entire library to this device"
  toggle. Turning ON opens a confirm dialog: "Download ~X GB (Y GB free)?"; on
  confirm it enables + starts. Progress reuses the existing in-flight
  active-download strip; Remove-all stays. Turning OFF confirms then deletes
  sync-origin downloads.
- **Desktop — Settings → Downloads & Storage:** the same toggle + estimate/confirm;
  the "On this device" view shows contents/progress. Wired via new IPC
  `musex:sync:getState` / `setEnabled` (validated) alongside `musex:downloads:*`.

## Persistence

- **Mobile:** async-storage `musex.library-sync` `{ enabled }`.
- **Desktop:** electron-store `library-sync` `{ enabled }`.
- `DownloadRecord.origin` persists in the existing downloads index.

## Testing

- **Core (primary):** `planLibrarySync` — toDownload diff; toRemove only for
  sync-origin missing tracks; `allowRemovals:false` ⇒ no removals even when
  library is empty; manual-origin never removed. `estimateSyncBytes` — AAC and
  original paths, zero/empty.
- **Coordinators:** fake gateway + fake DownloadManager/index — enable downloads
  the missing set as sync-origin; a new library track is picked up on reconcile;
  a removed track deletes its sync download; a **throwing/empty fetch removes
  nothing**; disable removes sync-origin but keeps manual pins.

## Build order (single PR)

1. Core: `origin` field + `library-sync.ts` + tests.
2. Mobile: AAC default, origin threading, `SyncCoordinator`, triggers, Settings
   toggle + confirm, disable cleanup.
3. Desktop: origin threading, `SyncCoordinator` over `LibraryWatcher`, IPC,
   Settings toggle + confirm.
4. `pnpm check` green; on-device/desktop acceptance is the user's.

## Risks

- **Accidental mass-deletion** — mitigated by `allowRemovals` gating on a trusted
  full online fetch; never removes on any failure/offline/partial.
- **Large enqueue** (thousands of jobs) — the existing sequential, concurrency-1
  manager handles it; resumable via index reconcile on restart; AAC default keeps
  total size manageable on iOS.
- **Manual vs sync ownership** — `origin` keeps them distinct so disable preserves
  manual pins; mirror-remove still deletes anything (manual or sync) that has
  genuinely left the library.
