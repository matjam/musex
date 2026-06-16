import type {
  Album,
  Artist,
  Library,
  LibrarySort,
  Pin,
  PlaylistTrack,
  PlexGateway,
  SearchResults,
  Server,
  Track,
} from "@musex/core";
import { PlexAuthError } from "@musex/core";
import { plexHeaders } from "../logic/plex-headers";
import {
  parseAlbums,
  parseArtists,
  parseLibraries,
  parseServers,
  parseTracks,
} from "../logic/plex-parse";

const PLEX_TV = "https://plex.tv";
const PROBE_TIMEOUT_MS = 4000;

type FetchFn = typeof fetch;

/** Phase 1 PlexGateway. Implements auth + browse only; unimplemented methods
 *  throw so the type is satisfied without pretending to support them yet. */
export class PlexGatewayImpl implements PlexGateway {
  private baseUrlByServer = new Map<string, string>();

  constructor(
    private readonly fetchFn: FetchFn,
    private readonly clientId: string,
  ) {}

  // --- auth ---

  async createPin(): Promise<Pin> {
    const res = await this.fetchFn(`${PLEX_TV}/api/v2/pins?strong=true`, {
      method: "POST",
      headers: plexHeaders(this.clientId),
    });
    this.assertOk(res);
    const j = (await res.json()) as { id: number; code: string };
    return {
      id: String(j.id),
      code: j.code,
      authUrl: `https://app.plex.tv/auth#?clientID=${encodeURIComponent(
        this.clientId,
      )}&code=${encodeURIComponent(j.code)}&context%5Bdevice%5D%5Bproduct%5D=musex`,
    };
  }

  async pollPin(id: string): Promise<{ authToken: string | null }> {
    const res = await this.fetchFn(`${PLEX_TV}/api/v2/pins/${id}`, {
      headers: plexHeaders(this.clientId),
    });
    this.assertOk(res);
    const j = (await res.json()) as { authToken: string | null };
    return { authToken: j.authToken ?? null };
  }

  // --- discovery ---

  async listServers(token: string): Promise<Server[]> {
    const res = await this.fetchFn(`${PLEX_TV}/api/v2/resources?includeHttps=1&includeRelay=1`, {
      headers: plexHeaders(this.clientId, { "X-Plex-Token": token }),
    });
    this.assertOk(res);
    return parseServers(await res.json());
  }

  async listMusicLibraries(server: Server, token: string): Promise<Library[]> {
    const base = await this.resolveBaseUrl(server, token);
    const json = await this.getJson(`${base}/library/sections`, token);
    return parseLibraries(json, server.id, server.name);
  }

  async listArtists(library: Library, token: string): Promise<Artist[]> {
    const base = this.requireBase(library.serverId);
    const json = await this.getJson(`${base}/library/sections/${library.id}/all?type=8`, token);
    return parseArtists(json, library.serverId);
  }

  async listAlbums(library: Library, artistId: string, token: string): Promise<Album[]> {
    const base = this.requireBase(library.serverId);
    const json = await this.getJson(`${base}/library/metadata/${artistId}/children`, token);
    return parseAlbums(json, library.serverId);
  }

  async listTracks(library: Library, albumId: string, token: string): Promise<Track[]> {
    const base = this.requireBase(library.serverId);
    const json = await this.getJson(`${base}/library/metadata/${albumId}/children`, token);
    return parseTracks(json, library.serverId);
  }

  /** Returns the base url a Track's StreamResolver should use. */
  baseUrlFor(serverId: string): string {
    return this.requireBase(serverId);
  }

  // --- internals ---

  private async resolveBaseUrl(server: Server, token: string): Promise<string> {
    const cached = this.baseUrlByServer.get(server.id);
    if (cached) return cached;
    // Preference: local, then remote (non-relay), then relay.
    const ordered = [...server.connections].sort((a, b) => score(a) - score(b));
    for (const conn of ordered) {
      if (await this.reachable(conn.uri, token)) {
        this.baseUrlByServer.set(server.id, conn.uri);
        return conn.uri;
      }
    }
    throw new Error(`No reachable connection for server ${server.name}`);
  }

  private async reachable(uri: string, token: string): Promise<boolean> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await this.fetchFn(`${uri}/`, {
        headers: plexHeaders(this.clientId, { "X-Plex-Token": token }),
        signal: ctrl.signal,
      });
      if (res.status === 401) throw new PlexAuthError();
      return res.ok;
    } catch (err) {
      if (err instanceof PlexAuthError) throw err;
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private requireBase(serverId: string): string {
    const base = this.baseUrlByServer.get(serverId);
    if (!base) throw new Error(`Server ${serverId} not connected; call listMusicLibraries first`);
    return base;
  }

  private async getJson(url: string, token: string): Promise<unknown> {
    const res = await this.fetchFn(url, {
      headers: plexHeaders(this.clientId, { "X-Plex-Token": token }),
    });
    this.assertOk(res);
    return res.json();
  }

  private assertOk(res: Response): void {
    if (res.status === 401) throw new PlexAuthError();
    if (!res.ok) throw new Error(`Plex request failed: ${res.status}`);
  }

  // --- not implemented in Phase 1 (search/playlists/ratings are later phases) ---

  search(): Promise<SearchResults> {
    throw new Error("search not implemented in Phase 1");
  }
  listPlaylists(): Promise<never> {
    throw new Error("playlists not implemented in Phase 1");
  }
  listPlaylistTracks(): Promise<PlaylistTrack[]> {
    throw new Error("playlists not implemented in Phase 1");
  }
  createPlaylist(): Promise<never> {
    throw new Error("playlists not implemented in Phase 1");
  }
  addToPlaylist(): Promise<void> {
    throw new Error("playlists not implemented in Phase 1");
  }
  removeFromPlaylist(): Promise<void> {
    throw new Error("playlists not implemented in Phase 1");
  }
  renamePlaylist(): Promise<void> {
    throw new Error("playlists not implemented in Phase 1");
  }
  deletePlaylist(): Promise<void> {
    throw new Error("playlists not implemented in Phase 1");
  }
  listAllAlbums(_l: Library, _s: LibrarySort, _t: string): Promise<Album[]> {
    throw new Error("listAllAlbums not implemented in Phase 1");
  }
  listAllTracks(_l: Library, _s: LibrarySort, _t: string): Promise<Track[]> {
    throw new Error("listAllTracks not implemented in Phase 1");
  }
  listAllTracksPage(): Promise<{ items: Track[]; total: number }> {
    throw new Error("listAllTracksPage not implemented in Phase 1");
  }
  rateItem(): Promise<void> {
    throw new Error("rateItem not implemented in Phase 1");
  }
  getUserRating(): Promise<number | null> {
    throw new Error("getUserRating not implemented in Phase 1");
  }
}

function score(c: { local: boolean; relay: boolean }): number {
  if (c.local) return 0;
  if (!c.relay) return 1;
  return 2;
}
