import { contextBridge, ipcRenderer } from "electron";
import type { MusexApi } from "../shared/ipc-contract.js";
import { IPC } from "../shared/ipc-contract.js";

const api: MusexApi = {
  signInStart: () => ipcRenderer.invoke(IPC.signInStart),
  signInPoll: () => ipcRenderer.invoke(IPC.signInPoll),
  restoreSession: () => ipcRenderer.invoke(IPC.restoreSession),
  discoverLibraries: () => ipcRenderer.invoke(IPC.discoverLibraries),
  selectLibrary: (libraryId) => ipcRenderer.invoke(IPC.selectLibrary, libraryId),
  listArtists: (libraryId, validator) => ipcRenderer.invoke(IPC.listArtists, libraryId, validator),
  listAlbums: (libraryId, artistId, validator) =>
    ipcRenderer.invoke(IPC.listAlbums, libraryId, artistId, validator),
  listTracks: (libraryId, albumId, validator) =>
    ipcRenderer.invoke(IPC.listTracks, libraryId, albumId, validator),
  search: (libraryId, query) => ipcRenderer.invoke(IPC.search, libraryId, query),
  resolveStream: (track) => ipcRenderer.invoke(IPC.resolveStream, track),
  getVolume: () => ipcRenderer.invoke(IPC.getVolume),
  setVolume: (v) => ipcRenderer.invoke(IPC.setVolume, v),
  getPreferences: () => ipcRenderer.invoke(IPC.getPreferences),
  setCacheEnabled: (enabled) => ipcRenderer.invoke(IPC.setCacheEnabled, enabled),
  setCacheMaxBytes: (bytes) => ipcRenderer.invoke(IPC.setCacheMaxBytes, bytes),
  getCacheStats: () => ipcRenderer.invoke(IPC.getCacheStats),
  clearCache: () => ipcRenderer.invoke(IPC.clearCache),
  listPlaylists: (libraryId) => ipcRenderer.invoke(IPC.listPlaylists, libraryId),
  listPlaylistTracks: (playlistId, serverId, validator) =>
    ipcRenderer.invoke(IPC.listPlaylistTracks, playlistId, serverId, validator),
  createPlaylist: (libraryId, title, trackIds) =>
    ipcRenderer.invoke(IPC.createPlaylist, libraryId, title, trackIds),
  addToPlaylist: (playlistId, serverId, trackIds) =>
    ipcRenderer.invoke(IPC.addToPlaylist, playlistId, serverId, trackIds),
  removeFromPlaylist: (playlistId, serverId, playlistItemIds) =>
    ipcRenderer.invoke(IPC.removeFromPlaylist, playlistId, serverId, playlistItemIds),
  renamePlaylist: (playlistId, serverId, title) =>
    ipcRenderer.invoke(IPC.renamePlaylist, playlistId, serverId, title),
  deletePlaylist: (playlistId, serverId) =>
    ipcRenderer.invoke(IPC.deletePlaylist, playlistId, serverId),
};

contextBridge.exposeInMainWorld("musex", api);
