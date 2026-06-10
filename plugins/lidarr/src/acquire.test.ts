import { describe, expect, it } from "vitest";
import { type HttpFn, LidarrClient } from "./client.js";
import { ensureArtist } from "./index.js";

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

const profileRoutes: Record<string, Route> = {
  "GET /api/v1/qualityprofile": () => json([{ id: 1, name: "Lossless" }]),
  "GET /api/v1/metadataprofile": () => json([{ id: 1, name: "Standard" }]),
  "GET /api/v1/rootfolder": () => json([{ id: 1, path: "/music" }]),
};

describe("ensureArtist", () => {
  it("returns the existing artist when the POST loses the add race (ArtistExistsValidator)", async () => {
    const artist = { id: 7, artistName: "Lamb", foreignArtistId: "mbid-lost-race" };
    let artistListCalls = 0;
    const { calls, httpFn } = routedHttp({
      ...profileRoutes,
      // Empty before the racing add lands, populated on the re-fetch.
      "GET /api/v1/artist": () => json(++artistListCalls === 1 ? [] : [artist]),
      "POST /api/v1/artist": () => ({
        status: 400,
        body: '[{"propertyName":"ArtistName","errorMessage":"This artist has already been added","errorCode":"ArtistExistsValidator"}]',
      }),
    });
    const c = new LidarrClient({ baseUrl: "http://lidarr:8686", apiKey: "k", httpFn });

    const result = await ensureArtist(
      c,
      { foreignArtistId: "mbid-lost-race", artistName: "Lamb" },
      noLog,
    );

    expect(result).toEqual(artist);
    expect(calls.filter((x) => x.init.method === "POST").length).toBe(1);
    expect(artistListCalls).toBe(2);
  });

  it("rethrows non-ArtistExists POST failures", async () => {
    const { httpFn } = routedHttp({
      ...profileRoutes,
      "GET /api/v1/artist": () => json([]),
      "POST /api/v1/artist": () => ({ status: 500, body: "boom" }),
    });
    const c = new LidarrClient({ baseUrl: "http://lidarr:8686", apiKey: "k", httpFn });

    await expect(
      ensureArtist(c, { foreignArtistId: "mbid-boom", artistName: "Lamb" }, noLog),
    ).rejects.toThrow("Lidarr HTTP 500");
  });

  it("dedupes concurrent ensures for the same artist onto one POST", async () => {
    const artist = { id: 9, artistName: "Lamb", foreignArtistId: "mbid-concurrent" };
    let releasePost!: () => void;
    const postGate = new Promise<void>((resolve) => {
      releasePost = resolve;
    });
    const { calls, httpFn } = routedHttp({
      ...profileRoutes,
      "GET /api/v1/artist": () => json([]),
      "POST /api/v1/artist": async () => {
        await postGate; // hold the POST so the second ensure arrives mid-flight
        return json(artist);
      },
    });
    const c = new LidarrClient({ baseUrl: "http://lidarr:8686", apiKey: "k", httpFn });
    const ref = { foreignArtistId: "mbid-concurrent", artistName: "Lamb" };

    const first = ensureArtist(c, ref, noLog);
    const second = ensureArtist(c, ref, noLog);
    releasePost();
    const [a, b] = await Promise.all([first, second]);

    expect(a).toEqual(artist);
    expect(b).toEqual(artist);
    expect(calls.filter((x) => x.init.method === "POST").length).toBe(1);
    // The dedupe shares the whole ensure, including the artist-list fetch.
    expect(
      calls.filter((x) => x.url.endsWith("/api/v1/artist") && x.init.method === "GET").length,
    ).toBe(1);
  });

  it("ensures different artists independently (no cross-artist dedupe)", async () => {
    let nextId = 1;
    const { calls, httpFn } = routedHttp({
      ...profileRoutes,
      "GET /api/v1/artist": () => json([]),
      "POST /api/v1/artist": (init) => {
        const body = JSON.parse(init.body ?? "{}") as { foreignArtistId: string };
        return json({ id: nextId++, foreignArtistId: body.foreignArtistId });
      },
    });
    const c = new LidarrClient({ baseUrl: "http://lidarr:8686", apiKey: "k", httpFn });

    const [a, b] = await Promise.all([
      ensureArtist(c, { foreignArtistId: "mbid-a", artistName: "A" }, noLog),
      ensureArtist(c, { foreignArtistId: "mbid-b", artistName: "B" }, noLog),
    ]);

    expect(a.foreignArtistId).toBe("mbid-a");
    expect(b.foreignArtistId).toBe("mbid-b");
    expect(calls.filter((x) => x.init.method === "POST").length).toBe(2);
  });
});
