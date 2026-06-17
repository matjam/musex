import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PluginNotification } from "../../shared/ipc-contract";
import { ProviderHub } from "../providers/provider-hub";
import { PluginHost, type PluginHostDeps } from "./plugin-host";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "musex-plugin-host-"));
  delete (globalThis as Record<string, unknown>).__activations;
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const GOOD_ENTRY = `export function activate(ctx) {
  ctx.registerSettings([
    { kind: "toggle", key: "x", label: "X" },
    { kind: "text", key: "apiKey", label: "API key" },
    { kind: "password", key: "secret", label: "Secret" },
    { kind: "action", key: "connect", label: "Connect" },
  ]);
  ctx.onSettingsAction("connect", async () => ({ ok: true, message: "connected" }));
  ctx.events.on("trackStarted", () => {});
  ctx.ui.contributeTrackAction({ id: "a", label: "A", onInvoke: async () => {} });
  globalThis.__activations = (globalThis.__activations ?? 0) + 1;
}
export function deactivate() {
  globalThis.__deactivated = true;
}
`;

async function writePlugin(
  id: string,
  entry: string,
  manifest?: Record<string, unknown>,
  opts?: { dist?: boolean },
): Promise<void> {
  const dir = opts?.dist ? join(root, "scan", id, "dist") : join(root, "scan", id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "plugin.json"),
    JSON.stringify(
      manifest ?? { id, name: id, version: "1.0.0", apiVersion: 2, entry: "index.mjs" },
    ),
  );
  await writeFile(join(dir, "index.mjs"), entry);
}

/** Build a PluginHost + ProviderHub pair for testing.
 *  providerTimeoutMs now lives on the hub; pass it via hubOpts. */
function makeHost(
  overrides: Omit<Partial<PluginHostDeps>, "hub"> = {},
  hubOpts: { providerTimeoutMs?: number } = {},
) {
  const disabled = new Set<string>();
  const notifications: PluginNotification[] = [];
  const opened: string[] = [];
  const hub = new ProviderHub(hubOpts);
  const host = new PluginHost({
    hub,
    scanDirs: [join(root, "scan")],
    dataDir: join(root, "data"),
    secretsDir: join(root, "secrets"),
    encrypt: async (s) => s,
    decrypt: async (s) => s,
    isEnabled: (id) => !disabled.has(id),
    setEnabled: (id, v) => {
      if (v) disabled.delete(id);
      else disabled.add(id);
    },
    notifySink: (p) => notifications.push(p),
    openExternal: (url) => opened.push(url),
    library: {
      search: async () => ({ artists: [], albums: [], tracks: [] }),
      recentlyPlayed: async () => [],
      topArtists: async () => [],
    },
    ...overrides,
  });
  return { host, hub, disabled, notifications, opened };
}

function activations(): number {
  return ((globalThis as Record<string, unknown>).__activations as number | undefined) ?? 0;
}

describe("PluginHost", () => {
  it("loads, activates, and exposes the registered settings schema", async () => {
    await writePlugin("good", GOOD_ENTRY);
    const { host, hub } = makeHost();
    await host.loadAll();

    expect(host.list()).toEqual([
      { id: "good", name: "good", version: "1.0.0", status: "active", origin: "user" },
    ]);
    expect(activations()).toBe(1);

    const settings = await host.getSettings("good");
    expect(settings.schema.map((f) => f.key)).toEqual(["x", "apiKey", "secret", "connect"]);
    // password presence flag, no value for actions
    expect(settings.values).toEqual({ x: null, apiKey: null, secret: { set: false } });

    // registrations landed in the hub's registry
    expect(hub.registry.eventSubscribers).toHaveLength(1);
    expect(hub.registry.trackActions).toHaveLength(1);
  });

  it("finds plugins in the direct root layout (<sub>/plugin.json)", async () => {
    await writePlugin("devkit", GOOD_ENTRY);
    const { host } = makeHost();
    await host.loadAll();
    expect(host.list()[0]?.status).toBe("active");
  });

  it("skips a plugin nested under dist/ — only root layout is scanned", async () => {
    // The old dev-repo dist/ convention has been removed. A plugin.json inside
    // <sub>/dist/ is not a valid scan target; only <sub>/plugin.json wins.
    await writePlugin("nested", GOOD_ENTRY, undefined, { dist: true });
    // Note: no plugin.json at <sub>/ root — so nothing is found.
    const { host } = makeHost();
    await host.loadAll();
    expect(host.list()).toHaveLength(0);
  });

  it("skips a manifest whose entry file is missing (unbuilt source tree)", async () => {
    const dir = join(root, "scan", "unbuilt");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "plugin.json"),
      JSON.stringify({
        id: "unbuilt",
        name: "u",
        version: "1.0.0",
        apiVersion: 2,
        entry: "index.mjs",
      }),
    );
    const { host } = makeHost();
    await host.loadAll();
    expect(host.list()).toHaveLength(0); // not listed as errored — just not a usable candidate
  });

  it("isolates a throwing plugin: it errors, others stay active", async () => {
    await writePlugin("bad", `export function activate() { throw new Error("boom"); }`);
    await writePlugin("good", GOOD_ENTRY);
    const { host } = makeHost();
    await host.loadAll();

    const byId = new Map(host.list().map((p) => [p.id, p]));
    expect(byId.get("bad")).toMatchObject({ status: "error", error: "boom" });
    expect(byId.get("good")?.status).toBe("active");
  });

  it("marks an entry without activate() as errored", async () => {
    await writePlugin("noop", `export const nothing = 1;`);
    const { host } = makeHost();
    await host.loadAll();
    expect(host.list()[0]).toMatchObject({ status: "error" });
    expect(host.list()[0]?.error).toContain("activate");
  });

  it("lists an apiVersion mismatch as incompatible without importing it", async () => {
    await writePlugin("future", `globalThis.__futureImported = true;`, {
      id: "future",
      name: "Future",
      version: "9.0.0",
      apiVersion: 3,
      entry: "index.mjs",
    });
    const { host } = makeHost();
    await host.loadAll();
    expect(host.list()[0]).toMatchObject({
      id: "future",
      status: "incompatible",
      error: "incompatible: requires API v3, host is v2",
    });
    expect((globalThis as Record<string, unknown>).__futureImported).toBeUndefined();
  });

  it("does not import disabled plugins, and setEnabled toggles activation", async () => {
    await writePlugin("good", GOOD_ENTRY);
    const { host, hub, disabled } = makeHost();
    disabled.add("good");
    await host.loadAll();
    expect(host.list()[0]?.status).toBe("disabled");
    expect(activations()).toBe(0);

    await host.setEnabled("good", true);
    expect(host.list()[0]?.status).toBe("active");
    expect(activations()).toBe(1);
    expect(disabled.has("good")).toBe(false);

    await host.setEnabled("good", false);
    expect(host.list()[0]?.status).toBe("disabled");
    expect(disabled.has("good")).toBe(true);
    // registrations were disposed from the hub
    expect(hub.registry.eventSubscribers).toHaveLength(0);
    expect(hub.registry.trackActions).toHaveLength(0);
    expect((globalThis as Record<string, unknown>).__deactivated).toBe(true);
  });

  it("emitEvent fans out per subscriber (via hub), isolating a throwing handler", async () => {
    await writePlugin(
      "thrower",
      `export function activate(ctx) {
        ctx.events.on("trackStarted", () => { throw new Error("handler boom"); });
      }`,
    );
    await writePlugin(
      "listener",
      `export function activate(ctx) {
        globalThis.__seen = [];
        ctx.events.on("trackStarted", (p) => globalThis.__seen.push(p));
        ctx.events.on("scrobble", (p) => globalThis.__seen.push(p));
      }`,
    );
    const { host } = makeHost();
    await host.loadAll();

    const track = { title: "T", artistName: "A", durationMs: 200_000 };
    host.emitEvent("trackStarted", { track, startedAtEpochSec: 1 });
    host.emitEvent("paused", { track }); // nobody subscribed — must not throw
    host.emitEvent("scrobble", { track, startedAtEpochSec: 1 });

    // thrower's failure didn't stop listener from receiving both events
    expect((globalThis as Record<string, unknown>).__seen).toEqual([
      { track, startedAtEpochSec: 1 },
      { track, startedAtEpochSec: 1 },
    ]);
  });

  it("reloadAll re-imports fresh module instances and re-activates", async () => {
    await writePlugin("good", GOOD_ENTRY);
    const { host, hub } = makeHost();
    await host.loadAll();
    expect(activations()).toBe(1);

    await host.reloadAll();
    expect(activations()).toBe(2); // fresh import (generation-busted URL) ran again
    expect(host.list()[0]?.status).toBe("active");
    expect(hub.registry.eventSubscribers).toHaveLength(1); // old disposed, new registered
  });

  it("round-trips settings: storage for text/toggle, secrets for password", async () => {
    await writePlugin("good", GOOD_ENTRY);
    const { host } = makeHost();
    await host.loadAll();

    await host.setSetting("good", "apiKey", "abc123");
    await host.setSetting("good", "x", true);
    await host.setSetting("good", "secret", "hunter2");
    const settings = await host.getSettings("good");
    expect(settings.values).toEqual({ x: true, apiKey: "abc123", secret: { set: true } });

    await host.setSetting("good", "secret", null); // delete
    const after = await host.getSettings("good");
    expect(after.values.secret).toEqual({ set: false });

    await expect(host.setSetting("good", "nope", 1)).rejects.toThrow(/no setting/);
  });

  it("runs settings actions and surfaces handler errors as { ok: false }", async () => {
    await writePlugin("good", GOOD_ENTRY);
    const { host } = makeHost();
    await host.loadAll();

    expect(await host.runSettingsAction("good", "connect")).toEqual({
      ok: true,
      message: "connected",
    });
    expect(await host.runSettingsAction("good", "missing")).toMatchObject({ ok: false });
  });

  it("routes ctx.ui.notify to the sink with the plugin id", async () => {
    await writePlugin("noisy", `export function activate(ctx) { ctx.ui.notify("hello", "info"); }`);
    const { host, notifications } = makeHost();
    await host.loadAll();
    expect(notifications).toEqual([{ pluginId: "noisy", message: "hello", level: "info" }]);
  });

  it("getSections fans out per target (via hub), isolating throwing and slow providers", async () => {
    await writePlugin(
      "sections-a",
      `export function activate(ctx) {
        ctx.ui.contributeSections("discover", {
          id: "a",
          getSections: async (sctx) => [
            { title: "Because you listened to " + sctx.recentArtists[0], items: [{ name: "X" }] },
          ],
        });
        ctx.ui.contributeSections("home", {
          id: "a-home",
          getSections: async () => [{ title: "Home row", items: [] }],
        });
      }`,
    );
    await writePlugin(
      "sections-boom",
      `export function activate(ctx) {
        ctx.ui.contributeSections("discover", {
          id: "boom",
          getSections: async () => { throw new Error("provider boom"); },
        });
      }`,
    );
    await writePlugin(
      "sections-slow",
      `export function activate(ctx) {
        ctx.ui.contributeSections("discover", {
          id: "slow",
          getSections: () => new Promise(() => {}), // never resolves
        });
      }`,
    );
    const { host, hub } = makeHost({}, { providerTimeoutMs: 50 });
    await host.loadAll();

    const sctx = { recentArtists: ["Lamb"], recentTracks: [], topArtists: [] };
    const discover = await hub.getSections("discover", sctx);
    expect(discover).toEqual([
      {
        pluginId: "sections-a",
        sections: [{ title: "Because you listened to Lamb", items: [{ name: "X" }] }],
      },
    ]);
    const home = await hub.getSections("home", sctx);
    expect(home).toEqual([
      { pluginId: "sections-a", sections: [{ title: "Home row", items: [] }] },
    ]);
  });

  it("recommendTracks merges + dedupes recommenders (via hub), applies exclude, isolates throws", async () => {
    await writePlugin(
      "recs-a",
      `export function activate(ctx) {
        ctx.registerTrackRecommender({
          id: "a",
          recommend: async () => [
            { artistName: "Lamb", title: "Gorecki" },
            { artistName: "Portishead", title: "Glory Box" }, // excluded below
            { artistName: "Massive Attack" }, // artist-level
          ],
        });
      }`,
    );
    await writePlugin(
      "recs-b",
      `export function activate(ctx) {
        ctx.registerTrackRecommender({
          id: "b",
          recommend: async () => [
            { artistName: "LAMB", title: "GORECKI" }, // dupe of recs-a (case-insensitive)
            { artistName: "Massive Attack", title: "Teardrop" }, // NOT excluded by the
            // artist-level "Massive Attack" key — exclude/dedupe match is exact
            { artistName: "Björk" },
          ],
        });
      }`,
    );
    await writePlugin(
      "recs-boom",
      `export function activate(ctx) {
        ctx.registerTrackRecommender({
          id: "boom",
          recommend: async () => { throw new Error("recommender boom"); },
        });
      }`,
    );
    await writePlugin(
      "recs-slow",
      `export function activate(ctx) {
        ctx.registerTrackRecommender({
          id: "slow",
          recommend: () => new Promise(() => {}), // never resolves
        });
      }`,
    );
    const { host, hub } = makeHost({}, { providerTimeoutMs: 50 });
    await host.loadAll();
    expect(hub.registry.trackRecommenders).toHaveLength(4);

    const recs = await hub.recommendTracks({
      seedTracks: [{ title: "Gabriel", artist: "Lamb" }],
      seedArtists: ["Lamb"],
      exclude: [{ title: "Glory Box", artist: "portishead" }],
      count: 10,
    });
    // recs-a's results first (registration order), then recs-b's novel ones;
    // the thrower and the hung recommender are isolated/skipped.
    expect(recs).toEqual([
      { artistName: "Lamb", title: "Gorecki" },
      { artistName: "Massive Attack" },
      { artistName: "Massive Attack", title: "Teardrop" },
      { artistName: "Björk" },
    ]);
  });

  it("getSimilar routes by kind to the matching method (via hub), merges + dedupes, isolates throws", async () => {
    await writePlugin(
      "sim-a",
      `export function activate(ctx) {
        ctx.ui.registerSimilarProvider({
          id: "a",
          similarArtists: async (name) => [
            { name: "Portishead", externalUrl: "https://last.fm/p" },
            { name: "Massive Attack" },
          ],
          similarTracks: async (seed) => [
            { name: "Glory Box", artistName: seed.artist },
          ],
        });
      }`,
    );
    await writePlugin(
      "sim-b",
      `export function activate(ctx) {
        ctx.ui.registerSimilarProvider({
          id: "b",
          // artists-only provider: must be skipped for kind "track"
          similarArtists: async () => [
            { name: "PORTISHEAD" }, // dupe of sim-a (case-insensitive)
            { name: "Björk" },
            { name: "" }, // junk — dropped
          ],
        });
      }`,
    );
    await writePlugin(
      "sim-boom",
      `export function activate(ctx) {
        ctx.ui.registerSimilarProvider({
          id: "boom",
          similarArtists: async () => { throw new Error("similar boom"); },
          similarTracks: () => new Promise(() => {}), // never resolves
        });
      }`,
    );
    const { host, hub } = makeHost({}, { providerTimeoutMs: 50 });
    await host.loadAll();
    expect(hub.registry.similarProviders).toHaveLength(3);

    const artists = await hub.getSimilar("artist", { name: "Lamb" });
    expect(artists).toEqual([
      { name: "Portishead", externalUrl: "https://last.fm/p" },
      { name: "Massive Attack" },
      { name: "Björk" },
    ]);

    const tracks = await hub.getSimilar("track", { title: "Gorecki", artist: "Lamb" });
    expect(tracks).toEqual([{ name: "Glory Box", artistName: "Lamb" }]);
  });

  it("getSimilar caps merged results at 24", async () => {
    await writePlugin(
      "sim-many",
      `export function activate(ctx) {
        ctx.ui.registerSimilarProvider({
          id: "many",
          similarArtists: async () =>
            Array.from({ length: 40 }, (_, i) => ({ name: "Artist " + i })),
        });
      }`,
    );
    const { host, hub } = makeHost();
    await host.loadAll();
    const items = await hub.getSimilar("artist", { name: "Lamb" });
    expect(items).toHaveLength(24);
    expect(items[0]).toEqual({ name: "Artist 0" });
  });

  it("lookupArtistAlbums: first provider returning a non-empty array wins, items tagged + junk-filtered", async () => {
    // Registration order = readdir order: acq-a (empty) before acq-b (results).
    await writePlugin(
      "acq-a",
      `export function activate(ctx) {
        globalThis.__lookups = [];
        ctx.registerAcquisitionProvider({
          id: "a",
          lookupArtistAlbums: async (name) => { globalThis.__lookups.push("a:" + name); return []; },
          acquireAlbum: async () => {},
          status: async () => [],
        });
      }`,
    );
    await writePlugin(
      "acq-b",
      `export function activate(ctx) {
        ctx.registerAcquisitionProvider({
          id: "b",
          lookupArtistAlbums: async (name) => [
            { title: "Fear of Fours", artistName: name, year: 1999, providerRef: "mb-1", state: "available" },
            { title: "", artistName: name, providerRef: "mb-2", state: "available" }, // junk — dropped
            { title: "Debut", artistName: name, providerRef: "", state: "available" }, // junk — dropped
          ],
          acquireAlbum: async () => {},
          status: async () => [],
        });
      }`,
    );
    const { host, hub } = makeHost();
    await host.loadAll();
    expect(hub.registry.acquisitionProviders).toHaveLength(2);
    expect(hub.acquisitionAvailable()).toBe(true);

    const albums = await hub.lookupArtistAlbums("Lamb");
    // acq-a was asked first (sequential), returned [], so acq-b's results won.
    expect((globalThis as Record<string, unknown>).__lookups).toEqual(["a:Lamb"]);
    expect(albums).toEqual([
      {
        title: "Fear of Fours",
        artistName: "Lamb",
        year: 1999,
        providerRef: "mb-1",
        state: "available",
        providerId: "acq-b",
      },
    ]);
  });

  it("lookupArtistAlbums skips throwing and slow providers (timeout respected)", async () => {
    await writePlugin(
      "acq-boom",
      `export function activate(ctx) {
        ctx.registerAcquisitionProvider({
          id: "boom",
          lookupArtistAlbums: async () => { throw new Error("lookup boom"); },
          acquireAlbum: async () => {},
          status: async () => [],
        });
      }`,
    );
    await writePlugin(
      "acq-slow",
      `export function activate(ctx) {
        ctx.registerAcquisitionProvider({
          id: "slow",
          lookupArtistAlbums: () => new Promise(() => {}), // never resolves
          acquireAlbum: async () => {},
          status: async () => [],
        });
      }`,
    );
    await writePlugin(
      "acq-z-good",
      `export function activate(ctx) {
        ctx.registerAcquisitionProvider({
          id: "good",
          lookupArtistAlbums: async (name) => [
            { title: "What Sound", artistName: name, providerRef: "mb-3", state: "requested" },
          ],
          acquireAlbum: async () => {},
          status: async () => [],
        });
      }`,
    );
    const { host, hub } = makeHost({}, { providerTimeoutMs: 50 });
    await host.loadAll();

    const albums = await hub.lookupArtistAlbums("Lamb");
    expect(albums).toEqual([
      {
        title: "What Sound",
        artistName: "Lamb",
        providerRef: "mb-3",
        state: "requested",
        providerId: "acq-z-good",
      },
    ]);
  });

  it("acquireAlbum routes by providerId; unknown ids and failures throw with context", async () => {
    await writePlugin(
      "acq-a",
      `export function activate(ctx) {
        globalThis.__acquired = [];
        ctx.registerAcquisitionProvider({
          id: "a",
          lookupArtistAlbums: async () => [],
          acquireAlbum: async (ref) => { globalThis.__acquired.push(ref); },
          status: async () => [],
        });
      }`,
    );
    await writePlugin(
      "acq-boom",
      `export function activate(ctx) {
        ctx.registerAcquisitionProvider({
          id: "boom",
          lookupArtistAlbums: async () => [],
          acquireAlbum: async () => { throw new Error("acquire boom"); },
          status: async () => [],
        });
      }`,
    );
    const { host, hub } = makeHost();
    await host.loadAll();

    await hub.acquireAlbum("acq-a", "mb-1");
    expect((globalThis as Record<string, unknown>).__acquired).toEqual(["mb-1"]);

    await expect(hub.acquireAlbum("nope", "mb-1")).rejects.toThrow(/unknown acquisition provider/);
    // rethrown with the plugin id so the renderer knows who failed
    await expect(hub.acquireAlbum("acq-boom", "mb-1")).rejects.toThrow(
      /\[plugin:acq-boom\].*acquire boom/,
    );
  });

  it("acquisitionStatus merges all providers (via hub), isolating throwing and slow ones", async () => {
    await writePlugin(
      "acq-a",
      `export function activate(ctx) {
        ctx.registerAcquisitionProvider({
          id: "a",
          lookupArtistAlbums: async () => [],
          acquireAlbum: async () => {},
          status: async () => [
            { title: "Fear of Fours", artistName: "Lamb", state: "downloading", progress: 0.5 },
          ],
        });
      }`,
    );
    await writePlugin(
      "acq-b",
      `export function activate(ctx) {
        ctx.registerAcquisitionProvider({
          id: "b",
          lookupArtistAlbums: async () => [],
          acquireAlbum: async () => {},
          status: async () => [
            { title: "Homogenic", artistName: "Björk", state: "requested" },
          ],
        });
      }`,
    );
    await writePlugin(
      "acq-boom",
      `export function activate(ctx) {
        ctx.registerAcquisitionProvider({
          id: "boom",
          lookupArtistAlbums: async () => [],
          acquireAlbum: async () => {},
          status: async () => { throw new Error("status boom"); },
        });
      }`,
    );
    await writePlugin(
      "acq-slow",
      `export function activate(ctx) {
        ctx.registerAcquisitionProvider({
          id: "slow",
          lookupArtistAlbums: async () => [],
          acquireAlbum: async () => {},
          status: () => new Promise(() => {}), // never resolves
        });
      }`,
    );
    const { host, hub } = makeHost({}, { providerTimeoutMs: 50 });
    await host.loadAll();
    expect(hub.registry.acquisitionProviders).toHaveLength(4);

    const status = await hub.acquisitionStatus();
    expect(status).toEqual([
      {
        title: "Fear of Fours",
        artistName: "Lamb",
        state: "downloading",
        progress: 0.5,
        providerId: "acq-a",
      },
      { title: "Homogenic", artistName: "Björk", state: "requested", providerId: "acq-b" },
    ]);
  });

  it("acquisitionAvailable is false with no providers, and registrations dispose", async () => {
    await writePlugin(
      "acq-a",
      `export function activate(ctx) {
        ctx.registerAcquisitionProvider({
          id: "a",
          lookupArtistAlbums: async () => [],
          acquireAlbum: async () => {},
          status: async () => [],
        });
      }`,
    );
    const { host, hub } = makeHost();
    await host.loadAll();
    expect(hub.acquisitionAvailable()).toBe(true);

    await host.setEnabled("acq-a", false);
    expect(hub.acquisitionAvailable()).toBe(false);
    expect(await hub.lookupArtistAlbums("Lamb")).toEqual([]);
    expect(await hub.acquisitionStatus()).toEqual([]);
  });

  it("searchExternalArtists: first provider with results wins, items tagged + junk-filtered + capped", async () => {
    // Registration order = readdir order: ext-a (empty) before ext-b (results).
    await writePlugin(
      "ext-a",
      `export function activate(ctx) {
        globalThis.__artistSearches = [];
        ctx.registerAcquisitionProvider({
          id: "a",
          lookupArtistAlbums: async () => [],
          acquireAlbum: async () => {},
          status: async () => [],
          searchArtists: async (term) => { globalThis.__artistSearches.push("a:" + term); return []; },
        });
      }`,
    );
    await writePlugin(
      "ext-b",
      `export function activate(ctx) {
        ctx.registerAcquisitionProvider({
          id: "b",
          lookupArtistAlbums: async () => [],
          acquireAlbum: async () => {},
          status: async () => [],
          searchArtists: async (term) => [
            { name: term, providerRef: "ar-1", monitored: true },
            { name: "", providerRef: "ar-2" }, // junk — dropped
            { name: "Lamb of God", providerRef: "" }, // junk — dropped
            ...Array.from({ length: 12 }, (_, i) => ({ name: "Filler " + i, providerRef: "f-" + i })),
          ],
        });
      }`,
    );
    // No searchArtists at all — must be skipped, not crash.
    await writePlugin(
      "ext-c",
      `export function activate(ctx) {
        ctx.registerAcquisitionProvider({
          id: "c",
          lookupArtistAlbums: async () => [],
          acquireAlbum: async () => {},
          status: async () => [],
        });
      }`,
    );
    const { host, hub } = makeHost();
    await host.loadAll();

    const artists = await hub.searchExternalArtists("Lamb");
    // ext-a was asked first (sequential), returned [], so ext-b's results won.
    expect((globalThis as Record<string, unknown>).__artistSearches).toEqual(["a:Lamb"]);
    expect(artists).toHaveLength(10); // capped
    expect(artists[0]).toEqual({
      name: "Lamb",
      providerRef: "ar-1",
      monitored: true,
      providerId: "ext-b",
    });
    expect(artists.every((a) => a.providerId === "ext-b")).toBe(true);
  });

  it("searchExternalArtists skips throwing and slow providers (timeout respected)", async () => {
    await writePlugin(
      "ext-boom",
      `export function activate(ctx) {
        ctx.registerAcquisitionProvider({
          id: "boom",
          lookupArtistAlbums: async () => [],
          acquireAlbum: async () => {},
          status: async () => [],
          searchArtists: async () => { throw new Error("search boom"); },
        });
      }`,
    );
    await writePlugin(
      "ext-slow",
      `export function activate(ctx) {
        ctx.registerAcquisitionProvider({
          id: "slow",
          lookupArtistAlbums: async () => [],
          acquireAlbum: async () => {},
          status: async () => [],
          searchArtists: () => new Promise(() => {}), // never resolves
        });
      }`,
    );
    await writePlugin(
      "ext-z-good",
      `export function activate(ctx) {
        ctx.registerAcquisitionProvider({
          id: "good",
          lookupArtistAlbums: async () => [],
          acquireAlbum: async () => {},
          status: async () => [],
          searchArtists: async (term) => [{ name: term, providerRef: "ar-9" }],
        });
      }`,
    );
    const { host, hub } = makeHost({}, { providerTimeoutMs: 50 });
    await host.loadAll();

    const artists = await hub.searchExternalArtists("Lamb");
    expect(artists).toEqual([{ name: "Lamb", providerRef: "ar-9", providerId: "ext-z-good" }]);
  });

  it("acquireArtist routes by providerId; unknown/unsupporting providers and failures throw", async () => {
    await writePlugin(
      "ext-a",
      `export function activate(ctx) {
        globalThis.__monitored = [];
        ctx.registerAcquisitionProvider({
          id: "a",
          lookupArtistAlbums: async () => [],
          acquireAlbum: async () => {},
          status: async () => [],
          acquireArtist: async (ref) => { globalThis.__monitored.push(ref); },
        });
      }`,
    );
    await writePlugin(
      "ext-boom",
      `export function activate(ctx) {
        ctx.registerAcquisitionProvider({
          id: "boom",
          lookupArtistAlbums: async () => [],
          acquireAlbum: async () => {},
          status: async () => [],
          acquireArtist: async () => { throw new Error("monitor boom"); },
        });
      }`,
    );
    // No acquireArtist — routing to it must throw, not crash.
    await writePlugin(
      "ext-noop",
      `export function activate(ctx) {
        ctx.registerAcquisitionProvider({
          id: "noop",
          lookupArtistAlbums: async () => [],
          acquireAlbum: async () => {},
          status: async () => [],
        });
      }`,
    );
    const { host, hub } = makeHost();
    await host.loadAll();

    await hub.acquireArtist("ext-a", "ar-1");
    expect((globalThis as Record<string, unknown>).__monitored).toEqual(["ar-1"]);

    await expect(hub.acquireArtist("nope", "ar-1")).rejects.toThrow(/unknown acquisition provider/);
    await expect(hub.acquireArtist("ext-noop", "ar-1")).rejects.toThrow(/cannot monitor artists/);
    // rethrown with the plugin id so the renderer knows who failed
    await expect(hub.acquireArtist("ext-boom", "ar-1")).rejects.toThrow(
      /\[plugin:ext-boom\].*monitor boom/,
    );
  });

  it("acquireArtistByName prefers the case-insensitive exact match, else the first result", async () => {
    await writePlugin(
      "ext-a",
      `export function activate(ctx) {
        globalThis.__monitored = [];
        ctx.registerAcquisitionProvider({
          id: "a",
          lookupArtistAlbums: async () => [],
          acquireAlbum: async () => {},
          status: async () => [],
          searchArtists: async () => [
            { name: "Lamb of God", providerRef: "ar-log" },
            { name: "LAMB", providerRef: "ar-lamb" },
          ],
          acquireArtist: async (ref) => { globalThis.__monitored.push(ref); },
        });
      }`,
    );
    const { host, hub } = makeHost();
    await host.loadAll();

    // exact (case-insensitive) match wins over the first result
    await hub.acquireArtistByName("lamb");
    // no exact match → first result
    await hub.acquireArtistByName("La");
    expect((globalThis as Record<string, unknown>).__monitored).toEqual(["ar-lamb", "ar-log"]);
  });

  it("acquireArtistByName throws when no source knows the artist", async () => {
    await writePlugin(
      "ext-a",
      `export function activate(ctx) {
        ctx.registerAcquisitionProvider({
          id: "a",
          lookupArtistAlbums: async () => [],
          acquireAlbum: async () => {},
          status: async () => [],
          searchArtists: async () => [],
          acquireArtist: async () => {},
        });
      }`,
    );
    const { host, hub } = makeHost();
    await host.loadAll();
    await expect(hub.acquireArtistByName("Nobody")).rejects.toThrow(
      /No acquisition source knows this artist/,
    );
  });

  it("lists and invokes track actions (via hub); unknown ids and failures throw with context", async () => {
    await writePlugin(
      "actions",
      `export function activate(ctx) {
        globalThis.__invoked = [];
        ctx.ui.contributeTrackAction({
          id: "love", label: "Love", icon: "heart",
          onInvoke: async (t) => { globalThis.__invoked.push(t.title); },
        });
        ctx.ui.contributeTrackAction({
          id: "explode", label: "Explode",
          onInvoke: async () => { throw new Error("action boom"); },
        });
      }`,
    );
    const { host, hub } = makeHost();
    await host.loadAll();

    expect(hub.listTrackActions()).toEqual([
      { pluginId: "actions", id: "love", label: "Love", icon: "heart" },
      { pluginId: "actions", id: "explode", label: "Explode" },
    ]);

    const track = { title: "T", artistName: "A", durationMs: 1000 };
    await hub.invokeTrackAction("love", track);
    expect((globalThis as Record<string, unknown>).__invoked).toEqual(["T"]);

    await expect(hub.invokeTrackAction("nope", track)).rejects.toThrow(/unknown track action/);
    // rethrown with the plugin id so the renderer knows who failed
    await expect(hub.invokeTrackAction("explode", track)).rejects.toThrow(
      /\[plugin:actions\].*action boom/,
    );
  });

  it("getTrackDetails drops nulls and isolates failing providers (via hub)", async () => {
    await writePlugin(
      "detail",
      `export function activate(ctx) {
        ctx.ui.contributeTrackDetail({
          id: "info",
          getDetail: async (t) => ({ title: "Info", rows: [{ label: "Title", value: t.title }] }),
        });
        ctx.ui.contributeTrackDetail({ id: "empty", getDetail: async () => null });
        ctx.ui.contributeTrackDetail({
          id: "boom",
          getDetail: async () => { throw new Error("detail boom"); },
        });
      }`,
    );
    const { host, hub } = makeHost({}, { providerTimeoutMs: 50 });
    await host.loadAll();

    const details = await hub.getTrackDetails({ title: "T", artistName: "A", durationMs: 1000 });
    expect(details).toEqual([
      { pluginId: "detail", title: "Info", rows: [{ label: "Title", value: "T" }] },
    ]);
  });

  it("keeps the first plugin when two directories declare the same id", async () => {
    await writePlugin("a-dupe", GOOD_ENTRY, {
      id: "dupe",
      name: "first",
      version: "1.0.0",
      apiVersion: 2,
      entry: "index.mjs",
    });
    await writePlugin("b-dupe", GOOD_ENTRY, {
      id: "dupe",
      name: "second",
      version: "1.0.0",
      apiVersion: 2,
      entry: "index.mjs",
    });
    const { host } = makeHost();
    await host.loadAll();
    expect(host.list()).toHaveLength(1);
    expect(host.list()[0]?.name).toBe("first"); // readdir order: a-dupe first
  });

  // ── core plugin tests (M4) ──────────────────────────────────────────────

  it("loadCore activates a core plugin and lists it with origin 'core'", async () => {
    let activated = false;
    const corePlugin = {
      manifest: { id: "core-test", name: "Core Test", version: "1.0.0", apiVersion: 2 },
      activate: (_ctx: import("@musex/plugin-api").PluginContext) => {
        activated = true;
      },
    };
    const { host } = makeHost({ corePlugins: [corePlugin] });
    await host.loadAll();

    expect(activated).toBe(true);
    const info = host.list().find((p) => p.id === "core-test");
    expect(info).toMatchObject({ id: "core-test", status: "active", origin: "core" });
  });

  it("disabled core plugin stays inactive after loadAll; setEnabled re-activates via static path (C1 regression)", async () => {
    let activationCount = 0;
    const corePlugin = {
      manifest: { id: "core-toggle", name: "Core Toggle", version: "1.0.0", apiVersion: 2 },
      activate: (_ctx: import("@musex/plugin-api").PluginContext) => {
        activationCount += 1;
      },
    };
    const { host, disabled } = makeHost({ corePlugins: [corePlugin] });
    disabled.add("core-toggle");
    await host.loadAll();

    expect(host.list().find((p) => p.id === "core-toggle")?.status).toBe("disabled");
    expect(activationCount).toBe(0);

    // Re-enable — must NOT attempt dynamic import (dir="") and must go active.
    await host.setEnabled("core-toggle", true);
    const info = host.list().find((p) => p.id === "core-toggle");
    expect(info?.status).toBe("active");
    expect(activationCount).toBe(1);
  });

  it("a scanned user plugin whose id collides with a core plugin is skipped", async () => {
    let coreActivated = false;
    const corePlugin = {
      manifest: { id: "conflict-id", name: "Core", version: "1.0.0", apiVersion: 2 },
      activate: (_ctx: import("@musex/plugin-api").PluginContext) => {
        coreActivated = true;
      },
    };
    // Write a user plugin with the same id — its entry must never be imported.
    await writePlugin(
      "conflict-id",
      `export function activate() { globalThis.__userImported = true; }`,
    );
    const { host } = makeHost({ corePlugins: [corePlugin] });
    await host.loadAll();

    expect(coreActivated).toBe(true);
    expect((globalThis as Record<string, unknown>).__userImported).toBeUndefined();
    // Only one entry with this id — the core one.
    expect(host.list().filter((p) => p.id === "conflict-id")).toHaveLength(1);
    expect(host.list().find((p) => p.id === "conflict-id")?.origin).toBe("core");
  });

  it("deactivating a core plugin calls its deactivate fn (I1 regression)", async () => {
    let deactivateCalled = false;
    const corePlugin = {
      manifest: { id: "core-deactivate", name: "Core Deactivate", version: "1.0.0", apiVersion: 2 },
      activate: (_ctx: import("@musex/plugin-api").PluginContext) => {},
      deactivate: () => {
        deactivateCalled = true;
      },
    };
    const { host } = makeHost({ corePlugins: [corePlugin] });
    await host.loadAll();
    expect(host.list().find((p) => p.id === "core-deactivate")?.status).toBe("active");

    await host.setEnabled("core-deactivate", false);
    expect(deactivateCalled).toBe(true);
    expect(host.list().find((p) => p.id === "core-deactivate")?.status).toBe("disabled");
  });

  it("apiVersion-incompatible core plugin lists as incompatible with origin 'core' (M3)", async () => {
    const corePlugin = {
      manifest: { id: "core-future", name: "Core Future", version: "9.0.0", apiVersion: 3 },
      activate: (_ctx: import("@musex/plugin-api").PluginContext) => {},
    };
    const { host } = makeHost({ corePlugins: [corePlugin] });
    await host.loadAll();

    const info = host.list().find((p) => p.id === "core-future");
    expect(info).toMatchObject({
      id: "core-future",
      status: "incompatible",
      origin: "core",
      error: "incompatible: requires API v3, host is v2",
    });
  });
});
