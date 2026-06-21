// Adapters

export type { CachingGatewayOpts } from "./adapters/caching-plex-gateway";
export { CachingPlexGateway } from "./adapters/caching-plex-gateway";
// Design
export * from "./design/entity-state";
export * from "./design/tokens";

// Logic
export * from "./logic/az-index";
export * from "./logic/cache-eviction";
export * from "./logic/collage";
export * from "./logic/collect-pages";
export * from "./logic/discography-merge";
export * from "./logic/download-lookup";
export * from "./logic/download-plan";
export * from "./logic/download-state";
export * from "./logic/entity-ref";
export * from "./logic/external-url";
export * from "./logic/follow-service";
export * from "./logic/for-you";
export * from "./logic/format";
export * from "./logic/genres";
export * from "./logic/group-tracks-by-album";
export * from "./logic/lastfm-protocol";
export * from "./logic/library-select";
export * from "./logic/library-sort";
export * from "./logic/library-sync";
export * from "./logic/library-watch";
export * from "./logic/list-cache-keys";
export * from "./logic/list-validator";
export * from "./logic/mixes";
export * from "./logic/mood-mixes";
export * from "./logic/nav-history";
export * from "./logic/offline-availability";
export * from "./logic/play-monitor";
export * from "./logic/plex-mapping";
export * from "./logic/plugin-source";
export * from "./logic/radio";
export * from "./logic/rating";
export * from "./logic/recently-played";
export * from "./logic/smart-playlists";
export * from "./logic/taste-expansion";
export * from "./logic/taste-profile";
export * from "./logic/transcode-url";
export * from "./models/entity-ref";
export type {
  Album,
  Artist,
  Connection,
  Library,
  LibrarySort,
  MediaInfo,
  Playlist,
  PlaylistTrack,
  Queue,
  RepeatMode,
  SearchResults,
  Server,
  Track,
} from "./models/index";
export type { PlaybackState, PlaybackStatus } from "./playback/playback-session";
// Playback
export { PlaybackSession } from "./playback/playback-session";
// Ports
export type { FollowRecord, FollowStore } from "./ports/follow-store";
export type { Hasher } from "./ports/hasher";
export type { ListCache } from "./ports/list-cache";
export type { MonitorBackend } from "./ports/monitor-backend";
export type { PlaybackEngine } from "./ports/playback-engine";
export type { Pin, PlexGateway } from "./ports/plex-gateway";
export { OfflineUnavailable, PlexAuthError } from "./ports/plex-gateway";
export type { StreamKind, StreamRef, StreamResolver } from "./ports/stream-resolver";
export type { TokenStore } from "./ports/token-store";
export { buildQueue, carryRepeat } from "./usecases/build-queue";
export { createPlaylist } from "./usecases/create-playlist";
export type { LibraryDiscovery } from "./usecases/discover-libraries";
export { discoverMusicLibraries } from "./usecases/discover-libraries";
export { searchLibrary } from "./usecases/search-library";
export type { SignInDeps, SignInOptions, SignInResult } from "./usecases/sign-in";
// Use-cases
export { SignInTimeoutError, signIn } from "./usecases/sign-in";
