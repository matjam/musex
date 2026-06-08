import { describe, expect, it } from "vitest";
import { toAlbum, toArtist, toTrack } from "./plex-mapping";

describe("plex-mapping", () => {
  it("maps an artist", () => {
    const a = toArtist({ ratingKey: "10", title: "Radiohead", thumb: "/t.jpg" }, "srv-1");
    expect(a).toEqual({ id: "10", serverId: "srv-1", name: "Radiohead", thumb: "/t.jpg" });
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
  it("maps a track with media/part and denormalized titles", () => {
    const t = toTrack(
      {
        ratingKey: "30",
        title: "Nude",
        index: 3,
        duration: 254000,
        parentRatingKey: "20",
        parentTitle: "In Rainbows",
        grandparentTitle: "Radiohead",
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
      albumTitle: "In Rainbows",
      artistName: "Radiohead",
      title: "Nude",
      trackNumber: 3,
      durationMs: 254000,
      media: {
        container: "flac",
        audioCodec: "flac",
        bitrate: 900,
        partId: "99",
        partKey: "/library/parts/99/file.flac",
      },
    });
  });
  it("throws if a track has no playable media part (not silently dropped)", () => {
    expect(() =>
      toTrack({ ratingKey: "31", title: "x", duration: 1, media: [] }, "srv-1"),
    ).toThrow();
  });
});
