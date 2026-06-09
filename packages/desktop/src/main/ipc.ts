import type { Track } from "@musex/core";
import { createPlaylist, discoverMusicLibraries } from "@musex/core";
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
  ipcMain.handle(IPC.listArtists, async (_e, libraryId: string, validator?: string) => {
    const lib = rt.findLibrary(libraryId);
    await rt.ensureProxyEndpoint(lib.serverId);
    const artists = await rt.gateway.listArtists(lib, rt.requireToken(), validator);
    return artists.map((a) => ({ ...a, thumb: rt.proxy.artUrl(a.serverId, a.thumb) }));
  });
  ipcMain.handle(
    IPC.listAlbums,
    async (_e, libraryId: string, artistId: string, validator?: string) => {
      const lib = rt.findLibrary(libraryId);
      await rt.ensureProxyEndpoint(lib.serverId);
      const albums = await rt.gateway.listAlbums(lib, artistId, rt.requireToken(), validator);
      return albums.map((a) => ({ ...a, thumb: rt.proxy.artUrl(a.serverId, a.thumb) }));
    },
  );
  ipcMain.handle(
    IPC.listTracks,
    async (_e, libraryId: string, albumId: string, validator?: string) => {
      const lib = rt.findLibrary(libraryId);
      await rt.ensureProxyEndpoint(lib.serverId);
      const tracks = await rt.gateway.listTracks(lib, albumId, rt.requireToken(), validator);
      return tracks.map((t) => ({ ...t, thumb: rt.proxy.artUrl(t.serverId, t.thumb) }));
    },
  );
  ipcMain.handle(IPC.search, async (_e, libraryId: string, query: string) => {
    const lib = rt.findLibrary(libraryId);
    await rt.ensureProxyEndpoint(lib.serverId);
    const results = await rt.gateway.search(lib, query, rt.requireToken());
    return {
      artists: results.artists.map((a) => ({ ...a, thumb: rt.proxy.artUrl(a.serverId, a.thumb) })),
      albums: results.albums.map((a) => ({ ...a, thumb: rt.proxy.artUrl(a.serverId, a.thumb) })),
      tracks: results.tracks.map((t) => ({ ...t, thumb: rt.proxy.artUrl(t.serverId, t.thumb) })),
    };
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
  ipcMain.handle(IPC.getPreferences, () => ({
    cacheEnabled: persistence.getCacheEnabled(),
    cacheMaxBytes: persistence.getCacheMaxBytes(),
  }));
  ipcMain.handle(IPC.setCacheEnabled, (_e, enabled: boolean) => {
    if (typeof enabled !== "boolean") throw new Error("invalid cacheEnabled");
    persistence.setCacheEnabled(enabled);
  });
  ipcMain.handle(IPC.setCacheMaxBytes, (_e, bytes: number) => {
    const MIN = 100 * 1024 ** 2; // 100 MiB floor
    if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < MIN) {
      throw new Error("invalid cacheMaxBytes");
    }
    persistence.setCacheMaxBytes(bytes);
  });
  ipcMain.handle(IPC.getCacheStats, () => rt.cache.stats());
  ipcMain.handle(IPC.clearCache, async () => ({ freedBytes: await rt.cache.clear() }));

  ipcMain.handle(IPC.listPlaylists, async (_e, libraryId: string) => {
    const lib = rt.findLibrary(libraryId);
    await rt.ensureProxyEndpoint(lib.serverId);
    const playlists = await rt.gateway.listPlaylists(lib, rt.requireToken());
    return playlists.map((p) => ({ ...p, thumb: rt.proxy.artUrl(p.serverId, p.thumb) }));
  });
  ipcMain.handle(
    IPC.listPlaylistTracks,
    async (_e, playlistId: string, serverId: string, validator?: string) => {
      await rt.ensureProxyEndpoint(serverId);
      const items = await rt.gateway.listPlaylistTracks(
        playlistId,
        serverId,
        rt.requireToken(),
        validator,
      );
      return items.map((it) => ({
        ...it,
        track: { ...it.track, thumb: rt.proxy.artUrl(it.track.serverId, it.track.thumb) },
      }));
    },
  );
  ipcMain.handle(
    IPC.listPlaylistTracksPage,
    async (_e, playlistId: string, serverId: string, start: number, size: number) => {
      await rt.ensureProxyEndpoint(serverId);
      const result = await rt.gateway.listPlaylistTracksPage(
        playlistId,
        serverId,
        start,
        size,
        rt.requireToken(),
      );
      return {
        ...result,
        items: result.items.map((it) => ({
          ...it,
          track: { ...it.track, thumb: rt.proxy.artUrl(it.track.serverId, it.track.thumb) },
        })),
      };
    },
  );
  ipcMain.handle(
    IPC.createPlaylist,
    async (_e, libraryId: string, title: string, trackIds: string[]) => {
      const lib = rt.findLibrary(libraryId);
      const p = await createPlaylist(rt.gateway, lib, title, trackIds, rt.requireToken());
      return { ...p, thumb: rt.proxy.artUrl(p.serverId, p.thumb) };
    },
  );
  ipcMain.handle(
    IPC.addToPlaylist,
    (_e, playlistId: string, serverId: string, trackIds: string[]) =>
      rt.gateway.addToPlaylist(playlistId, serverId, trackIds, rt.requireToken()),
  );
  ipcMain.handle(
    IPC.removeFromPlaylist,
    (_e, playlistId: string, serverId: string, itemIds: string[]) =>
      rt.gateway.removeFromPlaylist(playlistId, serverId, itemIds, rt.requireToken()),
  );
  ipcMain.handle(IPC.renamePlaylist, (_e, playlistId: string, serverId: string, title: string) =>
    rt.gateway.renamePlaylist(playlistId, serverId, title, rt.requireToken()),
  );
  ipcMain.handle(IPC.deletePlaylist, (_e, playlistId: string, serverId: string) =>
    rt.gateway.deletePlaylist(playlistId, serverId, rt.requireToken()),
  );
}
