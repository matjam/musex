import type { LibrarySearchResult, NetFetchResponse, TrackInfo } from "@musex/plugin-api";
import { describe, expect, it, vi } from "vitest";
import { type HostCapDeps, makeHostCallHandler } from "./host-capabilities.js";

function makeDeps(over: Partial<HostCapDeps> = {}): HostCapDeps {
  const storage = new Map<string, string>();
  const secrets = new Map<string, string>();
  return {
    storageGet: async (k) => storage.get(k) ?? null,
    storageSet: async (k, v) => {
      if (v === null) storage.delete(k);
      else storage.set(k, v);
    },
    secretsGet: async (k) => secrets.get(k) ?? null,
    secretsSet: async (k, v) => {
      if (v === null) secrets.delete(k);
      else secrets.set(k, v);
    },
    netFetch: async () => ({ ok: true, status: 200, headers: {}, body: "" }),
    library: {
      search: async (): Promise<LibrarySearchResult> => ({ artists: [], albums: [], tracks: [] }),
      recentlyPlayed: async (): Promise<TrackInfo[]> => [],
      topArtists: async () => [],
    },
    notify: vi.fn(),
    openExternal: vi.fn(),
    log: vi.fn(),
    registerSettings: vi.fn(),
    ...over,
  };
}

describe("makeHostCallHandler", () => {
  it("storageSet then storageGet round-trips, namespaced per plugin", async () => {
    const store = new Map<string, string>();
    const handler = makeHostCallHandler(
      makeDeps({
        storageGet: async (k) => store.get(k) ?? null,
        storageSet: async (k, v) => {
          if (v === null) store.delete(k);
          else store.set(k, v);
        },
      }),
    );
    await handler("plug-a", "storageSet", ["count", 3]);
    await handler("plug-b", "storageSet", ["count", 99]);
    expect(await handler("plug-a", "storageGet", ["count"])).toBe(3);
    expect(await handler("plug-b", "storageGet", ["count"])).toBe(99);
    // The two plugins must not collide.
    expect([...store.keys()].some((k) => k.includes("plug-a"))).toBe(true);
    expect([...store.keys()].some((k) => k.includes("plug-b"))).toBe(true);
    expect([...store.keys()].every((k) => k !== "count")).toBe(true);
  });

  it("storageGet returns null for a missing key", async () => {
    const handler = makeHostCallHandler(makeDeps());
    expect(await handler("p", "storageGet", ["nope"])).toBeNull();
  });

  it("secretsSet then secretsGet round-trips, namespaced", async () => {
    const handler = makeHostCallHandler(makeDeps());
    await handler("p", "secretsSet", ["apiKey", "xyz"]);
    expect(await handler("p", "secretsGet", ["apiKey"])).toBe("xyz");
    await handler("p", "secretsSet", ["apiKey", null]);
    expect(await handler("p", "secretsGet", ["apiKey"])).toBeNull();
  });

  it("netFetch passes through to the injected fetcher", async () => {
    const resp: NetFetchResponse = {
      ok: true,
      status: 201,
      headers: { "content-type": "application/json" },
      body: '{"x":1}',
    };
    const netFetch = vi.fn(async () => resp);
    const handler = makeHostCallHandler(makeDeps({ netFetch }));
    const out = await handler("p", "netFetch", ["https://x", { method: "POST" }]);
    expect(out).toEqual(resp);
    expect(netFetch).toHaveBeenCalledWith("https://x", { method: "POST" });
  });

  it("librarySearch shapes the result into LibrarySearchResult", async () => {
    const result: LibrarySearchResult = {
      artists: [{ id: "1", name: "A" }],
      albums: [{ id: "2", title: "Al", artistName: "A" }],
      tracks: [{ title: "T", artistName: "A", durationMs: 1000 }],
    };
    const handler = makeHostCallHandler(
      makeDeps({
        library: {
          search: async () => result,
          recentlyPlayed: async () => [],
          topArtists: async () => [],
        },
      }),
    );
    expect(await handler("p", "librarySearch", ["q"])).toEqual(result);
  });

  it("libraryTopArtists returns the taste topArtists", async () => {
    const top = [
      { name: "A", score: 10 },
      { name: "B", score: 5 },
    ];
    const handler = makeHostCallHandler(
      makeDeps({
        library: {
          search: async () => ({ artists: [], albums: [], tracks: [] }),
          recentlyPlayed: async () => [],
          topArtists: async () => top,
        },
      }),
    );
    expect(await handler("p", "libraryTopArtists", [3])).toEqual(top);
  });

  it("libraryRecentlyPlayed returns TrackInfo[]", async () => {
    const tracks: TrackInfo[] = [{ title: "T", artistName: "A", durationMs: 500 }];
    const handler = makeHostCallHandler(
      makeDeps({
        library: {
          search: async () => ({ artists: [], albums: [], tracks: [] }),
          recentlyPlayed: async () => tracks,
          topArtists: async () => [],
        },
      }),
    );
    expect(await handler("p", "libraryRecentlyPlayed", [5])).toEqual(tracks);
  });

  it("notify dispatches to the notify dep with the plugin id", async () => {
    const notify = vi.fn();
    const handler = makeHostCallHandler(makeDeps({ notify }));
    await handler("p", "notify", [{ pluginId: "ignored", message: "hi", level: "info" }]);
    expect(notify).toHaveBeenCalledWith({ pluginId: "p", message: "hi", level: "info" });
  });

  it("openExternal only opens http/https urls", async () => {
    const openExternal = vi.fn();
    const handler = makeHostCallHandler(makeDeps({ openExternal }));
    await handler("p", "openExternal", ["https://ok"]);
    await handler("p", "openExternal", ["file:///etc/passwd"]);
    await handler("p", "openExternal", ["javascript:alert(1)"]);
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith("https://ok");
  });

  it("log dispatches to the log dep", async () => {
    const log = vi.fn();
    const handler = makeHostCallHandler(makeDeps({ log }));
    await handler("p", "log", ["msg", 1, 2]);
    expect(log).toHaveBeenCalledWith("p", "msg", [1, 2]);
  });

  it("registerSettings dispatches the schema with the plugin id", async () => {
    const registerSettings = vi.fn();
    const handler = makeHostCallHandler(makeDeps({ registerSettings }));
    const schema = [{ kind: "toggle", key: "on", label: "On" }];
    await handler("p", "registerSettings", [schema]);
    expect(registerSettings).toHaveBeenCalledWith("p", schema);
  });

  it("rejects an unknown capability name", async () => {
    const handler = makeHostCallHandler(makeDeps());
    await expect(handler("p", "bogus", [])).rejects.toThrow(/unknown/i);
  });
});
