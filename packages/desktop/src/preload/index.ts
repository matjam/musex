import { contextBridge, ipcRenderer } from "electron";
import type { MusexApi, PlaybackEngineEvent, PluginNotification } from "../shared/ipc-contract.js";
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
  listPlaylistTracksPage: (playlistId, serverId, start, size) =>
    ipcRenderer.invoke(IPC.listPlaylistTracksPage, playlistId, serverId, start, size),
  listAllAlbums: (libraryId, sort, validator) =>
    ipcRenderer.invoke(IPC.listAllAlbums, libraryId, sort, validator),
  listAllTracks: (libraryId, sort, validator) =>
    ipcRenderer.invoke(IPC.listAllTracks, libraryId, sort, validator),
  listAllTracksPage: (libraryId, sort, start, size) =>
    ipcRenderer.invoke(IPC.listAllTracksPage, libraryId, sort, start, size),
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
  prefetch: (tracks) => ipcRenderer.invoke(IPC.prefetch, tracks),
  savePlaybackQueue: (tracks) => ipcRenderer.invoke(IPC.savePlaybackQueue, tracks),
  savePlaybackCursor: (cursor) => ipcRenderer.invoke(IPC.savePlaybackCursor, cursor),
  loadPlayback: () => ipcRenderer.invoke(IPC.loadPlayback),
  // Fire-and-forget notification (send, not invoke): playback transitions
  // feed the plugin events pipeline; the renderer never waits on it.
  playbackNowPlaying: (msg) => ipcRenderer.send(IPC.playbackNowPlaying, msg),
  playbackLoad: (args) => ipcRenderer.invoke(IPC.playbackLoad, args),
  playbackPreload: (url) => ipcRenderer.invoke(IPC.playbackPreload, url),
  playbackPlay: () => ipcRenderer.invoke(IPC.playbackPlay),
  playbackPause: () => ipcRenderer.invoke(IPC.playbackPause),
  playbackSeek: (sec) => ipcRenderer.invoke(IPC.playbackSeek, sec),
  playbackSetVolume: (v) => ipcRenderer.invoke(IPC.playbackSetVolume, v),
  onPlaybackEvent: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, evt: PlaybackEngineEvent) => cb(evt);
    ipcRenderer.on(IPC.playbackEvent, listener);
    return () => ipcRenderer.removeListener(IPC.playbackEvent, listener);
  },
  pluginsList: () => ipcRenderer.invoke(IPC.pluginsList),
  pluginsSetEnabled: (id, enabled) => ipcRenderer.invoke(IPC.pluginsSetEnabled, id, enabled),
  pluginsReload: () => ipcRenderer.invoke(IPC.pluginsReload),
  pluginsGetSettings: (id) => ipcRenderer.invoke(IPC.pluginsGetSettings, id),
  pluginsSetSetting: (id, key, value) => ipcRenderer.invoke(IPC.pluginsSetSetting, id, key, value),
  pluginsSettingsAction: (id, key) => ipcRenderer.invoke(IPC.pluginsSettingsAction, id, key),
  onPluginNotify: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, n: PluginNotification) => cb(n);
    ipcRenderer.on(IPC.pluginsNotify, listener);
    return () => ipcRenderer.removeListener(IPC.pluginsNotify, listener);
  },
};

contextBridge.exposeInMainWorld("musex", api);
