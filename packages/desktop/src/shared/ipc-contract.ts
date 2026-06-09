import type {
  Album,
  Artist,
  Library,
  Playlist,
  PlaylistTrack,
  SearchResults,
  Server,
  StreamRef,
  Track,
} from "@musex/core";

export const IPC = {
  signInStart: "musex:signIn:start", // -> { code: string; authUrl: string }
  signInPoll: "musex:signIn:poll", // -> { status: 'pending' | 'ok' | 'error' }
  restoreSession: "musex:restoreSession", // -> { library: Library | null }
  discoverLibraries: "musex:discoverLibraries", // -> { libraries: Library[]; unreachable: Server[] }
  selectLibrary: "musex:selectLibrary", // (libraryId) -> void
  listArtists: "musex:listArtists", // (libraryId) -> Artist[]
  listAlbums: "musex:listAlbums", // (libraryId, artistId) -> Album[]
  listTracks: "musex:listTracks", // (libraryId, albumId) -> Track[]
  search: "musex:search", // (libraryId, query) -> SearchResults
  resolveStream: "musex:resolveStream", // (track) -> StreamRef
  getVolume: "musex:getVolume", // -> number
  setVolume: "musex:setVolume", // (v) -> void
  getPreferences: "musex:getPreferences", // -> Preferences
  setCacheEnabled: "musex:setCacheEnabled", // (boolean) -> void
  setCacheMaxBytes: "musex:setCacheMaxBytes", // (number bytes) -> void
  getCacheStats: "musex:getCacheStats", // -> CacheStats
  clearCache: "musex:clearCache", // -> { freedBytes: number }
  listPlaylists: "musex:listPlaylists", // (libraryId) -> Playlist[]
  listPlaylistTracks: "musex:listPlaylistTracks", // (playlistId, serverId) -> PlaylistTrack[]
  createPlaylist: "musex:createPlaylist", // (libraryId, title, trackIds) -> Playlist
  addToPlaylist: "musex:addToPlaylist", // (playlistId, serverId, trackIds) -> void
  removeFromPlaylist: "musex:removeFromPlaylist", // (playlistId, serverId, playlistItemIds) -> void
  renamePlaylist: "musex:renamePlaylist", // (playlistId, serverId, title) -> void
  deletePlaylist: "musex:deletePlaylist", // (playlistId, serverId) -> void
} as const;

export type SignInStartResult = { code: string; authUrl: string };
export type SignInPollResult = { status: "pending" | "ok" | "error"; message?: string };
export type DiscoverResult = { libraries: Library[]; unreachable: Server[] };

export type RestoreSessionResult = { library: Library | null };
export type Preferences = { cacheEnabled: boolean; cacheMaxBytes: number };
export type CacheStats = { bytes: number; files: number };
export type ClearCacheResult = { freedBytes: number };

/** The API exposed on window.musex by the preload bridge. */
export interface MusexApi {
  signInStart(): Promise<SignInStartResult>;
  signInPoll(): Promise<SignInPollResult>;
  restoreSession(): Promise<RestoreSessionResult>;
  discoverLibraries(): Promise<DiscoverResult>;
  selectLibrary(libraryId: string): Promise<void>;
  listArtists(libraryId: string, validator?: string): Promise<Artist[]>;
  listAlbums(libraryId: string, artistId: string, validator?: string): Promise<Album[]>;
  listTracks(libraryId: string, albumId: string, validator?: string): Promise<Track[]>;
  search(libraryId: string, query: string): Promise<SearchResults>;
  resolveStream(track: Track): Promise<StreamRef>;
  getVolume(): Promise<number>;
  setVolume(v: number): Promise<void>;
  getPreferences(): Promise<Preferences>;
  setCacheEnabled(enabled: boolean): Promise<void>;
  setCacheMaxBytes(bytes: number): Promise<void>;
  getCacheStats(): Promise<CacheStats>;
  clearCache(): Promise<ClearCacheResult>;
  listPlaylists(libraryId: string): Promise<Playlist[]>;
  listPlaylistTracks(
    playlistId: string,
    serverId: string,
    validator?: string,
  ): Promise<PlaylistTrack[]>;
  createPlaylist(libraryId: string, title: string, trackIds: string[]): Promise<Playlist>;
  addToPlaylist(playlistId: string, serverId: string, trackIds: string[]): Promise<void>;
  removeFromPlaylist(
    playlistId: string,
    serverId: string,
    playlistItemIds: string[],
  ): Promise<void>;
  renamePlaylist(playlistId: string, serverId: string, title: string): Promise<void>;
  deletePlaylist(playlistId: string, serverId: string): Promise<void>;
}
