import { describe, expect, it } from "vitest";
import type { FsOps } from "./mobile-list-cache";
import { MobileListCache } from "./mobile-list-cache";
import { sha256hex } from "./sha256";

/** In-memory FsOps fake: a Map of filename -> { text, mtime }. mtime is a
 *  monotonically advancing counter so LRU ordering is deterministic. */
function fakeFs(): FsOps & { _files: Map<string, { text: string; mtime: number }> } {
  const files = new Map<string, { text: string; mtime: number }>();
  let clock = 0;
  return {
    _files: files,
    async ensureDir() {},
    async read(name) {
      return files.get(name)?.text ?? null;
    },
    async write(name, text) {
      files.set(name, { text, mtime: ++clock });
    },
    async remove(name) {
      files.delete(name);
    },
    async list() {
      return [...files.keys()];
    },
    async stat(name) {
      return files.get(name)?.mtime ?? null;
    },
    async clearAll() {
      files.clear();
    },
  };
}

describe("MobileListCache", () => {
  it("round-trips set -> get on validator match", async () => {
    const fs = fakeFs();
    const cache = new MobileListCache(fs, sha256hex);
    await cache.init();
    await cache.set("artists:L", "v1", [{ id: "a" }]);
    expect(await cache.get("artists:L", "v1")).toEqual([{ id: "a" }]);
  });

  it("returns null when the validator does not match", async () => {
    const fs = fakeFs();
    const cache = new MobileListCache(fs, sha256hex);
    await cache.init();
    await cache.set("artists:L", "v1", [{ id: "a" }]);
    expect(await cache.get("artists:L", "v2")).toBeNull();
  });

  it("getStale returns data regardless of validator", async () => {
    const fs = fakeFs();
    const cache = new MobileListCache(fs, sha256hex);
    await cache.init();
    await cache.set("artists:L", "v1", [{ id: "a" }]);
    expect(await cache.getStale("artists:L")).toEqual([{ id: "a" }]);
    // and null for an unknown key
    expect(await cache.getStale("nope")).toBeNull();
  });

  it("evictKey removes the entry from both tiers", async () => {
    const fs = fakeFs();
    const cache = new MobileListCache(fs, sha256hex);
    await cache.init();
    await cache.set("artists:L", "v1", [{ id: "a" }]);
    await cache.evictKey("artists:L");
    expect(await cache.get("artists:L", "v1")).toBeNull();
    expect(await cache.getStale("artists:L")).toBeNull();
    expect(fs._files.size).toBe(0);
  });

  it("LRU-evicts the oldest entries beyond maxEntries", async () => {
    const fs = fakeFs();
    const cache = new MobileListCache(fs, sha256hex, 2);
    await cache.init();
    await cache.set("k1", "v", 1);
    await cache.set("k2", "v", 2);
    await cache.set("k3", "v", 3); // exceeds cap of 2 -> k1 (oldest mtime) dropped
    expect(await cache.getStale("k1")).toBeNull();
    expect(await cache.getStale("k2")).toBe(2);
    expect(await cache.getStale("k3")).toBe(3);
  });

  it("treats corrupt JSON as a miss", async () => {
    const fs = fakeFs();
    const cache = new MobileListCache(fs, sha256hex);
    await cache.init();
    // Write garbage directly under the hashed filename for the key.
    await fs.write(`${sha256hex("artists:L")}.json`, "{not json");
    expect(await cache.get("artists:L", "v1")).toBeNull();
    expect(await cache.getStale("artists:L")).toBeNull();
  });

  it("clear empties the cache", async () => {
    const fs = fakeFs();
    const cache = new MobileListCache(fs, sha256hex);
    await cache.init();
    await cache.set("k1", "v", 1);
    await cache.set("k2", "v", 2);
    await cache.clear();
    expect(await cache.getStale("k1")).toBeNull();
    expect(await cache.getStale("k2")).toBeNull();
    expect(fs._files.size).toBe(0);
  });
});
