import type {
  Album,
  Artist,
  Library,
  LibrarySort,
  Playlist,
  PlaylistTrack,
  Queue,
  RepeatMode,
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
  listPlaylistTracksPage: "musex:listPlaylistTracksPage", // (playlistId, serverId, start, size) -> { items: PlaylistTrack[]; total: number }
  listAllAlbums: "musex:listAllAlbums", // (libraryId, sort, validator?) -> Album[]
  listAllTracks: "musex:listAllTracks", // (libraryId, sort, validator?) -> Track[]
  listAllTracksPage: "musex:listAllTracksPage", // (libraryId, sort, start, size) -> { items: Track[]; total: number }
  createPlaylist: "musex:createPlaylist", // (libraryId, title, trackIds) -> Playlist
  addToPlaylist: "musex:addToPlaylist", // (playlistId, serverId, trackIds) -> void
  removeFromPlaylist: "musex:removeFromPlaylist", // (playlistId, serverId, playlistItemIds) -> void
  renamePlaylist: "musex:renamePlaylist", // (playlistId, serverId, title) -> void
  deletePlaylist: "musex:deletePlaylist", // (playlistId, serverId) -> void
  prefetch: "musex:prefetch", // (tracks: Track[]) -> void
  savePlaybackQueue: "musex:playback:saveQueue", // (tracks: Track[]) -> void
  savePlaybackCursor: "musex:playback:saveCursor", // (cursor: PlaybackCursorDto) -> void
  loadPlayback: "musex:playback:load", // -> LoadPlaybackResult
  // mpv playback engine (main-process audio). NOTE: namespaced playbackEngine:*
  // because musex:playback:* is taken by queue/cursor persistence above.
  playbackLoad: "musex:playbackEngine:load", // ({ url, startSec? }) -> void (resolves on file-loaded)
  playbackPreload: "musex:playbackEngine:preload", // (url) -> void
  playbackPlay: "musex:playbackEngine:play", // -> void
  playbackPause: "musex:playbackEngine:pause", // -> void
  playbackSeek: "musex:playbackEngine:seek", // (sec) -> void
  playbackSetVolume: "musex:playbackEngine:setVolume", // (v 0..1) -> void
  playbackEvent: "musex:playbackEngine:event", // push: main -> renderer PlaybackEngineEvent
} as const;

export type SignInStartResult = { code: string; authUrl: string };
export type SignInPollResult = { status: "pending" | "ok" | "error"; message?: string };
export type DiscoverResult = { libraries: Library[]; unreachable: Server[] };

export type RestoreSessionResult = { library: Library | null };
export type Preferences = { cacheEnabled: boolean; cacheMaxBytes: number };
export type CacheStats = { bytes: number; files: number };
export type ClearCacheResult = { freedBytes: number };
export type PlaybackCursorDto = {
  index: number;
  positionSec: number;
  shuffle: boolean;
  repeat: RepeatMode;
};
export type LoadPlaybackResult = { queue: Queue; positionSec: number } | null;

/** Engine events pushed main → renderer. Structurally identical to
 *  `logic/mpv-ipc.ts`'s EngineEvent — duplicated deliberately so preload and
 *  renderer never import from main-process logic. */
export type PlaybackEngineEvent =
  | { type: "position"; sec: number }
  | { type: "advanced" }
  | { type: "ended" }
  | { type: "error"; message: string };

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
  listPlaylistTracksPage(
    playlistId: string,
    serverId: string,
    start: number,
    size: number,
  ): Promise<{ items: PlaylistTrack[]; total: number }>;
  listAllAlbums(libraryId: string, sort: LibrarySort, validator?: string): Promise<Album[]>;
  listAllTracks(libraryId: string, sort: LibrarySort, validator?: string): Promise<Track[]>;
  listAllTracksPage(
    libraryId: string,
    sort: LibrarySort,
    start: number,
    size: number,
  ): Promise<{ items: Track[]; total: number }>;
  createPlaylist(libraryId: string, title: string, trackIds: string[]): Promise<Playlist>;
  addToPlaylist(playlistId: string, serverId: string, trackIds: string[]): Promise<void>;
  removeFromPlaylist(
    playlistId: string,
    serverId: string,
    playlistItemIds: string[],
  ): Promise<void>;
  renamePlaylist(playlistId: string, serverId: string, title: string): Promise<void>;
  deletePlaylist(playlistId: string, serverId: string): Promise<void>;
  prefetch(tracks: Track[]): Promise<void>;
  savePlaybackQueue(tracks: Track[]): Promise<void>;
  savePlaybackCursor(cursor: PlaybackCursorDto): Promise<void>;
  loadPlayback(): Promise<LoadPlaybackResult>;
  playbackLoad(args: { url: string; startSec?: number }): Promise<void>;
  playbackPreload(url: string): Promise<void>;
  playbackPlay(): Promise<void>;
  playbackPause(): Promise<void>;
  playbackSeek(sec: number): Promise<void>;
  playbackSetVolume(v: number): Promise<void>;
  /** Subscribe to engine events; returns an unsubscribe function. */
  onPlaybackEvent(cb: (e: PlaybackEngineEvent) => void): () => void;
}
