import { PlexAuthError } from "@musex/core";
import { describe, expect, it, vi } from "vitest";
import { PlexGatewayImpl } from "./plex-gateway";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const server = {
  id: "srv",
  name: "Tower",
  connections: [{ uri: "https://pms.local:32400", local: true, relay: false }],
};

describe("PlexGatewayImpl", () => {
  it("createPin maps the pins response", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ id: 42, code: "WXYZ", authToken: null }));
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    const pin = await gw.createPin();
    expect(pin).toMatchObject({ id: "42", code: "WXYZ" });
    expect(pin.authUrl).toContain("WXYZ");
  });

  it("pollPin returns the token once present", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ id: 42, authToken: "TOK" }));
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    expect(await gw.pollPin("42")).toEqual({ authToken: "TOK" });
  });

  it("listArtists parses Metadata and sends the token", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: "1", title: "BoC" }] } }),
    );
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    const lib = {
      id: "3",
      serverId: "srv",
      serverName: "Tower",
      title: "Music",
      type: "music" as const,
    };
    // prime the resolved base url so listArtists hits the server
    await gw.listMusicLibraries(server, "TOK");
    const artists = await gw.listArtists(lib, "TOK");
    expect(artists[0]).toMatchObject({ id: "1", name: "BoC", serverId: "srv" });
    const calledUrls = fetchFn.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(calledUrls.some((u) => u.includes("/library/sections/3/all"))).toBe(true);
  });

  it("throws PlexAuthError on 401", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 401));
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await expect(gw.listServers("BAD")).rejects.toBeInstanceOf(PlexAuthError);
  });

  it("listAllAlbums queries type=9 with sort and parses", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: "10", title: "Funeral" }] } }),
    );
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    const lib = { id: "3", serverId: "srv", serverName: "T", title: "Music", type: "music" as const };
    await gw.listMusicLibraries(server, "TOK"); // prime base url
    const albums = await gw.listAllAlbums(lib, "title", "TOK");
    expect(albums[0]).toMatchObject({ id: "10", title: "Funeral" });
    const urls = fetchFn.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls.some((u) => u.includes("/library/sections/3/all") && u.includes("type=9"))).toBe(true);
  });

  it("listAllTracks queries type=10", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ MediaContainer: { Metadata: [] } }),
    );
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    const lib = { id: "3", serverId: "srv", serverName: "T", title: "Music", type: "music" as const };
    await gw.listMusicLibraries(server, "TOK");
    await gw.listAllTracks(lib, "title", "TOK");
    const urls = fetchFn.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls.some((u) => u.includes("type=10"))).toBe(true);
  });

  it("listArtistTracks queries allLeaves and parses", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        MediaContainer: {
          Metadata: [
            { ratingKey: "100", title: "Song", grandparentTitle: "BoC", Media: [{ Part: [{ id: "9", key: "/p/9" }] }] },
          ],
        },
      }),
    );
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    const lib = { id: "3", serverId: "srv", serverName: "T", title: "Music", type: "music" as const };
    await gw.listMusicLibraries(server, "TOK");
    const tracks = await gw.listArtistTracks("1", lib, "TOK");
    expect(tracks[0]).toMatchObject({ id: "100", artistName: "BoC" });
    const urls = fetchFn.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls.some((u) => u.includes("/library/metadata/1/allLeaves"))).toBe(true);
  });
});
