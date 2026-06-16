import { describe, expect, it } from "vitest";
import { parseArtists, parseLibraries, parseTracks } from "./plex-parse";

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
