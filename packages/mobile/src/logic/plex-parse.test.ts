import { describe, expect, it } from "vitest";
import { parseArtists, parseLibraries, parsePlaylists, parsePlaylistTracks, parseTracks } from "./plex-parse";

describe("parseArtists", () => {
  it("maps Metadata entries to Artist", () => {
    const json = {
      MediaContainer: {
        Metadata: [{ ratingKey: "1", title: "Boards of Canada", thumb: "/t/1", userRating: 8 }],
      },
    };
    const out = parseArtists(json, "srv");
    expect(out).toEqual([
      { id: "1", serverId: "srv", name: "Boards of Canada", thumb: "/t/1", userRating: 8 },
    ]);
  });
  it("returns [] when MediaContainer is empty", () => {
    expect(parseArtists({ MediaContainer: {} }, "srv")).toEqual([]);
  });
});

describe("parseTracks", () => {
  it("maps a Track with its first Media/Part", () => {
    const json = {
      MediaContainer: {
        Metadata: [
          {
            ratingKey: "100",
            title: "Roygbiv",
            parentRatingKey: "10",
            grandparentRatingKey: "1",
            grandparentTitle: "Boards of Canada",
            parentTitle: "Music Has the Right",
            index: 3,
            duration: 172000,
            thumb: "/t/100",
            Media: [
              {
                audioCodec: "flac",
                container: "flac",
                bitrate: 900,
                Part: [{ id: "9", key: "/library/parts/9/file.flac" }],
              },
            ],
          },
        ],
      },
    };
    const out = parseTracks(json, "srv");
    expect(out[0]).toMatchObject({
      id: "100",
      serverId: "srv",
      albumId: "10",
      artistId: "1",
      artistName: "Boards of Canada",
      albumTitle: "Music Has the Right",
      title: "Roygbiv",
      durationMs: 172000,
      trackNumber: 3,
      media: {
        container: "flac",
        audioCodec: "flac",
        partId: "9",
        partKey: "/library/parts/9/file.flac",
      },
    });
  });
  it("skips tracks with no playable Part", () => {
    const json = { MediaContainer: { Metadata: [{ ratingKey: "1", title: "x", Media: [] }] } };
    expect(parseTracks(json, "srv")).toEqual([]);
  });
});

describe("parseLibraries", () => {
  it("keeps only music sections and uses max(updatedAt, scannedAt)", () => {
    const json = {
      MediaContainer: {
        Directory: [
          { key: "3", type: "artist", title: "Music", updatedAt: 100, scannedAt: 200 },
          { key: "4", type: "movie", title: "Movies" },
        ],
      },
    };
    const out = parseLibraries(json, "srv", "Server");
    expect(out).toEqual([
      {
        id: "3",
        serverId: "srv",
        serverName: "Server",
        title: "Music",
        type: "music",
        updatedAt: 200000,
      },
    ]);
  });
});

describe("parsePlaylists", () => {
  it("maps playlist Metadata", () => {
    const json = {
      MediaContainer: {
        Metadata: [
          {
            ratingKey: "55",
            title: "Late Night",
            leafCount: 42,
            duration: 1000,
            composite: "/playlists/55/composite/1",
            updatedAt: 1700,
          },
        ],
      },
    };
    const pls = parsePlaylists(json, "srv");
    expect(pls[0]).toMatchObject({
      id: "55",
      serverId: "srv",
      title: "Late Night",
      trackCount: 42,
      durationMs: 1000,
      thumb: "/playlists/55/composite/1",
    });
    expect(pls[0]?.updatedAt).toBe(1700 * 1000);
  });
});

describe("parsePlaylistTracks", () => {
  it("attaches playlistItemId and the parsed track", () => {
    const json = {
      MediaContainer: {
        Metadata: [
          {
            ratingKey: "9",
            playlistItemID: "777",
            title: "Song",
            grandparentTitle: "BoC",
            duration: 200000,
            Media: [{ container: "flac", Part: [{ id: "1", key: "/p/1" }] }],
          },
        ],
      },
    };
    const items = parsePlaylistTracks(json, "srv");
    expect(items).toHaveLength(1);
    expect(items[0]?.playlistItemId).toBe("777");
    expect(items[0]?.track).toMatchObject({ id: "9", artistName: "BoC", title: "Song" });
  });

  it("skips rows with no playable part", () => {
    const json = { MediaContainer: { Metadata: [{ ratingKey: "9", playlistItemID: "1", title: "x" }] } };
    expect(parsePlaylistTracks(json, "srv")).toHaveLength(0);
  });
});
