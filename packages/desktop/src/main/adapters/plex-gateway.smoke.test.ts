import { describe, expect, it } from "vitest";
import { PlexapiGateway } from "./plex-gateway.js";

const TOKEN = process.env.MUSEX_PLEX_E2E;
const run = TOKEN ? describe : describe.skip;

run("PlexapiGateway (real Plex, env-gated)", () => {
  it("discovers servers and lists music libraries + a first artist/album/tracks", async () => {
    const gw = new PlexapiGateway();
    const servers = await gw.listServers(TOKEN!);
    expect(servers.length).toBeGreaterThan(0);
    const libs = await gw.listMusicLibraries(servers[0]!, TOKEN!);
    expect(libs.length).toBeGreaterThan(0);
    const artists = await gw.listArtists(libs[0]!, TOKEN!);
    expect(artists.length).toBeGreaterThan(0);
    const albums = await gw.listAlbums(libs[0]!, artists[0]!.id, TOKEN!);
    if (albums.length) {
      const tracks = await gw.listTracks(libs[0]!, albums[0]!.id, TOKEN!);
      expect(tracks[0]?.media.partKey).toMatch(/^\/library\/parts\//);
    }
  }, 30_000);

  it("playlist round-trip: create → list → addTrack → listTracks → removeTrack → rename → delete", async () => {
    const gw = new PlexapiGateway();
    const servers = await gw.listServers(TOKEN!);
    const lib = await gw
      .listMusicLibraries(servers[0]!, TOKEN!)
      .then((libs) => libs.find((l) => l.type === "music") ?? libs[0]!);

    // Grab a known track id to seed the playlist
    const artists = await gw.listArtists(lib, TOKEN!);
    const albums = await gw.listAlbums(lib, artists[0]!.id, TOKEN!);
    const tracks = await gw.listTracks(lib, albums[0]!.id, TOKEN!);
    const firstTrackId = tracks[0]!.id;
    const secondTrackId = tracks[1]?.id ?? firstTrackId;

    // Create a playlist with one track
    const created = await gw.createPlaylist(lib, "musex-e2e-tmp", [firstTrackId], TOKEN!);
    expect(created.id).toBeTruthy();
    expect(created.title).toBe("musex-e2e-tmp");
    expect(created.trackCount).toBe(1);

    try {
      // List playlists — the new one must appear
      const listed = await gw.listPlaylists(lib, TOKEN!);
      const found = listed.find((p) => p.id === created.id);
      expect(found).toBeDefined();

      // List tracks — 1 item with a non-empty playlistItemId
      const items1 = await gw.listPlaylistTracks(created.id, lib.serverId, TOKEN!);
      expect(items1).toHaveLength(1);
      const firstItemId = items1[0]!.playlistItemId;
      expect(firstItemId).toBeTruthy();
      expect(items1[0]!.track.id).toBe(firstTrackId);

      // Add a second track → count 2
      await gw.addToPlaylist(created.id, lib.serverId, [secondTrackId], TOKEN!);
      const items2 = await gw.listPlaylistTracks(created.id, lib.serverId, TOKEN!);
      expect(items2.length).toBeGreaterThanOrEqual(2);

      // Remove the first item by playlistItemId → count drops
      await gw.removeFromPlaylist(created.id, lib.serverId, [firstItemId], TOKEN!);
      const items3 = await gw.listPlaylistTracks(created.id, lib.serverId, TOKEN!);
      expect(items3.length).toBeLessThan(items2.length);
      expect(items3.every((it) => it.playlistItemId !== firstItemId)).toBe(true);

      // Rename
      await gw.renamePlaylist(created.id, lib.serverId, "musex-e2e-tmp-renamed", TOKEN!);
      const listed2 = await gw.listPlaylists(lib, TOKEN!);
      const renamed = listed2.find((p) => p.id === created.id);
      expect(renamed?.title).toBe("musex-e2e-tmp-renamed");
    } finally {
      // Always clean up — delete the test playlist
      await gw.deletePlaylist(created.id, lib.serverId, TOKEN!);
      const afterDelete = await gw.listPlaylists(lib, TOKEN!);
      expect(afterDelete.find((p) => p.id === created.id)).toBeUndefined();
    }
  }, 60_000);
});
