import { ProviderHub } from "@musex/plugin-host";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const m = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => m.get(k) ?? null,
      setItem: async (k: string, v: string) => void m.set(k, v),
      clear: async () => void m.clear(),
    },
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";

beforeEach(async () => {
  await AsyncStorage.clear();
});

import type { PluginManifest } from "@musex/plugin-api";
import type { BridgeRegState } from "@musex/plugin-host";
import { type InstalledPlugin, PluginIndex } from "./plugin-index";
import { PluginManager } from "./plugin-manager";
import type { PluginFileStore } from "./plugin-store";
import type { SandboxController } from "./sandbox-host";

const emptyRegState = (): BridgeRegState => ({
  acquisition: false,
  acquisitionMethods: [],
  recommender: false,
  settingsActions: [],
  similar: [],
  sections: {},
  trackActions: [],
  trackActionMeta: {},
  trackDetail: [],
  eventHandlers: [],
});

const manifest = (id: string): PluginManifest => ({
  id,
  name: id,
  version: "0.1.0",
  apiVersion: 2,
  entry: "index.mjs",
});

const installed = (id: string, enabled = true): InstalledPlugin => ({
  id,
  manifest: manifest(id),
  enabled,
  source: { owner: "o", repo: "r", version: "0.1.0" },
});

/** A fake SandboxController: records load/invoke/dispose, returns scripted
 *  regState per plugin id and scripted invoke results. */
function fakeSandbox(opts?: {
  regState?: (id: string) => BridgeRegState;
  loadThrows?: (id: string) => boolean;
  invokeResult?: (id: string, path: string, method: string, args: unknown[]) => unknown;
}) {
  const loads: string[] = [];
  const invokes: { id: string; path: string; method: string; args: unknown[] }[] = [];
  const disposes: string[] = [];
  const controller: SandboxController = {
    ready: Promise.resolve(),
    async load(id) {
      loads.push(id);
      if (opts?.loadThrows?.(id)) throw new Error(`boom: ${id}`);
      return opts?.regState ? opts.regState(id) : emptyRegState();
    },
    async invoke(id, path, method, args) {
      invokes.push({ id, path, method, args });
      return opts?.invokeResult ? opts.invokeResult(id, path, method, args) : null;
    },
    emit() {},
    dispose(id) {
      disposes.push(id);
    },
  };
  return { controller, loads, invokes, disposes };
}

/** A store whose readEntry always returns a stub module string. */
const fakeStore = (): PluginFileStore =>
  ({ readEntry: async () => "export function activate(){}" }) as unknown as PluginFileStore;

async function indexWith(...plugins: InstalledPlugin[]): Promise<PluginIndex> {
  const idx = new PluginIndex();
  await idx.load();
  for (const p of plugins) await idx.upsert(p);
  return idx;
}

const ACQ_REG = (): BridgeRegState => ({ ...emptyRegState(), acquisition: true });

describe("PluginManager", () => {
  it("loadAll activates an enabled plugin and registers its acquisition provider in the hub", async () => {
    const hub = new ProviderHub();
    const sandbox = fakeSandbox({ regState: ACQ_REG });
    const mgr = new PluginManager({
      index: await indexWith(installed("lidarr")),
      store: fakeStore(),
      sandbox: sandbox.controller,
      hub,
    });
    await mgr.loadAll();

    expect(sandbox.loads).toEqual(["lidarr"]);
    expect(hub.acquisitionAvailable()).toBe(true);
    expect(mgr.list()).toEqual([
      {
        id: "lidarr",
        name: "lidarr",
        version: "0.1.0",
        enabled: true,
        status: "active",
        registered: ACQ_REG(),
      },
    ]);
  });

  it("a hub fan-out round-trips to sandbox.invoke", async () => {
    const hub = new ProviderHub();
    const sandbox = fakeSandbox({
      regState: ACQ_REG,
      invokeResult: (_id, path, method) =>
        path === "acquisition" && method === "lookupArtistAlbums"
          ? [
              {
                title: "Album",
                artistName: "X",
                providerRef: "ref-1",
                state: "available",
              },
            ]
          : null,
    });
    const mgr = new PluginManager({
      index: await indexWith(installed("lidarr")),
      store: fakeStore(),
      sandbox: sandbox.controller,
      hub,
    });
    await mgr.loadAll();

    const albums = await hub.lookupArtistAlbums("X");
    expect(albums).toEqual([
      {
        title: "Album",
        artistName: "X",
        providerRef: "ref-1",
        state: "available",
        providerId: "lidarr",
      },
    ]);
    expect(sandbox.invokes).toContainEqual({
      id: "lidarr",
      path: "acquisition",
      method: "lookupArtistAlbums",
      args: ["X"],
    });
  });

  it("a plugin whose load throws is status error; others stay active", async () => {
    const hub = new ProviderHub();
    const sandbox = fakeSandbox({
      regState: ACQ_REG,
      loadThrows: (id) => id === "broken",
    });
    const mgr = new PluginManager({
      index: await indexWith(installed("broken"), installed("lidarr")),
      store: fakeStore(),
      sandbox: sandbox.controller,
      hub,
    });
    await mgr.loadAll(); // must not reject

    const list = mgr.list();
    expect(list.find((p) => p.id === "broken")?.status).toBe("error");
    expect(list.find((p) => p.id === "broken")?.error).toMatch(/boom/);
    expect(list.find((p) => p.id === "lidarr")?.status).toBe("active");
    // Only the working plugin registered its acquisition provider.
    expect(hub.acquisitionAvailable()).toBe(true);
    expect(hub.registry.acquisitionProviders.map((p) => p.pluginId)).toEqual(["lidarr"]);
  });

  it("setEnabled(false) disposes the plugin's hub registrations", async () => {
    const hub = new ProviderHub();
    const sandbox = fakeSandbox({ regState: ACQ_REG });
    const mgr = new PluginManager({
      index: await indexWith(installed("lidarr")),
      store: fakeStore(),
      sandbox: sandbox.controller,
      hub,
    });
    await mgr.loadAll();
    expect(hub.acquisitionAvailable()).toBe(true);

    await mgr.setEnabled("lidarr", false);
    expect(hub.acquisitionAvailable()).toBe(false);
    expect(sandbox.disposes).toContain("lidarr");
    expect(mgr.list()[0]?.status).toBe("disabled");
  });

  it("reloadAll disposes then re-activates", async () => {
    const hub = new ProviderHub();
    const sandbox = fakeSandbox({ regState: ACQ_REG });
    const mgr = new PluginManager({
      index: await indexWith(installed("lidarr")),
      store: fakeStore(),
      sandbox: sandbox.controller,
      hub,
    });
    await mgr.loadAll();
    await mgr.reloadAll();

    // Loaded twice, disposed at least once, and exactly one registration remains.
    expect(sandbox.loads).toEqual(["lidarr", "lidarr"]);
    expect(sandbox.disposes).toContain("lidarr");
    expect(hub.registry.acquisitionProviders).toHaveLength(1);
    expect(hub.acquisitionAvailable()).toBe(true);
  });

  it("an enabled plugin with no loaded record reports 'loading' (not 'error')", async () => {
    const hub = new ProviderHub();
    const sandbox = fakeSandbox({ regState: ACQ_REG });
    const mgr = new PluginManager({
      index: await indexWith(installed("lidarr")),
      store: fakeStore(),
      sandbox: sandbox.controller,
      hub,
    });
    // Before loadAll runs, no loaded record exists.
    expect(mgr.list()[0]?.status).toBe("loading");
    expect(sandbox.loads).toEqual([]);

    await mgr.loadAll();
    expect(mgr.list()[0]?.status).toBe("active");
  });

  it("disabled plugins are not loaded", async () => {
    const hub = new ProviderHub();
    const sandbox = fakeSandbox({ regState: ACQ_REG });
    const mgr = new PluginManager({
      index: await indexWith(installed("lidarr", false)),
      store: fakeStore(),
      sandbox: sandbox.controller,
      hub,
    });
    await mgr.loadAll();
    expect(sandbox.loads).toEqual([]);
    expect(mgr.list()[0]?.status).toBe("disabled");
    expect(hub.acquisitionAvailable()).toBe(false);
  });
});
