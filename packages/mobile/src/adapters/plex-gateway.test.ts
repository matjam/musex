import { PlexAuthError } from "@musex/core";
import { describe, expect, it, vi } from "vitest";
import { PlexGatewayImpl } from "./plex-gateway";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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

  it("getArtist queries /library/metadata/<id> and parses name + genres", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        MediaContainer: {
          Metadata: [
            {
              ratingKey: "1",
              title: "Boards of Canada",
              thumb: "/art/boc.jpg",
              Genre: [{ tag: "Electronic" }, { tag: "Ambient" }],
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
    const artist = await gw.getArtist(lib, "1", "TOK");
    expect(artist).not.toBeNull();
    expect(artist?.name).toBe("Boards of Canada");
    expect(artist?.genres).toEqual(["Electronic", "Ambient"]);
    const urls = fetchFn.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls.some((u) => u.includes("/library/metadata/1"))).toBe(true);
  });

  it("getArtist returns null when metadata is empty", async () => {
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
    const artist = await gw.getArtist(lib, "99", "TOK");
    expect(artist).toBeNull();
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

describe("playlist CRUD", () => {
  const lib = { id: "3", serverId: "srv", serverName: "T", title: "Music", type: "music" as const };

  it("createPlaylist POSTs type=audio with title + track uri and parses the result", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        MediaContainer: { Metadata: [{ ratingKey: "pl1", title: "Sunset", leafCount: 1 }] },
      }),
    );
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await gw.listMusicLibraries(server, "TOK");
    const pl = await gw.createPlaylist(lib, "Sunset", ["t1"], "TOK");
    expect(pl.id).toBe("pl1");
    const last = fetchFn.mock.calls.at(-1) as unknown as [string, RequestInit];
    const [url, init] = last;
    expect(init.method).toBe("POST");
    expect(url).toContain("/playlists");
    expect(url).toContain("type=audio");
    expect(url).toContain("title=Sunset");
    expect(decodeURIComponent(url)).toContain("library/metadata/t1");
  });

  it("addToPlaylist PUTs items with the track uri", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 200));
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await gw.listMusicLibraries(server, "TOK");
    await gw.addToPlaylist("pl1", "srv", ["t2", "t3"], "TOK");
    const last = fetchFn.mock.calls.at(-1) as unknown as [string, RequestInit];
    const [url, init] = last;
    expect(init.method).toBe("PUT");
    expect(url).toContain("/playlists/pl1/items");
    expect(decodeURIComponent(url)).toContain("library/metadata/t2,t3");
  });

  it("removeFromPlaylist DELETEs each playlist item", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 200));
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await gw.listMusicLibraries(server, "TOK");
    await gw.removeFromPlaylist("pl1", "srv", ["i1", "i2"], "TOK");
    const calls = fetchFn.mock.calls.filter((c) =>
      String((c as unknown[])[0]).includes("/playlists/pl1/items/"),
    );
    expect(calls).toHaveLength(2);
    expect(((calls[0] as unknown as unknown[])[1] as RequestInit).method).toBe("DELETE");
  });

  it("renamePlaylist PUTs the new title", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 200));
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await gw.listMusicLibraries(server, "TOK");
    await gw.renamePlaylist("pl1", "srv", "New Name", "TOK");
    const last = fetchFn.mock.calls.at(-1) as unknown as [string, RequestInit];
    const [url, init] = last;
    expect(init.method).toBe("PUT");
    expect(url).toContain("/playlists/pl1");
    expect(url).toContain("title=New%20Name");
  });

  it("deletePlaylist DELETEs the playlist", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 200));
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await gw.listMusicLibraries(server, "TOK");
    await gw.deletePlaylist("pl1", "srv", "TOK");
    const last = fetchFn.mock.calls.at(-1) as unknown as [string, RequestInit];
    const [url, init] = last;
    expect(init.method).toBe("DELETE");
    expect(url).toContain("/playlists/pl1");
  });
});

describe("base-url re-resolution on network transition", () => {
  const twoConn = {
    id: "srv",
    name: "Tower",
    connections: [
      { uri: "https://lan.plex.direct:32400", local: true, relay: false },
      { uri: "https://wan.plex.direct:32400", local: false, relay: false },
    ],
  };

  it("probe switches to the remote connection when the cached local one goes unreachable", async () => {
    let lanUp = true;
    const fetchFn = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const u = String(args[0]);
      if (u.startsWith("https://lan.plex.direct:32400")) {
        if (!lanUp) throw new TypeError("Network request failed");
        return jsonResponse({ MediaContainer: { Directory: [] } });
      }
      return jsonResponse({ MediaContainer: { Directory: [] } });
    });
    const gw = new PlexGatewayImpl(fetchFn, "CID");

    // On the LAN: resolves + caches the local connection.
    await gw.listMusicLibraries(twoConn, "TOK");
    expect(gw.baseUrlFor("srv")).toBe("https://lan.plex.direct:32400");

    // Left the LAN: the cached local connection now fails.
    lanUp = false;
    // The connectivity probe must re-resolve to the remote connection rather
    // than throw, and the cached base URL must switch so browse/stream follow.
    await gw.probe("srv", "TOK");
    expect(gw.baseUrlFor("srv")).toBe("https://wan.plex.direct:32400");
  });

  it("probe rejects when no connection is reachable (genuinely offline)", async () => {
    let up = true;
    const fetchFn = vi.fn(async () => {
      if (!up) throw new TypeError("Network request failed");
      return jsonResponse({ MediaContainer: { Directory: [] } });
    });
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await gw.listMusicLibraries(twoConn, "TOK");
    up = false;
    await expect(gw.probe("srv", "TOK")).rejects.toBeTruthy();
  });

  it("probe surfaces PlexAuthError when the token is rejected (sign-in owns auth)", async () => {
    let authOk = true;
    const fetchFn = vi.fn(async () =>
      authOk ? jsonResponse({ MediaContainer: { Directory: [] } }) : jsonResponse({}, 401),
    );
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await gw.listMusicLibraries(twoConn, "TOK"); // caches local while authorized
    authOk = false;
    await expect(gw.probe("srv", "TOK")).rejects.toBeInstanceOf(PlexAuthError);
  });
});

describe("parallel connection probing", () => {
  const twoConn = {
    id: "srv",
    name: "Tower",
    connections: [
      { uri: "https://lan.plex.direct:32400", local: true, relay: false },
      { uri: "https://wan.plex.direct:32400", local: false, relay: false },
    ],
  };

  it("races all connections — a faster one wins, we don't wait for a slower higher-preference one", async () => {
    // The local connection is preferred but SLOW to answer (e.g. off-LAN, where
    // the old sequential probe blocked on it until timeout). The remote answers
    // immediately and must win without waiting for the local one.
    const lan = deferred<Response>();
    const fetchFn = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const u = String(args[0]);
      if (u.startsWith("https://lan.plex.direct:32400")) return lan.promise;
      return jsonResponse({ MediaContainer: { Directory: [] } });
    });
    const gw = new PlexGatewayImpl(fetchFn, "CID");

    await gw.listMusicLibraries(twoConn, "TOK");
    expect(gw.baseUrlFor("srv")).toBe("https://wan.plex.direct:32400");

    lan.resolve(jsonResponse({ MediaContainer: { Directory: [] } })); // release the pending probe
  });

  it("never picks a relay connection over a reachable direct one, even if the relay answers first", async () => {
    const relayFirst = {
      id: "srv",
      name: "Tower",
      connections: [
        { uri: "https://relay.plex.direct:32400", local: false, relay: true },
        { uri: "https://wan.plex.direct:32400", local: false, relay: false },
      ],
    };
    const fetchFn = vi.fn(async () => jsonResponse({ MediaContainer: { Directory: [] } }));
    const gw = new PlexGatewayImpl(fetchFn, "CID");

    await gw.listMusicLibraries(relayFirst, "TOK");
    expect(gw.baseUrlFor("srv")).toBe("https://wan.plex.direct:32400");
  });

  it("falls back to a relay connection when no direct connection is reachable", async () => {
    const relayOnly = {
      id: "srv",
      name: "Tower",
      connections: [
        { uri: "https://wan.plex.direct:32400", local: false, relay: false },
        { uri: "https://relay.plex.direct:32400", local: false, relay: true },
      ],
    };
    const fetchFn = vi.fn(async (...args: Parameters<typeof fetch>) => {
      const u = String(args[0]);
      if (u.startsWith("https://wan.plex.direct:32400"))
        throw new TypeError("Network request failed");
      return jsonResponse({ MediaContainer: { Directory: [] } });
    });
    const gw = new PlexGatewayImpl(fetchFn, "CID");

    await gw.listMusicLibraries(relayOnly, "TOK");
    expect(gw.baseUrlFor("srv")).toBe("https://relay.plex.direct:32400");
  });
});
