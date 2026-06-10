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
import type {
  AcquirableAlbum,
  AcquisitionState,
  AcquisitionStatusItem,
  ExternalArtistResult,
  SettingField,
  SettingsActionResult,
  TrackInfo,
} from "@musex/plugin-api";

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
  rateItem: "musex:rateItem", // ({ serverId, itemId, rating, albumId?, artistId?, libraryId?, trackInfo? }) -> void
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
  similarGet: "musex:similar:get", // (SimilarGetArgs) -> SectionItemDto[]
  // Acquisition (e.g. Lidarr): external-artist discography + Downloads view
  acquisitionAvailable: "musex:acquisition:available", // -> boolean
  acquisitionLookupArtist: "musex:acquisition:lookupArtist", // (artistName) -> AcquirableAlbumDto[]
  acquisitionAcquire: "musex:acquisition:acquire", // ({ providerId, providerRef }) -> void
  acquisitionStatus: "musex:acquisition:status", // -> AcquisitionStatusDto[]
  acquisitionSearchArtists: "musex:acquisition:searchArtists", // (term) -> ExternalArtistResultDto[]
  acquisitionAcquireArtist: "musex:acquisition:acquireArtist", // ({ providerId, providerRef }) -> void
  acquisitionAcquireArtistByName: "musex:acquisition:acquireArtistByName", // (artistName) -> void
  openExternal: "musex:openExternal", // (url) -> void (http/https only)
  radioNext: "musex:radio:next", // (RadioNextArgs) -> Track[]
  navigateTo: "musex:navigateTo", // push: main -> renderer NavigateToPayload (app menu navigation)
  logsGet: "musex:logs:get", // -> LogEntryDto[] (snapshot of the in-memory ring buffer)
  logsAppend: "musex:logs:append", // (RendererLogEntry[]) -> void (renderer console forwarding)
  logsEvent: "musex:logs:event", // push: main -> renderer LogEntryDto (live viewer updates)
  expansionGetState: "musex:expansion:getState", // -> ExpansionStateDto
  expansionSetPrefs: "musex:expansion:setPrefs", // (ExpansionPrefsDto) -> void
  expansionRunNow: "musex:expansion:runNow", // -> ExpansionStateDto (after the cycle)
  expansionReject: "musex:expansion:reject", // (artistName) -> void ("Not for me")
  newReleaseWatchGet: "musex:watch:get", // (artistName) -> boolean | null (null = unsupported)
  newReleaseWatchSet: "musex:watch:set", // (artistName, enabled) -> void
  newReleaseWatchList: "musex:watch:list", // -> string[] (watched artist names)
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
  /** Last track rating (1–5 stars); null = unrated. */
  ratingStars: number | null;
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
export type {
  AcquisitionState,
  ExternalArtistResult,
  SettingField,
  SettingsActionResult,
  TrackInfo,
} from "@musex/plugin-api";

/** A plugin-api AcquirableAlbum + the host's enrichment: every item carries
 *  the providerId that produced it (acquire routes back to it); state is
 *  widened to include "owned" (host library cross-check), and owned items
 *  gain albumId/artistId/serverId so the renderer can navigate into the
 *  library. Non-owned imageUrls are baked through the proxy's /ext endpoint. */
export type AcquirableAlbumDto = Omit<AcquirableAlbum, "state"> & {
  state: AcquisitionState;
  providerId: string;
  albumId?: string;
  artistId?: string;
  serverId?: string;
};

/** One Downloads-view row, tagged with the providing plugin. */
export type AcquisitionStatusDto = AcquisitionStatusItem & { providerId: string };

/** A plugin-api ExternalArtistResult + the host's providerId tag (monitor
 *  routes back to it). imageUrls are baked through the proxy's /ext endpoint. */
export type ExternalArtistResultDto = ExternalArtistResult & { providerId: string };

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
/** Main → renderer navigation push (application menu items). Deliberately a
 *  narrow union — widen as more menu entries need to deep-link into the UI. */
export type NavigateToPayload =
  | { view: "settings"; section?: "shortcuts" }
  | { view: "about" }
  | { view: "logs" };

// ---- Unified log buffer (Help → Show Logs) ----

export type LogLevel = "debug" | "log" | "info" | "warn" | "error";

export interface LogEntryDto {
  ts: number; // epoch ms
  source: "main" | "renderer";
  level: LogLevel;
  text: string;
}

/** What the renderer's console-forwarder sends; main stamps source. */
export interface RendererLogEntry {
  ts: number;
  level: LogLevel;
  text: string;
}

// ---- Taste expansion (optimistic acquisition) ----

export type ExpansionPrefsDto = {
  enabled: boolean;
  /** Weekly acquisition budget (albums). */
  albumsPerWeek: number;
  /** Conservative → aggressive slider, 0–100. */
  aggressiveness: number;
};

export type ExpansionEntryDto = {
  artistName: string;
  albumTitle: string;
  state: "suggested" | "requested" | "landed" | "abandoned" | "rejected";
  deepening: boolean;
  retried: boolean;
  provenance: { seed: string; match: number; hop: 1 | 2; via?: string };
  note?: string;
  createdAt: number;
  requestedAt?: number;
  landedAt?: number;
  abandonedAt?: number;
  rejectedAt?: number;
};

export type ExpansionStateDto = {
  prefs: ExpansionPrefsDto;
  running: boolean;
  lastRunAt: number | null;
  lastSummary: string | null;
  /** Which provider capabilities are present (drives the status line). */
  available: { similar: boolean; acquisition: boolean };
  /** Newest first. */
  entries: ExpansionEntryDto[];
};

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
 *  external (badge + externalUrl link-out). Similar-SONGS items resolved to an
 *  owned library track additionally carry the full playable `track` (baked
 *  thumb) — a wire-DTO-only field; plugins never see it. */
export type SectionItemDto = {
  name: string;
  artistName?: string;
  imageUrl?: string;
  externalUrl?: string;
  artistId?: string;
  serverId?: string;
  external?: boolean;
  track?: Track;
};

/** Similar side panel request: an artist page's name, or a track's seed. */
export type SimilarGetArgs =
  | { kind: "artist"; name: string }
  | { kind: "track"; title: string; artist: string };
export type SectionDto = { pluginId: string; title: string; items: SectionItemDto[] };
export type TrackActionDto = { pluginId: string; id: string; label: string; icon?: string };
export type TrackDetailDto = {
  pluginId: string;
  title: string;
  rows: { label: string; value: string }[];
};

/** Radio refill request: seeds + everything already queued/recently played
 *  (never re-suggested), and how many tracks the renderer wants back. */
export type RadioNextArgs = {
  seedTracks: { title: string; artist: string }[];
  seedArtists: string[];
  exclude: { title: string; artist: string }[];
  count: number;
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
  /** Set a Plex userRating (0–10, integer; null clears). albumId/artistId/libraryId,
   *  when known, let main evict the exact list caches the rated item appears in
   *  (albumId for track ratings, artistId for album ratings).
   *  trackInfo, when supplied (track ratings only), makes main fire the
   *  `trackRated` plugin event and feed the taste profile. artistName, when
   *  supplied (artist ratings only), feeds the taste profile's artist affinity. */
  rateItem(args: {
    serverId: string;
    itemId: string;
    rating: number | null;
    albumId?: string;
    artistId?: string;
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
  /** Similar panel: fan out to plugin similar-providers, match/resolve items
   *  against the library (owned items navigate/play; the rest are external). */
  similarGet(args: SimilarGetArgs): Promise<SectionItemDto[]>;
  /** True when any plugin registered an AcquisitionProvider. */
  acquisitionAvailable(): Promise<boolean>;
  /** External-artist discography: first provider with results wins; items are
   *  owned-cross-checked against the library and art is proxy-baked. */
  acquisitionLookupArtist(artistName: string): Promise<AcquirableAlbumDto[]>;
  /** Request an album from the provider that produced the lookup item. */
  acquisitionAcquire(args: { providerId: string; providerRef: string }): Promise<void>;
  /** Downloads view: merged status rows from every acquisition provider. */
  acquisitionStatus(): Promise<AcquisitionStatusDto[]>;
  /** Federated external artist search: first provider with results wins;
   *  artwork is proxy-baked. */
  acquisitionSearchArtists(term: string): Promise<ExternalArtistResultDto[]>;
  /** Monitor EVERYTHING by the artist (whole discography + search) via the
   *  provider that produced the search result. */
  acquisitionAcquireArtist(args: { providerId: string; providerRef: string }): Promise<void>;
  /** Monitor an entire artist by name (External Artist view — name only). */
  acquisitionAcquireArtistByName(artistName: string): Promise<void>;
  /** Open an http(s) URL in the system browser (validated in main). */
  openExternal(url: string): Promise<void>;
  /** Radio refill: fan out to plugin recommenders, resolve suggestions against
   *  the library, return playable tracks (proxy-baked thumbs). May be empty. */
  radioNext(args: RadioNextArgs): Promise<Track[]>;
  /** Subscribe to app-menu navigation pushes; returns an unsubscribe function. */
  onNavigateTo(cb: (p: NavigateToPayload) => void): () => void;
  /** Snapshot of the unified in-memory log buffer (main + renderer lines). */
  logsGet(): Promise<LogEntryDto[]>;
  /** Forward batched renderer console lines into the main-process buffer. */
  logsAppend(entries: RendererLogEntry[]): Promise<void>;
  /** Subscribe to live log appends; returns an unsubscribe function. */
  onLogsEvent(cb: (e: LogEntryDto) => void): () => void;
  /** Taste expansion: prefs + status + the attempt ledger feed. */
  expansionGetState(): Promise<ExpansionStateDto>;
  expansionSetPrefs(prefs: ExpansionPrefsDto): Promise<void>;
  /** Run a cycle immediately (budget still applies); resolves when done. */
  expansionRunNow(): Promise<ExpansionStateDto>;
  /** "Not for me": blacklist the artist + unmonitor whatever was requested. */
  expansionReject(artistName: string): Promise<void>;
  /** Per-artist "fetch new releases" watch; null = no provider supports it. */
  newReleaseWatchGet(artistName: string): Promise<boolean | null>;
  newReleaseWatchSet(artistName: string, enabled: boolean): Promise<void>;
  newReleaseWatchList(): Promise<string[]>;
}
