import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
  it("remove rejects a key that would escape the store directory", async () => {
    await expect(store.remove("../escape")).rejects.toThrow();
    await expect(store.remove("../../etc/passwd")).rejects.toThrow();
  });
  it("commit rejects when the atomic rename fails (so the manager marks the job failed)", async () => {
    // Pre-create a directory at the destination key path: renaming the temp
    // file onto an existing directory fails, exercising commit's reject path.
    await mkdir(join(dir, "k4"));
    const w = store.beginWrite("k4");
    w.stream.write("data");
    w.stream.end();
    await expect(w.commit()).rejects.toThrow();
    // the .part temp is cleaned up — only the pre-created directory remains
    expect(await store.listKeys()).toEqual(["k4"]);
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
