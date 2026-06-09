import type { Album, Artist, Library, Playlist, PlaylistTrack, SearchResults, Server, Track } from "../models/index";

export interface Pin {
  id: string;
  code: string;
  authUrl: string;
}

/** Auth, discovery and browse. Implemented in the main process (Node, no CORS)
 *  wrapping a Plex client; the token is passed explicitly by the caller. */
export interface PlexGateway {
  createPin(): Promise<Pin>;
  pollPin(id: string): Promise<{ authToken: string | null }>;
  listServers(token: string): Promise<Server[]>;
  listMusicLibraries(server: Server, token: string): Promise<Library[]>;
  listArtists(library: Library, token: string): Promise<Artist[]>;
  listAlbums(library: Library, artistId: string, token: string): Promise<Album[]>;
  listTracks(library: Library, albumId: string, token: string): Promise<Track[]>;
  search(library: Library, query: string, token: string): Promise<SearchResults>;
  listPlaylists(library: Library, token: string): Promise<Playlist[]>;
  listPlaylistTracks(playlistId: string, serverId: string, token: string): Promise<PlaylistTrack[]>;
  createPlaylist(library: Library, title: string, trackIds: string[], token: string): Promise<Playlist>;
  addToPlaylist(playlistId: string, serverId: string, trackIds: string[], token: string): Promise<void>;
  removeFromPlaylist(playlistId: string, serverId: string, playlistItemIds: string[], token: string): Promise<void>;
  renamePlaylist(playlistId: string, serverId: string, title: string, token: string): Promise<void>;
  deletePlaylist(playlistId: string, serverId: string, token: string): Promise<void>;
}

/** Thrown by a PlexGateway implementation when the Plex token is rejected (HTTP 401).
 *  Distinct from connectivity failures so callers can trigger re-auth instead of
 *  treating it as an offline server. */
export class PlexAuthError extends Error {
  constructor(message = "Plex authentication failed") {
    super(message);
    this.name = "PlexAuthError";
  }
}
