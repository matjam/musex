# Mobile Feature Parity — Phase C: Downloads + Offline + Transcoded Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Download tracks/albums to the device (Original or AAC), play + browse them offline, with graceful degradation when Plex is unreachable.

**Architecture:** Promote the desktop download lookup/set helpers to `@musex/core` (the deferred piece). Add iOS adapters: a `DownloadStore` over the SDK-56 `expo-file-system` `File` API, a `DownloadIndex` (async-storage), a `DownloadManager` (sequential; original = native download task, AAC = HLS segment-stitch via the core `transcode-url` parsers), and a `ConnectivityMonitor` (netinfo + debounced Plex probe). The stream resolver returns a local `file://` URI when a track is downloaded. UI: a Library "Downloaded" segment, action-sheet Download, Settings → Downloads, and an app-wide offline banner.

**Tech Stack:** TypeScript 6, Expo SDK 56 / RN 0.85, vitest 4 (fake store + fake fetch), biome 2. New deps: `expo-file-system` + `@react-native-community/netinfo` (native → dev-client rebuild).

**Spec:** `docs/superpowers/specs/2026-06-17-mobile-parity-phase-c-offline-downloads-design.md`

---

## Conventions for every task

- **Verification bar:** after a task's edits, `pnpm check` from `/Users/matjam/src/musex` → exit 0. biome diffs → `pnpm exec biome check --write .` then re-run.
- Core (`packages/core/src`) NEVER imports its own barrel — relative `.js`. App/test files may import `@musex/core`.
- `import type` for types; merge `@musex/core` imports; lucide icons only; `git add -A`; one commit per task with the exact message.
- UI tasks have no unit tests (gate = `pnpm check`; on-device acceptance is the user's). Core + adapter-logic tasks are TDD.
- Branch `feature/mobile-parity-phase-c-offline-downloads` has the spec committed. Do NOT push (controller pushes after review).

---

## File Structure

**Core (new):** `logic/download-lookup.ts` (promoted `downloadKey`/`buildDownloadLookup`/`downloadRecordFor` + `downloadedContainerIds`/`downloadingContainerIds`) + test; barrel.
**Desktop (modified):** repoint `downloaded-records`/`downloaded-set` consumers to `@musex/core`; delete the desktop util files.
**Mobile (new, `src/downloads/`):** `download-store.ts`, `download-index.ts` (+test), `download-manager.ts` (+test), `connectivity-monitor.ts` (+test), `storage-config.ts` (+test).
**Mobile (modified):** `src/adapters/stream-resolver.ts` (local-first), `src/state/store.tsx` (wiring), `app/(tabs)/library/index.tsx` (Downloaded segment), `app/(tabs)/settings/{_layout,index,downloads}.tsx`, `src/ui/TrackActionSheet.tsx` (Download row), `app/_layout.tsx` or `(tabs)/_layout.tsx` (offline banner), `package.json`.

---

### Task 1: Promote download lookup/set helpers to core

**Files:** Create `packages/core/src/logic/download-lookup.ts` (+ `.test.ts`); modify `packages/core/src/index.ts`; repoint desktop consumers; delete `packages/desktop/src/renderer/src/util/downloaded-records.ts` + `downloaded-set.ts` (+ their tests move to core).

The desktop helpers use `DownloadDto`; core uses `DownloadRecord` (same shape — `state`/`serverId`/`plexPath`/`meta.albumId|artistId`, and records helper uses `track.media.partKey`). Type the core versions on `DownloadRecord`.

- [ ] **Step 1: Write the failing test** (`download-lookup.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import type { DownloadRecord, Track } from "../index.js";
import {
  buildDownloadLookup,
  downloadKey,
  downloadRecordFor,
  downloadedContainerIds,
  downloadingContainerIds,
} from "./download-lookup.js";

const rec = (over: Partial<DownloadRecord>): DownloadRecord => ({
  key: "k",
  serverId: "s1",
  plexPath: "/library/parts/1/f.flac",
  trackId: "t1",
  format: "original",
  state: "downloaded",
  bytes: 10,
  addedAt: 0,
  meta: { title: "T", artistName: "A", durationMs: 1, albumId: "al1", artistId: "ar1", container: "flac", audioCodec: "flac", partId: "1" },
  ...over,
});

describe("downloadKey", () => {
  it("joins serverId + plexPath with the unit separator", () => {
    expect(downloadKey("s1", "/p")).toBe("s1␟/p");
  });
});

describe("buildDownloadLookup / downloadRecordFor", () => {
  it("includes only downloaded records, keyed by serverId+plexPath", () => {
    const lookup = buildDownloadLookup([rec({}), rec({ state: "queued", plexPath: "/q" })]);
    expect(lookup.size).toBe(1);
    const track = { serverId: "s1", media: { partKey: "/library/parts/1/f.flac" } } as Track;
    expect(downloadRecordFor(lookup, track)?.trackId).toBe("t1");
  });
});

describe("container id sets", () => {
  it("downloadedContainerIds collects albumId/artistId of downloaded records", () => {
    expect(downloadedContainerIds([rec({})], "albumId").has("al1")).toBe(true);
    expect(downloadedContainerIds([rec({ state: "queued" })], "albumId").size).toBe(0);
  });
  it("downloadingContainerIds collects queued + downloading", () => {
    expect(downloadingContainerIds([rec({ state: "downloading" })], "artistId").has("ar1")).toBe(true);
    expect(downloadingContainerIds([rec({ state: "downloaded" })], "artistId").size).toBe(0);
  });
});
```

- [ ] **Step 2: Run → fail.** `pnpm --filter @musex/core exec vitest run src/logic/download-lookup.test.ts`

- [ ] **Step 3: Implement** (`download-lookup.ts`) — port the two desktop files, typed on `DownloadRecord` (import `Track`/`DownloadRecord` from relative core paths):

```ts
import type { DownloadRecord } from "./download-state.js";
import type { Track } from "../models/index.js";

/** Composite key for a downloaded track: Plex server id + media part path,
 *  joined by U+241F (can't appear in either). The download store + the "is this
 *  track downloaded?" probe share this key. */
export function downloadKey(serverId: string, plexPath: string): string {
  return `${serverId}␟${plexPath}`;
}

/** Lookup of fully-downloaded records keyed by `downloadKey`. Only
 *  `state === "downloaded"` (others have no file on disk yet). */
export function buildDownloadLookup(records: DownloadRecord[]): Map<string, DownloadRecord> {
  const map = new Map<string, DownloadRecord>();
  for (const r of records) {
    if (r.state !== "downloaded") continue;
    map.set(downloadKey(r.serverId, r.plexPath), r);
  }
  return map;
}

/** The downloaded record for a track (by serverId + media.partKey), or undefined. */
export function downloadRecordFor(
  lookup: Map<string, DownloadRecord>,
  track: Track,
): DownloadRecord | undefined {
  return lookup.get(downloadKey(track.serverId, track.media.partKey));
}

/** Container ids (album or artist) with at least one fully-downloaded track. */
export function downloadedContainerIds(
  records: DownloadRecord[],
  key: "albumId" | "artistId",
): Set<string> {
  const ids = new Set<string>();
  for (const r of records) {
    if (r.state !== "downloaded") continue;
    const id = r.meta[key];
    if (id) ids.add(id);
  }
  return ids;
}

/** Container ids with at least one in-flight (queued|downloading) track. */
export function downloadingContainerIds(
  records: DownloadRecord[],
  key: "albumId" | "artistId",
): Set<string> {
  const ids = new Set<string>();
  for (const r of records) {
    if (r.state !== "downloading" && r.state !== "queued") continue;
    const id = r.meta[key];
    if (id) ids.add(id);
  }
  return ids;
}
```

- [ ] **Step 4: Run → pass.** Barrel: add `export * from "./logic/download-lookup";` to `packages/core/src/index.ts`.

- [ ] **Step 5: Repoint desktop + delete the util files.** In each desktop file importing from `../util/downloaded-records` or `../util/downloaded-set` (per grep: `useDownloadRecords.ts`, `useDownloadedSet.ts`, `PlaylistView.tsx`, `MixView.tsx`, `SearchView.tsx`, `AlbumDetailView.tsx`, `SmartPlaylistView.tsx`, `GenreView.tsx`, `TracksView.tsx`), change the import to `@musex/core`. Desktop's `DownloadDto` is structurally compatible with `DownloadRecord` — if tsc complains at a call site, the dto is assignable (same fields); if not, cast at the call (`as DownloadRecord[]`) — but first try without. Then `rm packages/desktop/src/renderer/src/util/downloaded-records.ts packages/desktop/src/renderer/src/util/downloaded-set.ts` and their `.test.ts` (the test cases are now covered by the core test).

- [ ] **Step 6: Verify + commit.** `pnpm check` → 0 (desktop's download badges/lookups now use the core helpers; desktop tests green).
```bash
git add -A
git commit -m "feat(core): promote download lookup/set helpers (downloadKey, buildDownloadLookup)"
```

---

### Task 2: Install native deps

**Files:** `packages/mobile/package.json`.

- [ ] **Step 1: Install.** `pnpm --filter @musex/mobile exec expo install expo-file-system @react-native-community/netinfo` (pins SDK-56-compatible versions). Confirm both land in `package.json`.

- [ ] **Step 2: Verify + commit.** `pnpm check` → 0 (deps resolve; no code yet).
```bash
git add -A
git commit -m "chore(mobile): add expo-file-system + netinfo for offline downloads"
```

(Native modules → the user rebuilds the dev client at the end; CI stays JS-only.)

---

### Task 3: `DownloadStore` (expo-file-system File API)

**Files:** Create `packages/mobile/src/downloads/download-store.ts`.

The store is the native-fs adapter (not unit-tested — the manager is tested against a fake store implementing this interface). Uses the SDK-56 `File`/`Directory`/`Paths` API: `new File(dir, name)`, `.create()`, `.write(bytes, { append: true })`, `.size`, `.exists`, `.delete()`, `.move(dest)`, `.uri`, and `File.createDownloadTask(url, dest, { onProgress }).downloadAsync()`.

- [ ] **Step 1: Implement** (`download-store.ts`):

```ts
import { Directory, File, Paths } from "expo-file-system";

/** A streaming writer for the AAC segment-stitch path: append bytes to a
 *  `.part` file, then atomically move it into place on commit. */
export interface StoreWriter {
  write(bytes: Uint8Array): void;
  commit(): Promise<void>;
  abort(): Promise<void>;
}

/** Pinned download storage in the app document directory (never evicted). Keyed
 *  by `downloadKey(serverId, plexPath)`. */
export class DownloadStore {
  private readonly dir = new Directory(Paths.document, "downloads");

  private ensureDir(): void {
    if (!this.dir.exists) this.dir.create();
  }

  has(key: string): boolean {
    return new File(this.dir, key).exists;
  }

  size(key: string): number {
    const f = new File(this.dir, key);
    return f.exists ? (f.size ?? 0) : 0;
  }

  uri(key: string): string {
    return new File(this.dir, key).uri;
  }

  /** AAC path: append segment bytes to `<key>.part`, then move to `<key>`. */
  beginWrite(key: string): StoreWriter {
    this.ensureDir();
    const part = new File(this.dir, `${key}.part`);
    if (part.exists) part.delete();
    part.create();
    return {
      write: (bytes) => part.write(bytes, { append: true }),
      commit: async () => {
        const final = new File(this.dir, key);
        if (final.exists) final.delete();
        part.move(final);
      },
      abort: async () => {
        if (part.exists) part.delete();
      },
    };
  }

  /** Original path: native download task to `<key>.part`, then move to `<key>`. */
  async downloadUrl(
    key: string,
    url: string,
    onProgress?: (bytesWritten: number, totalBytes: number) => void,
  ): Promise<number> {
    this.ensureDir();
    const part = new File(this.dir, `${key}.part`);
    if (part.exists) part.delete();
    const task = File.createDownloadTask(url, part, {
      onProgress: onProgress
        ? ({ bytesWritten, totalBytes }) => onProgress(bytesWritten, totalBytes)
        : undefined,
    });
    const downloaded = await task.downloadAsync();
    const bytes = downloaded.size ?? 0;
    if (bytes <= 0) {
      if (part.exists) part.delete();
      throw new Error("empty download");
    }
    const final = new File(this.dir, key);
    if (final.exists) final.delete();
    part.move(final);
    return bytes;
  }

  remove(key: string): void {
    const f = new File(this.dir, key);
    if (f.exists) f.delete();
    const part = new File(this.dir, `${key}.part`);
    if (part.exists) part.delete();
  }

  /** Keys of present, non-empty, non-`.part` files (for reconcile + size totals). */
  presentNonEmptyKeys(): Set<string> {
    const keys = new Set<string>();
    if (!this.dir.exists) return keys;
    for (const entry of this.dir.list()) {
      if (entry instanceof File && entry.name && !entry.name.endsWith(".part") && (entry.size ?? 0) > 0) {
        keys.add(entry.name);
      }
    }
    return keys;
  }

  totalBytes(): number {
    if (!this.dir.exists) return 0;
    let total = 0;
    for (const entry of this.dir.list()) {
      if (entry instanceof File && !entry.name.endsWith(".part")) total += entry.size ?? 0;
    }
    return total;
  }
}

/** The interface the DownloadManager depends on (fake-able in tests). */
export type FileStore = Pick<
  DownloadStore,
  "has" | "size" | "uri" | "beginWrite" | "downloadUrl" | "remove" | "presentNonEmptyKeys" | "totalBytes"
>;
```

NOTE: verify the SDK-56 `File`/`Directory` API against the installed types — `.list()`, `.size`, `.write(bytes,{append})`, `File.createDownloadTask`, `.move`, `.delete`, `.create`, `Paths.document` are all per the SDK-56 docs, but adjust property/method names if the installed `.d.ts` differs (e.g. `size` may be a getter; `list()` may be `listAsync()`). Keep the `FileStore` interface stable regardless.

- [ ] **Step 2: Verify + commit.** `pnpm check` → 0 (typecheck against the installed expo-file-system types).
```bash
git add -A
git commit -m "feat(mobile): DownloadStore over expo-file-system"
```

---

### Task 4: `DownloadIndex` (async-storage records)

**Files:** Create `packages/mobile/src/downloads/download-index.ts` (+ `.test.ts`).

- [ ] **Step 1: Write the failing test** — mock async-storage (Map inside the factory). Assert upsert/get/all/remove + persistence + reconcile (drop missing). Use `reconcileRecords` from core for the reconcile.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@react-native-async-storage/async-storage", () => {
  const m = new Map<string, string>();
  return { default: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => void m.set(k, v) } };
});
import type { DownloadRecord } from "@musex/core";
import { DownloadIndex } from "./download-index";

const rec = (key: string, state: DownloadRecord["state"] = "downloaded"): DownloadRecord => ({
  key, serverId: "s", plexPath: `/p/${key}`, trackId: key, format: "original", state, bytes: 1, addedAt: 0,
  meta: { title: key, artistName: "A", durationMs: 1, albumId: "al", artistId: "ar", container: "flac", audioCodec: "flac", partId: "1" },
});

describe("DownloadIndex", () => {
  it("upsert/get/all round-trips and persists", async () => {
    const idx = new DownloadIndex();
    await idx.load();
    await idx.upsert(rec("a"));
    expect(idx.get("a")?.state).toBe("downloaded");
    expect(idx.all()).toHaveLength(1);
    const idx2 = new DownloadIndex();
    await idx2.load();
    expect(idx2.get("a")?.trackId).toBe("a");
  });
  it("reconcile marks downloaded records whose file vanished as missing", async () => {
    const idx = new DownloadIndex();
    await idx.load();
    await idx.upsert(rec("a"));
    await idx.upsert(rec("b"));
    await idx.reconcile(new Set(["a"])); // only "a" present on disk
    expect(idx.get("a")?.state).toBe("downloaded");
    expect(idx.get("b")?.state).toBe("missing");
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — Map + async-storage persist (`musex.downloads-index`), `reconcileRecords` from core:

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { type DownloadRecord, reconcileRecords } from "@musex/core";

const KEY = "musex.downloads-index";

export class DownloadIndex {
  private map = new Map<string, DownloadRecord>();

  async load(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(KEY);
      if (raw) for (const r of JSON.parse(raw) as DownloadRecord[]) this.map.set(r.key, r);
    } catch {
      /* fresh start */
    }
  }
  get(key: string): DownloadRecord | undefined {
    return this.map.get(key);
  }
  all(): DownloadRecord[] {
    return [...this.map.values()];
  }
  async upsert(r: DownloadRecord): Promise<void> {
    this.map.set(r.key, r);
    await this.persist();
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
    await this.persist();
  }
  async reconcile(presentKeys: ReadonlySet<string>): Promise<void> {
    const next = reconcileRecords(this.all(), presentKeys);
    this.map = new Map(next.map((r) => [r.key, r]));
    await this.persist();
  }
  private async persist(): Promise<void> {
    try {
      await AsyncStorage.setItem(KEY, JSON.stringify(this.all()));
    } catch (err) {
      console.warn("[downloads] index persist failed", err);
    }
  }
}
```

- [ ] **Step 4: Run → pass; verify + commit.** `pnpm check` → 0.
```bash
git add -A
git commit -m "feat(mobile): DownloadIndex (async-storage records + reconcile)"
```

---

### Task 5: `DownloadManager` (original + AAC HLS-stitch)

**Files:** Create `packages/mobile/src/downloads/download-manager.ts` (+ `.test.ts`).

Mirrors desktop's manager: sequential queue; `original` = `store.downloadUrl(directUrl)`; `aac` = HLS-stitch using core `buildHlsStartUrl`/`parseHlsMaster`/`parseHlsMedia` + `store.beginWrite` append loop, requiring `#EXT-X-ENDLIST`. Injected `{ store, index, fetch, endpoint, clientId, getQuality, onProgress }`.

- [ ] **Step 1: Write the failing test** (fake store + fake fetch) — original stores + marks downloaded; AAC stitches segments + requires ENDLIST; failure marks failed.

```ts
import type { DownloadJob } from "@musex/core";
import { describe, expect, it, vi } from "vitest";
import { DownloadIndex } from "./download-index";
import { DownloadManager } from "./download-manager";

function fakeStore() {
  const files = new Map<string, string>();
  return {
    files,
    has: (k: string) => files.has(k),
    size: (k: string) => files.get(k)?.length ?? 0,
    uri: (k: string) => `file:///downloads/${k}`,
    beginWrite(key: string) {
      let buf = "";
      return {
        write: (b: Uint8Array) => { buf += new TextDecoder().decode(b); },
        commit: async () => { files.set(key, buf); },
        abort: async () => {},
      };
    },
    downloadUrl: async (key: string) => { files.set(key, "AUDIO"); return 5; },
    remove: (k: string) => void files.delete(k),
    presentNonEmptyKeys: () => new Set(files.keys()),
    totalBytes: () => 0,
  };
}
const job = (key: string): DownloadJob => ({
  key, serverId: "s1", plexPath: `/library/parts/${key}/f.flac`, trackId: key,
  meta: { title: key, artistName: "A", durationMs: 1, albumId: "al", artistId: "ar", container: "flac", audioCodec: "flac", partId: "1" },
});

vi.mock("@react-native-async-storage/async-storage", () => {
  const m = new Map<string, string>();
  return { default: { getItem: async (k: string) => m.get(k) ?? null, setItem: async (k: string, v: string) => void m.set(k, v) } };
});

function mgr(store: ReturnType<typeof fakeStore>, fetchFn: typeof fetch, quality: { mode: "original" | "aac"; bitrateKbps: number }) {
  const index = new DownloadIndex();
  return {
    index,
    m: new DownloadManager({
      store: store as never, index, fetch: fetchFn,
      endpoint: async () => ({ baseUrl: "https://pms", token: "t" }),
      clientId: "cid", getQuality: () => quality, onProgress: () => {},
    }),
  };
}

describe("DownloadManager", () => {
  it("original: downloads to the store and marks downloaded", async () => {
    const store = fakeStore();
    const { index, m } = mgr(store, (async () => new Response("x")) as never, { mode: "original", bitrateKbps: 256 });
    await m.enqueue([job("a")]);
    await m.drain();
    expect(store.files.has("a")).toBe(true);
    expect(index.get("a")?.state).toBe("downloaded");
  });
  it("aac: stitches HLS segments then requires ENDLIST", async () => {
    const store = fakeStore();
    const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=320000\nsession/s/base/index.m3u8\n";
    const media = "#EXTM3U\n#EXTINF:1.0,\nseg0.ts\n#EXTINF:1.0,\nseg1.ts\n#EXT-X-ENDLIST\n";
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("start.m3u8")) return new Response(master);
      if (url.includes("index.m3u8")) return new Response(media);
      if (url.includes(".ts")) return new Response(url.includes("seg0") ? "AAA" : "BBB");
      return new Response("");
    });
    const { index, m } = mgr(store, fetchFn as never, { mode: "aac", bitrateKbps: 192 });
    await m.enqueue([job("b")]);
    await m.drain();
    expect(store.files.get("b")).toBe("AAABBB");
    expect(index.get("b")?.state).toBe("downloaded");
    expect(index.get("b")?.format).toBe("aac");
  });
  it("aac: no ENDLIST → failed, stores nothing", async () => {
    const store = fakeStore();
    const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nsession/s/base/index.m3u8\n";
    const media = "#EXTM3U\n#EXTINF:1.0,\nseg0.ts\n"; // no ENDLIST
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("start.m3u8")) return new Response(master);
      if (url.includes("index.m3u8")) return new Response(media);
      return new Response("AAA");
    });
    const { index, m } = mgr(store, fetchFn as never, { mode: "aac", bitrateKbps: 192 });
    await m.enqueue([job("h")]);
    await m.drain();
    expect(store.files.has("h")).toBe(false);
    expect(index.get("h")?.state).toBe("failed");
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** (`download-manager.ts`) — mirror desktop's `runOriginalJob`/`runHlsJob` (the desktop file `packages/desktop/src/main/download/download-manager.ts` is the reference for the HLS-stitch flow), adapted to `store.downloadUrl`/`store.beginWrite` (Uint8Array) + `getQuality().mode`:

```ts
import {
  buildHlsStartUrl, type DownloadJob, type DownloadRecord,
  parseHlsMaster, parseHlsMedia, type StorageQuality, stopSessionUrl, TRANSCODE_PROFILE_EXTRA,
} from "@musex/core";
import type { DownloadIndex } from "./download-index";
import type { FileStore, StoreWriter } from "./download-store";

export interface DownloadProgress { key: string; state: DownloadRecord["state"]; bytes: number; error?: string; }

export interface DownloadManagerDeps {
  store: FileStore;
  index: DownloadIndex;
  fetch: typeof fetch;
  endpoint: (serverId: string) => Promise<{ baseUrl: string; token: string }>;
  clientId: string;
  getQuality: () => StorageQuality;
  onProgress: (e: DownloadProgress) => void;
}

const SEGMENT_RETRY_DELAY_MS = 700;
const SEGMENT_RETRY_ATTEMPTS = 60;
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class DownloadManager {
  private queue: DownloadJob[] = [];
  private running = false;
  private idle: Promise<void> = Promise.resolve();
  private idleResolve: (() => void) | null = null;

  constructor(private readonly deps: DownloadManagerDeps) {}

  async enqueue(jobs: DownloadJob[]): Promise<void> {
    for (const j of jobs) {
      if (this.deps.store.has(j.key)) continue;
      this.queue.push(j);
      await this.record(j, "queued", 0);
    }
    this.pump();
  }

  drain(): Promise<void> { return this.idle; }

  private async record(job: DownloadJob, state: DownloadRecord["state"], bytes: number, error?: string): Promise<void> {
    const rec: DownloadRecord = {
      key: job.key, serverId: job.serverId, plexPath: job.plexPath, trackId: job.trackId,
      format: this.deps.getQuality().mode === "aac" ? "aac" : "original",
      state, bytes, addedAt: this.deps.index.get(job.key)?.addedAt ?? Date.now(), error, meta: job.meta,
    };
    await this.deps.index.upsert(rec);
    this.deps.onProgress({ key: job.key, state, bytes, error });
  }

  private pump(): void {
    if (this.running) return;
    this.running = true;
    this.idle = new Promise((r) => { this.idleResolve = r; });
    void this.loop();
  }
  private async loop(): Promise<void> {
    while (this.queue.length) await this.runJob(this.queue.shift()!);
    this.running = false;
    this.idleResolve?.();
  }

  private async runJob(job: DownloadJob): Promise<void> {
    await this.record(job, "downloading", 0);
    const quality = this.deps.getQuality();
    const ep = await this.deps.endpoint(job.serverId);
    if (quality.mode === "aac") await this.runHlsJob(job, quality, ep);
    else await this.runOriginalJob(job, ep);
  }

  private async runOriginalJob(job: DownloadJob, ep: { baseUrl: string; token: string }): Promise<void> {
    const url = `${ep.baseUrl}${job.plexPath}${job.plexPath.includes("?") ? "&" : "?"}X-Plex-Token=${encodeURIComponent(ep.token)}`;
    try {
      const bytes = await this.deps.store.downloadUrl(job.key, url, (w) => this.deps.onProgress({ key: job.key, state: "downloading", bytes: w }));
      await this.record(job, "downloaded", bytes);
    } catch (e) {
      this.deps.store.remove(job.key);
      await this.record(job, "failed", 0, e instanceof Error ? e.message : String(e));
    }
  }

  private async runHlsJob(job: DownloadJob, quality: StorageQuality, ep: { baseUrl: string; token: string }): Promise<void> {
    const session = `${job.key}-${Date.now()}`;
    const startUrl = buildHlsStartUrl({ baseUrl: ep.baseUrl, token: ep.token, clientId: this.deps.clientId, session, trackId: job.trackId, bitrateKbps: quality.bitrateKbps });
    const headers = { "X-Plex-Token": ep.token, "X-Plex-Client-Profile-Extra": TRANSCODE_PROFILE_EXTRA };
    let w: StoreWriter | null = null;
    try {
      const startRes = await this.deps.fetch(startUrl, { headers });
      if (!startRes.ok) { await this.record(job, "failed", 0, `hls start ${startRes.status}`); return; }
      const startText = await startRes.text();
      const variant = parseHlsMaster(startText);
      let mediaUrl = startUrl, mediaText = startText;
      if (variant) {
        mediaUrl = new URL(variant, startUrl).toString();
        const mediaRes = await this.deps.fetch(mediaUrl, { headers });
        if (!mediaRes.ok) { await this.record(job, "failed", 0, `hls media ${mediaRes.status}`); return; }
        mediaText = await mediaRes.text();
      }
      const { segments, ended } = parseHlsMedia(mediaText);
      if (segments.length === 0) { await this.record(job, "failed", 0, "no segments"); return; }
      w = this.deps.store.beginWrite(job.key);
      let total = 0;
      for (const seg of segments) {
        const bytes = await this.fetchSegment(new URL(seg.uri, mediaUrl).toString(), headers);
        if (bytes === null) { await w.abort(); w = null; await this.record(job, "failed", 0, `segment unavailable: ${seg.uri}`); return; }
        w.write(bytes); total += bytes.byteLength;
        this.deps.onProgress({ key: job.key, state: "downloading", bytes: total });
      }
      if (!ended) { await w.abort(); w = null; await this.record(job, "failed", 0, "incomplete playlist (no ENDLIST)"); return; }
      await w.commit(); w = null;
      await this.record(job, "downloaded", total);
    } catch (e) {
      if (w) await w.abort();
      await this.record(job, "failed", 0, e instanceof Error ? e.message : String(e));
    } finally {
      await this.deps.fetch(stopSessionUrl({ baseUrl: ep.baseUrl, token: ep.token, clientId: this.deps.clientId, session })).catch(() => {});
    }
  }

  private async fetchSegment(url: string, headers: Record<string, string>): Promise<Uint8Array | null> {
    for (let attempt = 0; attempt < SEGMENT_RETRY_ATTEMPTS; attempt++) {
      const res = await this.deps.fetch(url, { headers });
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.byteLength > 0) return bytes;
      } else if (res.status !== 404 && res.status < 500) return null;
      await delay(SEGMENT_RETRY_DELAY_MS);
    }
    return null;
  }

  async removeDownload(key: string): Promise<void> {
    this.deps.store.remove(key);
    await this.deps.index.remove(key);
  }
}
```

- [ ] **Step 4: Run → pass; verify + commit.** `pnpm check` → 0.
```bash
git add -A
git commit -m "feat(mobile): DownloadManager (original + AAC HLS-stitch)"
```

---

### Task 6: `ConnectivityMonitor` (netinfo + Plex probe)

**Files:** Create `packages/mobile/src/downloads/connectivity-monitor.ts` (+ `.test.ts`).

netinfo subscription gives the instant network signal; a debounced Plex probe (injected `probe()` → throws/resolves) confirms server reachability. A `PlexAuthError` from the probe NEVER counts as offline. Emits `online`/`offline` to a listener. Inject `subscribe` (netinfo) + `probe` so it's testable without native modules.

- [ ] **Step 1: Write the failing test** — drive the injected netinfo callback + probe; assert offline only after the threshold of consecutive non-auth probe failures; PlexAuthError → stays online.

```ts
import { PlexAuthError } from "@musex/core";
import { describe, expect, it, vi } from "vitest";
import { ConnectivityMonitor } from "./connectivity-monitor";

describe("ConnectivityMonitor", () => {
  it("netinfo no-connection → offline immediately", async () => {
    let net: (s: { isConnected: boolean | null }) => void = () => {};
    const states: string[] = [];
    const m = new ConnectivityMonitor({
      subscribe: (cb) => { net = cb; return () => {}; },
      probe: async () => {},
      onChange: (s) => states.push(s),
    });
    m.start();
    net({ isConnected: false });
    expect(states.at(-1)).toBe("offline");
  });
  it("PlexAuthError from the probe does NOT mark offline", async () => {
    const states: string[] = [];
    const m = new ConnectivityMonitor({
      subscribe: () => () => {},
      probe: async () => { throw new PlexAuthError(); },
      onChange: (s) => states.push(s),
    });
    await m.checkNow();
    expect(states).not.toContain("offline");
  });
  it("two consecutive non-auth probe failures → offline", async () => {
    const states: string[] = [];
    const m = new ConnectivityMonitor({
      subscribe: () => () => {},
      probe: async () => { throw new Error("network"); },
      onChange: (s) => states.push(s),
    });
    await m.checkNow();
    await m.checkNow();
    expect(states.at(-1)).toBe("offline");
  });
});
```

- [ ] **Step 2: Run → fail.**

- [ ] **Step 3: Implement** — threshold 2 consecutive non-auth failures → offline; any success → online; netinfo `isConnected === false` → offline immediately:

```ts
import { PlexAuthError } from "@musex/core";

export type Connectivity = "online" | "offline";
const FAILURE_THRESHOLD = 2;

export interface ConnectivityDeps {
  subscribe: (cb: (s: { isConnected: boolean | null }) => void) => () => void;
  probe: () => Promise<void>;
  onChange: (s: Connectivity) => void;
}

export class ConnectivityMonitor {
  private failures = 0;
  private state: Connectivity = "online";
  private unsub: (() => void) | null = null;

  constructor(private readonly deps: ConnectivityDeps) {}

  start(): void {
    this.unsub = this.deps.subscribe((s) => {
      if (s.isConnected === false) this.set("offline");
      else void this.checkNow();
    });
  }
  stop(): void { this.unsub?.(); this.unsub = null; }

  async checkNow(): Promise<void> {
    try {
      await this.deps.probe();
      this.failures = 0;
      this.set("online");
    } catch (e) {
      if (e instanceof PlexAuthError) return; // sign-in owns auth; not an offline signal
      this.failures += 1;
      if (this.failures >= FAILURE_THRESHOLD) this.set("offline");
    }
  }

  private set(s: Connectivity): void {
    if (s !== this.state) { this.state = s; this.deps.onChange(s); }
  }
}
```

- [ ] **Step 4: Run → pass; verify + commit.** `pnpm check` → 0.
```bash
git add -A
git commit -m "feat(mobile): ConnectivityMonitor (netinfo + Plex probe)"
```

---

### Task 7: `storage-config.ts` + store wiring

**Files:** Create `packages/mobile/src/downloads/storage-config.ts` (+ test); modify `packages/mobile/src/state/store.tsx`.

- [ ] **Step 1: `storage-config.ts`** — `StorageQuality` (`{mode,bitrateKbps}`) persisted in async-storage (`musex.storage-quality`); `loadStorageQuality`/`saveStorageQuality` with a validated default (`{mode:"original",bitrateKbps:256}`; mode ∈ {original,aac}, bitrate ∈ `TRANSCODE_BITRATES`). Test the round-trip + the validation clamp (mock async-storage). Mirror `lastfm-store.ts`.

- [ ] **Step 2: Store wiring** — read `store.tsx` first. Construct `DownloadStore`/`DownloadIndex`/`DownloadManager`/`ConnectivityMonitor` via `useMemo`/`useRef`; the manager's `endpoint(serverId)` = `{ baseUrl: gateway.baseUrlFor(serverId), token: tokenRef.current }`, `getQuality` reads the storage-config ref. The connectivity `subscribe` = netinfo `addEventListener`; `probe` = a lightweight gateway request (e.g. `gateway.baseUrlFor` + a HEAD/`listMusicLibraries`-style ping, or reuse an existing cheap call) that throws `PlexAuthError` on 401. Expose on the `Store`: `downloadTracks(tracks)`, `downloadAlbum(albumId)`/`downloadArtist(artistId)` (resolve their tracks then `downloadTracks`), `removeDownload(key)`, `downloadedTracks()` (→ `recordsToTracks(index.all())` then re-bake thumbs via `artBaseFor`+`artUrl`), `downloadsList()` (`index.all()`), `getStorageQuality`/`setStorageQuality`, and `connectivity: Connectivity`. Build `DownloadJob`s from `Track`s: `key = downloadKey(serverId, track.media.partKey)`, `plexPath = track.media.partKey`, full `meta` from the track. On bootstrap: `index.load()` then `index.reconcile(store.presentNonEmptyKeys())`; start the connectivity monitor. Dispatch `connectivity` into reducer state so the UI re-renders.

- [ ] **Step 3: Verify + commit.** `pnpm check` → 0.
```bash
git add -A
git commit -m "feat(mobile): storage config + wire downloads/connectivity into the store"
```

---

### Task 8: Stream resolver — local-first

**Files:** Modify `packages/mobile/src/adapters/stream-resolver.ts` (+ test).

When a track is downloaded, resolve to its local `file://` URI (offline + zero bandwidth) before the network decision.

- [ ] **Step 1: Write the failing test** — inject a `localUriFor(track) → string | null`; when it returns a uri, `resolve` yields `{kind:"direct", url:<file uri>}`; else falls through to `decideStreamRef`.

- [ ] **Step 2: Implement** — extend `PlexStreamResolver` ctor with `localUriFor: (track: Track) => string | null`; in `resolve`, `const local = this.localUriFor(track); if (local) return { kind: "direct", url: local };` then the existing decision. The store provides `localUriFor` = look up `downloadRecordFor(buildDownloadLookup(index.all()), track)` → `store.uri(rec.key)` (or null).

- [ ] **Step 3: Verify + commit.** `pnpm check` → 0.
```bash
git add -A
git commit -m "feat(mobile): play downloaded tracks from local files"
```

---

### Task 9: Download action in the action sheet

**Files:** Modify `packages/mobile/src/ui/TrackActionSheet.tsx`.

- [ ] **Step 1:** Add a `Download` row (lucide `Download`) → `downloadTracks([track])` then `onClose()`; when the track is already downloaded show "Remove download" (lucide `Trash2`/`CircleCheck`) → `removeDownload(downloadKey(track.serverId, track.media.partKey))`. Disable (dim) when `connectivity === "offline"` for the Download action (Remove stays — it's local). Pull `downloadTracks`/`removeDownload`/`downloadsList`/`connectivity` from `useStore()`. Determine downloaded state via `downloadRecordFor(buildDownloadLookup(downloadsList()), track)` (from `@musex/core`).

- [ ] **Step 2: Verify + commit.** `pnpm check` → 0.
```bash
git add -A
git commit -m "feat(mobile): download/remove a track from the action sheet"
```

---

### Task 10: Library "Downloaded" segment

**Files:** Modify `packages/mobile/app/(tabs)/library/index.tsx`.

- [ ] **Step 1:** Add `"Downloaded"` to the `SegmentedControl` segments. In the Downloaded branch, render the on-device collection from `downloadedTracks()` + `downloadsList()`: `groupDownloadsByAlbum(records)` → album tiles (reuse `Tile` + `AlbumArt`, art re-baked); a **Play all / Shuffle all** header (`ActionBar` with `getTracks = () => downloadedTracks()`); an **active-download strip** (records with state queued/downloading) showing progress; per-album **Remove** (remove all that album's keys). Tapping an album tile plays that album (`playTracks(albumTracks, 0)`) or drills into its tracks. Empty state: "No downloads yet." This segment reads local records → works offline.

- [ ] **Step 2: Verify + commit.** `pnpm check` → 0.
```bash
git add -A
git commit -m "feat(mobile): On-this-device collection (Library Downloaded segment)"
```

---

### Task 11: Settings → Downloads pane

**Files:** Create `packages/mobile/app/(tabs)/settings/downloads.tsx`; modify `settings/_layout.tsx` (register) + `settings/index.tsx` (link row).

- [ ] **Step 1:** Register `<Stack.Screen name="downloads" options={{ title: "Downloads & Storage" }} />`; add a link row in settings/index. Build `downloads.tsx`: a **Storage quality** section (Original↔AAC segmented + an AAC bitrate select from `TRANSCODE_BITRATES`, optimistic update via `setStorageQuality`), a **total downloads size** row (`store.totalBytes()` via a store getter, formatted with core `formatBytes`), and a **Remove all** button (confirm → remove every download key). Pull `getStorageQuality`/`setStorageQuality`/`downloadsList`/`removeDownload` from `useStore()`.

- [ ] **Step 2: Verify + commit.** `pnpm check` → 0.
```bash
git add -A
git commit -m "feat(mobile): Settings -> Downloads & Storage pane"
```

---

### Task 12: Offline banner + degradation

**Files:** Modify `packages/mobile/app/(tabs)/_layout.tsx` (banner) + `app/(tabs)/search/index.tsx` + `app/(tabs)/library/tracks.tsx` + `src/ui/TrackActionSheet.tsx` (degradation).

- [ ] **Step 1: App-wide offline banner.** In `(tabs)/_layout.tsx` (above `TabSlot`/`MiniPlayer`), render a thin red banner when `connectivity === "offline"`: a `WifiOff` lucide icon + "Offline · playing downloaded music". Read `connectivity` from `useStore()`.

- [ ] **Step 2: Degrade server-dependent surfaces.** Search (`search/index.tsx`): when offline, show a friendly empty-state ("You're offline — search needs your Plex server; your downloads are in Library → Downloaded") instead of querying. Album tracks (`library/tracks.tsx`): when offline, dim/disable rows that aren't downloaded (compute via `downloadRecordFor`); tapping a downloaded row plays, others are inert. Action sheet: hide/disable Download + last.fm-dependent rows (Start radio) when offline. The Library Downloaded segment + playback of downloaded tracks stay fully functional.

- [ ] **Step 3: Verify + commit.** `pnpm check` → 0. (On-device: airplane mode shows the banner, Downloaded plays, the rest degrades.)
```bash
git add -A
git commit -m "feat(mobile): offline banner + graceful degradation"
```

---

### Task 13: Final verification

- [ ] **Step 1:** `grep -rn "util/downloaded-records\|util/downloaded-set" packages/desktop/src` → no results (all repointed to core).
- [ ] **Step 2:** `grep -rn "node:" packages/core/src/logic/download-lookup.ts` → none (pure).
- [ ] **Step 3:** `pnpm check` → exit 0 across all packages.
- [ ] **Step 4:** Confirm `expo-file-system` + `@react-native-community/netinfo` in `packages/mobile/package.json`. Note in the report that the user must rebuild the dev client (`expo prebuild --platform ios` + `expo run:ios`) — both deps are native.

---

## Self-Review

**Spec coverage:** core promotion → Task 1; deps → Task 2; DownloadStore → Task 3; DownloadIndex → Task 4; DownloadManager (original + AAC HLS-stitch) → Task 5; ConnectivityMonitor → Task 6; storage config + store wiring → Task 7; local-first playback → Task 8; download action → Task 9; Downloaded collection → Task 10; Settings → Downloads → Task 11; offline banner + degradation → Task 12; verification → Task 13. ✓

**Placeholder scan:** No TBD/"handle edge cases". The "verify the SDK-56 File API against installed types" (Task 3) + "read store.tsx first" (Task 7) notes are explicit verification instructions for code that weaves into existing files / a freshly-installed native module — each specifies the exact interface to keep stable. ✓

**Type/symbol consistency:** `downloadKey(serverId, plexPath)` used by the store key, manager job key, resolver lookup, and action sheet — consistent. `FileStore` interface (Task 3) is what `DownloadManager` (Task 5) depends on + the fake store mirrors. `DownloadRecord`/`DownloadJob`/`StorageQuality`/`recordsToTracks`/`groupDownloadsByAlbum`/`reconcileRecords`/`buildHlsStartUrl`/`parseHlsMaster`/`parseHlsMedia`/`stopSessionUrl`/`TRANSCODE_PROFILE_EXTRA`/`TRANSCODE_BITRATES` are all real `@musex/core` exports (grounded). `Connectivity` = "online"|"offline" consistent across monitor + store + UI. ✓
