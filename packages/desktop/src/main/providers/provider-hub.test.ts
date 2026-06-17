import { describe, expect, it } from "vitest";
import { ProviderHub } from "./provider-hub";

/** Build a hub with an optional timeout override. */
function makeHub(providerTimeoutMs?: number): ProviderHub {
  return new ProviderHub(providerTimeoutMs !== undefined ? { providerTimeoutMs } : {});
}

describe("ProviderHub — first-party in-process registration", () => {
  it("registerSimilarProvider: registered provider appears in getSimilar results", async () => {
    const hub = makeHub();

    const disposable = hub.registerSimilarProvider("core:lastfm", {
      id: "lastfm-similar",
      similarArtists: async (name) => [
        { name: `${name} Similar A`, externalUrl: "https://last.fm/a" },
        { name: `${name} Similar B` },
      ],
    });

    expect(hub.registry.similarProviders).toHaveLength(1);
    expect(hub.registry.similarProviders[0]?.pluginId).toBe("core:lastfm");

    const items = await hub.getSimilar("artist", { name: "Lamb" });
    expect(items).toEqual([
      { name: "Lamb Similar A", externalUrl: "https://last.fm/a" },
      { name: "Lamb Similar B" },
    ]);

    // Dispose removes it from the registry and from future fan-outs.
    disposable.dispose();
    expect(hub.registry.similarProviders).toHaveLength(0);
    const after = await hub.getSimilar("artist", { name: "Lamb" });
    expect(after).toEqual([]);
  });

  it("registerTrackRecommender: registered recommender participates in recommendTracks", async () => {
    const hub = makeHub();

    const disposable = hub.registerTrackRecommender("core:lastfm", {
      id: "lastfm-radio",
      recommend: async (ctx) => [
        { artistName: ctx.seedArtists[0] ?? "Unknown", title: "Suggested Track" },
      ],
    });

    expect(hub.registry.trackRecommenders).toHaveLength(1);

    const recs = await hub.recommendTracks({
      seedTracks: [],
      seedArtists: ["Lamb"],
      exclude: [],
      count: 5,
    });
    expect(recs).toEqual([{ artistName: "Lamb", title: "Suggested Track" }]);

    disposable.dispose();
    expect(hub.registry.trackRecommenders).toHaveLength(0);
  });

  it("registerAcquisitionProvider: registered provider appears in acquisitionStatus + lookupArtistAlbums", async () => {
    const hub = makeHub();
    const acquiredRefs: string[] = [];

    const disposable = hub.registerAcquisitionProvider("core:lidarr", {
      id: "lidarr",
      lookupArtistAlbums: async (name) => [
        { title: "Fear of Fours", artistName: name, providerRef: "lidarr-1", state: "available" },
      ],
      acquireAlbum: async (ref) => {
        acquiredRefs.push(ref);
      },
      status: async () => [
        { title: "Homogenic", artistName: "Björk", state: "downloading", progress: 0.7 },
      ],
    });

    expect(hub.acquisitionAvailable()).toBe(true);

    const albums = await hub.lookupArtistAlbums("Lamb");
    expect(albums).toEqual([
      {
        title: "Fear of Fours",
        artistName: "Lamb",
        providerRef: "lidarr-1",
        state: "available",
        providerId: "core:lidarr",
      },
    ]);

    await hub.acquireAlbum("core:lidarr", "lidarr-1");
    expect(acquiredRefs).toEqual(["lidarr-1"]);

    const status = await hub.acquisitionStatus();
    expect(status).toEqual([
      {
        title: "Homogenic",
        artistName: "Björk",
        state: "downloading",
        progress: 0.7,
        providerId: "core:lidarr",
      },
    ]);

    disposable.dispose();
    expect(hub.acquisitionAvailable()).toBe(false);
  });

  it("contributeSections: registered provider appears in getSections", async () => {
    const hub = makeHub();

    const disposable = hub.contributeSections("core:lastfm", "discover", {
      id: "lastfm-discover",
      getSections: async (ctx) => [
        { title: `Discover for ${ctx.recentArtists[0] ?? "you"}`, items: [] },
      ],
    });

    expect(hub.registry.sectionProviders).toHaveLength(1);

    const results = await hub.getSections("discover", {
      recentArtists: ["Lamb"],
      recentTracks: [],
      topArtists: [],
    });
    expect(results).toEqual([
      { pluginId: "core:lastfm", sections: [{ title: "Discover for Lamb", items: [] }] },
    ]);

    disposable.dispose();
    expect(hub.registry.sectionProviders).toHaveLength(0);
  });

  it("contributeTrackAction: registered action appears in listTrackActions + invokeTrackAction", async () => {
    const hub = makeHub();
    const invoked: string[] = [];

    const disposable = hub.contributeTrackAction("core:lastfm", {
      id: "love",
      label: "Love on Last.fm",
      icon: "heart",
      onInvoke: async (track) => {
        invoked.push(track.title);
      },
    });

    expect(hub.listTrackActions()).toEqual([
      { pluginId: "core:lastfm", id: "love", label: "Love on Last.fm", icon: "heart" },
    ]);

    await hub.invokeTrackAction("love", {
      title: "Gorecki",
      artistName: "Lamb",
      durationMs: 300_000,
    });
    expect(invoked).toEqual(["Gorecki"]);

    disposable.dispose();
    expect(hub.listTrackActions()).toHaveLength(0);
  });

  it("contributeTrackDetail: registered provider appears in getTrackDetails", async () => {
    const hub = makeHub();

    const disposable = hub.contributeTrackDetail("core:lastfm", {
      id: "lastfm-detail",
      getDetail: async (track) => ({
        title: "Last.fm",
        rows: [{ label: "Artist", value: track.artistName }],
      }),
    });

    const details = await hub.getTrackDetails({
      title: "Gorecki",
      artistName: "Lamb",
      durationMs: 300_000,
    });
    expect(details).toEqual([
      { pluginId: "core:lastfm", title: "Last.fm", rows: [{ label: "Artist", value: "Lamb" }] },
    ]);

    disposable.dispose();
    expect(hub.registry.trackDetailProviders).toHaveLength(0);
  });

  it("onEvent: registered handler receives dispatched events and is removed by dispose", () => {
    const hub = makeHub();
    const seen: unknown[] = [];

    const disposable = hub.onEvent("core:lastfm", "trackStarted", (payload) => {
      seen.push(payload);
    });

    const track = { title: "Gorecki", artistName: "Lamb", durationMs: 300_000 };
    hub.dispatchEvent("trackStarted", { track, startedAtEpochSec: 1 });
    hub.dispatchEvent("scrobble", { track, startedAtEpochSec: 1 }); // different event — ignored

    expect(seen).toEqual([{ track, startedAtEpochSec: 1 }]);

    disposable.dispose();
    hub.dispatchEvent("trackStarted", { track, startedAtEpochSec: 2 });
    // After dispose, no more events received.
    expect(seen).toHaveLength(1);
  });

  it("dispatchEvent isolates a throwing handler — other handlers still fire", () => {
    const hub = makeHub();
    const received: string[] = [];

    hub.onEvent("core:bad", "paused", () => {
      throw new Error("handler boom");
    });
    hub.onEvent("core:good", "paused", (payload) => {
      const t = (payload as { track: { title: string } }).track;
      received.push(t.title);
    });

    const track = { title: "Gorecki", artistName: "Lamb", durationMs: 300_000 };
    // Must not throw even though core:bad's handler threw.
    expect(() => hub.dispatchEvent("paused", { track })).not.toThrow();
    expect(received).toEqual(["Gorecki"]);
  });

  it("multiple first-party providers co-exist with plugin providers in the same registry", async () => {
    const hub = makeHub();

    hub.registerSimilarProvider("core:lastfm", {
      id: "lastfm-similar",
      similarArtists: async () => [{ name: "Portishead" }],
    });

    // Simulate a plugin also registering into the hub (as buildPluginContext would do).
    hub.registerTracked(
      hub.registry.similarProviders,
      {
        pluginId: "user-plugin",
        provider: {
          id: "user-similar",
          similarArtists: async () => [{ name: "Massive Attack" }],
        },
      },
      () => {},
    );

    expect(hub.registry.similarProviders).toHaveLength(2);

    const items = await hub.getSimilar("artist", { name: "Lamb" });
    expect(items).toEqual([{ name: "Portishead" }, { name: "Massive Attack" }]);
  });

  it("getSimilar timeout isolation works for first-party providers too", async () => {
    const hub = makeHub(50); // 50ms timeout

    hub.registerSimilarProvider("core:slow", {
      id: "slow",
      similarArtists: () => new Promise(() => {}), // never resolves
    });
    hub.registerSimilarProvider("core:fast", {
      id: "fast",
      similarArtists: async () => [{ name: "Portishead" }],
    });

    const items = await hub.getSimilar("artist", { name: "Lamb" });
    // core:slow timed out; core:fast succeeded
    expect(items).toEqual([{ name: "Portishead" }]);
  });
});
