import { describe, expect, it } from "vitest";
import { type HttpFn, LidarrClient } from "./client.js";
import { setNewReleaseWatch } from "./index.js";

type Init = { method: string; headers: Record<string, string>; body?: string };
type Call = { url: string; init: Init };
type RouteResult = { status: number; body: string };
type Route = (init: Init) => RouteResult | Promise<RouteResult>;

const noLog = () => {};

/** Routes "<METHOD> <pathname>" → response; throws on anything unrouted. */
function routedHttp(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const httpFn: HttpFn = async (url, init) => {
    calls.push({ url, init });
    const route = routes[`${init.method} ${new URL(url).pathname}`];
    if (route === undefined) throw new Error(`unexpected request: ${init.method} ${url}`);
    const { status, body } = await route(init);
    return { ok: status >= 200 && status < 300, status, text: async () => body };
  };
  return { calls, httpFn };
}

const json = (value: unknown): RouteResult => ({ status: 200, body: JSON.stringify(value) });

const client = (httpFn: HttpFn) =>
  new LidarrClient({ baseUrl: "http://lidarr:8686", apiKey: "k", httpFn });

const profileRoutes: Record<string, Route> = {
  "GET /api/v1/qualityprofile": () => json([{ id: 1, name: "Lossless" }]),
  "GET /api/v1/metadataprofile": () => json([{ id: 1, name: "Standard" }]),
  "GET /api/v1/rootfolder": () => json([{ id: 1, path: "/music" }]),
};

function putBody(calls: Call[], path: string): Record<string, unknown> {
  const call = calls.find((c) => c.init.method === "PUT" && new URL(c.url).pathname === path);
  expect(call, `expected a PUT ${path}`).toBeDefined();
  return JSON.parse(call?.init.body ?? "{}") as Record<string, unknown>;
}

describe("setNewReleaseWatch", () => {
  const existing = {
    id: 9,
    artistName: "Plaid",
    foreignArtistId: "mbid-plaid",
    monitored: false,
    monitorNewItems: "none",
  };

  it("enables on an existing artist: monitorNewItems=all AND monitored=true", async () => {
    const { calls, httpFn } = routedHttp({
      "GET /api/v1/artist": () => json([existing]),
      "GET /api/v1/artist/9": () => json(existing),
      "PUT /api/v1/artist/9": () => json({}),
    });
    await setNewReleaseWatch(client(httpFn), "plaid", true, noLog); // case-insensitive match
    const body = putBody(calls, "/api/v1/artist/9");
    expect(body.monitorNewItems).toBe("all");
    expect(body.monitored).toBe(true);
  });

  it("disables by resetting monitorNewItems ONLY — monitored is left alone", async () => {
    const watched = { ...existing, monitored: true, monitorNewItems: "all" };
    const { calls, httpFn } = routedHttp({
      "GET /api/v1/artist": () => json([watched]),
      "GET /api/v1/artist/9": () => json(watched),
      "PUT /api/v1/artist/9": () => json({}),
    });
    await setNewReleaseWatch(client(httpFn), "Plaid", false, noLog);
    const body = putBody(calls, "/api/v1/artist/9");
    expect(body.monitorNewItems).toBe("none");
    expect(body.monitored).toBe(true); // round-tripped, not forced off
  });

  it("adds an absent artist watch-only: monitor none, no album search, monitorNewItems all", async () => {
    const added = { id: 4, artistName: "Plaid", foreignArtistId: "mbid-plaid" };
    const { calls, httpFn } = routedHttp({
      ...profileRoutes,
      "GET /api/v1/artist": () => json([]),
      "GET /api/v1/artist/lookup": () => json([added]),
      "POST /api/v1/artist": () => json(added),
      // 3597 re-assert path reads the artist back; report it correct.
      "GET /api/v1/artist/4": () => json({ ...added, monitored: true, monitorNewItems: "all" }),
    });
    await setNewReleaseWatch(client(httpFn), "Plaid", true, noLog);
    const post = calls.find((c) => c.init.method === "POST");
    const body = JSON.parse(post?.init.body ?? "{}") as Record<string, unknown>;
    expect(body.monitorNewItems).toBe("all");
    expect(body.addOptions).toEqual({ monitor: "none", searchForMissingAlbums: false });
    // Re-assert read found it already correct — no PUT issued.
    expect(calls.some((c) => c.init.method === "PUT")).toBe(false);
  });

  it("re-asserts watch fields when the add disregarded them (Lidarr#3597)", async () => {
    const added = { id: 4, artistName: "Plaid", foreignArtistId: "mbid-plaid" };
    const { calls, httpFn } = routedHttp({
      ...profileRoutes,
      "GET /api/v1/artist": () => json([]),
      "GET /api/v1/artist/lookup": () => json([added]),
      "POST /api/v1/artist": () => json(added),
      "GET /api/v1/artist/4": () => json({ ...added, monitored: false, monitorNewItems: "none" }),
      "PUT /api/v1/artist/4": () => json({}),
    });
    await setNewReleaseWatch(client(httpFn), "Plaid", true, noLog);
    const body = putBody(calls, "/api/v1/artist/4");
    expect(body.monitored).toBe(true);
    expect(body.monitorNewItems).toBe("all");
  });

  it("unwatching an artist Lidarr doesn't know is a no-op", async () => {
    const { calls, httpFn } = routedHttp({
      "GET /api/v1/artist": () => json([]),
    });
    await setNewReleaseWatch(client(httpFn), "Nobody", false, noLog);
    expect(calls.length).toBe(1);
  });

  it("throws when an absent artist can't be resolved by lookup", async () => {
    const { httpFn } = routedHttp({
      "GET /api/v1/artist": () => json([]),
      "GET /api/v1/artist/lookup": () => json([]),
    });
    await expect(setNewReleaseWatch(client(httpFn), "Nobody", true, noLog)).rejects.toThrow(
      /not found/,
    );
  });
});
