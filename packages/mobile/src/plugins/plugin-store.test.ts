import { describe, expect, it } from "vitest";
import { type FsOps, PluginFileStore } from "./plugin-store";

/** In-memory FsOps: `<id>/<name>` → bytes. */
function fakeFs() {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const fs: FsOps = {
    ensureDir(id) {
      dirs.add(id);
    },
    writeFile(id, name, bytes) {
      files.set(`${id}/${name}`, bytes);
    },
    readText(id, name) {
      const b = files.get(`${id}/${name}`);
      if (!b) throw new Error(`no such file: ${id}/${name}`);
      return new TextDecoder().decode(b);
    },
    removeDir(id) {
      dirs.delete(id);
      for (const k of [...files.keys()]) if (k.startsWith(`${id}/`)) files.delete(k);
    },
    listDirs() {
      return [...dirs];
    },
  };
  return { files, dirs, fs };
}

const enc = (s: string) => new TextEncoder().encode(s);

describe("PluginFileStore", () => {
  it("writePlugin rejects an unsafe id", async () => {
    const { fs } = fakeFs();
    const store = new PluginFileStore(fs);
    await expect(store.writePlugin("../evil", { "plugin.json": enc("{}") })).rejects.toThrow(
      /invalid plugin id/,
    );
  });

  it("writePlugin rejects an unsafe entry name", async () => {
    const { fs } = fakeFs();
    const store = new PluginFileStore(fs);
    await expect(store.writePlugin("lidarr", { "../escape.mjs": enc("x") })).rejects.toThrow(
      /unsafe entry name/,
    );
  });

  it("readEntry returns the written module code", async () => {
    const { fs } = fakeFs();
    const store = new PluginFileStore(fs);
    await store.writePlugin("lidarr", {
      "plugin.json": enc('{"id":"lidarr"}'),
      "index.mjs": enc("export function activate(){}"),
    });
    expect(await store.readEntry("lidarr", "index.mjs")).toBe("export function activate(){}");
  });

  it("readEntry rejects an unsafe id / entry", async () => {
    const { fs } = fakeFs();
    const store = new PluginFileStore(fs);
    await expect(store.readEntry("../x", "index.mjs")).rejects.toThrow(/invalid plugin id/);
    await expect(store.readEntry("lidarr", "../x.mjs")).rejects.toThrow(/unsafe entry name/);
  });

  it("writePlugin replaces a prior install (removeDir before write)", async () => {
    const { fs, files } = fakeFs();
    const store = new PluginFileStore(fs);
    await store.writePlugin("lidarr", { "index.mjs": enc("v1"), "old.mjs": enc("stale") });
    await store.writePlugin("lidarr", { "index.mjs": enc("v2") });
    expect(await store.readEntry("lidarr", "index.mjs")).toBe("v2");
    expect(files.has("lidarr/old.mjs")).toBe(false);
  });

  it("removePlugin clears the dir and list reflects installed ids", async () => {
    const { fs } = fakeFs();
    const store = new PluginFileStore(fs);
    await store.writePlugin("lidarr", { "index.mjs": enc("x") });
    await store.writePlugin("scrobbler", { "index.mjs": enc("y") });
    expect((await store.list()).sort()).toEqual(["lidarr", "scrobbler"]);
    await store.removePlugin("lidarr");
    expect(await store.list()).toEqual(["scrobbler"]);
  });

  it("removePlugin rejects an unsafe id (guard before fs use)", async () => {
    const { fs } = fakeFs();
    const store = new PluginFileStore(fs);
    await expect(store.removePlugin("../../etc")).rejects.toThrow(/invalid plugin id/);
  });
});
