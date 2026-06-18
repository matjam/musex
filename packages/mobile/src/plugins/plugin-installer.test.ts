import { zipSync } from "fflate";
import { sha256 } from "js-sha256";
import { describe, expect, it, vi } from "vitest";
import type { FsOps } from "./plugin-store";
import { PluginFileStore } from "./plugin-store";

vi.mock("@react-native-async-storage/async-storage", () => {
  const m = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => m.get(k) ?? null,
      setItem: async (k: string, v: string) => void m.set(k, v),
    },
  };
});

import { PluginIndex } from "./plugin-index";
import { MobilePluginInstaller } from "./plugin-installer";

const enc = (s: string) => new TextEncoder().encode(s);

function fakeFs() {
  const files = new Map<string, Uint8Array>();
  const dirs = new Set<string>();
  const fs: FsOps = {
    ensureDir: (id) => void dirs.add(id),
    writeFile: (id, name, bytes) => void files.set(`${id}/${name}`, bytes),
    readText: (id, name) => {
      const b = files.get(`${id}/${name}`);
      if (!b) throw new Error("no file");
      return new TextDecoder().decode(b);
    },
    removeDir: (id) => {
      dirs.delete(id);
      for (const k of [...files.keys()]) if (k.startsWith(`${id}/`)) files.delete(k);
    },
    listDirs: () => [...dirs],
  };
  return { files, fs };
}

const MANIFEST = (apiVersion = 2) => ({
  schemaVersion: 1,
  repo: "matjam/musex-plugins",
  plugins: [
    {
      id: "lidarr",
      name: "Lidarr",
      description: "Acquire music via Lidarr",
      apiVersion,
      version: "0.2.0",
      tag: "lidarr-v0.2.0",
      asset: "lidarr-0.2.0.zip",
    },
  ],
});

function makeZip(extra: Record<string, Uint8Array> = {}) {
  return zipSync({
    "plugin.json": enc('{"id":"lidarr","name":"Lidarr","version":"0.2.0","entry":"index.mjs"}'),
    "index.mjs": enc("export function activate(ctx){}"),
    ...extra,
  });
}

const ASSET_URL =
  "https://github.com/matjam/musex-plugins/releases/download/lidarr-v0.2.0/lidarr-0.2.0.zip";
const MAIN_MANIFEST_URL =
  "https://raw.githubusercontent.com/matjam/musex-plugins/main/plugins.json";
const MASTER_MANIFEST_URL =
  "https://raw.githubusercontent.com/matjam/musex-plugins/master/plugins.json";

/** A scripted fetch: maps URL → {ok,status, json/text/arrayBuffer}. */
function fakeFetch(
  routes: Record<string, { status?: number; json?: unknown; bytes?: Uint8Array; text?: string }>,
) {
  return (async (url: string) => {
    const r = routes[url];
    if (!r) return { ok: false, status: 404 } as Response;
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => r.json,
      text: async () => r.text ?? "",
      arrayBuffer: async () => {
        const b = r.bytes ?? new Uint8Array();
        return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

function deps(
  fetchImpl: typeof fetch,
  store: PluginFileStore,
  index: PluginIndex,
  reload: () => Promise<void> = async () => {},
) {
  return new MobilePluginInstaller({
    fetch: fetchImpl,
    store,
    index,
    sha256: (b) => sha256(b),
    reload,
  });
}

describe("MobilePluginInstaller", () => {
  it("happy path: verifies sha, whitelist-extracts, writes, upserts, reloads", async () => {
    const zip = makeZip();
    const reload = vi.fn(async () => {});
    const { fs } = fakeFs();
    const store = new PluginFileStore(fs);
    const index = new PluginIndex();
    await index.load();
    const inst = deps(
      fakeFetch({
        [MAIN_MANIFEST_URL]: { json: MANIFEST() },
        [ASSET_URL]: { bytes: zip },
        [`${ASSET_URL}.sha256`]: { text: `${sha256(zip)}  lidarr-0.2.0.zip\n` },
      }),
      store,
      index,
      reload,
    );

    await inst.install("matjam/musex-plugins", "lidarr");

    expect(await store.readEntry("lidarr", "index.mjs")).toBe("export function activate(ctx){}");
    const rec = index.get("lidarr");
    expect(rec?.enabled).toBe(true);
    expect(rec?.manifest.entry).toBe("index.mjs");
    expect(rec?.source).toEqual({ owner: "matjam", repo: "musex-plugins", version: "0.2.0" });
    expect(reload).toHaveBeenCalledOnce();
  });

  it("falls back from main to master for the manifest", async () => {
    const zip = makeZip();
    const { fs } = fakeFs();
    const store = new PluginFileStore(fs);
    const index = new PluginIndex();
    await index.load();
    const inst = deps(
      fakeFetch({
        [MAIN_MANIFEST_URL]: { status: 404 },
        [MASTER_MANIFEST_URL]: { json: MANIFEST() },
        [ASSET_URL]: { bytes: zip },
        [`${ASSET_URL}.sha256`]: { text: sha256(zip) },
      }),
      store,
      index,
    );
    await inst.install("matjam/musex-plugins", "lidarr");
    expect(index.get("lidarr")).toBeDefined();
  });

  it("rejects apiVersion !== 2", async () => {
    const { fs } = fakeFs();
    const inst = deps(
      fakeFetch({ [MAIN_MANIFEST_URL]: { json: MANIFEST(1) } }),
      new PluginFileStore(fs),
      await loadedIndex(),
    );
    await expect(inst.install("matjam/musex-plugins", "lidarr")).rejects.toThrow(
      /needs plugin API v1/,
    );
  });

  it("aborts on sha256 mismatch", async () => {
    const zip = makeZip();
    const { fs } = fakeFs();
    const store = new PluginFileStore(fs);
    const inst = deps(
      fakeFetch({
        [MAIN_MANIFEST_URL]: { json: MANIFEST() },
        [ASSET_URL]: { bytes: zip },
        [`${ASSET_URL}.sha256`]: { text: "0".repeat(64) },
      }),
      store,
      await loadedIndex(),
    );
    await expect(inst.install("matjam/musex-plugins", "lidarr")).rejects.toThrow(
      /checksum mismatch/,
    );
    expect(await store.list()).toEqual([]);
  });

  it("rejects a zip-slip entry name in plugin.json", async () => {
    const zip = zipSync({
      "plugin.json": enc('{"id":"lidarr","entry":"../escape.mjs"}'),
      "index.mjs": enc("x"),
    });
    const { fs } = fakeFs();
    const inst = deps(
      fakeFetch({
        [MAIN_MANIFEST_URL]: { json: MANIFEST() },
        [ASSET_URL]: { bytes: zip },
        [`${ASSET_URL}.sha256`]: { text: sha256(zip) },
      }),
      new PluginFileStore(fs),
      await loadedIndex(),
    );
    await expect(inst.install("matjam/musex-plugins", "lidarr")).rejects.toThrow(
      /unsafe entry name/,
    );
  });

  it("rejects an unsafe install id before any fetch", async () => {
    const { fs } = fakeFs();
    const inst = deps(fakeFetch({}), new PluginFileStore(fs), await loadedIndex());
    await expect(inst.install("matjam/musex-plugins", "../../x")).rejects.toThrow(
      /invalid plugin id/,
    );
  });

  it("uninstall removes from store + index and reloads", async () => {
    const reload = vi.fn(async () => {});
    const { fs } = fakeFs();
    const store = new PluginFileStore(fs);
    await store.writePlugin("lidarr", { "index.mjs": enc("x") });
    const index = new PluginIndex();
    await index.load();
    await index.upsert({
      id: "lidarr",
      manifest: {
        id: "lidarr",
        name: "Lidarr",
        version: "0.2.0",
        apiVersion: 2,
        entry: "index.mjs",
      },
      enabled: true,
      source: { owner: "matjam", repo: "musex-plugins", version: "0.2.0" },
    });
    const inst = deps(fakeFetch({}), store, index, reload);
    await inst.uninstall("lidarr");
    expect(await store.list()).toEqual([]);
    expect(index.get("lidarr")).toBeUndefined();
    expect(reload).toHaveBeenCalledOnce();
  });

  it("fetchManifest marks apiVersion-2 plugins compatible + reports installedVersion", async () => {
    const index = await loadedIndex();
    await index.upsert({
      id: "lidarr",
      manifest: {
        id: "lidarr",
        name: "Lidarr",
        version: "0.1.0",
        apiVersion: 2,
        entry: "index.mjs",
      },
      enabled: true,
      source: { owner: "matjam", repo: "musex-plugins", version: "0.1.0" },
    });
    const { fs } = fakeFs();
    const inst = deps(
      fakeFetch({ [MAIN_MANIFEST_URL]: { json: MANIFEST() } }),
      new PluginFileStore(fs),
      index,
    );
    const res = await inst.fetchManifest("matjam/musex-plugins");
    expect(res.repo).toBe("matjam/musex-plugins");
    expect(res.plugins[0]?.compatible).toBe(true);
    expect(res.plugins[0]?.installedVersion).toBe("0.1.0");
  });
});

async function loadedIndex(): Promise<PluginIndex> {
  const i = new PluginIndex();
  await i.load();
  return i;
}
