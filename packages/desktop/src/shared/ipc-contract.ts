import type { Album, Artist, Library, Server, StreamRef, Track } from "@musex/core";

export const IPC = {
  signInStart: "musex:signIn:start", // -> { code: string; authUrl: string }
  signInPoll: "musex:signIn:poll", // -> { status: 'pending' | 'ok' | 'error' }
  restoreSession: "musex:restoreSession", // -> { library: Library | null }
  discoverLibraries: "musex:discoverLibraries", // -> { libraries: Library[]; unreachable: Server[] }
  selectLibrary: "musex:selectLibrary", // (libraryId) -> void
  listArtists: "musex:listArtists", // (libraryId) -> Artist[]
  listAlbums: "musex:listAlbums", // (libraryId, artistId) -> Album[]
  listTracks: "musex:listTracks", // (libraryId, albumId) -> Track[]
  resolveStream: "musex:resolveStream", // (track) -> StreamRef
  getVolume: "musex:getVolume", // -> number
  setVolume: "musex:setVolume", // (v) -> void
  getPreferences: "musex:getPreferences", // -> Preferences
  setCacheEnabled: "musex:setCacheEnabled", // (boolean) -> void
  setCacheMaxBytes: "musex:setCacheMaxBytes", // (number bytes) -> void
  getCacheStats: "musex:getCacheStats", // -> CacheStats
  clearCache: "musex:clearCache", // -> { freedBytes: number }
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
  listArtists(libraryId: string): Promise<Artist[]>;
  listAlbums(libraryId: string, artistId: string): Promise<Album[]>;
  listTracks(libraryId: string, albumId: string): Promise<Track[]>;
  resolveStream(track: Track): Promise<StreamRef>;
  getVolume(): Promise<number>;
  setVolume(v: number): Promise<void>;
  getPreferences(): Promise<Preferences>;
  setCacheEnabled(enabled: boolean): Promise<void>;
  setCacheMaxBytes(bytes: number): Promise<void>;
  getCacheStats(): Promise<CacheStats>;
  clearCache(): Promise<ClearCacheResult>;
}
