import { contextBridge, ipcRenderer } from "electron";
import type { MusexApi } from "../shared/ipc-contract.js";
import { IPC } from "../shared/ipc-contract.js";

const api: MusexApi = {
  signInStart: () => ipcRenderer.invoke(IPC.signInStart),
  signInPoll: () => ipcRenderer.invoke(IPC.signInPoll),
  discoverLibraries: () => ipcRenderer.invoke(IPC.discoverLibraries),
  selectLibrary: (libraryId) => ipcRenderer.invoke(IPC.selectLibrary, libraryId),
  listArtists: (libraryId) => ipcRenderer.invoke(IPC.listArtists, libraryId),
  listAlbums: (libraryId, artistId) => ipcRenderer.invoke(IPC.listAlbums, libraryId, artistId),
  listTracks: (libraryId, albumId) => ipcRenderer.invoke(IPC.listTracks, libraryId, albumId),
  resolveStream: (track) => ipcRenderer.invoke(IPC.resolveStream, track),
  getVolume: () => ipcRenderer.invoke(IPC.getVolume),
  setVolume: (v) => ipcRenderer.invoke(IPC.setVolume, v),
};

contextBridge.exposeInMainWorld("musex", api);
