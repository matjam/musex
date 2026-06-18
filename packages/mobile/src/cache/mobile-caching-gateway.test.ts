import type { Artist, Library, ListCache, Track } from "@musex/core";
import { OfflineUnavailable } from "@musex/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlexGatewayImpl } from "../adapters/plex-gateway";
import { MobileCachingGateway } from "./mobile-caching-gateway";

const LIB: Library = {
  id: "L",
  serverId: "S",
  serverName: "srv",
  title: "Music",
  type: "music",
};
const ARTIST: Artist = { id: "ar1", serverId: "S", name: "Beatles" };
const TRACK: Track = {
  id: "t1",
  serverId: "S",
  albumId: "al1",
  artistId: "ar1",
  artistName: "Beatles",
  title: "Hey Jude",
  durationMs: 1000,
  media: { container: "mp3", audioCodec: "mp3", partId: "p1", partKey: "/parts/1" },
};

/** In-memory ListCache fake (mem-only Map of key -> {validator,data}). */
function fakeCache(): ListCache {
  const store = new Map<string, { validator: string; data: unknown }>();
  return {
    async init() {},
    async get<T>(key: string, validator: string): Promise<T | null> {
      const e = store.get(key);
      return e && e.validator === validator ? (e.data as T) : null;
    },
    async getStale<T>(key: string): Promise<T | null> {
      const e = store.get(key);
      return e ? (e.data as T) : null;
    },
    async set<T>(key: string, validator: string, data: T): Promise<void> {
      store.set(key, { validator, data });
    },
    async evictKey(key: string): Promise<void> {
      store.delete(key);
    },
    async clear(): Promise<void> {
      store.clear();
    },
  };
}

function fakeInner() {
  return {
    getArtist: vi.fn(async () => ARTIST),
    listArtistTracks: vi.fn(async () => [TRACK]),
    baseUrlFor: vi.fn(() => "http://host:32400"),
  } as unknown as PlexGatewayImpl & {
    getArtist: ReturnType<typeof vi.fn>;
    listArtistTracks: ReturnType<typeof vi.fn>;
    baseUrlFor: ReturnType<typeof vi.fn>;
  };
}

describe("MobileCachingGateway", () => {
  let inner: ReturnType<typeof fakeInner>;
  let cache: ListCache;

  beforeEach(() => {
    inner = fakeInner();
    cache = fakeCache();
  });

  it("getArtist: serves from cache on a validator match (no inner call)", async () => {
    const gw = new MobileCachingGateway(inner, cache, () => true);
    expect(await gw.getArtist(LIB, "ar1", "tok", "v1")).toEqual(ARTIST);
    expect(inner.getArtist).toHaveBeenCalledTimes(1);
    // second call same validator -> cache hit, inner not called again
    expect(await gw.getArtist(LIB, "ar1", "tok", "v1")).toEqual(ARTIST);
    expect(inner.getArtist).toHaveBeenCalledTimes(1);
  });

  it("getArtist: refetches + caches on a validator mismatch", async () => {
    const gw = new MobileCachingGateway(inner, cache, () => true);
    await gw.getArtist(LIB, "ar1", "tok", "v1");
    await gw.getArtist(LIB, "ar1", "tok", "v2");
    expect(inner.getArtist).toHaveBeenCalledTimes(2);
  });

  it("getArtist: offline serves stale, else throws OfflineUnavailable", async () => {
    let online = true;
    const gw = new MobileCachingGateway(inner, cache, () => online);
    await gw.getArtist(LIB, "ar1", "tok", "v1"); // warm the cache online
    online = false;
    inner.getArtist.mockClear();
    expect(await gw.getArtist(LIB, "ar1", "tok", "v1")).toEqual(ARTIST);
    expect(inner.getArtist).not.toHaveBeenCalled();
    await expect(gw.getArtist(LIB, "uncached", "tok", "v1")).rejects.toBeInstanceOf(
      OfflineUnavailable,
    );
    expect(inner.getArtist).not.toHaveBeenCalled();
  });

  it("listArtistTracks: caches by artist + offline-serves stale", async () => {
    let online = true;
    const gw = new MobileCachingGateway(inner, cache, () => online);
    expect(await gw.listArtistTracks("ar1", LIB, "tok", "v1")).toEqual([TRACK]);
    expect(await gw.listArtistTracks("ar1", LIB, "tok", "v1")).toEqual([TRACK]);
    expect(inner.listArtistTracks).toHaveBeenCalledTimes(1);
    online = false;
    inner.listArtistTracks.mockClear();
    expect(await gw.listArtistTracks("ar1", LIB, "tok", "v1")).toEqual([TRACK]);
    expect(inner.listArtistTracks).not.toHaveBeenCalled();
  });

  it("baseUrlFor delegates to the inner gateway", () => {
    const gw = new MobileCachingGateway(inner, cache, () => true);
    expect(gw.baseUrlFor("S")).toBe("http://host:32400");
    expect(inner.baseUrlFor).toHaveBeenCalledWith("S");
  });
});
