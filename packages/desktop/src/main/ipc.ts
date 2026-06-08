import type { Track } from "@musex/core";
import { discoverMusicLibraries } from "@musex/core";
import { ipcMain } from "electron";
import { IPC } from "../shared/ipc-contract.js";
import { persistence } from "./adapters/persistence.js";
import type { Runtime } from "./runtime.js";

export function registerIpc(rt: Runtime): void {
  ipcMain.handle(IPC.signInStart, () => rt.signInStart());
  ipcMain.handle(IPC.signInPoll, () => rt.signInPoll());

  ipcMain.handle(IPC.restoreSession, async () => {
    if (!rt.token) return { library: null };
    const lib = persistence.getLibrary();
    if (lib) {
      rt.libraries = [lib];
      return { library: lib }; // instant — no network
    }
    // Signed in but no library chosen yet: discover once.
    try {
      const result = await discoverMusicLibraries(rt.gateway, rt.token);
      rt.libraries = result.libraries;
      return { library: result.libraries[0] ?? null };
    } catch {
      return { library: null };
    }
  });

  ipcMain.handle(IPC.discoverLibraries, async () => {
    const result = await discoverMusicLibraries(rt.gateway, rt.requireToken());
    rt.libraries = result.libraries;
    return result;
  });

  ipcMain.handle(IPC.selectLibrary, (_e, libraryId: string) => {
    const lib = rt.findLibrary(libraryId);
    persistence.setLibrary(lib);
  });

  // Browse handlers also register the stream-proxy endpoint for the server, because
  // artwork loads with browse results, before any playback.
  // ensureProxyEndpoint reuses the gateway's cached connection, so it's ~free.
  // Art URLs are baked here (full http://127.0.0.1:PORT/… URLs) so the renderer
  // can use them directly without knowing anything about the proxy or token.
  ipcMain.handle(IPC.listArtists, async (_e, libraryId: string) => {
    const lib = rt.findLibrary(libraryId);
    await rt.ensureProxyEndpoint(lib.serverId);
    const artists = await rt.gateway.listArtists(lib, rt.requireToken());
    return artists.map((a) => ({ ...a, thumb: rt.proxy.artUrl(a.serverId, a.thumb) }));
  });
  ipcMain.handle(IPC.listAlbums, async (_e, libraryId: string, artistId: string) => {
    const lib = rt.findLibrary(libraryId);
    await rt.ensureProxyEndpoint(lib.serverId);
    const albums = await rt.gateway.listAlbums(lib, artistId, rt.requireToken());
    return albums.map((a) => ({ ...a, thumb: rt.proxy.artUrl(a.serverId, a.thumb) }));
  });
  ipcMain.handle(IPC.listTracks, async (_e, libraryId: string, albumId: string) => {
    const lib = rt.findLibrary(libraryId);
    await rt.ensureProxyEndpoint(lib.serverId);
    const tracks = await rt.gateway.listTracks(lib, albumId, rt.requireToken());
    return tracks.map((t) => ({ ...t, thumb: rt.proxy.artUrl(t.serverId, t.thumb) }));
  });

  ipcMain.handle(IPC.resolveStream, async (_e, track: Track) => {
    await rt.ensureProxyEndpoint(track.serverId);
    return rt.proxy.resolve(track);
  });

  ipcMain.handle(IPC.getVolume, () => persistence.getVolume());
  ipcMain.handle(IPC.setVolume, (_e, v: number) => {
    if (typeof v !== "number" || v < 0 || v > 1) throw new Error("invalid volume");
    persistence.setVolume(v);
  });
}
