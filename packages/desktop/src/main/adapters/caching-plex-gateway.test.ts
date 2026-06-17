import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Album, Artist, Library, PlaylistTrack, Track } from "@musex/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CachingPlexGateway } from "./caching-plex-gateway";
import { ListCacheStore } from "./list-cache-store";

const lib: Library = { id: "1", serverId: "s1", serverName: "K", title: "Music", type: "music" };
const track = (id: string): Track => ({
  id,
  serverId: "s1",
  albumId: "al1",
  artistId: "ar1",
  artistName: "A",
  title: id,
  durationMs: 1000,
  media: { container: "flac", audioCodec: "flac", partId: "p", partKey: "/k" },
});
const ptracks: PlaylistTrack[] = [{ track: track("t1"), playlistItemId: "i1" }];
const album = (id: string): Album => ({
  id,
  serverId: "s1",
  artistId: "ar1",
  title: id,
});
const artist = (id: string): Artist => ({
  id,
  serverId: "s1",
  name: id,
});

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "musex-cpg-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function setup() {
  const inner = {
    listPlaylistTracks: vi.fn(async () => ptracks),
    listTracks: vi.fn(async () => [track("t1")]),
    listAllTracks: vi.fn(async () => [track("t1")]),
    listAlbums: vi.fn(async () => [album("al1")]),
    listAllAlbums: vi.fn(async () => [album("al1")]),
    listArtists: vi.fn(async () => [artist("ar1")]),
    addToPlaylist: vi.fn(async () => {}),
    rateItem: vi.fn(async () => {}),
    getUserRating: vi.fn(async () => 8),
    endpoint: vi.fn(async (_serverId: string, token: string) => ({
      baseUrl: "http://localhost",
      token,
    })),
    listPlaylistTracksPage: vi.fn(async () => ({ items: ptracks, total: ptracks.length })),
  } as unknown as import("@musex/core").PlexGateway & {
    endpoint(serverId: string, token: string): Promise<{ baseUrl: string; token: string }>;
    listPlaylistTracksPage(
      playlistId: string,
      serverId: string,
      start: number,
      size: number,
      token: string,
    ): Promise<{ items: PlaylistTrack[]; total: number }>;
  };
  const store = new ListCacheStore(dir, 50);
  return { inner, gw: new CachingPlexGateway(inner, store), store };
}

describe("CachingPlexGateway", () => {
  it("serves a matching validator from cache without re-calling inner", async () => {
    const { inner, gw, store } = setup();
    await store.init();
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1");
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1");
    expect(inner.listPlaylistTracks).toHaveBeenCalledTimes(1);
  });
  it("refetches when the validator differs", async () => {
    const { inner, gw, store } = setup();
    await store.init();
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1");
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v2");
    expect(inner.listPlaylistTracks).toHaveBeenCalledTimes(2);
  });
  it("always fetches when no validator is given", async () => {
    const { inner, gw, store } = setup();
    await store.init();
    await gw.listPlaylistTracks("pl1", "s1", "tok");
    await gw.listPlaylistTracks("pl1", "s1", "tok");
    expect(inner.listPlaylistTracks).toHaveBeenCalledTimes(2);
  });
  it("evicts a playlist's track cache after a mutation", async () => {
    const { inner, gw, store } = setup();
    await store.init();
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1");
    await gw.addToPlaylist("pl1", "s1", ["t9"], "tok");
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1");
    expect(inner.listPlaylistTracks).toHaveBeenCalledTimes(2);
  });

  it("delegates rateItem and getUserRating to inner", async () => {
    const { inner, gw, store } = setup();
    await store.init();
    await gw.rateItem("s1", "t1", 8, "tok");
    expect(inner.rateItem).toHaveBeenCalledWith("s1", "t1", 8, "tok");
    await expect(gw.getUserRating("s1", "t1", "tok")).resolves.toBe(8);
    expect(inner.getUserRating).toHaveBeenCalledWith("s1", "t1", "tok");
  });

  it("rateItem with albumId evicts that album's track cache only", async () => {
    const { inner, gw, store } = setup();
    await store.init();
    await gw.listTracks(lib, "al1", "tok", "v1"); // seed tracks:al1
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1"); // unrelated key
    await gw.rateItem("s1", "t1", 6, "tok", { albumId: "al1" });
    await gw.listTracks(lib, "al1", "tok", "v1"); // evicted -> refetch
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1"); // untouched -> hit
    expect(inner.listTracks).toHaveBeenCalledTimes(2);
    expect(inner.listPlaylistTracks).toHaveBeenCalledTimes(1);
  });

  it("rateItem with libraryId evicts all three alltracks sort caches", async () => {
    const { inner, gw, store } = setup();
    await store.init();
    await gw.listAllTracks(lib, "title", "tok", "v1");
    await gw.listAllTracks(lib, "artist", "tok", "v1");
    await gw.listAllTracks(lib, "added", "tok", "v1");
    await gw.rateItem("s1", "t1", 6, "tok", { libraryId: lib.id });
    await gw.listAllTracks(lib, "title", "tok", "v1");
    await gw.listAllTracks(lib, "artist", "tok", "v1");
    await gw.listAllTracks(lib, "added", "tok", "v1");
    expect(inner.listAllTracks).toHaveBeenCalledTimes(6); // every sort refetched
  });

  it("rateItem with artistId evicts that artist's album cache only", async () => {
    const { inner, gw, store } = setup();
    await store.init();
    await gw.listAlbums(lib, "ar1", "tok", "v1"); // seed albums:ar1
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1"); // unrelated key
    await gw.rateItem("s1", "al1", 8, "tok", { artistId: "ar1" });
    await gw.listAlbums(lib, "ar1", "tok", "v1"); // evicted -> refetch
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1"); // untouched -> hit
    expect(inner.listAlbums).toHaveBeenCalledTimes(2);
    expect(inner.listPlaylistTracks).toHaveBeenCalledTimes(1);
  });

  it("rateItem with libraryId evicts all three allalbums sort caches", async () => {
    const { inner, gw, store } = setup();
    await store.init();
    await gw.listAllAlbums(lib, "title", "tok", "v1");
    await gw.listAllAlbums(lib, "artist", "tok", "v1");
    await gw.listAllAlbums(lib, "added", "tok", "v1");
    await gw.rateItem("s1", "al1", 8, "tok", { libraryId: lib.id });
    await gw.listAllAlbums(lib, "title", "tok", "v1");
    await gw.listAllAlbums(lib, "artist", "tok", "v1");
    await gw.listAllAlbums(lib, "added", "tok", "v1");
    expect(inner.listAllAlbums).toHaveBeenCalledTimes(6); // every sort refetched
  });

  it("rateItem without opts evicts nothing", async () => {
    const { inner, gw, store } = setup();
    await store.init();
    await gw.listTracks(lib, "al1", "tok", "v1");
    await gw.rateItem("s1", "t1", null, "tok");
    await gw.listTracks(lib, "al1", "tok", "v1"); // still cached
    expect(inner.listTracks).toHaveBeenCalledTimes(1);
  });

  // --- listArtists caching ---

  it("serves a matching validator from cache without re-calling inner (listArtists)", async () => {
    const { inner, gw, store } = setup();
    await store.init();
    await gw.listArtists(lib, "tok", "v1");
    const result = await gw.listArtists(lib, "tok", "v1");
    expect(inner.listArtists).toHaveBeenCalledTimes(1);
    expect(result).toEqual([artist("ar1")]);
  });

  it("refetches when the validator differs (listArtists)", async () => {
    const { inner, gw, store } = setup();
    await store.init();
    await gw.listArtists(lib, "tok", "v1");
    await gw.listArtists(lib, "tok", "v2");
    expect(inner.listArtists).toHaveBeenCalledTimes(2);
  });

  it("always fetches when no validator is given (listArtists)", async () => {
    const { inner, gw, store } = setup();
    await store.init();
    await gw.listArtists(lib, "tok");
    await gw.listArtists(lib, "tok");
    expect(inner.listArtists).toHaveBeenCalledTimes(2);
  });
});
