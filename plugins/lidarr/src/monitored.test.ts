import { describe, expect, it } from "vitest";
import { type HttpFn, LidarrClient } from "./client.js";
import { getMonitoredArtists } from "./index.js";

type Init = { method: string; headers: Record<string, string>; body?: string };
type Call = { url: string; init: Init };
type RouteResult = { status: number; body: string };
type Route = (init: Init) => RouteResult | Promise<RouteResult>;

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

describe("getMonitoredArtists", () => {
  it("calls GET /api/v1/artist and returns monitored artists' names", async () => {
    const artists = [
      { id: 1, artistName: "Plaid", monitored: true },
      { id: 2, artistName: "Autechre", monitored: false },
      { id: 3, artistName: "Boards of Canada", monitored: true },
    ];
    const { calls, httpFn } = routedHttp({
      "GET /api/v1/artist": () => json(artists),
    });
    const result = await getMonitoredArtists(client(httpFn));
    expect(result).toEqual(["Plaid", "Boards of Canada"]);
    // Verify it only issued GET /api/v1/artist — no extra requests.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init.method).toBe("GET");
    expect(new URL(calls[0]?.url ?? "").pathname).toBe("/api/v1/artist");
  });

  it("returns an empty list when no artists are monitored", async () => {
    const { httpFn } = routedHttp({
      "GET /api/v1/artist": () => json([{ id: 1, artistName: "Unknown", monitored: false }]),
    });
    const result = await getMonitoredArtists(client(httpFn));
    expect(result).toEqual([]);
  });

  it("returns an empty list when no artists exist in Lidarr", async () => {
    const { httpFn } = routedHttp({
      "GET /api/v1/artist": () => json([]),
    });
    const result = await getMonitoredArtists(client(httpFn));
    expect(result).toEqual([]);
  });

  it("filters out artists with null or empty names", async () => {
    const { httpFn } = routedHttp({
      "GET /api/v1/artist": () =>
        json([
          { id: 1, artistName: "Valid Artist", monitored: true },
          { id: 2, artistName: null, monitored: true },
          { id: 3, artistName: "", monitored: true },
        ]),
    });
    const result = await getMonitoredArtists(client(httpFn));
    expect(result).toEqual(["Valid Artist"]);
  });
});
