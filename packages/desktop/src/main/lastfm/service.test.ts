/**
 * LastfmService tests — providers registered on the hub, via fake fetch.
 * Ported from plugins/lastfm/src/signing.test.ts (signing) plus new service tests.
 */
import { createHash } from "node:crypto";
import { ProviderHub } from "@musex/plugin-host";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type LastfmConfig, LastfmService } from "./service.js";
import { sign } from "./signing.js";

// ── signing tests (ported verbatim from plugins/lastfm/src/signing.test.ts) ──

const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

describe("sign", () => {
  it("matches a hand-computed vector (sorted name+value concat + secret)", () => {
    const sig = sign({ api_key: "abc", method: "auth.getToken" }, "sec");
    expect(sig).toBe(md5("api_keyabcmethodauth.getTokensec"));
    expect(sig).toBe("3334e36028583f782c8e6db457c76835");
  });

  it("sorts by param NAME regardless of insertion order", () => {
    const a = sign({ method: "auth.getToken", api_key: "abc" }, "sec");
    const b = sign({ api_key: "abc", method: "auth.getToken" }, "sec");
    expect(a).toBe(b);
    expect(a).toBe("3334e36028583f782c8e6db457c76835");
  });

  it("signs sk-bearing calls with values interleaved after their names", () => {
    const sig = sign(
      { method: "track.love", api_key: "k", sk: "s", artist: "Lamb", track: "Gorecki" },
      "secret",
    );
    expect(sig).toBe(md5("api_keykartistLambmethodtrack.loveskstrackGoreckisecret"));
  });
});

// ── LastfmService provider tests ─────────────────────────────────────────────

/** Fake config always returns connected creds for tests. */
function makeConfig(overrides?: Partial<LastfmConfig>): LastfmConfig {
  return {
    apiKey: "test-api-key",
    apiSecret: "test-secret",
    sessionKey: "test-session-key",
    username: "testuser",
    scrobbling: true,
    loveOnRating: true,
    connection: "Connected as testuser",
    ...overrides,
  };
}

/** Build a LastfmService started on a fresh hub with a controlled fetch.
 *  The global fetch is stubbed BEFORE the service starts so the service's
 *  `globalThis.fetch.bind(globalThis)` captures the mock. */
function makeService(fetchImpl: typeof fetch, configOverride?: Partial<LastfmConfig>) {
  // Stub BEFORE calling start() — the service captures globalThis.fetch at start time.
  vi.stubGlobal("fetch", fetchImpl);

  const hub = new ProviderHub({ providerTimeoutMs: 500 });
  const notifications: { message: string; level: string }[] = [];
  const opened: string[] = [];
  const storage: Record<string, unknown> = {};
  let cfg = makeConfig(configOverride);

  const service = new LastfmService();
  service.start(hub, {
    getConfig: async () => cfg,
    setConfig: async (patch) => {
      cfg = { ...cfg, ...patch } as LastfmConfig;
    },
    openExternal: (url) => opened.push(url),
    notify: (message, level) => notifications.push({ message, level: level ?? "info" }),
    log: () => {},
    storageGet: async <T>(key: string) => (storage[key] as T | undefined) ?? null,
    storageSet: async (key, value) => {
      storage[key] = value;
    },
  });

  return { hub, service, notifications, opened, storage };
}

/** Build a minimal last.fm API JSON response body string. */
function lfmJson(data: unknown) {
  return JSON.stringify(data);
}

describe("LastfmService — similar artists", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("registers a similar provider on the hub", () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        lfmJson({
          similarartists: {
            artist: [
              { name: "Portishead", url: "https://www.last.fm/music/Portishead", match: "0.9" },
              {
                name: "Massive Attack",
                url: "https://www.last.fm/music/Massive+Attack",
                match: "0.8",
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const { hub } = makeService(fetchMock as unknown as typeof fetch);
    expect(hub.registry.similarProviders.length).toBe(1);
    expect(hub.registry.similarProviders[0]?.pluginId).toBe("core:lastfm");
  });

  it("getSimilar returns artist names via the hub fan-out", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        lfmJson({
          similarartists: {
            artist: [
              { name: "Portishead", url: "https://www.last.fm/music/Portishead", match: "0.9" },
              {
                name: "Massive Attack",
                url: "https://www.last.fm/music/Massive+Attack",
                match: "0.8",
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );
    const { hub } = makeService(fetchMock as unknown as typeof fetch);
    const items = await hub.getSimilar("artist", { name: "Tricky" });
    expect(items.map((i) => i.name)).toEqual(["Portishead", "Massive Attack"]);
    // match scores should be parsed
    expect(items[0]?.match).toBeCloseTo(0.9);
  });

  it("returns [] when no credentials set", async () => {
    const fetchMock = vi.fn();
    const { hub } = makeService(fetchMock as unknown as typeof fetch, {
      apiKey: "",
      apiSecret: "",
    });
    const items = await hub.getSimilar("artist", { name: "Tricky" });
    expect(items).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns [] when no session key (no connected account)", async () => {
    const fetchMock = vi.fn();
    const { hub } = makeService(fetchMock as unknown as typeof fetch, {
      sessionKey: null,
    });
    const items = await hub.getSimilar("artist", { name: "Tricky" });
    expect(items).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("LastfmService — track recommender (radio)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("registers a track recommender on the hub", () => {
    const fetchMock = vi.fn();
    const { hub } = makeService(fetchMock as unknown as typeof fetch);
    expect(hub.registry.trackRecommenders.length).toBe(1);
  });

  it("recommends tracks via similar-tracks and similar-artists fan-out", async () => {
    const fetchMock = vi
      .fn()
      // First call: track.getSimilar
      .mockResolvedValueOnce(
        new Response(
          lfmJson({
            similartracks: {
              track: [{ name: "Sour Times", artist: { name: "Portishead" } }],
            },
          }),
          { status: 200 },
        ),
      )
      // Second call: artist.getSimilar
      .mockResolvedValueOnce(
        new Response(
          lfmJson({
            similarartists: { artist: [{ name: "Massive Attack" }] },
          }),
          { status: 200 },
        ),
      );
    const { hub } = makeService(fetchMock as unknown as typeof fetch);
    const recs = await hub.recommendTracks({
      seedTracks: [{ title: "Karma Police", artist: "Radiohead" }],
      seedArtists: ["Radiohead"],
      exclude: [],
      count: 10,
    });
    expect(recs.some((r) => r.title === "Sour Times")).toBe(true);
    expect(recs.some((r) => r.artistName === "Massive Attack" && r.title === undefined)).toBe(true);
  });
});

describe("LastfmService — sections (discover)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("registers a section provider for 'discover' on the hub", () => {
    const fetchMock = vi.fn();
    const { hub } = makeService(fetchMock as unknown as typeof fetch);
    const discoverProviders = hub.registry.sectionProviders.filter((p) => p.target === "discover");
    expect(discoverProviders.length).toBe(1);
  });

  it("returns discover sections seeded from top artists", async () => {
    const fetchMock = vi
      .fn()
      // artist.getSimilar for the seed
      .mockResolvedValueOnce(
        new Response(
          lfmJson({
            similarartists: {
              artist: [{ name: "Boards of Canada", match: "0.7" }],
            },
          }),
          { status: 200 },
        ),
      )
      // artist.getTopAlbums for artwork (applyArtistArt)
      .mockResolvedValueOnce(new Response(lfmJson({ topalbums: { album: [] } }), { status: 200 }));
    const { hub } = makeService(fetchMock as unknown as typeof fetch);
    const results = await hub.getSections("discover", {
      recentArtists: [],
      recentTracks: [],
      topArtists: [{ name: "Aphex Twin", score: 1 }],
    });
    expect(results.length).toBeGreaterThan(0);
    const section = results[0];
    expect(section?.sections[0]?.title).toMatch(/Aphex Twin/);
    expect(section?.sections[0]?.items[0]?.name).toBe("Boards of Canada");
  });
});

describe("LastfmService — track detail", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("registers a track-detail provider on the hub", () => {
    const fetchMock = vi.fn();
    const { hub } = makeService(fetchMock as unknown as typeof fetch);
    expect(hub.registry.trackDetailProviders.length).toBe(1);
  });

  it("returns scrobble stats from track.getInfo", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        lfmJson({
          track: {
            playcount: "1234567",
            listeners: "98765",
            userplaycount: "42",
            toptags: { tag: [{ name: "trip-hop" }, { name: "electronic" }] },
          },
        }),
        { status: 200 },
      ),
    );
    const { hub } = makeService(fetchMock as unknown as typeof fetch);
    const details = await hub.getTrackDetails({
      title: "Karma Police",
      artistName: "Radiohead",
      durationMs: 264000,
    });
    expect(details.length).toBe(1);
    const detail = details[0];
    expect(detail?.title).toBe("Last.fm");
    const labels = detail?.rows.map((r) => r.label) ?? [];
    expect(labels).toContain("Scrobbles");
    expect(labels).toContain("Listeners");
    expect(labels).toContain("Your scrobbles");
    expect(labels).toContain("Tags");
    const tagsRow = detail?.rows.find((r) => r.label === "Tags");
    expect(tagsRow?.value).toContain("trip-hop");
  });

  it("returns null when API key not set (no client)", async () => {
    const fetchMock = vi.fn();
    const { hub } = makeService(fetchMock as unknown as typeof fetch, {
      apiKey: "",
      apiSecret: "",
    });
    const details = await hub.getTrackDetails({
      title: "Test",
      artistName: "Test",
      durationMs: 0,
    });
    expect(details).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("LastfmService — track action (Love on Last.fm)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("registers a 'Love on Last.fm' track action on the hub", () => {
    const fetchMock = vi.fn();
    const { hub } = makeService(fetchMock as unknown as typeof fetch);
    const actions = hub.registry.trackActions;
    expect(actions.length).toBe(1);
    expect(actions[0]?.action.id).toBe("lastfm-love");
    expect(actions[0]?.action.icon).toBe("heart");
  });

  it("calls track.love via the hub invokeTrackAction", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(lfmJson({}), { status: 200 }));
    const { hub, notifications } = makeService(fetchMock as unknown as typeof fetch);
    await hub.invokeTrackAction("lastfm-love", {
      title: "Gorecki",
      artistName: "Lamb",
      durationMs: 260000,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    // Notification should include the track title
    expect(notifications.some((n) => n.message.includes("Gorecki"))).toBe(true);
  });
});

describe("LastfmService — event subscriptions", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("scrobbles on the 'scrobble' event when scrobbling enabled", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(lfmJson({}), { status: 200 }));
    const { hub } = makeService(fetchMock as unknown as typeof fetch);
    hub.dispatchEvent("scrobble", {
      track: { title: "Karma Police", artistName: "Radiohead", durationMs: 264000 },
      startedAtEpochSec: Math.floor(Date.now() / 1000),
    });
    // Run microtasks so the async handler fires
    await vi.runAllTimersAsync();
    // Check that fetch was called with track.scrobble
    const calls = fetchMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const body = calls[calls.length - 1]?.[1]?.body?.toString() ?? "";
    expect(body).toContain("method=track.scrobble");
  });

  it("does NOT scrobble when scrobbling is disabled", async () => {
    const fetchMock = vi.fn();
    const { hub } = makeService(fetchMock as unknown as typeof fetch, {
      scrobbling: false,
    });
    hub.dispatchEvent("scrobble", {
      track: { title: "Test", artistName: "Test", durationMs: 60000 },
      startedAtEpochSec: 1000000,
    });
    await vi.runAllTimersAsync();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loves track on trackRated with rating >= 8", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(lfmJson({}), { status: 200 }));
    const { hub } = makeService(fetchMock as unknown as typeof fetch);
    hub.dispatchEvent("trackRated", {
      track: { title: "Gorecki", artistName: "Lamb", durationMs: 260000 },
      rating10: 8,
    });
    await vi.runAllTimersAsync();
    const calls = fetchMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const body = calls[0]?.[1]?.body?.toString() ?? "";
    expect(body).toContain("method=track.love");
  });

  it("unloves track on trackRated with rating < 8", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(lfmJson({}), { status: 200 }));
    const { hub } = makeService(fetchMock as unknown as typeof fetch);
    hub.dispatchEvent("trackRated", {
      track: { title: "Test", artistName: "Test", durationMs: 60000 },
      rating10: 6,
    });
    await vi.runAllTimersAsync();
    const body = fetchMock.mock.calls[0]?.[1]?.body?.toString() ?? "";
    expect(body).toContain("method=track.unlove");
  });
});

describe("LastfmService — dispose", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("removes all registrations from the hub on dispose", () => {
    const fetchMock = vi.fn();
    const { hub } = makeService(fetchMock as unknown as typeof fetch);
    // Before: all registrations present
    expect(hub.registry.similarProviders.length).toBe(1);
    expect(hub.registry.trackRecommenders.length).toBe(1);
    expect(hub.registry.sectionProviders.length).toBe(1);
    expect(hub.registry.trackDetailProviders.length).toBe(1);
    expect(hub.registry.trackActions.length).toBe(1);
    expect(hub.registry.eventSubscribers.length).toBe(3); // trackStarted, scrobble, trackRated
  });
});

// ── catalog search (artist + album + track) ──────────────────────────────────

describe("LastfmService — search", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Route the three search methods (all POST the same endpoint) by the
   *  `method` form field in the request body. */
  function searchFetch(bodies: { artist: unknown; album: unknown; track: unknown }): typeof fetch {
    return vi.fn(async (_url: unknown, init: { body: URLSearchParams }) => {
      const method = init.body.get("method");
      if (method === "artist.search") return new Response(lfmJson(bodies.artist), { status: 200 });
      if (method === "album.search") return new Response(lfmJson(bodies.album), { status: 200 });
      if (method === "track.search") return new Response(lfmJson(bodies.track), { status: 200 });
      return new Response(lfmJson({}), { status: 200 });
    }) as unknown as typeof fetch;
  }

  it("returns artists, albums and tracks parsed from the three search methods", async () => {
    const { service } = makeService(
      searchFetch({
        artist: {
          results: {
            artistmatches: {
              artist: [{ name: "Mike Oldfield" }, { name: "" }, { other: 1 }],
            },
          },
        },
        album: {
          results: {
            albummatches: {
              album: [
                {
                  name: "Tubular Bells",
                  artist: "Mike Oldfield",
                  image: [{ size: "large", "#text": "https://img/tb.png" }],
                },
                { name: "No Artist" }, // dropped (missing artist)
              ],
            },
          },
        },
        track: {
          results: {
            trackmatches: {
              track: [
                { name: "Tubular Bells", artist: "Mike Oldfield" },
                { name: "X" }, // dropped (missing artist)
              ],
            },
          },
        },
      }),
    );
    const res = await service.search?.("tubular bells");
    expect(res?.artists).toEqual([{ name: "Mike Oldfield" }]);
    expect(res?.albums).toEqual([
      { title: "Tubular Bells", artistName: "Mike Oldfield", imageUrl: "https://img/tb.png" },
    ]);
    expect(res?.tracks).toEqual([{ title: "Tubular Bells", artistName: "Mike Oldfield" }]);
  });

  it("drops the last.fm placeholder image (treated as no artwork)", async () => {
    const placeholder =
      "https://lastfm.freetls.fastly.net/i/u/300x300/2a96cbd8b46e442fc41c2b86b821562f.png";
    const { service } = makeService(
      searchFetch({
        artist: {
          results: {
            artistmatches: {
              artist: [{ name: "A", image: [{ size: "large", "#text": placeholder }] }],
            },
          },
        },
        album: { results: { albummatches: { album: [] } } },
        track: { results: { trackmatches: { track: [] } } },
      }),
    );
    const res = await service.search?.("a");
    expect(res?.artists).toEqual([{ name: "A" }]); // no imageUrl
  });

  it("returns empty when last.fm isn't configured (no api key)", async () => {
    const { service } = makeService(searchFetch({ artist: {}, album: {}, track: {} }), {
      apiKey: "",
    });
    const res = await service.search?.("anything");
    expect(res).toEqual({ artists: [], albums: [], tracks: [] });
  });

  it("returns empty for a blank query", async () => {
    const { service } = makeService(searchFetch({ artist: {}, album: {}, track: {} }));
    const res = await service.search?.("   ");
    expect(res).toEqual({ artists: [], albums: [], tracks: [] });
  });
});
