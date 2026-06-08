import type { Album, Artist, Library, Server, Track } from "../models/index";

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
}
