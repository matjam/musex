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
    await writeFile(path.join(dir, "old"), Buffer.alloc(400));
    await writeFile(path.join(dir, "new"), Buffer.alloc(400));
    await utimes(path.join(dir, "old"), new Date(10_000), new Date(10_000));
    await utimes(path.join(dir, "new"), new Date(20_000), new Date(20_000));
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
    await cache.pathIfPresent("x");
    await writeEntry("z", Buffer.alloc(400), 1000);
    expect(await cache.pathIfPresent("y")).toBeNull();
    expect(await cache.pathIfPresent("x")).not.toBeNull();
  });
});
