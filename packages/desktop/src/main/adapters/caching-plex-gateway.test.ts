import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Library, PlaylistTrack, Track } from "@musex/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CachingPlexGateway } from "./caching-plex-gateway";
import { ListCacheStore } from "./list-cache-store";

const _lib: Library = { id: "1", serverId: "s1", serverName: "K", title: "Music", type: "music" };
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
    addToPlaylist: vi.fn(async () => {}),
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
});
