/**
 * Tests for the QuickJS capability bridge (bridge.ts).
 *
 * Covers:
 *   - ctx.net.fetch calls host netFetch and guest gets the response
 *   - A guest-registered acquisition provider invoked through the hub returns data
 *   - Events: hub.dispatchEvent → guest handler fires
 *   - Dispose releases hub registrations
 */

import type { ProviderHub } from "@musex/plugin-host";
import { describe, expect, it, vi } from "vitest";
import { type BridgeResult, installBridge } from "./bridge.js";
import { SandboxContext } from "./quickjs-host.js";

// Minimal ProviderHub fake: just captures registrations
function makeFakeHub(): ProviderHub {
  return {
    registry: {
      eventSubscribers: [],
      sectionProviders: [],
      trackActions: [],
      trackDetailProviders: [],
      trackRecommenders: [],
      similarProviders: [],
      acquisitionProviders: [],
    },
    registerSimilarProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    registerTrackRecommender: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    registerAcquisitionProvider: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    contributeSections: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    contributeTrackAction: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    contributeTrackDetail: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    onEvent: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    registerTracked: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    dispatchEvent: vi.fn(),
    acquisitionAvailable: vi.fn().mockReturnValue(false),
    getSections: vi.fn(),
    recommendTracks: vi.fn(),
    getSimilar: vi.fn(),
    lookupArtistAlbums: vi.fn(),
    lookupArtistAlbumsStrict: vi.fn(),
    acquireAlbum: vi.fn(),
    searchExternalArtists: vi.fn(),
    acquireArtist: vi.fn(),
    acquireArtistByName: vi.fn(),
    acquisitionStatus: vi.fn(),
    expansionCapabilities: vi.fn(),
    similarArtistsScored: vi.fn(),
    topAlbums: vi.fn(),
    cancelAlbum: vi.fn(),
    watchNewReleases: vi.fn(),
    isWatchingNewReleases: vi.fn(),
    listWatchedArtists: vi.fn(),
    artistInfo: vi.fn(),
    listMonitoredArtists: vi.fn(),
    externalDiscography: vi.fn(),
    listTrackActions: vi.fn(),
    invokeTrackAction: vi.fn(),
    getTrackDetails: vi.fn(),
  } as unknown as ProviderHub;
}

function makeDeps(hub: ProviderHub, overrides: Partial<Parameters<typeof installBridge>[1]> = {}) {
  const manifest = {
    id: "test-plugin",
    name: "Test Plugin",
    version: "1.0.0",
    apiVersion: 2,
    entry: "index.mjs",
  };
  return {
    manifest,
    pluginId: "test-plugin",
    netFetch: vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"hello":"world"}',
    }),
    storage: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    },
    secrets: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
    },
    library: {
      search: vi.fn().mockResolvedValue({ artists: [], albums: [], tracks: [] }),
      recentlyPlayed: vi.fn().mockResolvedValue([]),
      topArtists: vi.fn().mockResolvedValue([]),
    },
    notifySink: vi.fn(),
    openExternal: vi.fn(),
    hub,
    registerSettings: vi.fn(),
    onSettingsAction: vi.fn(),
    trackDisposable: vi.fn(),
    ...overrides,
  };
}

describe("bridge", () => {
  it("installs bridge and preamble without error, disposes cleanly", async () => {
    const sc = await SandboxContext.create();
    const hub = makeFakeHub();
    try {
      sc.installPreamble();
      const bridge = installBridge(sc, makeDeps(hub)) as BridgeResult;
      bridge.dispose();
    } finally {
      sc.dispose();
    }
  });

  it("ctx.net.fetch calls host netFetch and guest receives the response", async () => {
    const sc = await SandboxContext.create();
    const hub = makeFakeHub();
    const deps = makeDeps(hub);
    deps.netFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { "content-type": "application/json" },
      body: '{"hello":"world"}',
    });
    try {
      sc.installPreamble();
      const bridge = installBridge(sc, deps) as BridgeResult;

      const result = await sc.evalSettle(`
        (async () => {
          const r = await ctx.net.fetch("http://example.com/api");
          return { ok: r.ok, status: r.status, body: r.body };
        })()
      `);

      expect(result).toEqual({
        ok: true,
        status: 200,
        body: '{"hello":"world"}',
      });
      expect(deps.netFetch).toHaveBeenCalledWith("http://example.com/api", undefined);

      bridge.dispose();
    } finally {
      sc.dispose();
    }
  });

  it("ctx.net.fetch passes init options to host", async () => {
    const sc = await SandboxContext.create();
    const hub = makeFakeHub();
    const deps = makeDeps(hub);
    try {
      sc.installPreamble();
      const bridge = installBridge(sc, deps) as BridgeResult;

      await sc.evalSettle(`
        ctx.net.fetch("http://example.com/post", {
          method: "POST",
          headers: { "x-key": "val" },
          body: "data"
        })
      `);

      expect(deps.netFetch).toHaveBeenCalledWith("http://example.com/post", {
        method: "POST",
        headers: { "x-key": "val" },
        body: "data",
      });

      bridge.dispose();
    } finally {
      sc.dispose();
    }
  });

  it("guest-registered acquisition provider is registered on hub after registerHubEntries()", async () => {
    const sc = await SandboxContext.create();
    const hub = makeFakeHub();
    const deps = makeDeps(hub);
    try {
      sc.installPreamble();
      const bridge = installBridge(sc, deps) as BridgeResult;

      // Simulate plugin activate registering an acquisition provider
      await sc.evalSettle(`
        ctx.registerAcquisitionProvider({
          id: "fake-acq",
          async lookupArtistAlbums(name) {
            return [{ title: "Album " + name, artistName: name, providerRef: "ref:1", state: "available" }];
          },
          async acquireAlbum(ref) {},
          async status() { return []; },
        });
      `);

      bridge.registerHubEntries();

      expect(hub.registerAcquisitionProvider).toHaveBeenCalledWith(
        "test-plugin",
        expect.any(Object),
      );

      bridge.dispose();
    } finally {
      sc.dispose();
    }
  });

  it("host invokes guest acquisition provider method via __invoke and gets data back", async () => {
    const sc = await SandboxContext.create();
    const hub = makeFakeHub();
    const deps = makeDeps(hub);
    try {
      sc.installPreamble();
      const bridge = installBridge(sc, deps) as BridgeResult;

      // Register provider in guest
      await sc.evalSettle(`
        ctx.registerAcquisitionProvider({
          id: "test-acq",
          async lookupArtistAlbums(name) {
            return [
              { title: name + " — Greatest Hits", artistName: name, providerRef: "ref:1", state: "available" },
            ];
          },
          async acquireAlbum(ref) {},
          async status() { return []; },
        });
      `);

      bridge.registerHubEntries();

      // Call __invoke directly to test the mechanism
      const result = await bridge.callGuest("acquisition", "lookupArtistAlbums", "Radiohead");
      expect(result).toEqual([
        {
          title: "Radiohead — Greatest Hits",
          artistName: "Radiohead",
          providerRef: "ref:1",
          state: "available",
        },
      ]);

      bridge.dispose();
    } finally {
      sc.dispose();
    }
  });

  it("KEY REGRESSION: guest provider with TWO sequential host calls resolves correctly", async () => {
    // This verifies the bridge handles the multi-suspension case that kills asyncify.
    const sc = await SandboxContext.create();
    const hub = makeFakeHub();
    const store = new Map<string, unknown>();
    const deps = makeDeps(hub, {
      storage: {
        get: vi.fn().mockImplementation(async (key) => store.get(key) ?? null),
        set: vi.fn().mockImplementation(async (key: string, v: unknown) => {
          store.set(key, v);
        }),
      },
    });
    try {
      sc.installPreamble();
      const bridge = installBridge(sc, deps) as BridgeResult;

      await sc.evalSettle(`
        ctx.registerAcquisitionProvider({
          id: "sequential-test",
          async lookupArtistAlbums(name) {
            // TWO sequential host calls (storage set then get)
            await ctx.storage.set("lastLookup", name);
            const seen = await ctx.storage.get("lastLookup");
            return [{ title: seen + " — Album", artistName: name, providerRef: "ref:1", state: "available" }];
          },
          async acquireAlbum(ref) {},
          async status() { return []; },
        });
      `);

      bridge.registerHubEntries();

      const result = await bridge.callGuest("acquisition", "lookupArtistAlbums", "Portishead");
      expect(result).toEqual([
        {
          title: "Portishead — Album",
          artistName: "Portishead",
          providerRef: "ref:1",
          state: "available",
        },
      ]);
      expect(store.get("lastLookup")).toBe("Portishead");

      bridge.dispose();
    } finally {
      sc.dispose();
    }
  });

  it("events: hub dispatchEvent → guest event handler fires", async () => {
    const sc = await SandboxContext.create();
    // Use a real hub with real dispatchEvent for event tests
    const { ProviderHub } = await import("@musex/plugin-host");
    const realHub = new ProviderHub();
    const deps = makeDeps(realHub);
    try {
      sc.installPreamble();
      const bridge = installBridge(sc, deps) as BridgeResult;

      // Guest registers a trackStarted handler and stores the received payload
      await sc.evalSettle(`
        ctx.events.on("trackStarted", (payload) => {
          globalThis.__lastEvent = payload;
        });
      `);

      bridge.registerHubEntries();

      const trackPayload = {
        track: { title: "Karma Police", artistName: "Radiohead", durationMs: 262000 },
        startedAtEpochSec: 1000000,
      };

      // Dispatch from host
      realHub.dispatchEvent("trackStarted", trackPayload);

      // Wait for the async __emit to fire
      await new Promise<void>((res) => setTimeout(res, 50));

      // Check guest received it
      const received = await sc.evalSettle(`globalThis.__lastEvent`);
      expect(received).toEqual(trackPayload);

      bridge.dispose();
    } finally {
      sc.dispose();
    }
  });

  it("regState reports registered providers correctly", async () => {
    const sc = await SandboxContext.create();
    const hub = makeFakeHub();
    const deps = makeDeps(hub);
    try {
      sc.installPreamble();
      const bridge = installBridge(sc, deps) as BridgeResult;

      // Initially nothing registered
      const before = bridge.regState();
      expect(before.acquisition).toBe(false);
      expect(before.recommender).toBe(false);

      await sc.evalSettle(`
        ctx.registerAcquisitionProvider({
          id: "my-acq",
          async lookupArtistAlbums(n) { return []; },
          async acquireAlbum(r) {},
          async status() { return []; },
        });
        ctx.registerTrackRecommender({
          id: "my-rec",
          async recommend(ctx) { return []; },
        });
      `);

      const after = bridge.regState();
      expect(after.acquisition).toBe(true);
      expect(after.recommender).toBe(true);

      bridge.dispose();
    } finally {
      sc.dispose();
    }
  });

  it("dispose releases hub registrations", async () => {
    const sc = await SandboxContext.create();
    const hub = makeFakeHub();
    const deps = makeDeps(hub);
    const mockDisposable = { dispose: vi.fn() };
    (hub.registerAcquisitionProvider as ReturnType<typeof vi.fn>).mockReturnValue(mockDisposable);
    try {
      sc.installPreamble();
      const bridge = installBridge(sc, deps) as BridgeResult;

      await sc.evalSettle(`
        ctx.registerAcquisitionProvider({
          id: "disposable-test",
          async lookupArtistAlbums(n) { return []; },
          async acquireAlbum(r) {},
          async status() { return []; },
        });
      `);

      bridge.registerHubEntries();
      expect(hub.registerAcquisitionProvider).toHaveBeenCalled();

      bridge.dispose();
      expect(mockDisposable.dispose).toHaveBeenCalled();
    } finally {
      sc.dispose();
    }
  });

  it("storage set and get round-trip works through bridge", async () => {
    const sc = await SandboxContext.create();
    const hub = makeFakeHub();
    const store = new Map<string, unknown>();
    const deps = makeDeps(hub, {
      storage: {
        get: vi.fn().mockImplementation(async (key) => store.get(key) ?? null),
        set: vi.fn().mockImplementation(async (key: string, v: unknown) => {
          store.set(key, v);
        }),
      },
    });
    try {
      sc.installPreamble();
      const bridge = installBridge(sc, deps) as BridgeResult;

      const result = await sc.evalSettle(`
        (async () => {
          await ctx.storage.set("myKey", { val: 42 });
          return await ctx.storage.get("myKey");
        })()
      `);

      expect(result).toEqual({ val: 42 });
      expect(store.get("myKey")).toEqual({ val: 42 });

      bridge.dispose();
    } finally {
      sc.dispose();
    }
  });
});
