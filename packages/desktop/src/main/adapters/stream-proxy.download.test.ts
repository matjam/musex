import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cacheKey } from "../../logic/cache.js";
import { MediaCache } from "./media-cache.js";
import { StreamProxy } from "./stream-proxy.js";

const SERVER_ID = "srv-1";
const PLEX_PATH = "/library/parts/1/file.flac";
const KEY = cacheKey(SERVER_ID, PLEX_PATH);
const BYTES = Buffer.from("downloaded-track-bytes-0123456789", "utf8");

/** Minimal fake downloads store backed by an in-memory key→path map. */
class FakeDownloads {
  private readonly map = new Map<string, string>();
  set(key: string, filePath: string): void {
    this.map.set(key, filePath);
  }
  async pathIfPresent(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async has(key: string): Promise<boolean> {
    return this.map.has(key);
  }
}

let dir: string;
let proxy: StreamProxy;
let downloads: FakeDownloads;
let port: number;
let filePath: string;
/** A fetch spy that always throws — proves upstream was never contacted. */
let upstreamFetch: ReturnType<typeof vi.fn>;
let realFetch: typeof globalThis.fetch;

/** Reach into the proxy's private state to drive a request without runtime wiring.
 *  The proxy exposes no public URL builder for arbitrary keys, so read the
 *  per-launch secret + bound port directly (mirrors how the renderer receives
 *  baked URLs from main). Test-only introspection of fields the proxy computes. */
function proxyState(): { secret: string; port: number } {
  const p = proxy as unknown as { secret: string; port: number };
  return { secret: p.secret, port: p.port };
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "musex-proxy-dl-"));
  filePath = join(dir, "downloaded.flac");
  await writeFile(filePath, BYTES);

  downloads = new FakeDownloads();
  downloads.set(KEY, filePath);

  proxy = new StreamProxy();
  // No endpoint is registered, so any upstream attempt 404s; the fetch spy
  // additionally guards the external-art branch (unused here).
  realFetch = globalThis.fetch;
  upstreamFetch = vi.fn(() => {
    throw new Error("upstream fetch must not be called for a pinned download");
  });
  globalThis.fetch = upstreamFetch as unknown as typeof globalThis.fetch;

  await proxy.start();
  port = proxyState().port;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  // The proxy has no public stop(); close the underlying server directly.
  const srv = (proxy as unknown as { server: { close(cb?: () => void): void } | null }).server;
  await new Promise<void>((resolve) => {
    if (!srv) return resolve();
    srv.close(() => resolve());
  });
  await rm(dir, { recursive: true, force: true });
});

/** GET the proxy URL for KEY with the correct secret-in-path + Host header. */
async function getDownload(extraHeaders: Record<string, string> = {}): Promise<{
  status: number;
  body: Buffer;
}> {
  const { secret } = proxyState();
  const url = `http://127.0.0.1:${port}/${secret}/${SERVER_ID}${PLEX_PATH}`;
  const res = await realFetch(url, {
    headers: { Host: `127.0.0.1:${port}`, ...extraHeaders },
  });
  const body = Buffer.from(await res.arrayBuffer());
  return { status: res.status, body };
}

describe("StreamProxy — pinned downloads", () => {
  it("serves a pinned download from disk without hitting upstream (cache disabled)", async () => {
    proxy.configureDownloads(downloads);
    // Explicitly NO configureCache: downloads must be independent of the LRU cache.

    const { status, body } = await getDownload();

    expect(status).toBe(200);
    expect(body.equals(BYTES)).toBe(true);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("serves a pinned download even when the LRU cache is configured but DISABLED", async () => {
    const cache = new MediaCache(join(dir, "cache"));
    await cache.init();
    proxy.configureCache(cache, () => ({ enabled: false, maxBytes: 1_000_000 }));
    proxy.configureDownloads(downloads);

    const { status, body } = await getDownload();

    expect(status).toBe(200);
    expect(body.equals(BYTES)).toBe(true);
    expect(upstreamFetch).not.toHaveBeenCalled();
    // The download must NOT have been copied into the LRU cache dir.
    expect(await cache.pathIfPresent(KEY)).toBeNull();
  });

  it("serves a pinned download even when the LRU cache is ENABLED (downloads win)", async () => {
    const cache = new MediaCache(join(dir, "cache2"));
    await cache.init();
    proxy.configureCache(cache, () => ({ enabled: true, maxBytes: 1_000_000 }));
    proxy.configureDownloads(downloads);

    const { status, body } = await getDownload();

    expect(status).toBe(200);
    expect(body.equals(BYTES)).toBe(true);
    expect(upstreamFetch).not.toHaveBeenCalled();
    // Serving a download never populates the LRU cache for that key.
    expect(await cache.pathIfPresent(KEY)).toBeNull();
  });

  it("honours a Range request against the pinned download (206 + slice)", async () => {
    proxy.configureDownloads(downloads);
    const { secret } = proxyState();
    const url = `http://127.0.0.1:${port}/${secret}/${SERVER_ID}${PLEX_PATH}`;
    const res = await realFetch(url, {
      headers: { Host: `127.0.0.1:${port}`, Range: "bytes=2-5" },
    });
    const body = Buffer.from(await res.arrayBuffer());
    expect(res.status).toBe(206);
    expect(body.equals(BYTES.subarray(2, 6))).toBe(true);
    expect(res.headers.get("content-range")).toBe(`bytes 2-5/${BYTES.length}`);
    expect(upstreamFetch).not.toHaveBeenCalled();
  });

  it("prefetch skips a key the downloads store already has (no upstream cache fetch)", async () => {
    const cache = new MediaCache(join(dir, "cache3"));
    await cache.init();
    proxy.configureCache(cache, () => ({ enabled: true, maxBytes: 1_000_000 }));
    proxy.configureDownloads(downloads);

    // Register an endpoint pointing at a dead address: WITHOUT the download-skip
    // guard, prefetch would build an upstream request and register the key in
    // prefetchInflight. With the guard, the key is `continue`d past before any
    // request is built, so the inflight map never gains it.
    proxy.registerServer(SERVER_ID, { baseUrl: "http://127.0.0.1:1", token: "tok" });

    proxy.prefetch([{ serverId: SERVER_ID, plexPath: PLEX_PATH }]);
    await new Promise((r) => setTimeout(r, 20));

    const inflight = (proxy as unknown as { prefetchInflight: Map<string, unknown> })
      .prefetchInflight;
    expect(inflight.has(KEY)).toBe(false);
    expect(await cache.pathIfPresent(KEY)).toBeNull();
  });
});
