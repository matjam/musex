import type { Track } from "@musex/core";
import { describe, expect, it } from "vitest";
import { groupTracksByAlbum } from "./group-tracks-by-album.js";

function track(over: Partial<Track> & { albumId: string }): Track {
  return {
    id: "t",
    serverId: "s1",
    artistId: "art1",
    artistName: "Artist",
    albumTitle: "Album",
    title: "Song",
    durationMs: 1000,
    media: { container: "flac", audioCodec: "flac", partId: "p1", partKey: "/k" },
    ...over,
  };
}

describe("groupTracksByAlbum", () => {
  it("groups tracks by albumId, preserving track order within a group", () => {
    const groups = groupTracksByAlbum([
      track({ id: "t1", albumId: "a1", albumTitle: "Aaa", trackNumber: 1 }),
      track({ id: "t2", albumId: "a1", albumTitle: "Aaa", trackNumber: 2 }),
      track({ id: "t3", albumId: "a2", albumTitle: "Bbb", artistName: "Other" }),
    ]);

    const a1 = groups.find((g) => g.albumId === "a1");
    expect(a1?.tracks.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(a1?.albumTitle).toBe("Aaa");
    expect(a1?.artistName).toBe("Artist");

    const a2 = groups.find((g) => g.albumId === "a2");
    expect(a2?.tracks.map((t) => t.id)).toEqual(["t3"]);
    expect(a2?.artistName).toBe("Other");
  });

  it("takes the thumb from the first track that has one", () => {
    const groups = groupTracksByAlbum([
      track({ id: "t1", albumId: "a1", thumb: undefined }),
      track({ id: "t2", albumId: "a1", thumb: "art" }),
    ]);
    expect(groups[0]?.thumb).toBe("art");
  });

  it("falls back to 'Unknown Album' when no album title is present", () => {
    const groups = groupTracksByAlbum([track({ id: "t1", albumId: "a1", albumTitle: undefined })]);
    expect(groups[0]?.albumTitle).toBe("Unknown Album");
  });

  it("returns groups sorted by album title (case-insensitive)", () => {
    const groups = groupTracksByAlbum([
      track({ id: "t1", albumId: "a1", albumTitle: "Zebra" }),
      track({ id: "t2", albumId: "a2", albumTitle: "apple" }),
    ]);
    expect(groups.map((g) => g.albumTitle)).toEqual(["apple", "Zebra"]);
  });
});
