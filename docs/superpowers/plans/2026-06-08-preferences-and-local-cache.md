# Preferences View + Local Media Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Settings view and an opt-in local media cache that caches direct-play tracks to disk as they stream, serves them from disk (incl. seeking/offline) on later plays, and LRU-evicts at a configurable size cap.

**Architecture:** Caching lives entirely in the main process: a pure logic module (`logic/cache.ts`), a filesystem adapter (`adapters/media-cache.ts`), and integration in the existing localhost stream proxy. The renderer gains a sectioned Settings view + preference IPC. No `@musex/core` changes; no audio-engine changes. The proxy reads cache config fresh per request (via a closure over persistence), so toggling takes effect immediately with no restart.

**Tech Stack:** Electron (main: Node `http`/`fs`, `electron-store`, `safeStorage`), React 19 (renderer), TypeScript 6, Vitest 4, Biome 2.

**Spec:** `docs/superpowers/specs/2026-06-08-preferences-and-local-cache-design.md`

**Conventions (match existing code):**
- Main/adapter/logic source files use `.js` extensions on relative imports (ESM). Test files import **without** extension. Renderer files import without extension.
- Biome: double quotes, semicolons, 2-space indent, `import type` for type-only imports. `noUncheckedIndexedAccess` is on — array/record indexing yields `T | undefined`; handle it.
- No empty `catch {}`. A `catch` that intentionally recovers from a benign race **must contain an explanatory comment** (Biome allows a comment-only catch).
- Run `pnpm check` (typecheck + tests + lint via Biome) from repo root to match CI.

---

### Task 1: Pure cache logic + tests

**Files:**
- Create: `packages/desktop/src/logic/cache.ts`
- Test: `packages/desktop/src/logic/cache.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/desktop/src/logic/cache.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  cacheKey,
  contentTypeForPath,
  isCacheablePath,
  parseByteRange,
  selectEvictions,
} from "./cache";

describe("cacheKey", () => {
  it("is deterministic for the same inputs", () => {
    expect(cacheKey("srv", "/library/parts/1/2/a.flac")).toBe(
      cacheKey("srv", "/library/parts/1/2/a.flac"),
    );
  });
  it("differs by server and by path", () => {
    const a = cacheKey("srv1", "/library/parts/1/2/a.flac");
    const b = cacheKey("srv2", "/library/parts/1/2/a.flac");
    const c = cacheKey("srv1", "/library/parts/9/9/a.flac");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
  it("produces a 64-char hex string (sha256)", () => {
    expect(cacheKey("s", "/p")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("isCacheablePath", () => {
  it("caches only original media files under /library/parts/", () => {
    expect(isCacheablePath("/library/parts/123/456/file.flac")).toBe(true);
  });
  it("does not cache artwork or transcode streams", () => {
    expect(isCacheablePath("/library/metadata/55/thumb/167")).toBe(false);
    expect(isCacheablePath("/music/:/transcode/universal/start.m3u8")).toBe(false);
    expect(isCacheablePath("/photo/:/transcode")).toBe(false);
  });
});

describe("contentTypeForPath", () => {
  it("maps known audio extensions", () => {
    expect(contentTypeForPath("/x/a.flac")).toBe("audio/flac");
    expect(contentTypeForPath("/x/a.MP3")).toBe("audio/mpeg");
    expect(contentTypeForPath("/x/a.m4a")).toBe("audio/mp4");
    expect(contentTypeForPath("/x/a.ogg")).toBe("audio/ogg");
    expect(contentTypeForPath("/x/a.wav")).toBe("audio/wav");
  });
  it("falls back to octet-stream for unknown/missing extensions", () => {
    expect(contentTypeForPath("/x/a.xyz")).toBe("application/octet-stream");
    expect(contentTypeForPath("/x/noext")).toBe("application/octet-stream");
  });
});

describe("parseByteRange", () => {
  it("returns null when there is no Range header", () => {
    expect(parseByteRange(undefined, 1000)).toBeNull();
  });
  it("parses a closed range", () => {
    expect(parseByteRange("bytes=100-199", 1000)).toEqual({ start: 100, end: 199 });
  });
  it("parses an open-ended range to end of file", () => {
    expect(parseByteRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
  });
  it("parses a suffix range (last N bytes)", () => {
    expect(parseByteRange("bytes=-100", 1000)).toEqual({ start: 900, end: 999 });
  });
  it("clamps an end past EOF", () => {
    expect(parseByteRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
  });
  it("returns null for unsatisfiable or malformed ranges", () => {
    expect(parseByteRange("bytes=2000-3000", 1000)).toBeNull();
    expect(parseByteRange("bytes=abc", 1000)).toBeNull();
    expect(parseByteRange("bytes=-", 1000)).toBeNull();
    expect(parseByteRange("bytes=500-100", 1000)).toBeNull();
  });
});

describe("selectEvictions", () => {
  const e = (name: string, size: number, mtimeMs: number) => ({ name, size, mtimeMs });
  it("returns nothing when under the cap", () => {
    expect(selectEvictions([e("a", 100, 1), e("b", 100, 2)], 1000)).toEqual([]);
  });
  it("evicts oldest-first until within the cap", () => {
    const entries = [e("new", 400, 30), e("old", 400, 10), e("mid", 400, 20)];
    // total 1200, cap 1000 -> must drop 200+, drops oldest ("old", 400) -> 800
    expect(selectEvictions(entries, 1000)).toEqual(["old"]);
  });
  it("evicts multiple when needed", () => {
    const entries = [e("a", 500, 1), e("b", 500, 2), e("c", 500, 3)];
    // total 1500, cap 600 -> drop a (1000), drop b (500)
    expect(selectEvictions(entries, 600)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @musex/desktop exec vitest run src/logic/cache.test.ts`
Expected: FAIL — `Cannot find module './cache'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/desktop/src/logic/cache.ts`:

```ts
import { createHash } from "node:crypto";

/** Stable cache key for a media file: sha256 of serverId + Plex path.
 *  The Plex part path embeds a file-version token, so a changed file yields a
 *  new key (the stale entry is later evicted). */
export function cacheKey(serverId: string, plexPath: string): string {
  return createHash("sha256").update(`${serverId}:${plexPath}`).digest("hex");
}

/** Only original media files under /library/parts/ are cached. This excludes
 *  artwork (/library/metadata/.../thumb) and transcode streams (/music/:/transcode). */
export function isCacheablePath(plexPath: string): boolean {
  return plexPath.startsWith("/library/parts/");
}

const CONTENT_TYPES: Record<string, string> = {
  flac: "audio/flac",
  mp3: "audio/mpeg",
  mp2: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/mp4",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  wave: "audio/wav",
};

/** Content-Type from a file path's extension (for serving cache hits). */
export function contentTypeForPath(plexPath: string): string {
  const dot = plexPath.lastIndexOf(".");
  const ext = dot === -1 ? "" : plexPath.slice(dot + 1).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export interface ByteRange {
  start: number;
  end: number;
}

/** Parse a single `bytes=start-end` Range header against a known size.
 *  Returns null for absent/unsupported/unsatisfiable ranges (caller serves full). */
export function parseByteRange(header: string | undefined, size: number): ByteRange | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const startStr = m[1] ?? "";
  const endStr = m[2] ?? "";
  if (startStr === "" && endStr === "") return null;
  let start: number;
  let end: number;
  if (startStr === "") {
    const n = Number(endStr); // suffix range: last N bytes
    if (!Number.isFinite(n) || n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(startStr);
    end = endStr === "" ? size - 1 : Number(endStr);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start >= size) return null;
  if (end >= size) end = size - 1;
  return { start, end };
}

export interface CacheEntryMeta {
  name: string;
  size: number;
  mtimeMs: number;
}

/** Given current cache entries and a byte cap, return the names to delete
 *  (least-recently-modified first) so the total falls within the cap. */
export function selectEvictions(entries: CacheEntryMeta[], maxBytes: number): string[] {
  let total = 0;
  for (const e of entries) total += e.size;
  if (total <= maxBytes) return [];
  const byOldest = [...entries].sort((a, b) => a.mtimeMs - b.mtimeMs);
  const toDelete: string[] = [];
  for (const e of byOldest) {
    if (total <= maxBytes) break;
    toDelete.push(e.name);
    total -= e.size;
  }
  return toDelete;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @musex/desktop exec vitest run src/logic/cache.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(cache): pure cache logic (key, range, content-type, LRU selection)"
git push origin main
```

---

### Task 2: MediaCache filesystem adapter + tests

**Files:**
- Create: `packages/desktop/src/main/adapters/media-cache.ts`
- Test: `packages/desktop/src/main/adapters/media-cache.test.ts`

**Why electron-free:** `MediaCache` takes its directory as a constructor arg (Runtime passes `app.getPath("userData")/media-cache`), so it has no Electron import and is fully testable against a real temp dir.

- [ ] **Step 1: Write the failing test**

Create `packages/desktop/src/main/adapters/media-cache.test.ts`:

```ts
import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MediaCache } from "./media-cache";

let dir: string;
let cache: MediaCache;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "musex-cache-"));
  cache = new MediaCache(dir);
  await cache.init();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Pipe `data` through a write-through writer and commit it. */
async function writeEntry(key: string, data: Buffer, maxBytes = 1_000_000): Promise<void> {
  const writer = cache.beginWrite(key, maxBytes);
  await pipeline(Readable.from(data), writer.stream);
  await writer.commit();
}

describe("MediaCache", () => {
  it("returns null for a missing key", async () => {
    expect(await cache.pathIfPresent("nope")).toBeNull();
  });

  it("commits a write-through entry and serves it back", async () => {
    await writeEntry("k1", Buffer.from("hello"));
    const p = await cache.pathIfPresent("k1");
    expect(p).not.toBeNull();
    expect(p).toBe(path.join(dir, "k1"));
    const s = await stat(p as string);
    expect(s.size).toBe(5);
  });

  it("aborts a write-through without leaving a committed entry", async () => {
    const writer = cache.beginWrite("k2", 1_000_000);
    await pipeline(Readable.from(Buffer.from("partial")), writer.stream);
    await writer.abort();
    expect(await cache.pathIfPresent("k2")).toBeNull();
    // no leftover temp files
    const stats = await cache.stats();
    expect(stats.files).toBe(0);
  });

  it("reports stats (bytes + file count), ignoring .part temp files", async () => {
    await writeEntry("a", Buffer.alloc(100));
    await writeEntry("b", Buffer.alloc(200));
    const stats = await cache.stats();
    expect(stats.files).toBe(2);
    expect(stats.bytes).toBe(300);
  });

  it("clear() removes all entries and returns freed bytes", async () => {
    await writeEntry("a", Buffer.alloc(100));
    await writeEntry("b", Buffer.alloc(200));
    const freed = await cache.clear();
    expect(freed).toBe(300);
    expect((await cache.stats()).files).toBe(0);
  });

  it("evicts least-recently-modified entries past the cap on commit", async () => {
    // Two existing entries with controlled mtimes (old vs new).
    await writeFile(path.join(dir, "old"), Buffer.alloc(400));
    await writeFile(path.join(dir, "new"), Buffer.alloc(400));
    await utimes(path.join(dir, "old"), new Date(10_000), new Date(10_000));
    await utimes(path.join(dir, "new"), new Date(20_000), new Date(20_000));
    // Committing a third 400-byte entry with a 1000-byte cap (total would be 1200)
    // must evict the oldest ("old").
    await writeEntry("fresh", Buffer.alloc(400), 1000);
    expect(await cache.pathIfPresent("old")).toBeNull();
    expect(await cache.pathIfPresent("new")).not.toBeNull();
    expect(await cache.pathIfPresent("fresh")).not.toBeNull();
  });

  it("bumps mtime on read so recently-served entries survive eviction", async () => {
    await writeFile(path.join(dir, "x"), Buffer.alloc(400));
    await writeFile(path.join(dir, "y"), Buffer.alloc(400));
    await utimes(path.join(dir, "x"), new Date(10_000), new Date(10_000));
    await utimes(path.join(dir, "y"), new Date(20_000), new Date(20_000));
    // Touch "x" (older) so it becomes most-recent; committing "z" should now evict "y".
    await cache.pathIfPresent("x");
    await writeEntry("z", Buffer.alloc(400), 1000);
    expect(await cache.pathIfPresent("y")).toBeNull();
    expect(await cache.pathIfPresent("x")).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @musex/desktop exec vitest run src/main/adapters/media-cache.test.ts`
Expected: FAIL — `Cannot find module './media-cache'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/desktop/src/main/adapters/media-cache.ts`:

```ts
import { randomBytes } from "node:crypto";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink, utimes } from "node:fs/promises";
import path from "node:path";
import { selectEvictions } from "../../logic/cache.js";

export interface CacheStats {
  bytes: number;
  files: number;
}

/** A single in-progress write-through download. */
export interface CacheWriter {
  stream: WriteStream;
  /** Finish the file and atomically publish it, then run eviction. */
  commit(): Promise<void>;
  /** Discard the in-progress file (e.g. download aborted/skipped). */
  abort(): Promise<void>;
}

/**
 * Filesystem media cache. Every operation is confined to `dir`; eviction and
 * clear only ever unlink files inside it.
 *
 * A complete entry is a file named exactly `<key>`. In-progress writes go to
 * `<key>.<rand>.part` and are renamed into place on commit, so an aborted or
 * partial download never appears as a complete entry.
 */
export class MediaCache {
  constructor(private readonly dir: string) {}

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private full(name: string): string {
    return path.join(this.dir, name);
  }

  /** Path to a complete entry if present (bumping its mtime for LRU), else null. */
  async pathIfPresent(key: string): Promise<string | null> {
    const p = this.full(key);
    try {
      await stat(p);
    } catch {
      return null; // not cached
    }
    const now = new Date();
    try {
      await utimes(p, now, now); // touch -> "recently used" for LRU
    } catch {
      // touch failure is non-fatal — we can still serve the file
    }
    return p;
  }

  /** Begin a write-through download for `key`. */
  beginWrite(key: string, maxBytes: number): CacheWriter {
    const tmp = this.full(`${key}.${randomBytes(8).toString("hex")}.part`);
    const dest = this.full(key);
    const stream = createWriteStream(tmp);
    let settled = false;

    const removeTmp = async () => {
      try {
        await unlink(tmp);
      } catch {
        // already gone — nothing to clean up
      }
    };

    return {
      stream,
      commit: async () => {
        if (settled) return;
        settled = true;
        await new Promise<void>((resolve) => stream.end(resolve));
        try {
          await rename(tmp, dest); // atomic publish (overwrites a prior copy)
        } catch (err) {
          console.error("[musex cache] commit failed:", err);
          await removeTmp();
          return;
        }
        await this.evict(maxBytes);
      },
      abort: async () => {
        if (settled) return;
        settled = true;
        stream.destroy();
        await removeTmp();
      },
    };
  }

  /** Complete entries (excludes in-progress `.part` files). */
  private async entries(): Promise<{ name: string; size: number; mtimeMs: number }[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return []; // dir missing -> empty cache
    }
    const out: { name: string; size: number; mtimeMs: number }[] = [];
    for (const name of names) {
      if (name.endsWith(".part")) continue;
      try {
        const s = await stat(this.full(name));
        if (s.isFile()) out.push({ name, size: s.size, mtimeMs: s.mtimeMs });
      } catch {
        // racing deletion — entry vanished, skip it
      }
    }
    return out;
  }

  /** Delete least-recently-used entries until total size is within `maxBytes`. */
  async evict(maxBytes: number): Promise<void> {
    const entries = await this.entries();
    for (const name of selectEvictions(entries, maxBytes)) {
      try {
        await unlink(this.full(name));
      } catch {
        // racing deletion — already gone
      }
    }
  }

  /** Remove all entries (and orphaned temp files); return bytes freed. */
  async clear(): Promise<number> {
    const entries = await this.entries();
    let freed = 0;
    for (const e of entries) {
      try {
        await unlink(this.full(e.name));
        freed += e.size;
      } catch {
        // racing deletion — already gone
      }
    }
    try {
      for (const name of await readdir(this.dir)) {
        if (!name.endsWith(".part")) continue;
        try {
          await unlink(this.full(name));
        } catch {
          // already gone
        }
      }
    } catch {
      // dir missing — nothing to clean
    }
    return freed;
  }

  async stats(): Promise<CacheStats> {
    const entries = await this.entries();
    let bytes = 0;
    for (const e of entries) bytes += e.size;
    return { bytes, files: entries.length };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @musex/desktop exec vitest run src/main/adapters/media-cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(cache): filesystem MediaCache adapter (write-through, LRU evict, clear)"
git push origin main
```

---

### Task 3: Stream-proxy cache integration

**Files:**
- Modify: `packages/desktop/src/main/adapters/stream-proxy.ts`

This change is standalone-safe: until `configureCache` is called (Task 5), `this.cache` stays null and the proxy behaves exactly as today.

- [ ] **Step 1: Replace the file with the cache-aware version**

Overwrite `packages/desktop/src/main/adapters/stream-proxy.ts` with:

```ts
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import type { StreamRef, Track } from "@musex/core";
import { cacheKey, contentTypeForPath, isCacheablePath, parseByteRange } from "../../logic/cache.js";
import { chooseStreamKind } from "../../logic/stream-kind.js";
import type { MediaCache } from "./media-cache.js";

/** Per-server connection info needed to fulfil a proxied stream request. */
export interface ServerEndpoint {
  baseUrl: string; // e.g. http://192.168.1.10:32400
  token: string; // per-server access token
}

/** How the proxy reads live cache configuration on each request. */
export type CacheConfig = { enabled: boolean; maxBytes: number };

/**
 * Localhost HTTP proxy that streams Plex media to the renderer with the Plex
 * token injected server-side (so the token never reaches the renderer).
 *
 * Hardened against the classic localhost-proxy attacks:
 *  - a per-launch random secret is embedded in the URL PATH (not a header — media
 *    elements / <img> can't set headers; not a query param — HLS relative segments
 *    would drop it). Requests without the exact secret get 403.
 *  - the Host header must be the loopback literal `127.0.0.1:<port>`, defeating
 *    DNS-rebinding (a rebound hostname presents a different Host).
 *  - CORS reflects the renderer's Origin only AFTER those checks pass — never `*`.
 *
 * When a cache is configured and enabled, original media files (/library/parts/)
 * are written through to disk as they stream and served from disk on later plays.
 */
export class StreamProxy {
  private readonly endpoints = new Map<string, ServerEndpoint>();
  private server: http.Server | null = null;
  private port = 0;
  private readonly secret = randomBytes(32).toString("hex");

  private cache: MediaCache | null = null;
  private readCacheConfig: (() => CacheConfig) | null = null;

  registerServer(serverId: string, endpoint: ServerEndpoint): void {
    this.endpoints.set(serverId, endpoint);
  }

  /** Attach a media cache + a getter for live config (read fresh per request). */
  configureCache(cache: MediaCache, readConfig: () => CacheConfig): void {
    this.cache = cache;
    this.readCacheConfig = readConfig;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        console.error("[musex stream proxy] handler error:", err);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        this.port = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  }

  private baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  private mediaUrl(serverId: string, plexPathWithQuery: string): string {
    return `${this.baseUrl()}/${this.secret}/${serverId}${plexPathWithQuery}`;
  }

  artUrl(serverId: string, thumb: string | undefined): string | undefined {
    return thumb ? this.mediaUrl(serverId, thumb) : undefined;
  }

  resolve(track: Track): StreamRef {
    const kind = chooseStreamKind(track.media.audioCodec);
    const path =
      kind === "direct"
        ? track.media.partKey
        : `/music/:/transcode/universal/start.m3u8?path=${encodeURIComponent(
            `/library/metadata/${track.id}`,
          )}&protocol=hls&directStreamAudio=1`;
    return { url: this.mediaUrl(track.serverId, path), kind };
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // DNS-rebinding defense: only accept the loopback literal we listen on.
    if (req.headers.host !== `127.0.0.1:${this.port}`) {
      res.writeHead(403);
      res.end("forbidden host");
      return;
    }

    const reqUrl = new URL(req.url ?? "/", `http://127.0.0.1:${this.port}`);
    const segments = reqUrl.pathname.replace(/^\//, "").split("/");
    const token = segments.shift() ?? "";
    if (token !== this.secret) {
      res.writeHead(403);
      res.end("forbidden");
      return;
    }

    // Authenticated: reflect the renderer's origin for the Web Audio XHR (never `*`).
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Headers", "Range");
    res.setHeader("Access-Control-Expose-Headers", "Accept-Ranges, Content-Range, Content-Length");
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const serverId = segments.shift() ?? "";
    const plexPath = `/${segments.join("/")}`;

    const cfg = this.readCacheConfig?.();
    const cachingOn = !!(cfg?.enabled && this.cache && isCacheablePath(plexPath));
    const key = cachingOn ? cacheKey(serverId, plexPath) : null;

    // Serve from disk if we have a complete copy (works for full + range, even offline).
    if (cachingOn && this.cache && key) {
      const hit = await this.cache.pathIfPresent(key);
      if (hit) {
        await this.serveFromFile(req, res, hit, plexPath);
        return;
      }
    }

    const endpoint = this.endpoints.get(serverId);
    if (!endpoint) {
      res.writeHead(404);
      res.end("unknown server");
      return;
    }

    const upstream = new URL(endpoint.baseUrl);
    upstream.pathname = plexPath;
    upstream.search = reqUrl.search; // forward Plex query params (secret was in the path)
    upstream.searchParams.set("X-Plex-Token", endpoint.token);

    const client = upstream.protocol === "https:" ? https : http;
    const headers: http.OutgoingHttpHeaders = {};
    if (req.headers.range) headers.Range = req.headers.range;

    // Only the full-file GET (no Range) populates the cache; partials are not cached.
    const writer =
      cachingOn && this.cache && key && !req.headers.range
        ? this.cache.beginWrite(key, cfg?.maxBytes ?? 0)
        : null;

    const upstreamReq = client.request(upstream, { method: "GET", headers }, (upstreamRes) => {
      const h: http.OutgoingHttpHeaders = {};
      for (const k of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const v = upstreamRes.headers[k];
        if (v) h[k] = v;
      }
      res.writeHead(upstreamRes.statusCode ?? 502, h);

      if (writer && upstreamRes.statusCode === 200) {
        const expected = Number(upstreamRes.headers["content-length"] ?? "");
        let written = 0;
        upstreamRes.on("data", (chunk: Buffer) => {
          written += chunk.length;
        });
        upstreamRes.pipe(res);
        upstreamRes.pipe(writer.stream);
        upstreamRes.on("end", () => {
          // Commit only a verifiably-complete body; otherwise discard the temp.
          if (Number.isFinite(expected) && expected > 0 && written !== expected) {
            void writer.abort();
          } else {
            void writer.commit();
          }
        });
        upstreamRes.on("error", () => void writer.abort());
      } else {
        if (writer) void writer.abort(); // unexpected status (e.g. 206) -> don't cache
        upstreamRes.pipe(res);
      }
    });
    upstreamReq.on("error", (err) => {
      console.error(`[musex stream proxy] ${plexPath} failed:`, err);
      if (writer) void writer.abort();
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    // If the renderer aborts (track change/seek), stop upstream and discard the partial.
    req.on("close", () => {
      upstreamReq.destroy();
      if (writer) void writer.abort();
    });
    upstreamReq.end();
  }

  /** Serve a complete cache file, honouring Range requests for seeking. */
  private async serveFromFile(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    filePath: string,
    plexPath: string,
  ): Promise<void> {
    let size: number;
    try {
      size = (await stat(filePath)).size;
    } catch {
      res.writeHead(404);
      res.end();
      return;
    }
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", contentTypeForPath(plexPath));

    const range = parseByteRange(req.headers.range, size);
    const pipeFile = (start: number, end: number, status: number) => {
      res.writeHead(status, {
        "Content-Length": String(end - start + 1),
        ...(status === 206 ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      const stream = createReadStream(filePath, { start, end });
      stream.on("error", (err) => {
        console.error(`[musex cache] read failed for ${filePath}:`, err);
        if (!res.headersSent) res.writeHead(500);
        res.end();
      });
      req.on("close", () => stream.destroy());
      stream.pipe(res);
    };

    if (range) {
      pipeFile(range.start, range.end, 206);
    } else {
      pipeFile(0, size - 1, 200);
    }
  }
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm --filter @musex/desktop exec tsc --noEmit && pnpm exec biome check packages/desktop/src/main/adapters/stream-proxy.ts`
Expected: no type errors, no lint errors. (Existing desktop tests still pass — the proxy has no unit tests; behavior is unchanged until a cache is configured.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(cache): stream-proxy write-through + serve-from-disk (range-aware)"
git push origin main
```

---

### Task 4: Persistence fields + IPC contract + preload bridge

**Files:**
- Modify: `packages/desktop/src/main/adapters/persistence.ts`
- Modify: `packages/desktop/src/shared/ipc-contract.ts`
- Modify: `packages/desktop/src/preload/index.ts`

- [ ] **Step 1: Add cache fields to persistence**

In `packages/desktop/src/main/adapters/persistence.ts`, extend `PersistedState`, defaults, and the `persistence` object.

Replace the `PersistedState` interface and `store` declaration:

```ts
export interface PersistedState {
  clientId: string;
  library: Library | null;
  volume: number;
  cacheEnabled: boolean;
  cacheMaxBytes: number;
}

/** Default local-cache cap: 5 GiB. */
export const DEFAULT_CACHE_MAX_BYTES = 5 * 1024 ** 3;

const store = new Store<PersistedState>({
  defaults: {
    clientId: "",
    library: null,
    volume: 1,
    cacheEnabled: false,
    cacheMaxBytes: DEFAULT_CACHE_MAX_BYTES,
  },
});
```

Add these methods inside the `persistence` object (after `setVolume`):

```ts
  getCacheEnabled(): boolean {
    return store.get("cacheEnabled");
  },
  setCacheEnabled(v: boolean): void {
    store.set("cacheEnabled", v);
  },
  getCacheMaxBytes(): number {
    return store.get("cacheMaxBytes");
  },
  setCacheMaxBytes(v: number): void {
    store.set("cacheMaxBytes", v);
  },
```

- [ ] **Step 2: Add channels + types + API to the IPC contract**

In `packages/desktop/src/shared/ipc-contract.ts`, add to the `IPC` object (before the closing `} as const;`):

```ts
  getPreferences: "musex:getPreferences", // -> Preferences
  setCacheEnabled: "musex:setCacheEnabled", // (boolean) -> void
  setCacheMaxBytes: "musex:setCacheMaxBytes", // (number bytes) -> void
  getCacheStats: "musex:getCacheStats", // -> CacheStats
  clearCache: "musex:clearCache", // -> { freedBytes: number }
```

Add these exported types (after `RestoreSessionResult`):

```ts
export type Preferences = { cacheEnabled: boolean; cacheMaxBytes: number };
export type CacheStats = { bytes: number; files: number };
export type ClearCacheResult = { freedBytes: number };
```

Add these methods to the `MusexApi` interface (before the closing brace):

```ts
  getPreferences(): Promise<Preferences>;
  setCacheEnabled(enabled: boolean): Promise<void>;
  setCacheMaxBytes(bytes: number): Promise<void>;
  getCacheStats(): Promise<CacheStats>;
  clearCache(): Promise<ClearCacheResult>;
```

- [ ] **Step 3: Wire the preload bridge**

In `packages/desktop/src/preload/index.ts`, add to the `api` object (after `setVolume`):

```ts
  getPreferences: () => ipcRenderer.invoke(IPC.getPreferences),
  setCacheEnabled: (enabled) => ipcRenderer.invoke(IPC.setCacheEnabled, enabled),
  setCacheMaxBytes: (bytes) => ipcRenderer.invoke(IPC.setCacheMaxBytes, bytes),
  getCacheStats: () => ipcRenderer.invoke(IPC.getCacheStats),
  clearCache: () => ipcRenderer.invoke(IPC.clearCache),
```

- [ ] **Step 4: Typecheck + existing contract test**

Run: `pnpm --filter @musex/desktop exec tsc --noEmit && pnpm --filter @musex/desktop exec vitest run src/shared/ipc-contract.test.ts`
Expected: no type errors; the contract test (unique + `musex:`-namespaced channels) passes with the new channels.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(cache): persistence fields + preference IPC contract + preload"
git push origin main
```

---

### Task 5: Runtime wiring + IPC handlers

**Files:**
- Modify: `packages/desktop/src/main/runtime.ts`
- Modify: `packages/desktop/src/main/ipc.ts`

- [ ] **Step 1: Construct + configure the cache in Runtime**

In `packages/desktop/src/main/runtime.ts`:

Add imports at the top (after the existing imports):

```ts
import path from "node:path";
import { app, shell } from "electron";
import { MediaCache } from "./adapters/media-cache.js";
import { persistence } from "./adapters/persistence.js";
```

(Note: `shell` is already imported — merge it into the existing `import { shell } from "electron";` so there's a single `import { app, shell } from "electron";`. Do not duplicate the import.)

Add the cache field to the class (next to the other `readonly` fields):

```ts
  readonly cache = new MediaCache(path.join(app.getPath("userData"), "media-cache"));
```

Replace the `init` method body so the cache is initialised and wired into the proxy before it starts:

```ts
  async init(): Promise<void> {
    await this.cache.init();
    this.proxy.configureCache(this.cache, () => ({
      enabled: persistence.getCacheEnabled(),
      maxBytes: persistence.getCacheMaxBytes(),
    }));
    await this.proxy.start();
  }
```

- [ ] **Step 2: Add preference + cache IPC handlers**

In `packages/desktop/src/main/ipc.ts`, add these handlers inside `registerIpc`, after the existing `setVolume` handler:

```ts
  ipcMain.handle(IPC.getPreferences, () => ({
    cacheEnabled: persistence.getCacheEnabled(),
    cacheMaxBytes: persistence.getCacheMaxBytes(),
  }));
  ipcMain.handle(IPC.setCacheEnabled, (_e, enabled: boolean) => {
    if (typeof enabled !== "boolean") throw new Error("invalid cacheEnabled");
    persistence.setCacheEnabled(enabled);
  });
  ipcMain.handle(IPC.setCacheMaxBytes, (_e, bytes: number) => {
    const MIN = 100 * 1024 ** 2; // 100 MiB floor
    if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < MIN) {
      throw new Error("invalid cacheMaxBytes");
    }
    persistence.setCacheMaxBytes(bytes);
  });
  ipcMain.handle(IPC.getCacheStats, () => rt.cache.stats());
  ipcMain.handle(IPC.clearCache, async () => ({ freedBytes: await rt.cache.clear() }));
```

(`persistence` is already imported in `ipc.ts`; `rt` is the `Runtime` param.)

- [ ] **Step 3: Typecheck + full desktop tests**

Run: `pnpm --filter @musex/desktop exec tsc --noEmit && pnpm --filter @musex/desktop test`
Expected: no type errors; all desktop tests pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(cache): wire MediaCache into runtime + preference/cache IPC handlers"
git push origin main
```

---

### Task 6: Settings view (renderer) + navigation + theme

**Files:**
- Modify: `packages/desktop/src/renderer/src/util/format.ts`
- Test: `packages/desktop/src/renderer/src/util/format.test.ts`
- Modify: `packages/desktop/src/renderer/src/state/app.tsx`
- Modify: `packages/desktop/src/renderer/src/ui/Shell.tsx`
- Create: `packages/desktop/src/renderer/src/ui/views/SettingsView.tsx`
- Modify: `packages/desktop/src/renderer/src/ui/theme.css`

- [ ] **Step 1: Write the failing test for formatBytes**

Append to `packages/desktop/src/renderer/src/util/format.test.ts` (keep existing tests; add the import for `formatBytes` to the existing import from `./format`):

```ts
describe("formatBytes", () => {
  it("formats bytes below 1 KiB", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
  });
  it("formats KiB/MiB/GiB with sensible precision", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5 GB");
    expect(formatBytes(1024 ** 4)).toBe("1 TB");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @musex/desktop exec vitest run src/renderer/src/util/format.test.ts`
Expected: FAIL — `formatBytes is not a function` / not exported.

- [ ] **Step 3: Implement formatBytes**

Append to `packages/desktop/src/renderer/src/util/format.ts`:

```ts
/** Human-readable byte size (binary units, e.g. "5 GB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const decimals = value >= 10 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[i] ?? "TB"}`;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @musex/desktop exec vitest run src/renderer/src/util/format.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the `settings` view to app state**

In `packages/desktop/src/renderer/src/state/app.tsx`, add `settings` to the `View` union:

```ts
export type View =
  | { name: "albums" }
  | { name: "artists" }
  | { name: "album"; album: Album }
  | { name: "artist"; artist: Artist }
  | { name: "settings" };
```

(No reducer change needed — `navigate` already accepts any `View`.)

- [ ] **Step 6: Create the SettingsView component**

Create `packages/desktop/src/renderer/src/ui/views/SettingsView.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { CacheStats } from "../../../../shared/ipc-contract";
import { useApp } from "../../state/app";
import { formatBytes } from "../../util/format";

const GiB = 1024 ** 3;

type LoadState =
  | { status: "loading" }
  | { status: "ready"; cacheEnabled: boolean; capGiB: number };

export function SettingsView() {
  const { library } = useApp();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [clearing, setClearing] = useState(false);

  function refreshStats() {
    window.musex
      .getCacheStats()
      .then(setStats)
      .catch(() => setStats(null));
  }

  useEffect(() => {
    let cancelled = false;
    window.musex
      .getPreferences()
      .then((p) => {
        if (!cancelled) {
          setState({ status: "ready", cacheEnabled: p.cacheEnabled, capGiB: p.cacheMaxBytes / GiB });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: "ready", cacheEnabled: false, capGiB: 5 });
      });
    refreshStats();
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading") {
    return <div className="content-placeholder">Loading settings…</div>;
  }

  async function toggleCache(enabled: boolean) {
    if (state.status !== "ready") return;
    setState({ ...state, cacheEnabled: enabled });
    await window.musex.setCacheEnabled(enabled);
  }

  function changeCap(nextGiB: number) {
    if (state.status !== "ready") return;
    const clamped = Number.isFinite(nextGiB) && nextGiB >= 1 ? nextGiB : 1;
    setState({ ...state, capGiB: clamped });
    void window.musex.setCacheMaxBytes(Math.round(clamped * GiB));
  }

  async function clearCache() {
    setClearing(true);
    try {
      await window.musex.clearCache();
      refreshStats();
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="settings-page">
      <h2 className="settings-head">Settings</h2>
      <div className="settings-subhead">Configure musex.</div>

      <div className="settings-section">
        <div className="settings-section-title">Local Cache</div>

        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">Cache played tracks on this Mac</div>
            <div className="settings-row-desc">
              Songs are saved to disk as they play and loaded locally next time, so
              repeat listens don't re-stream from Plex. Only original (direct-play) files
              are cached.
            </div>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={state.cacheEnabled}
              onChange={(e) => void toggleCache(e.target.checked)}
            />
            <span className="switch-track" />
          </label>
        </div>

        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">Maximum cache size</div>
            <div className="settings-row-desc">
              When the cache grows past this size, the least-recently-played files are
              removed automatically.
            </div>
          </div>
          <div>
            <input
              className="settings-input"
              type="number"
              min={1}
              step={1}
              value={state.capGiB}
              disabled={!state.cacheEnabled}
              onChange={(e) => changeCap(Number(e.target.value))}
            />
            <span className="settings-suffix">GB</span>
          </div>
        </div>

        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">Current cache</div>
            <div className="settings-row-desc">
              {stats ? `${formatBytes(stats.bytes)} across ${stats.files} file${stats.files === 1 ? "" : "s"}` : "—"}
            </div>
          </div>
          <button
            type="button"
            className="settings-btn danger"
            disabled={clearing || (stats?.files ?? 0) === 0}
            onClick={() => void clearCache()}
          >
            {clearing ? "Clearing…" : "Clear cache"}
          </button>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">Account</div>
        <div className="settings-row">
          <div className="settings-row-text">
            <div className="settings-row-label">Plex server</div>
            <div className="settings-row-desc">
              {library ? `${library.serverName} · ${library.title}` : "No library selected"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Add the Settings nav item + route in Shell**

In `packages/desktop/src/renderer/src/ui/Shell.tsx`:

Add the import:

```tsx
import { SettingsView } from "./views/SettingsView";
```

Add an `active` flag alongside the existing ones:

```tsx
  const settingsActive = view.name === "settings";
```

Add a `settings` case to `renderContent`'s switch (before the `albums` case is fine):

```tsx
      case "settings":
        return <SettingsView />;
```

Add a functional Settings nav button. Replace the dim, non-functional Tracks item block with the Tracks item followed by a working Settings item:

```tsx
        <div className="nav-item dim">
          <span className="nav-ic" />
          Tracks
        </div>

        <div className="nav-section">App</div>

        <button
          type="button"
          className={`nav-item${settingsActive ? " active" : ""}`}
          onClick={() => dispatch({ type: "navigate", view: { name: "settings" } })}
        >
          <span className="nav-ic" />
          Settings
        </button>
```

- [ ] **Step 8: Add Settings styles to the theme**

Append to `packages/desktop/src/renderer/src/ui/theme.css`:

```css
/* ---- Settings view ---- */

.settings-page {
  padding: 24px 28px;
  max-width: 720px;
}

.settings-head {
  margin: 0 0 4px;
  font-size: 22px;
}

.settings-subhead {
  opacity: 0.5;
  font-size: 12px;
  margin-bottom: 24px;
}

.settings-section {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 2px 18px;
  margin-bottom: 18px;
}

.settings-section-title {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.5;
  padding: 14px 0 4px;
}

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px 0;
  border-top: 1px solid var(--line);
}

.settings-section-title + .settings-row {
  border-top: none;
}

.settings-row-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.settings-row-label {
  font-size: 13.5px;
  font-weight: 600;
}

.settings-row-desc {
  font-size: 11.5px;
  opacity: 0.5;
  max-width: 440px;
  line-height: 1.45;
}

/* Toggle switch */
.switch {
  position: relative;
  width: 40px;
  height: 22px;
  flex-shrink: 0;
}

.switch input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.switch-track {
  position: absolute;
  inset: 0;
  background: var(--panel-2);
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s;
}

.switch-track::before {
  content: "";
  position: absolute;
  width: 16px;
  height: 16px;
  left: 3px;
  top: 3px;
  border-radius: 50%;
  background: var(--text);
  transition: transform 0.15s;
}

.switch input:checked + .switch-track {
  background: var(--green);
}

.switch input:checked + .switch-track::before {
  transform: translateX(18px);
}

/* Number input */
.settings-input {
  background: var(--panel-2);
  border: 1px solid var(--line);
  color: var(--text);
  border-radius: 8px;
  padding: 7px 10px;
  font: inherit;
  width: 84px;
  text-align: right;
}

.settings-input:disabled {
  opacity: 0.45;
}

.settings-suffix {
  opacity: 0.5;
  font-size: 12px;
  margin-left: 6px;
}

/* Buttons */
.settings-btn {
  background: var(--panel-2);
  border: 1px solid var(--line);
  color: var(--text);
  border-radius: 8px;
  padding: 7px 14px;
  font: inherit;
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s, color 0.1s;
  flex-shrink: 0;
}

.settings-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.08);
}

.settings-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.settings-btn.danger:hover:not(:disabled) {
  border-color: var(--red);
  color: var(--red);
}
```

- [ ] **Step 9: Typecheck + lint + tests**

Run: `pnpm --filter @musex/desktop exec tsc --noEmit && pnpm exec biome check packages/desktop/src && pnpm --filter @musex/desktop test`
Expected: clean typecheck, no lint errors, all tests pass.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "feat(settings): sectioned Settings view with local-cache controls"
git push origin main
```

---

### Task 7: End-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Full local CI bar**

Run from repo root: `pnpm check`
Expected: typecheck + all tests + Biome lint/format all pass (this is the CI bar).

- [ ] **Step 2: Manual smoke test (dev)**

Start the app: `pnpm --filter @musex/desktop dev` (quit any running instance first so the patched/rebuilt code loads).

Verify:
1. A **Settings** item appears in the sidebar; clicking it shows the Settings view (cache section + Account section), and volume is still in the Now Playing bar (unchanged).
2. With cache **off**, playing a track streams as before; the cache stat stays at 0 files.
3. Turn cache **on**, play a track to completion. The "Current cache" stat (re-open Settings) shows 1 file of roughly the track size. In Finder, `~/Library/Application Support/<app>/media-cache/` contains one hex-named file (no `.part` left over).
4. Play the **same track again** — confirm it serves from disk. (In the terminal, no `[musex stream proxy] /library/parts/...` upstream line for that track; only the first play hit Plex.)
5. **Seek** within a cached track — playback continues (Range served from disk).
6. Skip a track mid-download — confirm no `.part` file is orphaned and no incomplete entry is committed (a half file should not appear as a complete cache entry).
7. Set **Maximum cache size** to `1` GB and play enough distinct tracks to exceed it — confirm older files get evicted (file count/size stops growing past the cap).
8. **Clear cache** — stat returns to 0 files and the `media-cache/` dir is emptied.

- [ ] **Step 3: Update project notes (only if something non-obvious was learned)**

If implementation surfaced a non-obvious gotcha (e.g. an `electron-store` default-merge quirk, a Plex part-path shape difference, a Biome rule interaction), add a one-line note to `CLAUDE.md` under the appropriate section and commit. Otherwise skip.

---

## Self-Review Notes

- **Spec coverage:** Preferences view (Task 6) ✓; sectioned/extensible with Account section ✓; volume stays in Now Playing bar (untouched) ✓; cache enable toggle ✓; configurable cap ✓; current size + clear ✓ (Task 6 UI, Task 5 handlers). Write-through on full GET ✓ (Task 3); serve-from-disk incl. Range ✓ (Task 3); direct-play-only via `isCacheablePath` ✓ (Task 1/3); LRU eviction at cap ✓ (Task 1 selection, Task 2 fs); key = sha256(serverId+path) ✓ (Task 1); eviction/clear confined to `media-cache/` ✓ (Task 2); no core/audio-engine changes ✓.
- **Type consistency:** `CacheConfig` (proxy) ↔ `() => ({ enabled, maxBytes })` (runtime) match; `CacheStats` shape `{ bytes, files }` consistent across media-cache, contract, and SettingsView; `Preferences` `{ cacheEnabled, cacheMaxBytes }` consistent across contract/handlers/SettingsView; `configureCache(cache, readConfig)` signature matches caller.
- **Placeholders:** none — all steps contain full code.
