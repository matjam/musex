// Models

// Logic
export * from "./logic/az-index";
export * from "./logic/collage";
export * from "./logic/discography-merge";
export * from "./logic/download-plan";
export * from "./logic/download-state";
export * from "./logic/external-url";
export * from "./logic/for-you";
export * from "./logic/format";
export * from "./logic/genres";
export * from "./logic/group-tracks-by-album";
export * from "./logic/library-select";
export * from "./logic/library-sort";
export * from "./logic/library-watch";
export * from "./logic/list-validator";
export * from "./logic/mood-mixes";
export * from "./logic/nav-history";
export * from "./logic/offline-availability";
export * from "./logic/play-monitor";
export * from "./logic/plex-mapping";
export * from "./logic/recently-played";
export * from "./logic/smart-playlists";
export * from "./logic/taste-expansion";
export * from "./logic/taste-profile";
export * from "./logic/transcode-url";
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
export type { PlaybackEngine } from "./ports/playback-engine";
// Ports
export type { Pin, PlexGateway } from "./ports/plex-gateway";
export { PlexAuthError } from "./ports/plex-gateway";
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
