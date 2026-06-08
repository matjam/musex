import { contextBridge, ipcRenderer } from "electron";
import type { MusexApi } from "../shared/ipc-contract.js";
import { IPC } from "../shared/ipc-contract.js";

const api: MusexApi = {
  signInStart: () => ipcRenderer.invoke(IPC.signInStart),
  signInPoll: () => ipcRenderer.invoke(IPC.signInPoll),
  restoreSession: () => ipcRenderer.invoke(IPC.restoreSession),
  discoverLibraries: () => ipcRenderer.invoke(IPC.discoverLibraries),
  selectLibrary: (libraryId) => ipcRenderer.invoke(IPC.selectLibrary, libraryId),
  listArtists: (libraryId) => ipcRenderer.invoke(IPC.listArtists, libraryId),
  listAlbums: (libraryId, artistId) => ipcRenderer.invoke(IPC.listAlbums, libraryId, artistId),
  listTracks: (libraryId, albumId) => ipcRenderer.invoke(IPC.listTracks, libraryId, albumId),
  resolveStream: (track) => ipcRenderer.invoke(IPC.resolveStream, track),
  getVolume: () => ipcRenderer.invoke(IPC.getVolume),
  setVolume: (v) => ipcRenderer.invoke(IPC.setVolume, v),
  getPreferences: () => ipcRenderer.invoke(IPC.getPreferences),
  setCacheEnabled: (enabled) => ipcRenderer.invoke(IPC.setCacheEnabled, enabled),
  setCacheMaxBytes: (bytes) => ipcRenderer.invoke(IPC.setCacheMaxBytes, bytes),
  getCacheStats: () => ipcRenderer.invoke(IPC.getCacheStats),
  clearCache: () => ipcRenderer.invoke(IPC.clearCache),
};

contextBridge.exposeInMainWorld("musex", api);
