import { describe, expect, it } from "vitest";
import { cacheKeys, evictKeysForPlaylist, evictKeysForRating } from "./list-cache-keys";

describe("cacheKeys", () => {
  it("builds the documented key shapes", () => {
    expect(cacheKeys.artists("L")).toBe("artists:L");
    expect(cacheKeys.albums("ar")).toBe("albums:ar");
    expect(cacheKeys.tracks("al")).toBe("tracks:al");
    expect(cacheKeys.playlistTracks("p")).toBe("pltracks:p");
    expect(cacheKeys.allAlbums("L", "title")).toBe("allalbums:L:title");
    expect(cacheKeys.allTracks("L", "title")).toBe("alltracks:L:title");
    expect(cacheKeys.playlists("L")).toBe("playlists:L");
    expect(cacheKeys.artist("ar")).toBe("artist:ar");
    expect(cacheKeys.artistTracks("ar")).toBe("artisttracks:ar");
  });
});

describe("evictKeysForRating", () => {
  it("evicts a single album track list for albumId", () => {
    expect(evictKeysForRating({ albumId: "al" })).toEqual(["tracks:al"]);
  });
  it("evicts a single artist album list for artistId", () => {
    expect(evictKeysForRating({ artistId: "ar" })).toEqual(["albums:ar"]);
  });
  it("evicts both list families across all three sorts for libraryId", () => {
    const keys = evictKeysForRating({ libraryId: "L" });
    expect(keys).toHaveLength(6);
    expect(keys).toEqual([
      "alltracks:L:title",
      "allalbums:L:title",
      "alltracks:L:artist",
      "allalbums:L:artist",
      "alltracks:L:added",
      "allalbums:L:added",
    ]);
  });
  it("combines all of albumId + artistId + libraryId", () => {
    const keys = evictKeysForRating({ albumId: "al", artistId: "ar", libraryId: "L" });
    expect(keys).toHaveLength(8);
    expect(keys).toContain("tracks:al");
    expect(keys).toContain("albums:ar");
  });
  it("evicts nothing with no opts", () => {
    expect(evictKeysForRating({})).toEqual([]);
  });
});

describe("evictKeysForPlaylist", () => {
  it("evicts the playlist track list and the library playlists list", () => {
    expect(evictKeysForPlaylist("p", "L")).toEqual(["pltracks:p", "playlists:L"]);
  });
  it("evicts only the playlist track list without a libraryId", () => {
    expect(evictKeysForPlaylist("p")).toEqual(["pltracks:p"]);
  });
});
