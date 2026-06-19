import { describe, expect, it } from "vitest";
import type { Album, Track } from "../models/index";
import { albumsForGenre, albumsWithTrackGenres, genreIndex, tracksForGenre } from "./genres";

function album(over: Partial<Album> & { id: string }): Album {
  return {
    serverId: "srv",
    artistId: "art",
    title: `Album ${over.id}`,
    ...over,
  };
}

function track(over: Partial<Track> & { id: string; albumId: string; artistName: string }): Track {
  return {
    serverId: "srv",
    artistId: "art",
    title: `Track ${over.id}`,
    durationMs: 200_000,
    media: { container: "flac", audioCodec: "flac", partId: "p1", partKey: "/k" },
    ...over,
  };
}

describe("genreIndex", () => {
  it("counts albums per genre", () => {
    const idx = genreIndex([
      album({ id: "1", genres: ["Rock"] }),
      album({ id: "2", genres: ["Rock", "Jazz"] }),
      album({ id: "3", genres: ["Jazz"] }),
      album({ id: "4", genres: ["Jazz"] }),
    ]);
    expect(idx).toEqual([
      { genre: "Jazz", albumCount: 3 },
      { genre: "Rock", albumCount: 2 },
    ]);
  });

  it("groups case-insensitively and keeps the first-seen casing as display name", () => {
    const idx = genreIndex([
      album({ id: "1", genres: ["Hip-Hop"] }),
      album({ id: "2", genres: ["hip-hop"] }),
      album({ id: "3", genres: ["HIP-HOP"] }),
    ]);
    expect(idx).toEqual([{ genre: "Hip-Hop", albumCount: 3 }]);
  });

  it("sorts by album count desc, then name asc", () => {
    const idx = genreIndex([
      album({ id: "1", genres: ["Zeta"] }),
      album({ id: "2", genres: ["Alpha"] }),
      album({ id: "3", genres: ["Beta"] }),
      album({ id: "4", genres: ["Beta"] }),
    ]);
    expect(idx.map((g) => g.genre)).toEqual(["Beta", "Alpha", "Zeta"]);
  });

  it("ignores albums without genres and returns empty for an empty library", () => {
    expect(genreIndex([album({ id: "1" }), album({ id: "2", genres: [] })])).toEqual([]);
    expect(genreIndex([])).toEqual([]);
  });
});

describe("albumsWithTrackGenres", () => {
  it("folds track-level genres up to their album (real-library case: albums untagged, tracks tagged)", () => {
    const albums = [album({ id: "a1" }), album({ id: "a2" }), album({ id: "a3" })];
    const tracks = [
      track({ id: "t1", albumId: "a1", artistName: "A", genres: ["Rock"] }),
      track({ id: "t2", albumId: "a1", artistName: "A", genres: ["Rock", "Indie"] }),
      track({ id: "t3", albumId: "a2", artistName: "B", genres: ["Jazz"] }),
      track({ id: "t4", albumId: "a3", artistName: "C" }), // no genres
    ];
    const enriched = albumsWithTrackGenres(albums, tracks);

    expect(enriched.find((a) => a.id === "a1")?.genres).toEqual(["Rock", "Indie"]);
    expect(enriched.find((a) => a.id === "a2")?.genres).toEqual(["Jazz"]);
    expect(enriched.find((a) => a.id === "a3")?.genres).toBeUndefined();

    // The whole point: the index is now populated from track genres.
    expect(genreIndex(enriched)).toEqual([
      { genre: "Indie", albumCount: 1 },
      { genre: "Jazz", albumCount: 1 },
      { genre: "Rock", albumCount: 1 },
    ]);
  });

  it("merges album and track genres case-insensitively, keeping first-seen casing", () => {
    const albums = [album({ id: "a1", genres: ["Rock"] })];
    const tracks = [
      track({ id: "t1", albumId: "a1", artistName: "A", genres: ["rock", "Jazz"] }),
      track({ id: "t2", albumId: "a1", artistName: "A", genres: ["JAZZ"] }),
    ];
    expect(albumsWithTrackGenres(albums, tracks)[0]?.genres).toEqual(["Rock", "Jazz"]);
  });

  it("counts an album once per genre even when several tracks repeat it", () => {
    const albums = [album({ id: "a1" }), album({ id: "a2" })];
    const tracks = [
      track({ id: "t1", albumId: "a1", artistName: "A", genres: ["Rock"] }),
      track({ id: "t2", albumId: "a1", artistName: "A", genres: ["Rock"] }),
      track({ id: "t3", albumId: "a2", artistName: "B", genres: ["Rock"] }),
    ];
    const enriched = albumsWithTrackGenres(albums, tracks);
    expect(genreIndex(enriched)).toEqual([{ genre: "Rock", albumCount: 2 }]);
    expect(albumsForGenre("rock", enriched).map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(tracksForGenre("rock", enriched, tracks).map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("does not mutate the input albums", () => {
    const a1 = album({ id: "a1" });
    const albums = [a1];
    const tracks = [track({ id: "t1", albumId: "a1", artistName: "A", genres: ["Rock"] })];
    albumsWithTrackGenres(albums, tracks);
    expect(a1.genres).toBeUndefined();
  });
});

describe("albumsForGenre", () => {
  it("returns albums tagged with the genre, matched case-insensitively", () => {
    const albums = [
      album({ id: "a1", genres: ["Rock"] }),
      album({ id: "a2", genres: ["rock", "Jazz"] }),
      album({ id: "a3", genres: ["Jazz"] }),
      album({ id: "a4" }),
    ];
    expect(albumsForGenre("ROCK", albums).map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(albumsForGenre("Classical", albums)).toEqual([]);
  });
});

describe("tracksForGenre", () => {
  const albums = [
    album({ id: "a1", genres: ["Rock"] }),
    album({ id: "a2", genres: ["rock", "Jazz"] }),
    album({ id: "a3", genres: ["Jazz"] }),
  ];

  it("returns tracks from albums tagged with the genre, matched case-insensitively", () => {
    const t1 = track({ id: "t1", albumId: "a1", artistName: "A" });
    const t2 = track({ id: "t2", albumId: "a2", artistName: "A" });
    const t3 = track({ id: "t3", albumId: "a3", artistName: "A" });
    const got = tracksForGenre("ROCK", albums, [t1, t2, t3]);
    expect(got.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  it("sorts by artist, then album title, then track number with nullish last", () => {
    const tracks = [
      track({ id: "t1", albumId: "a1", artistName: "Zed", albumTitle: "Z", trackNumber: 1 }),
      track({ id: "t2", albumId: "a1", artistName: "Abe", albumTitle: "B", trackNumber: 2 }),
      track({ id: "t3", albumId: "a1", artistName: "Abe", albumTitle: "B", trackNumber: 1 }),
      track({ id: "t4", albumId: "a1", artistName: "Abe", albumTitle: "B" }), // no trackNumber -> last in album
      track({ id: "t5", albumId: "a1", artistName: "Abe", albumTitle: "A", trackNumber: 9 }),
    ];
    const got = tracksForGenre("Rock", albums, tracks);
    expect(got.map((t) => t.id)).toEqual(["t5", "t3", "t2", "t4", "t1"]);
  });

  it("keeps a stable, valid order when several tracks lack a track number", () => {
    const tracks = [
      track({ id: "t1", albumId: "a1", artistName: "A", albumTitle: "B" }),
      track({ id: "t2", albumId: "a1", artistName: "A", albumTitle: "B" }),
      track({ id: "t3", albumId: "a1", artistName: "A", albumTitle: "B", trackNumber: 1 }),
    ];
    const got = tracksForGenre("Rock", albums, tracks);
    expect(got.map((t) => t.id)).toEqual(["t3", "t1", "t2"]);
  });

  it("returns empty when no album carries the genre", () => {
    const t1 = track({ id: "t1", albumId: "a1", artistName: "A" });
    expect(tracksForGenre("Classical", albums, [t1])).toEqual([]);
  });
});
