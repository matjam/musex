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
import type { SettingField, SettingsActionResult, TrackInfo } from "@musex/plugin-api";

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
  rateItem: "musex:rateItem", // ({ serverId, itemId, rating, albumId?, libraryId?, trackInfo? }) -> void
  getUserRating: "musex:getUserRating", // (serverId, itemId) -> number | null
  getTasteSnapshot: "musex:getTasteSnapshot", // -> TasteSnapshotDto
  prefetch: "musex:prefetch", // (tracks: Track[]) -> void
  savePlaybackQueue: "musex:playback:saveQueue", // (tracks: Track[]) -> void
  savePlaybackCursor: "musex:playback:saveCursor", // (cursor: PlaybackCursorDto) -> void
  loadPlayback: "musex:playback:load", // -> LoadPlaybackResult
  playbackNowPlaying: "musex:playback:nowPlaying", // fire-and-forget renderer -> main NowPlayingMsg
  // mpv playback engine (main-process audio). NOTE: namespaced playbackEngine:*
  // because musex:playback:* is taken by queue/cursor persistence above.
  playbackLoad: "musex:playbackEngine:load", // ({ url, startSec? }) -> void (resolves on file-loaded)
  playbackPreload: "musex:playbackEngine:preload", // (url) -> void
  playbackPlay: "musex:playbackEngine:play", // -> void
  playbackPause: "musex:playbackEngine:pause", // -> void
  playbackSeek: "musex:playbackEngine:seek", // (sec) -> void
  playbackSetVolume: "musex:playbackEngine:setVolume", // (v 0..1) -> void
  playbackEvent: "musex:playbackEngine:event", // push: main -> renderer PlaybackEngineEvent
  // Plugin host (Settings → Plugins UI + toasts)
  pluginsList: "musex:plugins:list", // -> PluginInfo[]
  pluginsSetEnabled: "musex:plugins:setEnabled", // (id, enabled) -> void
  pluginsReload: "musex:plugins:reload", // -> void
  pluginsGetSettings: "musex:plugins:getSettings", // (id) -> PluginSettings
  pluginsSetSetting: "musex:plugins:setSetting", // (id, key, value) -> void
  pluginsSettingsAction: "musex:plugins:settingsAction", // (id, key) -> SettingsActionResult
  pluginsNotify: "musex:plugins:notify", // push: main -> renderer PluginNotification
  // Plugin contribution surfaces (sections / track actions / track detail)
  sectionsGet: "musex:sections:get", // (target) -> SectionDto[]
  trackActionsList: "musex:trackActions:list", // -> TrackActionDto[]
  trackActionsInvoke: "musex:trackActions:invoke", // (actionId, trackInfo) -> void
  trackDetailGet: "musex:trackDetail:get", // (trackInfo) -> TrackDetailDto[]
  openExternal: "musex:openExternal", // (url) -> void (http/https only)
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

/** One taste-profile track stat on the wire. `key` is the artist+title join
 *  key (lower(artist)␟lower(title)) — names aren't carried, the renderer joins
 *  against library tracks by key. Decayed values are computed in main. */
export type TrackStatDto = {
  key: string;
  plays: number;
  skips: number;
  lastPlayedMs: number;
  decayedPlays: number;
};
/** Taste profile snapshot for the renderer's smart playlists. */
export type TasteSnapshotDto = {
  stats: TrackStatDto[];
  topArtists: { name: string; score: number }[];
};

/** Engine events pushed main → renderer. Structurally identical to
 *  `logic/mpv-ipc.ts`'s EngineEvent — duplicated deliberately so preload and
 *  renderer never import from main-process logic. */
export type PlaybackEngineEvent =
  | { type: "position"; sec: number }
  | { type: "advanced" }
  | { type: "ended" }
  | { type: "error"; message: string };

// Plugin host surface. Settings vocabulary types come straight from the
// plugin API package; the contract only adds the IPC-specific shapes.
export type { SettingField, SettingsActionResult, TrackInfo } from "@musex/plugin-api";

/** Playback transitions the renderer session reports to main (fire-and-forget),
 *  feeding the PlaybackMonitor → plugin events pipeline. "start" means the
 *  track began *audibly* playing — a restore-paused track sends nothing until
 *  the user actually plays it. Carries only TrackInfo (no ids/URLs/tokens). */
export type NowPlayingMsg =
  | { kind: "start"; track: TrackInfo; atEpochSec: number }
  | { kind: "pause" }
  | { kind: "resume" }
  | { kind: "stop" };

export type PluginStatus = "active" | "error" | "disabled" | "incompatible";
export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  status: PluginStatus;
  error?: string;
}
export type PluginNotification = {
  pluginId: string;
  message: string;
  level: "info" | "error";
};
/** Values keyed by setting key. Password fields carry `{ set: boolean }`
 *  (presence only) — the secret itself NEVER crosses to the renderer. */
export type PluginSettings = { schema: SettingField[]; values: Record<string, unknown> };

// ── Plugin contribution surfaces (wire DTOs — plugins never see these; the
// host enriches plain plugin-api Section items with library-match results) ──

export type SectionTarget = "discover" | "home";
/** A plugin-api Section item + the host's library-match enrichment: matched
 *  items gain artistId/serverId (renderer navigates); unmatched are flagged
 *  external (badge + externalUrl link-out). */
export type SectionItemDto = {
  name: string;
  artistName?: string;
  imageUrl?: string;
  externalUrl?: string;
  artistId?: string;
  serverId?: string;
  external?: boolean;
};
export type SectionDto = { pluginId: string; title: string; items: SectionItemDto[] };
export type TrackActionDto = { pluginId: string; id: string; label: string; icon?: string };
export type TrackDetailDto = {
  pluginId: string;
  title: string;
  rows: { label: string; value: string }[];
};

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
  /** Set a Plex userRating (0–10, integer; null clears). albumId/libraryId, when
   *  known, let main evict the exact list caches the rated item appears in.
   *  trackInfo, when supplied (track ratings only), makes main fire the
   *  `trackRated` plugin event and feed the taste profile. artistName, when
   *  supplied (artist ratings only), feeds the taste profile's artist affinity. */
  rateItem(args: {
    serverId: string;
    itemId: string;
    rating: number | null;
    albumId?: string;
    libraryId?: string;
    trackInfo?: TrackInfo;
    artistName?: string;
  }): Promise<void>;
  /** Read an item's current Plex userRating (0–10), or null when unrated. */
  getUserRating(serverId: string, itemId: string): Promise<number | null>;
  /** Taste-profile snapshot (track stats + artist affinity) for smart playlists. */
  getTasteSnapshot(): Promise<TasteSnapshotDto>;
  prefetch(tracks: Track[]): Promise<void>;
  savePlaybackQueue(tracks: Track[]): Promise<void>;
  savePlaybackCursor(cursor: PlaybackCursorDto): Promise<void>;
  loadPlayback(): Promise<LoadPlaybackResult>;
  /** Fire-and-forget (ipcRenderer.send) — playback transition notification. */
  playbackNowPlaying(msg: NowPlayingMsg): void;
  playbackLoad(args: { url: string; startSec?: number }): Promise<void>;
  playbackPreload(url: string): Promise<void>;
  playbackPlay(): Promise<void>;
  playbackPause(): Promise<void>;
  playbackSeek(sec: number): Promise<void>;
  playbackSetVolume(v: number): Promise<void>;
  /** Subscribe to engine events; returns an unsubscribe function. */
  onPlaybackEvent(cb: (e: PlaybackEngineEvent) => void): () => void;
  pluginsList(): Promise<PluginInfo[]>;
  pluginsSetEnabled(id: string, enabled: boolean): Promise<void>;
  pluginsReload(): Promise<void>;
  pluginsGetSettings(id: string): Promise<PluginSettings>;
  pluginsSetSetting(id: string, key: string, value: unknown): Promise<void>;
  pluginsSettingsAction(id: string, key: string): Promise<SettingsActionResult>;
  /** Subscribe to plugin toast notifications; returns an unsubscribe function. */
  onPluginNotify(cb: (n: PluginNotification) => void): () => void;
  sectionsGet(target: SectionTarget): Promise<SectionDto[]>;
  trackActionsList(): Promise<TrackActionDto[]>;
  trackActionsInvoke(actionId: string, track: TrackInfo): Promise<void>;
  trackDetailGet(track: TrackInfo): Promise<TrackDetailDto[]>;
  /** Open an http(s) URL in the system browser (validated in main). */
  openExternal(url: string): Promise<void>;
}
