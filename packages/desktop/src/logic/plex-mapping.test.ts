import { describe, expect, it } from "vitest";
import { thumbPath, toAlbum, toArtist, toTrack } from "./plex-mapping";

describe("thumbPath", () => {
  it("passes through a server-relative path unchanged", () => {
    expect(thumbPath("/library/metadata/1/thumb/2")).toBe("/library/metadata/1/thumb/2");
  });
  it("strips host and token query from a full Plex URL", () => {
    expect(thumbPath("http://host:32400/library/metadata/1/thumb/2?X-Plex-Token=abc")).toBe(
      "/library/metadata/1/thumb/2",
    );
  });
  it("returns undefined for undefined input", () => {
    expect(thumbPath(undefined)).toBeUndefined();
  });
  it("returns undefined for an unparseable non-path string", () => {
    expect(thumbPath("not a url or path")).toBeUndefined();
  });
});

describe("plex-mapping", () => {
  it("maps an artist", () => {
    const a = toArtist({ ratingKey: "10", title: "Radiohead", thumb: "/t.jpg" }, "srv-1");
    expect(a).toEqual({ id: "10", serverId: "srv-1", name: "Radiohead", thumb: "/t.jpg" });
  });
  it("maps an artist with updatedAt", () => {
    const a = toArtist(
      { ratingKey: "10", title: "Radiohead", thumb: "/t.jpg", updatedAt: 1717800000000 },
      "srv-1",
    );
    expect(a.updatedAt).toBe(1717800000000);
  });
  it("maps an artist userRating, and leaves it undefined when absent", () => {
    const rated = toArtist({ ratingKey: "10", title: "Radiohead", userRating: 6 }, "srv-1");
    expect(rated.userRating).toBe(6);
    const unrated = toArtist({ ratingKey: "11", title: "Boards of Canada" }, "srv-1");
    expect(unrated.userRating).toBeUndefined();
  });
  it("maps an album with year + parent artist id", () => {
    const al = toAlbum(
      { ratingKey: "20", title: "In Rainbows", year: 2007, thumb: "/a.jpg", parentRatingKey: "10" },
      "srv-1",
    );
    expect(al).toEqual({
      id: "20",
      serverId: "srv-1",
      artistId: "10",
      title: "In Rainbows",
      year: 2007,
      thumb: "/a.jpg",
    });
  });
  it("maps an album with updatedAt", () => {
    const al = toAlbum(
      {
        ratingKey: "20",
        title: "In Rainbows",
        year: 2007,
        thumb: "/a.jpg",
        parentRatingKey: "10",
        updatedAt: 1717900000000,
      },
      "srv-1",
    );
    expect(al.updatedAt).toBe(1717900000000);
  });
  it("maps an album userRating, and leaves it undefined when absent", () => {
    const rated = toAlbum(
      { ratingKey: "20", title: "In Rainbows", parentRatingKey: "10", userRating: 8 },
      "srv-1",
    );
    expect(rated.userRating).toBe(8);
    const unrated = toAlbum({ ratingKey: "21", title: "OK Computer" }, "srv-1");
    expect(unrated.userRating).toBeUndefined();
  });
  it("maps a track with media/part and denormalized titles", () => {
    const t = toTrack(
      {
        ratingKey: "30",
        title: "Nude",
        index: 3,
        duration: 254000,
        parentRatingKey: "20",
        parentTitle: "In Rainbows",
        grandparentRatingKey: "10",
        grandparentTitle: "Radiohead",
        userRating: 8,
        media: [
          {
            audioCodec: "flac",
            bitrate: 900,
            container: "flac",
            parts: [{ id: 99, key: "/library/parts/99/file.flac", container: "flac" }],
          },
        ],
      },
      "srv-1",
    );
    expect(t).toEqual({
      id: "30",
      serverId: "srv-1",
      albumId: "20",
      artistId: "10",
      albumTitle: "In Rainbows",
      artistName: "Radiohead",
      title: "Nude",
      trackNumber: 3,
      durationMs: 254000,
      userRating: 8,
      media: {
        container: "flac",
        audioCodec: "flac",
        bitrate: 900,
        partId: "99",
        partKey: "/library/parts/99/file.flac",
      },
    });
  });
  it("maps a track with a thumb, stripping the token from a full URL", () => {
    const t = toTrack(
      {
        ratingKey: "32",
        title: "Karma Police",
        index: 4,
        duration: 262000,
        parentRatingKey: "20",
        parentTitle: "OK Computer",
        grandparentTitle: "Radiohead",
        thumb: "http://192.168.1.1:32400/library/metadata/32/thumb/99?X-Plex-Token=secret",
        media: [
          {
            audioCodec: "flac",
            bitrate: 1000,
            container: "flac",
            parts: [{ id: 100, key: "/library/parts/100/file.flac", container: "flac" }],
          },
        ],
      },
      "srv-1",
    );
    expect(t.thumb).toBe("/library/metadata/32/thumb/99");
    expect(t.userRating).toBeUndefined(); // no raw userRating -> stays undefined
  });
  it("throws if a track has no playable media part (not silently dropped)", () => {
    expect(() =>
      toTrack({ ratingKey: "31", title: "x", duration: 1, media: [] }, "srv-1"),
    ).toThrow();
  });
});
