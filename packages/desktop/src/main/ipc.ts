import type { Track } from "@musex/core";
import { discoverMusicLibraries } from "@musex/core";
import { ipcMain } from "electron";
import { IPC } from "../shared/ipc-contract.js";
import { persistence } from "./adapters/persistence.js";
import type { Runtime } from "./runtime.js";

export function registerIpc(rt: Runtime): void {
  ipcMain.handle(IPC.signInStart, () => rt.signInStart());
  ipcMain.handle(IPC.signInPoll, () => rt.signInPoll());

  ipcMain.handle(IPC.discoverLibraries, async () => {
    const token = rt.requireToken();
    const result = await discoverMusicLibraries(rt.gateway, token);
    rt.libraries = result.libraries;
    // Register stream endpoints for each reachable server.
    for (const server of await rt.gateway.listServers(token)) {
      const reachable = server.connections.find((c) => c.uri);
      if (reachable) {
        rt.proxy.registerServer(server, { baseUrl: reachable.uri, token });
      }
    }
    return result;
  });

  ipcMain.handle(IPC.selectLibrary, (_e, libraryId: string) => {
    const lib = rt.findLibrary(libraryId);
    persistence.setSelection(lib.serverId, lib.id);
  });

  ipcMain.handle(IPC.listArtists, (_e, libraryId: string) =>
    rt.gateway.listArtists(rt.findLibrary(libraryId), rt.requireToken()),
  );
  ipcMain.handle(IPC.listAlbums, (_e, libraryId: string, artistId: string) =>
    rt.gateway.listAlbums(rt.findLibrary(libraryId), artistId, rt.requireToken()),
  );
  ipcMain.handle(IPC.listTracks, (_e, libraryId: string, albumId: string) =>
    rt.gateway.listTracks(rt.findLibrary(libraryId), albumId, rt.requireToken()),
  );

  ipcMain.handle(IPC.resolveStream, (_e, track: Track) => rt.proxy.resolve(track));

  ipcMain.handle(IPC.getVolume, () => persistence.getVolume());
  ipcMain.handle(IPC.setVolume, (_e, v: number) => {
    if (typeof v !== "number" || v < 0 || v > 1) throw new Error("invalid volume");
    persistence.setVolume(v);
  });
}
