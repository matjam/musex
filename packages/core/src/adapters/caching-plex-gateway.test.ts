import { describe, expect, it, vi } from "vitest";
import type { Album, Artist, Library, PlaylistTrack, Track } from "../models/index";
import type { ListCache } from "../ports/list-cache";
import { OfflineUnavailable, type PlexGateway } from "../ports/plex-gateway";
import { type CachingGatewayOpts, CachingPlexGateway } from "./caching-plex-gateway";

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
const album = (id: string): Album => ({ id, serverId: "s1", artistId: "ar1", title: id });
const artist = (id: string): Artist => ({ id, serverId: "s1", name: id });

/** In-memory ListCache fake: Map of key → {validator, data}. `getStale` ignores
 *  the validator. No fs. */
class FakeListCache implements ListCache {
  private readonly mem = new Map<string, { validator: string; data: unknown }>();
  initCalls = 0;
  async init(): Promise<void> {
    this.initCalls++;
  }
  async get<T>(key: string, validator: string): Promise<T | null> {
    const e = this.mem.get(key);
    if (!e) return null;
    return e.validator === validator ? (e.data as T) : null;
  }
  async getStale<T>(key: string): Promise<T | null> {
    const e = this.mem.get(key);
    return e ? (e.data as T) : null;
  }
  async set<T>(key: string, validator: string, data: T): Promise<void> {
    this.mem.set(key, { validator, data });
  }
  async evictKey(key: string): Promise<void> {
    this.mem.delete(key);
  }
  async clear(): Promise<void> {
    this.mem.clear();
  }
}

function setup(opts: Partial<CachingGatewayOpts> = {}) {
  const inner = {
    listPlaylistTracks: vi.fn(async () => ptracks),
    listTracks: vi.fn(async () => [track("t1")]),
    listAllTracks: vi.fn(async () => [track("t1")]),
    listAlbums: vi.fn(async () => [album("al1")]),
    listAllAlbums: vi.fn(async () => [album("al1")]),
    listArtists: vi.fn(async () => [artist("ar1")]),
    listPlaylists: vi.fn(async () => []),
    createPlaylist: vi.fn(async () => ({ id: "pl1", serverId: "s1", title: "x", trackCount: 0 })),
    addToPlaylist: vi.fn(async () => {}),
    removeFromPlaylist: vi.fn(async () => {}),
    renamePlaylist: vi.fn(async () => {}),
    deletePlaylist: vi.fn(async () => {}),
    rateItem: vi.fn(async () => {}),
    getUserRating: vi.fn(async () => 8),
  } as unknown as PlexGateway;
  const cache = new FakeListCache();
  const gw = new CachingPlexGateway(inner, cache, {
    isOnline: () => true,
    schemaVersion: "v6",
    ...opts,
  });
  return { inner, gw, cache };
}

describe("CachingPlexGateway", () => {
  it("serves a matching validator from cache without re-calling inner", async () => {
    const { inner, gw } = setup();
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1");
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1");
    expect(inner.listPlaylistTracks).toHaveBeenCalledTimes(1);
  });
  it("refetches when the validator differs", async () => {
    const { inner, gw } = setup();
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1");
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v2");
    expect(inner.listPlaylistTracks).toHaveBeenCalledTimes(2);
  });
  it("always fetches when no validator is given", async () => {
    const { inner, gw } = setup();
    await gw.listPlaylistTracks("pl1", "s1", "tok");
    await gw.listPlaylistTracks("pl1", "s1", "tok");
    expect(inner.listPlaylistTracks).toHaveBeenCalledTimes(2);
  });
  it("evicts a playlist's track cache after a mutation", async () => {
    const { inner, gw } = setup();
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1");
    await gw.addToPlaylist("pl1", "s1", ["t9"], "tok");
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1");
    expect(inner.listPlaylistTracks).toHaveBeenCalledTimes(2);
  });

  it("delegates rateItem and getUserRating to inner", async () => {
    const { inner, gw } = setup();
    await gw.rateItem("s1", "t1", 8, "tok");
    expect(inner.rateItem).toHaveBeenCalledWith("s1", "t1", 8, "tok");
    await expect(gw.getUserRating("s1", "t1", "tok")).resolves.toBe(8);
    expect(inner.getUserRating).toHaveBeenCalledWith("s1", "t1", "tok");
  });

  it("rateItem with albumId evicts that album's track cache only", async () => {
    const { inner, gw } = setup();
    await gw.listTracks(lib, "al1", "tok", "v1"); // seed tracks:al1
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1"); // unrelated key
    await gw.rateItem("s1", "t1", 6, "tok", { albumId: "al1" });
    await gw.listTracks(lib, "al1", "tok", "v1"); // evicted -> refetch
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1"); // untouched -> hit
    expect(inner.listTracks).toHaveBeenCalledTimes(2);
    expect(inner.listPlaylistTracks).toHaveBeenCalledTimes(1);
  });

  it("rateItem with libraryId evicts all three alltracks sort caches", async () => {
    const { inner, gw } = setup();
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
    const { inner, gw } = setup();
    await gw.listAlbums(lib, "ar1", "tok", "v1"); // seed albums:ar1
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1"); // unrelated key
    await gw.rateItem("s1", "al1", 8, "tok", { artistId: "ar1" });
    await gw.listAlbums(lib, "ar1", "tok", "v1"); // evicted -> refetch
    await gw.listPlaylistTracks("pl1", "s1", "tok", "v1"); // untouched -> hit
    expect(inner.listAlbums).toHaveBeenCalledTimes(2);
    expect(inner.listPlaylistTracks).toHaveBeenCalledTimes(1);
  });

  it("rateItem with libraryId evicts all three allalbums sort caches", async () => {
    const { inner, gw } = setup();
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
    const { inner, gw } = setup();
    await gw.listTracks(lib, "al1", "tok", "v1");
    await gw.rateItem("s1", "t1", null, "tok");
    await gw.listTracks(lib, "al1", "tok", "v1"); // still cached
    expect(inner.listTracks).toHaveBeenCalledTimes(1);
  });

  // --- listArtists caching ---

  it("serves a matching validator from cache without re-calling inner (listArtists)", async () => {
    const { inner, gw } = setup();
    await gw.listArtists(lib, "tok", "v1");
    const result = await gw.listArtists(lib, "tok", "v1");
    expect(inner.listArtists).toHaveBeenCalledTimes(1);
    expect(result).toEqual([artist("ar1")]);
  });

  it("refetches when the validator differs (listArtists)", async () => {
    const { inner, gw } = setup();
    await gw.listArtists(lib, "tok", "v1");
    await gw.listArtists(lib, "tok", "v2");
    expect(inner.listArtists).toHaveBeenCalledTimes(2);
  });

  it("always fetches when no validator is given (listArtists)", async () => {
    const { inner, gw } = setup();
    await gw.listArtists(lib, "tok");
    await gw.listArtists(lib, "tok");
    expect(inner.listArtists).toHaveBeenCalledTimes(2);
  });

  // --- offline branch (isOnline: () => false) ---

  it("offline: serves a cached key via getStale with no inner call", async () => {
    const { inner, gw, cache } = setup();
    await gw.listArtists(lib, "tok", "v1"); // warm online
    expect(inner.listArtists).toHaveBeenCalledTimes(1);
    const staleSpy = vi.spyOn(cache, "getStale");

    const offline = new CachingPlexGateway(inner, cache, {
      isOnline: () => false,
      schemaVersion: "v6",
    });
    // Even a mismatched validator is ignored offline — getStale serves it.
    const result = await offline.listArtists(lib, "tok", "different");
    expect(result).toEqual([artist("ar1")]);
    expect(inner.listArtists).toHaveBeenCalledTimes(1); // no extra inner call
    expect(staleSpy).toHaveBeenCalledWith("v6:artists:1");
  });

  it("offline: throws OfflineUnavailable for an uncached key", async () => {
    const { inner, gw } = setup({ isOnline: () => false });
    await expect(gw.listTracks(lib, "al-nope", "tok", "v1")).rejects.toBeInstanceOf(
      OfflineUnavailable,
    );
    expect(inner.listTracks).not.toHaveBeenCalled();
  });

  it("offline: never calls inner even with a validator", async () => {
    const { inner, cache } = setup();
    // warm one key online via a separate online gateway
    const onlineGw = new CachingPlexGateway(inner, cache, {
      isOnline: () => true,
      schemaVersion: "v6",
    });
    await onlineGw.listTracks(lib, "al1", "tok", "v1");
    inner.listTracks = vi.fn(async () => [track("t1")]) as typeof inner.listTracks;

    const offline = new CachingPlexGateway(inner, cache, {
      isOnline: () => false,
      schemaVersion: "v6",
    });
    await offline.listTracks(lib, "al1", "tok", "v1"); // cached -> served stale
    await expect(offline.listTracks(lib, "al2", "tok", "v1")).rejects.toBeInstanceOf(
      OfflineUnavailable,
    ); // uncached -> throw
    expect(inner.listTracks).not.toHaveBeenCalled();
  });

  it("coalesces concurrent misses for the same key into one inner fetch", async () => {
    const { inner, gw } = setup();
    // Hold the inner fetch open so all three callers overlap on the miss.
    let release: (v: Track[]) => void = () => {};
    inner.listAllTracks = vi.fn(
      () => new Promise<Track[]>((r) => (release = r)),
    ) as typeof inner.listAllTracks;

    const calls = [
      gw.listAllTracks(lib, "title", "tok", "v1"),
      gw.listAllTracks(lib, "title", "tok", "v1"),
      gw.listAllTracks(lib, "title", "tok", "v1"),
    ];
    await Promise.resolve(); // let the cache.get misses settle
    release([track("t1")]);
    const results = await Promise.all(calls);

    expect(inner.listAllTracks).toHaveBeenCalledTimes(1);
    for (const r of results) expect(r).toEqual([track("t1")]);
    // After settling, the in-flight entry is cleared and the result is cached.
    await gw.listAllTracks(lib, "title", "tok", "v1");
    expect(inner.listAllTracks).toHaveBeenCalledTimes(1); // served from cache
  });

  it("clears the in-flight entry on failure so the next call retries", async () => {
    const { inner, gw } = setup();
    inner.listAllTracks = vi
      .fn()
      .mockRejectedValueOnce(new Error("plex down"))
      .mockResolvedValueOnce([track("t1")]) as typeof inner.listAllTracks;

    await expect(gw.listAllTracks(lib, "title", "tok", "v1")).rejects.toThrow("plex down");
    await expect(gw.listAllTracks(lib, "title", "tok", "v1")).resolves.toEqual([track("t1")]);
    expect(inner.listAllTracks).toHaveBeenCalledTimes(2);
  });
});
