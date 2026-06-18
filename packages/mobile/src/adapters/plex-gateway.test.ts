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
    const lib = {
      id: "3",
      serverId: "srv",
      serverName: "T",
      title: "Music",
      type: "music" as const,
    };
    await gw.listMusicLibraries(server, "TOK"); // prime base url
    const albums = await gw.listAllAlbums(lib, "title", "TOK");
    expect(albums[0]).toMatchObject({ id: "10", title: "Funeral" });
    const urls = fetchFn.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls.some((u) => u.includes("/library/sections/3/all") && u.includes("type=9"))).toBe(
      true,
    );
  });

  it("listAllTracks queries type=10", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ MediaContainer: { Metadata: [] } }));
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    const lib = {
      id: "3",
      serverId: "srv",
      serverName: "T",
      title: "Music",
      type: "music" as const,
    };
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
            {
              ratingKey: "100",
              title: "Song",
              grandparentTitle: "BoC",
              Media: [{ Part: [{ id: "9", key: "/p/9" }] }],
            },
          ],
        },
      }),
    );
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    const lib = {
      id: "3",
      serverId: "srv",
      serverName: "T",
      title: "Music",
      type: "music" as const,
    };
    await gw.listMusicLibraries(server, "TOK");
    const tracks = await gw.listArtistTracks("1", lib, "TOK");
    expect(tracks[0]).toMatchObject({ id: "100", artistName: "BoC" });
    const urls = fetchFn.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls.some((u) => u.includes("/library/metadata/1/allLeaves"))).toBe(true);
  });

  it("listPlaylists queries audio playlists and parses", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        MediaContainer: { Metadata: [{ ratingKey: "55", title: "Late Night", leafCount: 42 }] },
      }),
    );
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    const lib = {
      id: "3",
      serverId: "srv",
      serverName: "T",
      title: "Music",
      type: "music" as const,
    };
    await gw.listMusicLibraries(server, "TOK"); // prime base url
    const pls = await gw.listPlaylists(lib, "TOK");
    expect(pls[0]).toMatchObject({ id: "55", title: "Late Night", trackCount: 42 });
    const urls = fetchFn.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls.some((u) => u.includes("/playlists") && u.includes("playlistType=audio"))).toBe(
      true,
    );
  });

  it("listPlaylistTracks queries items and parses PlaylistTracks", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        MediaContainer: {
          Metadata: [
            {
              ratingKey: "9",
              playlistItemID: "777",
              title: "Song",
              grandparentTitle: "BoC",
              Media: [{ Part: [{ id: "1", key: "/p/1" }] }],
            },
          ],
        },
      }),
    );
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await gw.listMusicLibraries(server, "TOK"); // prime base url for serverId "srv"
    const items = await gw.listPlaylistTracks("55", "srv", "TOK");
    expect(items[0]).toMatchObject({ playlistItemId: "777" });
    expect(items[0]?.track.title).toBe("Song");
    const urls = fetchFn.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls.some((u) => u.includes("/playlists/55/items"))).toBe(true);
  });
});

describe("rateItem", () => {
  it("PUTs /:/rate with key + rating", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 200));
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await gw.listMusicLibraries(server, "TOK");
    await gw.rateItem("srv", "123", 8, "TOK");
    const last = fetchFn.mock.calls.at(-1) as unknown as [string, RequestInit];
    const [url, init] = last;
    expect(init.method).toBe("PUT");
    expect(url).toContain("/:/rate");
    expect(url).toContain("key=123");
    expect(url).toContain("rating=8");
    expect(url).toContain("identifier=com.plexapp.plugins.library");
  });

  it("sends rating=-1 to clear (null)", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 200));
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await gw.listMusicLibraries(server, "TOK");
    await gw.rateItem("srv", "123", null, "TOK");
    const lastUrl = String((fetchFn.mock.calls.at(-1) as unknown as unknown[])[0]);
    expect(lastUrl).toContain("rating=-1");
  });
});

describe("search", () => {
  it("queries artists/albums/tracks and assembles SearchResults", async () => {
    const fetchFn = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const u = String(args[0]);
      if (u.includes("type=8"))
        return jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: "a1", title: "M83" }] } });
      if (u.includes("type=9"))
        return jsonResponse({
          MediaContainer: { Metadata: [{ ratingKey: "al1", title: "Junk" }] },
        });
      if (u.includes("type=10"))
        return jsonResponse({
          MediaContainer: {
            Metadata: [
              { ratingKey: "t1", title: "Wait", Media: [{ Part: [{ id: "1", key: "/p/1" }] }] },
            ],
          },
        });
      return jsonResponse({ MediaContainer: {} });
    });
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    const lib = {
      id: "3",
      serverId: "srv",
      serverName: "T",
      title: "Music",
      type: "music" as const,
    };
    await gw.listMusicLibraries(server, "TOK");
    const res = await gw.search(lib, "m83", "TOK");
    expect(res.artists[0]?.name).toBe("M83");
    expect(res.albums[0]?.title).toBe("Junk");
    expect(res.tracks[0]?.title).toBe("Wait");
    const urls = fetchFn.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(
      urls.some((u) => u.includes("/library/sections/3/search") && u.includes("query=m83")),
    ).toBe(true);
  });
});

describe("getUserRating", () => {
  it("reads userRating off the item metadata", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: "123", userRating: 8 }] } }),
    );
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await gw.listMusicLibraries(server, "TOK");
    expect(await gw.getUserRating("srv", "123", "TOK")).toBe(8);
  });

  it("returns null when unrated", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: "123" }] } }),
    );
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await gw.listMusicLibraries(server, "TOK");
    expect(await gw.getUserRating("srv", "123", "TOK")).toBeNull();
  });
});
