import type {
  Album,
  Artist,
  Library,
  LibrarySort,
  Pin,
  Playlist,
  PlaylistTrack,
  PlexGateway,
  SearchResults,
  Server,
  Track,
} from "@musex/core";
import { PlexAuthError, plexSort } from "@musex/core";
import { plexHeaders } from "../logic/plex-headers";
import {
  parseAlbums,
  parseArtists,
  parseLibraries,
  parsePlaylists,
  parsePlaylistTracks,
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
    return parseLibraries(json, server.id, server.name, server.owned, server.sourceTitle);
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

  /** A non-GET authenticated Plex request. Returns the Response (callers that
   *  need a body call res.json()); most mutations ignore it. */
  private async send(url: string, method: string, token: string): Promise<Response> {
    const res = await this.fetchFn(url, {
      method,
      headers: plexHeaders(this.clientId, { "X-Plex-Token": token }),
    });
    this.assertOk(res);
    return res;
  }

  private assertOk(res: Response): void {
    if (res.status === 401) throw new PlexAuthError();
    if (!res.ok) throw new Error(`Plex request failed: ${res.status}`);
  }

  // --- not implemented in Phase 1 (search/playlists/ratings are later phases) ---

  async search(library: Library, query: string, token: string): Promise<SearchResults> {
    const base = this.requireBase(library.serverId);
    const q = encodeURIComponent(query);
    const hit = (type: number) =>
      this.getJson(`${base}/library/sections/${library.id}/search?type=${type}&query=${q}`, token);
    const [a, al, t] = await Promise.all([hit(8), hit(9), hit(10)]);
    return {
      artists: parseArtists(a, library.serverId),
      albums: parseAlbums(al, library.serverId),
      tracks: parseTracks(t, library.serverId),
    };
  }
  async listPlaylists(library: Library, token: string): Promise<Playlist[]> {
    const base = this.requireBase(library.serverId);
    const json = await this.getJson(`${base}/playlists?playlistType=audio`, token);
    return parsePlaylists(json, library.serverId);
  }

  async listPlaylistTracks(
    playlistId: string,
    serverId: string,
    token: string,
  ): Promise<PlaylistTrack[]> {
    const base = this.requireBase(serverId);
    const json = await this.getJson(`${base}/playlists/${playlistId}/items`, token);
    return parsePlaylistTracks(json, serverId);
  }
  async createPlaylist(
    library: Library,
    title: string,
    trackIds: string[],
    token: string,
  ): Promise<Playlist> {
    const base = this.requireBase(library.serverId);
    const uri = `server://${library.serverId}/com.plexapp.plugins.library/library/metadata/${trackIds.join(",")}`;
    const res = await this.send(
      `${base}/playlists?type=audio&smart=0&title=${encodeURIComponent(title)}&uri=${encodeURIComponent(uri)}`,
      "POST",
      token,
    );
    const pl = parsePlaylists(await res.json(), library.serverId)[0];
    if (!pl) throw new Error("createPlaylist: server returned no playlist");
    return pl;
  }

  async addToPlaylist(
    playlistId: string,
    serverId: string,
    trackIds: string[],
    token: string,
  ): Promise<void> {
    const base = this.requireBase(serverId);
    const uri = `server://${serverId}/com.plexapp.plugins.library/library/metadata/${trackIds.join(",")}`;
    await this.send(
      `${base}/playlists/${playlistId}/items?uri=${encodeURIComponent(uri)}`,
      "PUT",
      token,
    );
  }

  async removeFromPlaylist(
    playlistId: string,
    serverId: string,
    playlistItemIds: string[],
    token: string,
  ): Promise<void> {
    const base = this.requireBase(serverId);
    for (const itemId of playlistItemIds) {
      await this.send(`${base}/playlists/${playlistId}/items/${itemId}`, "DELETE", token);
    }
  }

  async renamePlaylist(
    playlistId: string,
    serverId: string,
    title: string,
    token: string,
  ): Promise<void> {
    const base = this.requireBase(serverId);
    await this.send(
      `${base}/playlists/${playlistId}?title=${encodeURIComponent(title)}`,
      "PUT",
      token,
    );
  }

  async deletePlaylist(playlistId: string, serverId: string, token: string): Promise<void> {
    const base = this.requireBase(serverId);
    await this.send(`${base}/playlists/${playlistId}`, "DELETE", token);
  }
  async listAllAlbums(library: Library, sort: LibrarySort, token: string): Promise<Album[]> {
    const base = this.requireBase(library.serverId);
    const json = await this.getJson(
      `${base}/library/sections/${library.id}/all?type=9&sort=${plexSort(sort)}`,
      token,
    );
    return parseAlbums(json, library.serverId);
  }

  async listAllTracks(library: Library, sort: LibrarySort, token: string): Promise<Track[]> {
    const base = this.requireBase(library.serverId);
    const json = await this.getJson(
      `${base}/library/sections/${library.id}/all?type=10&sort=${plexSort(sort)}`,
      token,
    );
    return parseTracks(json, library.serverId);
  }

  /** All tracks for an artist (Plex allLeaves). Mobile-only — feeds the Artist
   *  action bar; not part of the core PlexGateway port. */
  async listArtistTracks(artistId: string, library: Library, token: string): Promise<Track[]> {
    const base = this.requireBase(library.serverId);
    const json = await this.getJson(`${base}/library/metadata/${artistId}/allLeaves`, token);
    return parseTracks(json, library.serverId);
  }
  listAllTracksPage(): Promise<{ items: Track[]; total: number }> {
    throw new Error("listAllTracksPage not implemented in Phase 1");
  }
  async rateItem(
    serverId: string,
    itemId: string,
    rating: number | null,
    token: string,
  ): Promise<void> {
    const base = this.requireBase(serverId);
    const r = rating ?? -1; // Plex unsets a rating with -1
    await this.send(
      `${base}/:/rate?key=${encodeURIComponent(itemId)}&identifier=com.plexapp.plugins.library&rating=${r}`,
      "PUT",
      token,
    );
  }

  async getUserRating(serverId: string, itemId: string, token: string): Promise<number | null> {
    const base = this.requireBase(serverId);
    const json = await this.getJson(`${base}/library/metadata/${itemId}`, token);
    const container =
      ((json as Record<string, unknown>)?.MediaContainer as Record<string, unknown>) ?? {};
    const meta = (Array.isArray(container.Metadata) ? container.Metadata[0] : null) as Record<
      string,
      unknown
    > | null;
    const rating = typeof meta?.userRating === "number" ? meta.userRating : null;
    return rating;
  }
}

function score(c: { local: boolean; relay: boolean }): number {
  if (c.local) return 0;
  if (!c.relay) return 1;
  return 2;
}
