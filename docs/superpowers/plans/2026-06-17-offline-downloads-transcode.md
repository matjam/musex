# Offline + Local Downloads + Transcoded Storage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user download tracks/albums/artists to the device as pinned copies, browse + play them (and media-cached tracks) seamlessly while Plex is unreachable, and optionally store transcoded MP3 copies at a chosen bitrate — reworking the old acquisition "Downloads" view into a badge + filter so its sidebar slot becomes the offline home base.

**Architecture:** Hexagonal. New pure logic in `@musex/core` (`download-plan`, `offline-availability`, `download-state`, `transcode-url`); Electron-main adapters (`DownloadStore`, `DownloadIndex`, `DownloadManager`, `ConnectivityMonitor`) owned by `Runtime`; the renderer learns download status + connectivity over typed IPC and reuses the existing `GridCard`/`StateBadge`/`TrackRow` badge+dim infra. Downloaded files serve through the existing localhost stream proxy (serve order: downloads → media cache → upstream), so playback is unchanged.

**Tech Stack:** Electron + electron-vite, React 19, TypeScript 6, electron-store 11, vitest 4, biome 2, pnpm 11 workspaces (`@musex/core`, `@musex/desktop`). Spec: `docs/superpowers/specs/2026-06-17-offline-downloads-transcode-design.md`.

**Spike status:** Transcode delivery is already confirmed (MP3-only, `start.mp3?protocol=http`, `musicBitrate` VBR ceiling) — see the spec's "Transcode — confirmed by spike" section. The throwaway probe was removed.

---

## File Structure

**Create (core, pure):**
- `packages/core/src/logic/transcode-url.ts` — build the confirmed single-file MP3 transcode URL + stop-session URL.
- `packages/core/src/logic/download-plan.ts` — `downloadKey()` + dedupe a track list into download jobs.
- `packages/core/src/logic/offline-availability.ts` — decide a track's UI availability from local presence + connectivity.
- `packages/core/src/logic/download-state.ts` — `DownloadRecord` type, state transitions, index reconciliation.
- Matching `*.test.ts` for each.

**Create (desktop main):**
- `packages/desktop/src/main/adapters/download-store.ts` — pinned on-disk store (shares the `.part`→rename pattern with `MediaCache`).
- `packages/desktop/src/main/adapters/download-index.ts` — persisted `DownloadRecord[]`.
- `packages/desktop/src/main/download/download-manager.ts` — sequential download queue + transcode + progress events.
- `packages/desktop/src/main/adapters/connectivity-monitor.ts` — Plex-reachability state machine.
- Matching `*.test.ts`.

**Create (desktop renderer):**
- `packages/desktop/src/renderer/src/ui/views/OnDeviceView.tsx` — the "On this device" destination.
- `packages/desktop/src/renderer/src/ui/views/AcquiringView.tsx` — re-homed acquisition feed (renamed from `DownloadsView`).

**Modify:**
- `packages/core/src/index.ts` — barrel-export the new logic.
- `packages/desktop/src/main/adapters/stream-proxy.ts` — serve order + skip-downloaded.
- `packages/desktop/src/main/adapters/caching-plex-gateway.ts` — cache top-level artists.
- `packages/desktop/src/main/adapters/persistence.ts` — `storageQuality` + downloads index store.
- `packages/desktop/src/main/runtime.ts` — own the new adapters + sinks.
- `packages/desktop/src/main/index.ts` — wire the new sinks in `wireEngineEvents`.
- `packages/desktop/src/main/ipc.ts` — new handlers.
- `packages/desktop/src/shared/ipc-contract.ts` — new channels + Dto types + `MusexApi` methods.
- `packages/desktop/src/preload/index.ts` — expose the new channels.
- `packages/desktop/src/renderer/src/state/app.tsx` — connectivity + downloads slices + listeners.
- `packages/desktop/src/renderer/src/ui/Shell.tsx` — sidebar swap + routing.
- `packages/desktop/src/renderer/src/ui/TopBar.tsx` — offline pill.
- `packages/desktop/src/renderer/src/ui/state-badge.ts` — add `downloaded`/`downloading` states.
- `packages/desktop/src/renderer/src/ui/TrackRow.tsx` — `downloadState` prop.
- `packages/desktop/src/renderer/src/ui/TrackContextMenu.tsx` — download/remove items.
- `packages/desktop/src/renderer/src/ui/views/SettingsView.tsx` — "Downloads & Storage" pane.
- library views (`AlbumsView`, `ArtistsView`, `AlbumDetailView`, etc.) — filter + dimming overlay.

**Conventions:** `import type` for types (verbatimModuleSyntax); `_`-prefix unused params; biome `check --write .` before every push; run the FULL `pnpm check` (root) before pushing — per-package runs miss repo-wide biome. Core stays Node/DOM-free.

---

## Phase 1 — Download engine (core logic + store + index + manager + proxy + IPC)

### Task 1.1: Pure `transcode-url` builder

**Files:**
- Create: `packages/core/src/logic/transcode-url.ts`
- Test: `packages/core/src/logic/transcode-url.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/logic/transcode-url.test.ts
import { describe, expect, it } from "vitest";
import { buildTranscodeUrl, stopSessionUrl, TRANSCODE_BITRATES } from "./transcode-url.js";

describe("buildTranscodeUrl", () => {
  it("builds the confirmed single-file MP3 URL with the forcing params", () => {
    const url = buildTranscodeUrl({
      baseUrl: "https://pms:32400",
      token: "tok",
      clientId: "cid",
      session: "sess-1",
      trackId: "8809",
      bitrateKbps: 256,
    });
    const u = new URL(url);
    expect(u.pathname).toBe("/audio/:/transcode/universal/start.mp3");
    expect(u.searchParams.get("protocol")).toBe("http");
    expect(u.searchParams.get("directPlay")).toBe("0");
    expect(u.searchParams.get("directStream")).toBe("0");
    expect(u.searchParams.get("audioCodec")).toBe("mp3");
    expect(u.searchParams.get("musicBitrate")).toBe("256");
    expect(u.searchParams.get("path")).toBe("/library/metadata/8809");
    expect(u.searchParams.get("X-Plex-Token")).toBe("tok");
    expect(u.searchParams.get("X-Plex-Client-Identifier")).toBe("cid");
    expect(u.searchParams.get("session")).toBe("sess-1");
  });

  it("stopSessionUrl targets the universal stop endpoint with the session", () => {
    const u = new URL(stopSessionUrl({ baseUrl: "https://pms:32400", token: "tok", clientId: "cid", session: "s1" }));
    expect(u.pathname).toBe("/audio/:/transcode/universal/stop");
    expect(u.searchParams.get("session")).toBe("s1");
    expect(u.searchParams.get("X-Plex-Token")).toBe("tok");
  });

  it("exposes the selectable bitrate ladder", () => {
    expect(TRANSCODE_BITRATES).toEqual([128, 192, 256, 320]);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `pnpm --filter @musex/core exec vitest run transcode-url` → FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
// packages/core/src/logic/transcode-url.ts

/** Bitrates offered in Settings (kbps). VBR ceiling — actual files land at or below. */
export const TRANSCODE_BITRATES = [128, 192, 256, 320] as const;
export type TranscodeBitrate = (typeof TRANSCODE_BITRATES)[number];

export interface TranscodeUrlOpts {
  baseUrl: string;
  token: string;
  clientId: string;
  session: string;
  trackId: string;
  bitrateKbps: number;
}

/** The confirmed single-file MP3 transcode URL (see spec "Transcode — confirmed by spike").
 *  Returns one continuous audio/mpeg body; read to EOF and save. */
export function buildTranscodeUrl(o: TranscodeUrlOpts): string {
  const sp = new URLSearchParams({
    "X-Plex-Token": o.token,
    "X-Plex-Client-Identifier": o.clientId,
    "X-Plex-Session-Identifier": o.session,
    session: o.session,
    "X-Plex-Platform": "Chrome",
    path: `/library/metadata/${o.trackId}`,
    mediaIndex: "0",
    partIndex: "0",
    offset: "0",
    protocol: "http",
    directPlay: "0",
    directStream: "0",
    audioCodec: "mp3",
    musicBitrate: String(o.bitrateKbps),
  });
  return `${o.baseUrl}/audio/:/transcode/universal/start.mp3?${sp.toString()}`;
}

export function stopSessionUrl(o: { baseUrl: string; token: string; clientId: string; session: string }): string {
  const sp = new URLSearchParams({
    session: o.session,
    "X-Plex-Token": o.token,
    "X-Plex-Client-Identifier": o.clientId,
  });
  return `${o.baseUrl}/audio/:/transcode/universal/stop?${sp.toString()}`;
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat(core): pure Plex MP3 transcode URL builder"`

---

### Task 1.2: Pure `download-plan` (key + dedupe)

**Files:**
- Create: `packages/core/src/logic/download-plan.ts`
- Test: `packages/core/src/logic/download-plan.test.ts`

**Context:** The same keying as the media cache so the proxy can look a track up identically: `downloadKey === cacheKey(serverId, plexPath)`. But `cacheKey` lives in desktop (`logic/cache.ts`, uses `node:crypto`). Core must stay Node-free, so the manager passes the already-computed key in; `download-plan` works on a `DownloadJob` shape and dedupes by an opaque `key` string. Keying itself stays in desktop.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/logic/download-plan.test.ts
import { describe, expect, it } from "vitest";
import { dedupeJobs, type DownloadJob } from "./download-plan.js";

const job = (key: string): DownloadJob => ({
  key,
  serverId: "s1",
  plexPath: `/library/parts/${key}/file.flac`,
  trackId: key,
  meta: { title: key, artistName: "A", albumTitle: "Al", durationMs: 1000, thumb: undefined, trackNumber: 1, albumId: "al", artistId: "ar" },
});

describe("dedupeJobs", () => {
  it("drops jobs whose key is already present", () => {
    const out = dedupeJobs([job("a"), job("b"), job("a")], new Set(["b"]));
    expect(out.map((j) => j.key)).toEqual(["a"]);
  });
  it("keeps order and removes duplicates within the batch", () => {
    const out = dedupeJobs([job("x"), job("y"), job("x")], new Set());
    expect(out.map((j) => j.key)).toEqual(["x", "y"]);
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement**

```typescript
// packages/core/src/logic/download-plan.ts

/** Metadata snapshot kept with a download so it's browsable offline. */
export interface DownloadMeta {
  title: string;
  artistName: string;
  albumTitle?: string;
  durationMs: number;
  thumb?: string;
  trackNumber?: number;
  albumId: string;
  artistId: string;
}

export interface DownloadJob {
  /** Opaque store key (desktop computes cacheKey(serverId, plexPath)). */
  key: string;
  serverId: string;
  plexPath: string;
  trackId: string;
  meta: DownloadMeta;
}

/** Drop jobs already present (by key) and de-duplicate within the batch, preserving order. */
export function dedupeJobs(jobs: DownloadJob[], alreadyHave: ReadonlySet<string>): DownloadJob[] {
  const seen = new Set(alreadyHave);
  const out: DownloadJob[] = [];
  for (const j of jobs) {
    if (seen.has(j.key)) continue;
    seen.add(j.key);
    out.push(j);
  }
  return out;
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(core): download job dedupe + types"`

---

### Task 1.3: Pure `offline-availability`

**Files:**
- Create: `packages/core/src/logic/offline-availability.ts`
- Test: `packages/core/src/logic/offline-availability.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/logic/offline-availability.test.ts
import { describe, expect, it } from "vitest";
import { trackAvailability, type LocalPresence } from "./offline-availability.js";

const p = (downloaded: boolean, cached: boolean): LocalPresence => ({ downloaded, cached });

describe("trackAvailability", () => {
  it("online: everything is playable", () => {
    expect(trackAvailability(p(false, false), true)).toBe("playable");
    expect(trackAvailability(p(true, false), true)).toBe("playable");
  });
  it("offline: downloaded or cached is playable", () => {
    expect(trackAvailability(p(true, false), false)).toBe("playable");
    expect(trackAvailability(p(false, true), false)).toBe("playable");
  });
  it("offline: neither downloaded nor cached is dimmed", () => {
    expect(trackAvailability(p(false, false), false)).toBe("unavailable-offline");
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement**

```typescript
// packages/core/src/logic/offline-availability.ts
export interface LocalPresence {
  downloaded: boolean;
  cached: boolean;
}

export type Availability = "playable" | "unavailable-offline";

/** Offline-playable = downloaded ∪ cached. Online, everything is playable. */
export function trackAvailability(local: LocalPresence, online: boolean): Availability {
  if (online) return "playable";
  return local.downloaded || local.cached ? "playable" : "unavailable-offline";
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(core): offline availability decision"`

---

### Task 1.4: Pure `download-state` (record + transitions + reconcile)

**Files:**
- Create: `packages/core/src/logic/download-state.ts`
- Test: `packages/core/src/logic/download-state.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/core/src/logic/download-state.test.ts
import { describe, expect, it } from "vitest";
import { reconcileRecords, type DownloadRecord } from "./download-state.js";

const rec = (key: string, state: DownloadRecord["state"]): DownloadRecord => ({
  key, serverId: "s1", plexPath: `/library/parts/${key}/f.flac`, trackId: key,
  format: "original", state, bytes: 10, addedAt: 1,
  meta: { title: key, artistName: "A", durationMs: 1, albumId: "al", artistId: "ar" },
});

describe("reconcileRecords", () => {
  it("downgrades a 'downloaded' record to 'failed' when its file is missing on disk", () => {
    const out = reconcileRecords([rec("a", "downloaded"), rec("b", "downloaded")], new Set(["a"]));
    expect(out.find((r) => r.key === "a")?.state).toBe("downloaded");
    expect(out.find((r) => r.key === "b")?.state).toBe("missing");
  });
  it("leaves queued/downloading records untouched (file not expected yet)", () => {
    const out = reconcileRecords([rec("c", "queued"), rec("d", "downloading")], new Set());
    expect(out.map((r) => r.state)).toEqual(["queued", "downloading"]);
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement**

```typescript
// packages/core/src/logic/download-state.ts
import type { DownloadMeta } from "./download-plan.js";

export type DownloadStatus = "queued" | "downloading" | "downloaded" | "failed" | "missing";
export type DownloadFormat = "original" | "mp3";

export interface DownloadRecord {
  key: string;
  serverId: string;
  plexPath: string;
  trackId: string;
  format: DownloadFormat;
  state: DownloadStatus;
  bytes: number;
  addedAt: number;
  error?: string;
  meta: DownloadMeta;
}

/** On launch, mark any 'downloaded' record whose file vanished as 'missing'. Records
 *  still queued/downloading have no file yet, so they're left as-is. */
export function reconcileRecords(records: DownloadRecord[], presentKeys: ReadonlySet<string>): DownloadRecord[] {
  return records.map((r) =>
    r.state === "downloaded" && !presentKeys.has(r.key) ? { ...r, state: "missing" as const } : r,
  );
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(core): download record types + reconcile"`

---

### Task 1.5: Barrel-export the new core logic

**Files:**
- Modify: `packages/core/src/index.ts` (the `export * from "./logic/…"` block, alphabetical)

- [ ] **Step 1:** Add these lines in sorted position among the existing `export * from "./logic/…"` lines:

```typescript
export * from "./logic/download-plan";
export * from "./logic/download-state";
export * from "./logic/offline-availability";
export * from "./logic/transcode-url";
```

- [ ] **Step 2: Verify** — `pnpm --filter @musex/core run typecheck` → clean; `pnpm --filter @musex/core test` → all green.
- [ ] **Step 3: Commit** — `git commit -m "feat(core): export download/offline/transcode logic"`

---

### Task 1.6: `DownloadStore` adapter (pinned, no eviction)

**Files:**
- Create: `packages/desktop/src/main/adapters/download-store.ts`
- Test: `packages/desktop/src/main/adapters/download-store.test.ts`

**Context:** Model on `MediaCache` (`media-cache.ts`): same `.part`→atomic-rename `beginWrite` returning `{ stream, commit, abort }`, same `pathIfPresent(key)`, `stats()`. Differences: NO eviction; add `has(key)`, `remove(key)`, `listKeys()`. Reuse the `CacheWriter` shape (re-export the type from media-cache or duplicate a local `StoreWriter`). Keys are the desktop `cacheKey(serverId, plexPath)` hex (so the proxy looks up identically).

- [ ] **Step 1: Write the failing test**

```typescript
// packages/desktop/src/main/adapters/download-store.test.ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DownloadStore } from "./download-store.js";

let dir: string;
let store: DownloadStore;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "musex-dl-"));
  store = new DownloadStore(dir);
  await store.init();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(key: string, data: string): Promise<void> {
  const w = store.beginWrite(key);
  w.stream.write(data);
  w.stream.end();
  await w.commit();
}

describe("DownloadStore", () => {
  it("commits a file and finds it by key", async () => {
    await write("k1", "hello");
    expect(await store.has("k1")).toBe(true);
    const path = await store.pathIfPresent("k1");
    expect(path).toBeTruthy();
  });
  it("abort leaves nothing behind", async () => {
    const w = store.beginWrite("k2");
    w.stream.write("x");
    w.stream.end();
    await w.abort();
    expect(await store.has("k2")).toBe(false);
  });
  it("remove deletes a stored file", async () => {
    await write("k3", "bye");
    await store.remove("k3");
    expect(await store.has("k3")).toBe(false);
  });
  it("stats counts files + bytes; listKeys returns complete keys", async () => {
    await write("a", "12345");
    await write("b", "678");
    expect(await store.listKeys()).toEqual(expect.arrayContaining(["a", "b"]));
    const s = await store.stats();
    expect(s.files).toBe(2);
    expect(s.bytes).toBe(8);
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — mirror `media-cache.ts`'s `beginWrite`/`pathIfPresent`/`stats` (`.part` temp + rename on commit, unlink on abort), drop eviction, add `has`/`remove`/`listKeys`:

```typescript
// packages/desktop/src/main/adapters/download-store.ts
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { join } from "node:path";

export interface StoreWriter {
  stream: WriteStream;
  commit(): Promise<void>;
  abort(): Promise<void>;
}

export interface StoreStats {
  bytes: number;
  files: number;
}

/** Pinned on-disk store for downloaded media. Same atomic-write discipline as
 *  MediaCache, but never evicts. Keyed by cacheKey(serverId, plexPath). */
export class DownloadStore {
  constructor(private readonly dir: string) {}

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private keyPath(key: string): string {
    return join(this.dir, key);
  }

  async has(key: string): Promise<boolean> {
    return (await this.pathIfPresent(key)) !== null;
  }

  async pathIfPresent(key: string): Promise<string | null> {
    try {
      await stat(this.keyPath(key));
      return this.keyPath(key);
    } catch {
      return null;
    }
  }

  beginWrite(key: string): StoreWriter {
    const tmp = join(this.dir, `${key}.${randomBytes(6).toString("hex")}.part`);
    const stream = createWriteStream(tmp);
    let failed = false;
    stream.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code !== "ERR_STREAM_DESTROYED") failed = true;
    });
    const cleanup = () => unlink(tmp).catch(() => {});
    return {
      stream,
      commit: async () => {
        await new Promise<void>((resolve) => {
          if (stream.writableFinished) return resolve();
          stream.end(() => resolve());
        });
        if (failed) {
          await cleanup();
          throw new Error(`download write failed for ${key}`);
        }
        await rename(tmp, this.keyPath(key));
      },
      abort: async () => {
        stream.destroy();
        await cleanup();
      },
    };
  }

  async remove(key: string): Promise<void> {
    await rm(this.keyPath(key), { force: true });
  }

  async listKeys(): Promise<string[]> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    return names.filter((n) => !n.includes(".part"));
  }

  async stats(): Promise<StoreStats> {
    const keys = await this.listKeys();
    let bytes = 0;
    for (const k of keys) {
      try {
        bytes += (await stat(this.keyPath(k))).size;
      } catch {
        /* skip */
      }
    }
    return { bytes, files: keys.length };
  }
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): pinned DownloadStore adapter"`

---

### Task 1.7: `DownloadIndex` (persisted records)

**Files:**
- Create: `packages/desktop/src/main/adapters/download-index.ts`
- Test: `packages/desktop/src/main/adapters/download-index.test.ts`

**Context:** Back it with a `Map` + an injectable persistence hook so the unit test needs no electron-store. Runtime wires the real persistence in Task 1.10.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/desktop/src/main/adapters/download-index.test.ts
import { describe, expect, it } from "vitest";
import { DownloadIndex } from "./download-index.js";
import type { DownloadRecord } from "@musex/core";

const rec = (key: string): DownloadRecord => ({
  key, serverId: "s1", plexPath: `/library/parts/${key}/f.flac`, trackId: key,
  format: "original", state: "queued", bytes: 0, addedAt: 1,
  meta: { title: key, artistName: "A", durationMs: 1, albumId: "al", artistId: "ar" },
});

describe("DownloadIndex", () => {
  it("upserts, gets, lists and removes; persists on every mutation", () => {
    const saved: DownloadRecord[][] = [];
    const idx = new DownloadIndex([], (all) => saved.push(all));
    idx.upsert(rec("a"));
    idx.upsert({ ...rec("a"), state: "downloaded", bytes: 99 });
    expect(idx.get("a")?.state).toBe("downloaded");
    expect(idx.list()).toHaveLength(1);
    idx.remove("a");
    expect(idx.get("a")).toBeUndefined();
    expect(saved.length).toBe(3); // 2 upserts + 1 remove
  });

  it("hydrates from initial records", () => {
    const idx = new DownloadIndex([rec("x")], () => {});
    expect(idx.get("x")).toBeDefined();
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement**

```typescript
// packages/desktop/src/main/adapters/download-index.ts
import type { DownloadRecord } from "@musex/core";

export class DownloadIndex {
  private readonly map = new Map<string, DownloadRecord>();

  constructor(initial: DownloadRecord[], private readonly persist: (all: DownloadRecord[]) => void) {
    for (const r of initial) this.map.set(r.key, r);
  }

  get(key: string): DownloadRecord | undefined {
    return this.map.get(key);
  }

  list(): DownloadRecord[] {
    return [...this.map.values()];
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  upsert(record: DownloadRecord): void {
    this.map.set(record.key, record);
    this.persist(this.list());
  }

  remove(key: string): void {
    this.map.delete(key);
    this.persist(this.list());
  }
}
```

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): persisted DownloadIndex"`

---

### Task 1.8: `DownloadManager` (sequential queue + transcode)

**Files:**
- Create: `packages/desktop/src/main/download/download-manager.ts`
- Test: `packages/desktop/src/main/download/download-manager.test.ts`

**Context:** Concurrency 1. For each job: pick fetch URL (direct part URL via the server endpoint, or `buildTranscodeUrl` when `storageQuality.mode === "mp3"`), stream into `DownloadStore.beginWrite`, update `DownloadIndex` (queued→downloading→downloaded|failed), emit progress via an injected `onProgress`. Inject `fetch`, an `endpoint(serverId)` resolver, the store, the index, and a `getQuality()` getter — so the test uses fakes (no network, no Plex). On transcode completion, GET the stop URL (best-effort). Bounded retry is user-initiated (re-`enqueue`), no auto-retry loop.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/desktop/src/main/download/download-manager.test.ts
import { describe, expect, it, vi } from "vitest";
import { DownloadManager } from "./download-manager.js";
import { DownloadIndex } from "../adapters/download-index.js";
import type { DownloadJob } from "@musex/core";

function fakeStore() {
  const files = new Map<string, string>();
  return {
    files,
    has: async (k: string) => files.has(k),
    beginWrite(key: string) {
      let buf = "";
      return {
        stream: { write: (c: string) => { buf += c; }, end: () => {}, destroyed: false } as never,
        commit: async () => { files.set(key, buf); },
        abort: async () => {},
      };
    },
    remove: async (k: string) => { files.delete(k); },
  };
}

const job = (key: string): DownloadJob => ({
  key, serverId: "s1", plexPath: `/library/parts/${key}/f.flac`, trackId: key,
  meta: { title: key, artistName: "A", durationMs: 1, albumId: "al", artistId: "ar" },
});

describe("DownloadManager", () => {
  it("downloads a job: queued→downloaded, file stored, progress emitted", async () => {
    const store = fakeStore();
    const index = new DownloadIndex([], () => {});
    const progress: string[] = [];
    const fetchFn = vi.fn(async () =>
      new Response("AUDIODATA", { status: 200, headers: { "content-length": "9" } }),
    );
    const mgr = new DownloadManager({
      store: store as never,
      index,
      fetch: fetchFn as never,
      endpoint: async () => ({ baseUrl: "https://pms", token: "t" }),
      clientId: "cid",
      getQuality: () => ({ mode: "original", bitrateKbps: 256 }),
      onProgress: (e) => progress.push(`${e.key}:${e.state}`),
    });
    await mgr.enqueue([job("a")]);
    await mgr.drain(); // test helper: await the queue to idle
    expect(store.files.has("a")).toBe(true);
    expect(index.get("a")?.state).toBe("downloaded");
    expect(progress).toContain("a:downloaded");
  });

  it("transcode mode fetches the MP3 transcode URL", async () => {
    const store = fakeStore();
    const index = new DownloadIndex([], () => {});
    let fetchedUrl = "";
    const fetchFn = vi.fn(async (url: string) => {
      fetchedUrl = url;
      return new Response("MP3", { status: 200 });
    });
    const mgr = new DownloadManager({
      store: store as never, index, fetch: fetchFn as never,
      endpoint: async () => ({ baseUrl: "https://pms", token: "t" }),
      clientId: "cid",
      getQuality: () => ({ mode: "mp3", bitrateKbps: 192 }),
      onProgress: () => {},
    });
    await mgr.enqueue([job("b")]);
    await mgr.drain();
    expect(fetchedUrl).toContain("/audio/:/transcode/universal/start.mp3");
    expect(fetchedUrl).toContain("musicBitrate=192");
    expect(index.get("b")?.format).toBe("mp3");
  });

  it("marks failed on non-200 and stores nothing", async () => {
    const store = fakeStore();
    const index = new DownloadIndex([], () => {});
    const mgr = new DownloadManager({
      store: store as never, index,
      fetch: (async () => new Response("nope", { status: 500 })) as never,
      endpoint: async () => ({ baseUrl: "https://pms", token: "t" }),
      clientId: "cid", getQuality: () => ({ mode: "original", bitrateKbps: 256 }),
      onProgress: () => {},
    });
    await mgr.enqueue([job("c")]);
    await mgr.drain();
    expect(store.files.has("c")).toBe(false);
    expect(index.get("c")?.state).toBe("failed");
  });
});
```

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** — sequential queue; per job set `downloading`, fetch, stream body to store, commit + set `downloaded` (+bytes) or `failed`; emit progress on each transition; `drain()` resolves when the queue empties. Direct URL = `${baseUrl}${plexPath}?X-Plex-Token=…`; transcode URL via `buildTranscodeUrl` + stop URL after. Use `Response.body` (web stream) → write chunks; for the test's plain `Response`, read `arrayBuffer()`.

```typescript
// packages/desktop/src/main/download/download-manager.ts
import { randomUUID } from "node:crypto";
import { buildTranscodeUrl, stopSessionUrl, type DownloadJob, type DownloadRecord } from "@musex/core";
import type { DownloadStore } from "../adapters/download-store.js";
import type { DownloadIndex } from "../adapters/download-index.js";

export interface StorageQuality {
  mode: "original" | "mp3";
  bitrateKbps: number;
}
export interface DownloadProgressEvent {
  key: string;
  state: DownloadRecord["state"];
  bytes: number;
  error?: string;
}
export interface DownloadManagerDeps {
  store: DownloadStore;
  index: DownloadIndex;
  fetch: typeof fetch;
  endpoint: (serverId: string) => Promise<{ baseUrl: string; token: string }>;
  clientId: string;
  getQuality: () => StorageQuality;
  onProgress: (e: DownloadProgressEvent) => void;
}

export class DownloadManager {
  private queue: DownloadJob[] = [];
  private running = false;
  private idle: Promise<void> = Promise.resolve();
  private idleResolve: (() => void) | null = null;

  constructor(private readonly deps: DownloadManagerDeps) {}

  async enqueue(jobs: DownloadJob[]): Promise<void> {
    for (const j of jobs) {
      if (await this.deps.store.has(j.key)) continue;
      this.queue.push(j);
      this.record(j, "queued", 0);
    }
    this.pump();
  }

  /** Test/shutdown helper: resolves when the queue has drained. */
  drain(): Promise<void> {
    return this.idle;
  }

  private record(job: DownloadJob, state: DownloadRecord["state"], bytes: number, error?: string): void {
    const rec: DownloadRecord = {
      key: job.key, serverId: job.serverId, plexPath: job.plexPath, trackId: job.trackId,
      format: this.deps.getQuality().mode === "mp3" ? "mp3" : "original",
      state, bytes, addedAt: this.deps.index.get(job.key)?.addedAt ?? Date.now(), error,
      meta: job.meta,
    };
    this.deps.index.upsert(rec);
    this.deps.onProgress({ key: job.key, state, bytes, error });
  }

  private pump(): void {
    if (this.running) return;
    this.running = true;
    this.idle = new Promise((r) => { this.idleResolve = r; });
    void this.loop();
  }

  private async loop(): Promise<void> {
    while (this.queue.length) {
      const job = this.queue.shift()!;
      await this.runJob(job);
    }
    this.running = false;
    this.idleResolve?.();
  }

  private async runJob(job: DownloadJob): Promise<void> {
    this.record(job, "downloading", 0);
    const quality = this.deps.getQuality();
    const ep = await this.deps.endpoint(job.serverId);
    const session = randomUUID();
    const url =
      quality.mode === "mp3"
        ? buildTranscodeUrl({ baseUrl: ep.baseUrl, token: ep.token, clientId: this.deps.clientId, session, trackId: job.trackId, bitrateKbps: quality.bitrateKbps })
        : `${ep.baseUrl}${job.plexPath}${job.plexPath.includes("?") ? "&" : "?"}X-Plex-Token=${encodeURIComponent(ep.token)}`;
    try {
      const res = await this.deps.fetch(url);
      if (!res.ok) {
        this.record(job, "failed", 0, `status ${res.status}`);
        return;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      const w = this.deps.store.beginWrite(job.key);
      w.stream.write(Buffer.from(buf));
      w.stream.end();
      await w.commit();
      this.record(job, "downloaded", buf.byteLength);
    } catch (e) {
      this.record(job, "failed", 0, e instanceof Error ? e.message : String(e));
    } finally {
      if (quality.mode === "mp3") {
        await this.deps
          .fetch(stopSessionUrl({ baseUrl: ep.baseUrl, token: ep.token, clientId: this.deps.clientId, session }))
          .catch(() => {});
      }
    }
  }

  async removeDownload(key: string): Promise<void> {
    await this.deps.store.remove(key);
    this.deps.index.remove(key);
  }
}
```

> NOTE: real-network streaming (chunked, large files) should pipe `res.body` rather than buffer `arrayBuffer()`. The buffered form keeps this task testable and is acceptable for music files; a follow-up step in Task 1.10 can switch to a piped `node:stream` write once wired to the real `fetch`. Keep the buffered path for now — call it out in the PR.

- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): sequential DownloadManager with transcode support"`

---

### Task 1.9: StreamProxy — serve downloads first + skip-downloaded

**Files:**
- Modify: `packages/desktop/src/main/adapters/stream-proxy.ts` (the cache-read block ~line 187–194; the write-through writer condition ~line 214–219; `prefetch` ~line 421; `resolve` is unchanged)
- Test: `packages/desktop/src/main/adapters/stream-proxy.download.test.ts`

**Context:** Add `configureDownloads(store: DownloadStore)`. In the request handler, BEFORE the media-cache hit, check the download store and `serveFromFile` if present (works offline + Range). In the write-through writer condition and in `prefetch`, skip keys the download store already has (no double-store). The download store is consulted for any `/library/parts/` path regardless of `cacheEnabled`.

- [ ] **Step 1: Write the failing test** — construct a `StreamProxy`, attach a fake download store reporting `has`/`pathIfPresent` for one key, start it, and assert a request for that key serves the local file (200, the file bytes) without hitting upstream. (Mirror any existing stream-proxy test harness; if none, drive `handle` with mock `req`/`res`.) Assert `prefetch` filters out downloaded keys.

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** — add the field + method and the serve/skip branches:

```typescript
// add near configureCache (~line 76)
private downloads: { pathIfPresent(key: string): Promise<string | null>; has(key: string): Promise<boolean> } | null = null;
configureDownloads(store: { pathIfPresent(key: string): Promise<string | null>; has(key: string): Promise<boolean> }): void {
  this.downloads = store;
}
```

```typescript
// in handle(), immediately BEFORE the existing media-cache hit block (~line 187),
// for cacheable media paths:
if (this.downloads && isCacheablePath(plexPath)) {
  const dlHit = await this.downloads.pathIfPresent(cacheKey(serverId, plexPath));
  if (dlHit) {
    await this.serveFromFile(req, res, dlHit, contentTypeForPath(plexPath));
    return;
  }
}
```

```typescript
// in the write-through writer condition (~line 214): do not cache a track that is
// already a pinned download. Guard the audio-cache branch:
//   cachingOn && this.cache && key && !req.headers.range && !(await this.downloads?.has(key))
// Since the condition is synchronous, hoist an `isDownloaded` check above it:
const isDownloaded = key && this.downloads ? await this.downloads.has(key) : false;
// ...then in the writer ternary replace `cachingOn && this.cache && key && !req.headers.range`
// with `cachingOn && this.cache && key && !req.headers.range && !isDownloaded`.
```

```typescript
// in prefetch() (~line 421), after computing `wanted`, drop downloaded keys.
// prefetch is sync; resolve presence first. Replace the body's filtering with an
// async pre-filter: keep an in-memory Set the manager updates, OR check store.has
// inside pumpPrefetch's per-item start. Simplest: in pumpPrefetch, before
// cacheFromUpstream, `if (await this.downloads?.has(item.key)) { onDone(); continue; }`.
```

- [ ] **Step 4: Run, verify pass.** Then `pnpm --filter @musex/desktop test stream-proxy` green.
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): proxy serves downloads first, skips caching them"`

---

### Task 1.10: Persistence + Runtime wiring for downloads

**Files:**
- Modify: `packages/desktop/src/main/adapters/persistence.ts` (add a `downloads-index` separate Store + getter/setter; add `storageQuality` to `PersistedState`)
- Modify: `packages/desktop/src/main/runtime.ts` (own `downloadStore`, `downloadIndex`, `downloadManager`; init order after caches; sink for progress)
- Modify: `packages/desktop/src/main/index.ts` (`wireEngineEvents`: `runtime.setDownloadProgressSink(...)`)

- [ ] **Step 1:** persistence — add a separate store + `storageQuality` field:

```typescript
// separate store (large/frequently-written), next to queueStore/cursorStore:
const downloadsStore = new Store<{ records: DownloadRecord[] }>({ name: "downloads-index", defaults: { records: [] } });
// PersistedState: add `storageQuality: StorageQuality;`
// defaults: storageQuality: { mode: "original", bitrateKbps: 256 },
// persistence object:
getDownloadRecords(): DownloadRecord[] { return downloadsStore.get("records"); },
setDownloadRecords(records: DownloadRecord[]): void { downloadsStore.set("records", records); },
getStorageQuality(): StorageQuality { return store.get("storageQuality"); },
setStorageQuality(q: StorageQuality): void { store.set("storageQuality", q); },
```
Import `DownloadRecord` from `@musex/core` and `StorageQuality` from the manager (or define `StorageQuality` in core logic and import from `@musex/core` — preferred; move the `StorageQuality` interface into `download-state.ts` and re-export, then import it in both manager and persistence).

- [ ] **Step 2:** Runtime — fields + init (after `this.artCache`/proxy setup, before/after libraryWatcher). Use the `cacheKey` from `../../logic/cache.js` to compute job keys when enqueuing:

```typescript
// fields
readonly downloadStore = new DownloadStore(path.join(app.getPath("userData"), "downloads"));
downloadManager!: DownloadManager;
private downloadProgressSink: ((e: DownloadProgressEvent) => void) | null = null;
setDownloadProgressSink(s: ((e: DownloadProgressEvent) => void) | null): void { this.downloadProgressSink = s; }

// in init(), after proxy.start():
await this.downloadStore.init();
this.proxy.configureDownloads(this.downloadStore);
const presentKeys = new Set(await this.downloadStore.listKeys());
const reconciled = reconcileRecords(persistence.getDownloadRecords(), presentKeys);
persistence.setDownloadRecords(reconciled);
const downloadIndex = new DownloadIndex(reconciled, (all) => persistence.setDownloadRecords(all));
this.downloadManager = new DownloadManager({
  store: this.downloadStore,
  index: downloadIndex,
  fetch: globalThis.fetch,
  endpoint: (serverId) => this.gateway.endpoint(serverId, this.requireToken()),
  clientId: persistence.getClientId(),
  getQuality: () => persistence.getStorageQuality(),
  onProgress: (e) => this.downloadProgressSink?.(e),
});
this.downloadIndex = downloadIndex; // expose for IPC
```

- [ ] **Step 3:** `index.ts` `wireEngineEvents`: `runtime.setDownloadProgressSink((e) => { if (!win.isDestroyed()) win.webContents.send(IPC.downloadsProgress, e); });`

- [ ] **Step 4: Verify** — `pnpm --filter @musex/desktop run typecheck` clean.
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): wire DownloadStore/Index/Manager into Runtime + persistence"`

---

### Task 1.11: Downloads IPC (add/remove/list/progress) + availability

**Files:**
- Modify: `packages/desktop/src/shared/ipc-contract.ts` (IPC entries + `MusexApi` methods + Dto types)
- Modify: `packages/desktop/src/preload/index.ts`
- Modify: `packages/desktop/src/main/ipc.ts`

**Context:** `downloadAlbum`/`downloadArtist` expand via the gateway in the handler (list tracks), build jobs with `cacheKey`, `dedupeJobs` against the index, enqueue. `getLocalAvailability(serverId, plexPaths[])` returns per-path `{ downloaded, cached }` by checking `downloadStore.has` + `cache.pathIfPresent`.

- [ ] **Step 1:** ipc-contract — add channels + Dtos + `MusexApi`:

```typescript
// IPC map
downloadTracks: "musex:downloads:tracks",     // (trackIds[], libraryId) -> void
downloadAlbum: "musex:downloads:album",       // (albumId, libraryId) -> void
downloadArtist: "musex:downloads:artist",     // (artistId, libraryId) -> void
removeDownload: "musex:downloads:remove",     // (key) -> void
downloadsList: "musex:downloads:list",        // -> DownloadDto[]
downloadsProgress: "musex:downloads:progress",// push -> DownloadProgressEvent
localAvailability: "musex:downloads:availability", // (serverId, plexPaths[]) -> AvailabilityDto[]
// Dtos
export type DownloadDto = DownloadRecord;            // re-export shape from core
export type AvailabilityDto = { plexPath: string; downloaded: boolean; cached: boolean };
// MusexApi: matching method signatures + onDownloadsProgress(cb): () => void
```

- [ ] **Step 2:** preload — invoke wrappers + the `onDownloadsProgress` subscription (mirror `onPluginNotify`).

- [ ] **Step 3:** ipc.ts handlers:

```typescript
ipcMain.handle(IPC.downloadsList, () => rt.downloadIndex.list());
ipcMain.handle(IPC.removeDownload, (_e, key: string) => {
  if (typeof key !== "string") throw new Error("invalid key");
  return rt.downloadManager.removeDownload(key);
});
ipcMain.handle(IPC.downloadTracks, async (_e, trackIds: string[], libraryId: string) => {
  const lib = rt.findLibrary(libraryId);
  await rt.ensureProxyEndpoint(lib.serverId);
  // resolve tracks → jobs. For tracks we already hold partKey via listTracks; re-list the album
  // is wasteful, so accept Track objects instead: change signature to (tracks: Track[]).
});
// PREFER: downloadTracks takes Track[] (renderer already has them). Album/Artist expand via gateway:
ipcMain.handle(IPC.downloadAlbum, async (_e, albumId: string, libraryId: string) => {
  const lib = rt.findLibrary(libraryId);
  const tracks = await rt.gateway.listTracks(lib, albumId, rt.requireToken());
  await rt.enqueueDownloads(tracks); // helper on Runtime: maps Track[]→jobs via cacheKey + dedupeJobs
});
ipcMain.handle(IPC.localAvailability, async (_e, serverId: string, plexPaths: string[]) => {
  const out: { plexPath: string; downloaded: boolean; cached: boolean }[] = [];
  for (const p of plexPaths) {
    const k = cacheKey(serverId, p);
    out.push({ plexPath: p, downloaded: await rt.downloadStore.has(k), cached: (await rt.cache.pathIfPresent(k)) !== null });
  }
  return out;
});
```

Add `Runtime.enqueueDownloads(tracks: Track[])`: maps each to a `DownloadJob` (`key: cacheKey(serverId, partKey)`, `meta` from the Track), `dedupeJobs` against `downloadIndex` keys, `downloadManager.enqueue`. Settle `downloadTracks` to take `Track[]`.

- [ ] **Step 4: Verify** typecheck + a small ipc smoke (optional). 
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): downloads IPC (add/remove/list/progress/availability)"`

---

## Phase 2 — Connectivity + offline metadata

### Task 2.1: `ConnectivityMonitor`

**Files:**
- Create: `packages/desktop/src/main/adapters/connectivity-monitor.ts`
- Test: `packages/desktop/src/main/adapters/connectivity-monitor.test.ts`

**Context:** Tracks `online`. `noteSuccess()`/`noteFailure(err)` are called by the gateway-call sites (or a wrapper); a periodic probe (injected `probe()` + injected timer) confirms reachability when idle. Debounce: flip to offline only after N consecutive failures; flip to online on first success. `PlexAuthError` is NOT offline (ignored — sign-in owns it). Emits via `onChange(cb)`.

- [ ] **Step 1: Write the failing test** — inject a fake clock + probe; assert: starts online; one failure stays online; ≥2 consecutive failures → offline + onChange(false); a success → online + onChange(true); a `PlexAuthError` failure does not flip offline.

- [ ] **Step 2: Run, verify fail.**
- [ ] **Step 3: Implement** the debounced state machine (consecutive-failure threshold = 2; success resets). Expose `online`, `noteSuccess`, `noteFailure(err)`, `onChange`, `start(probe, intervalMs)`/`stop` using injected `setInterval`/`clearInterval` (default to globals).
- [ ] **Step 4: Run, verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(desktop): ConnectivityMonitor state machine"`

### Task 2.2: Wire connectivity into Runtime + gateway calls + IPC push

**Files:**
- Modify: `runtime.ts` (own `connectivityMonitor`; call `noteSuccess/noteFailure` around gateway/proxy operations — at minimum in `ensureProxyEndpoint` and the `libraryWatcher` reconnect path; sink), `index.ts` (`setConnectivitySink` → `webContents.send(IPC.connectivityChanged, {online})`), `ipc-contract.ts` + `preload` (`connectivityChanged` push + `onConnectivityChanged`; plus a `getConnectivity()` invoke for initial state).
- [ ] **Steps:** add monitor to Runtime init, hook `noteSuccess/noteFailure` at the gateway call boundary (wrap `ensureProxyEndpoint` + a couple of list calls; do NOT treat `PlexAuthError` as offline), add the sink + IPC + preload (mirror `onLibraryChanged`). Test the wrapper boundary if extractable; otherwise rely on the Task 2.1 unit test + manual. Commit `feat(desktop): connectivity monitor wired to gateway + pushed to renderer`.

### Task 2.3: Cache the top-level artists list

**Files:**
- Modify: `packages/desktop/src/main/adapters/caching-plex-gateway.ts`
- Test: extend its test (or `caching-plex-gateway.test.ts`)

**Context:** `listArtists(library, token, validator?)` currently isn't cached (per CLAUDE.md). Add caching keyed `artists:{library.id}` validated by `listValidator(library.updatedAt)` (the same validator the renderer already passes). Mirror the existing `listAlbums`/`listTracks` cache path in this file.
- [ ] **Steps:** TDD — test that a second `listArtists` with a matching validator returns cached data without a gateway call, and a changed validator refetches. Implement by adding the cache wrap around the inner gateway's `listArtists`. Commit `feat(desktop): cache top-level artists list for offline browse`.

### Task 2.4: Renderer connectivity state

**Files:**
- Modify: `packages/desktop/src/renderer/src/state/app.tsx`
- [ ] **Steps:** add `connectivity: "online" | "offline"` to `AppState` (init "online"), `{ type: "connectivity-changed"; online: boolean }` to the Action union + reducer case, and a `useEffect` listener `window.musex.onConnectivityChanged(({online}) => dispatch({type:"connectivity-changed", online}))` (mirror the `onLibraryChanged` block) plus a one-shot `getConnectivity()` on mount. Commit `feat(renderer): connectivity state + listener`.

---

## Phase 3 — UI (badges, filter, On this device, marker, dimming, actions)

### Task 3.1: Extend badge states

**Files:**
- Modify: `packages/desktop/src/renderer/src/ui/state-badge.ts` (`AcquisitionBadgeState` union + `StateBadge` rendering)
- [ ] **Steps:** add `"downloaded"` (green check) and `"downloading"` (blue ring + percent) to the state union + the badge label/icon/color mapping (lucide `CircleCheck`, a spinner/`LoaderCircle`). Keep existing acquisition states. Test the mapping if there's a pure helper; else visual. Commit `feat(renderer): downloaded/downloading badge states`.

### Task 3.2: "On this device" view + sidebar swap

**Files:**
- Create: `packages/desktop/src/renderer/src/ui/views/OnDeviceView.tsx`
- Modify: `Shell.tsx` (nav button label/icon → "On this device", `HardDriveDownload` icon; `view.name` "downloads" → "on-device"; route to `OnDeviceView`), `state/app.tsx` (View union: replace `{name:"downloads"}` with `{name:"on-device"}` and add `{name:"acquiring"}`).
- [ ] **Steps:** `OnDeviceView` fetches `window.musex.downloadsList()` + subscribes `onDownloadsProgress` to live-update; renders an active-downloads strip (records with state `downloading`/`queued`, progress) + a tiled grid of `downloaded` records grouped (Albums default) using `GridCard` (`state="downloaded"`, `onAction`=remove via `removeDownload(key)`); shows total storage from a `downloadsList` reduce. Mirror `AlbumsView`'s fetch/loading/error pattern. Swap the Shell nav slot. Commit `feat(renderer): On this device view replaces Downloads nav slot`.

### Task 3.3: In-view filter (All · Downloaded · Acquiring)

**Files:**
- Create: `packages/desktop/src/renderer/src/ui/LibraryFilter.tsx` (a segmented control)
- Modify: library views (`AlbumsView`, `ArtistsView`) to render it + apply.
- [ ] **Steps:** a small segmented control (mirror `SortSelector`); the hosting view filters its items by the selected mode using an availability/acquiring overlay (Task 3.4 supplies the per-item state). When `connectivity === "offline"`, default selection behaves per spec (un-downloaded dimmed, not hidden — so "All" still shows, dimmed). Commit `feat(renderer): library filter control`.

### Task 3.4: Availability overlay + dimming on cards/rows

**Files:**
- Modify: library views (use `getLocalAvailability` for the visible items → map plexPath→presence), pass `dim`/`state` to `GridCard`; `TrackRow.tsx` add `downloadState?: "downloaded" | "downloading" | undefined` + a small indicator; `offline-availability` (core) decides dim.
- [ ] **Steps:** in each view, after items load, call `window.musex.localAvailability(serverId, plexPaths)` and build a map; compute `trackAvailability(presence, online)` per item; pass `dim={avail === "unavailable-offline"}` + `state` to `GridCard`, and `downloadState` to `TrackRow`. Commit `feat(renderer): per-item download badges + offline dimming`.

### Task 3.5: Offline marker pill

**Files:**
- Modify: `packages/desktop/src/renderer/src/ui/TopBar.tsx`
- [ ] **Steps:** read `connectivity` from `useApp()`; render a red `.topbar-offline-pill` (lucide `WifiOff`, "Offline") after the search box when offline. Add the CSS class (small red pill, right-aligned). Commit `feat(renderer): offline marker in top bar`.

### Task 3.6: Download actions in context menu + headers

**Files:**
- Modify: `TrackContextMenu.tsx` (Download / Remove download items, gated on the track's current download state), album header (`AlbumDetailView`) + artist menu (`ArtistDetailView`) Download buttons.
- [ ] **Steps:** add a `.ctx-sep` + a Download/Remove item (lucide `Download`/`Trash2`) calling `window.musex.downloadTracks([track], libraryId)` / `removeDownload(key)`; album header gets a Download button calling `downloadAlbum(albumId, libraryId)` with progress→done states from the downloads slice; artist ⋯ gets "Download all albums" → `downloadArtist`. Commit `feat(renderer): download/remove actions on tracks, albums, artists`.

### Task 3.7: Graceful degradation of online-only actions

**Files:**
- Modify: search entry, acquire/monitor actions, plugin-lookup actions to disable + show the friendly message when `connectivity === "offline"`.
- [ ] **Steps:** add a small `useApp()`-driven `offline` guard; disable the relevant buttons with a tooltip and render the inline "You're offline — to do X you need to reconnect. Your downloads are under On this device." message where a full view can't load. Commit `feat(renderer): offline-aware degradation + messaging`.

---

## Phase 4 — Transcode wiring (Settings)

### Task 4.1: storageQuality IPC

**Files:**
- Modify: `ipc-contract.ts` (`storageGetQuality`/`storageSetQuality` + `StorageQualityDto`), `preload`, `ipc.ts` (handlers calling `persistence.getStorageQuality/setStorageQuality`; validate `mode ∈ {original,mp3}`, `bitrateKbps ∈ TRANSCODE_BITRATES`).
- [ ] **Steps:** add channels + handlers with validation (reject invalid → throw, mirror `setCacheMaxBytes`). Commit `feat(desktop): storage-quality IPC`.

### Task 4.2: Settings "Downloads & Storage" pane

**Files:**
- Modify: `SettingsView.tsx` (CATEGORIES already has `library`; rename label to "Downloads & Storage" or add a dedicated subsection in the library pane), add a `StorageQualitySection` + move/keep the existing `CacheSection`, add a downloads size + "Remove all downloads" row.
- [ ] **Steps:** build `StorageQualitySection` mirroring `CacheSection`'s optimistic pattern: Original↔MP3 toggle (`storageSetQuality`), a bitrate `<select>` (TRANSCODE_BITRATES) shown when MP3, help text ("VBR ceiling; first live listen plays original"); a downloads-storage row (size from `downloadsList` reduce; "Remove all" → loop `removeDownload`). Apply-to-mpv-style optimistic update + revert + `error-text`. Commit `feat(renderer): Downloads & Storage settings pane`.

---

## Phase 5 — Acquisition rework (badge + Acquiring filter view)

### Task 5.1: Rename DownloadsView → AcquiringView, reachable via filter

**Files:**
- Rename: `DownloadsView.tsx` → `AcquiringView.tsx` (keep its three sections: expansions, acquisition queue, watched); Modify `Shell.tsx` routing (`{name:"acquiring"}` → `AcquiringView`); reach it from the "Acquiring" filter selection (Task 3.3) and/or a small entry — NOT a top-level nav slot (that's now "On this device").
- [ ] **Steps:** rename + update imports + route; the "Acquiring" filter mode in library views routes to / surfaces acquisition state; preserve `expansionReject`/`newReleaseWatch*` actions. Commit `feat(renderer): acquisition feed becomes Acquiring view + filter (frees the Downloads slot)`.

### Task 5.2: Acquiring badge on items

**Files:**
- Modify: library views to overlay acquisition status (from `acquisitionStatus()` mapped by artist/album name) → `state="requested"`/`monitored` on `GridCard` (infra already exists).
- [ ] **Steps:** fetch `acquisitionStatus()` once per view (cached), map to visible items by name, pass the existing acquisition `state`. Commit `feat(renderer): Acquiring badge on library items`.

---

## Phase 6 — Finalize

### Task 6.1: Full check + CLAUDE.md + PR

- [ ] **Step 1:** `pnpm check` (root) → green (typecheck all packages + biome + all tests). Fix anything.
- [ ] **Step 2:** Update project `CLAUDE.md` with a concise bullet: the downloads/offline/transcode feature — DownloadStore (pinned, `userData/downloads/`, bypasses LRU cache), serve order downloads→cache→upstream, ConnectivityMonitor + offline degradation + artists-list caching, MP3-only transcode (`start.mp3?protocol=http`, `musicBitrate` VBR), "On this device" replaced the acquisition Downloads nav slot (now Acquiring badge+filter), `storageQuality` + downloads-index electron-store files.
- [ ] **Step 3:** Commit; ensure branch pushed; the draft PR for `feature/offline-downloads-transcode` is updated with the summary.

---

## Self-review notes (controller)

- **Spec coverage:** downloads store/index/manager (1.6–1.8, 1.10), serve order + skip (1.9), downloads IPC + availability (1.11), connectivity (2.1–2.2, 2.4), artists-list caching (2.3), badges/filter/On-this-device/marker/dimming/actions/degradation (3.1–3.7), transcode settings (4.1–4.2), acquisition rework (5.1–5.2), CLAUDE.md/PR (6.1). Pure logic: transcode-url (1.1), download-plan (1.2), offline-availability (1.3), download-state (1.4).
- **Deliberate simplification:** no `Track.local?` model field — availability is a renderer overlay via `localAvailability` IPC (avoids mapper/persistence churn the spec's hint would cause). Recorded here so it isn't read as a gap.
- **Deferred within tasks:** `DownloadManager` buffers the body (arrayBuffer) for testability; switch to a piped `node:stream` write against real `fetch` as a noted follow-up step in 1.10/PR.
- **Type consistency:** `DownloadJob`/`DownloadMeta`/`DownloadRecord`/`StorageQuality` defined in core (`download-plan.ts`/`download-state.ts`), imported everywhere; `cacheKey` (desktop `logic/cache.ts`) computes all store keys; `buildTranscodeUrl`/`stopSessionUrl`/`TRANSCODE_BITRATES` from `transcode-url.ts`.
