import { describe, expect, it } from "vitest";
import { initPlexIdentity, PlexapiGateway } from "./plex-gateway.js";

const TOKEN = process.env.MUSEX_PLEX_E2E;
const run = TOKEN ? describe : describe.skip;

run("PlexapiGateway (real Plex, env-gated)", () => {
  it("discovers servers and lists music libraries + a first artist/album/tracks", async () => {
    initPlexIdentity();
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
});
