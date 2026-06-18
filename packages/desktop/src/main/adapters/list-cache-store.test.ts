import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ListCacheStore } from "./list-cache-store";

let dir: string;
let store: ListCacheStore;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "musex-listcache-"));
  store = new ListCacheStore(dir, 3);
  await store.init();
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ListCacheStore", () => {
  it("returns null on miss", async () => {
    expect(await store.get("k", "v1")).toBeNull();
  });
  it("round-trips data when the validator matches", async () => {
    await store.set("k", "v1", [{ id: "a" }]);
    expect(await store.get("k", "v1")).toEqual([{ id: "a" }]);
  });
  it("returns null when the validator differs (stale)", async () => {
    await store.set("k", "v1", [{ id: "a" }]);
    expect(await store.get("k", "v2")).toBeNull();
  });
  it("persists across store instances (disk)", async () => {
    await store.set("k", "v1", [{ id: "a" }]);
    const fresh = new ListCacheStore(dir, 3);
    await fresh.init();
    expect(await fresh.get("k", "v1")).toEqual([{ id: "a" }]);
  });
  it("evicts the oldest entries beyond the cap", async () => {
    await store.set("a", "v", [1]);
    await store.set("b", "v", [2]);
    await store.set("c", "v", [3]);
    await store.set("d", "v", [4]); // cap 3 -> "a" evicted
    expect(await store.get("a", "v")).toBeNull();
    expect(await store.get("d", "v")).toEqual([4]);
  });
  it("evictKey drops a specific entry", async () => {
    await store.set("k", "v", [1]);
    await store.evictKey("k");
    expect(await store.get("k", "v")).toBeNull();
  });
  it("getStale returns data regardless of the validator", async () => {
    await store.set("k", "v1", [{ id: "a" }]);
    expect(await store.getStale("k")).toEqual([{ id: "a" }]);
    // also from disk (no in-memory tier)
    const fresh = new ListCacheStore(dir, 3);
    await fresh.init();
    expect(await fresh.getStale("k")).toEqual([{ id: "a" }]);
  });
  it("getStale returns null when absent", async () => {
    expect(await store.getStale("missing")).toBeNull();
  });
});
