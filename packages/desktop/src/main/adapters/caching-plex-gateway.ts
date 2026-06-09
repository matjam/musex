import type {
  Album,
  Artist,
  Library,
  Pin,
  Playlist,
  PlaylistTrack,
  PlexGateway,
  SearchResults,
  Server,
  Track,
} from "@musex/core";
import type { ListCacheStore } from "./list-cache-store.js";

/** A PlexGateway that caches item-heavy list results keyed by a caller-supplied
 *  validator, and invalidates on mutations. Transparent: same port surface
 *  (cached methods take an extra optional `validator`), plus the non-port
 *  `endpoint()` that Runtime relies on. */
export class CachingPlexGateway implements PlexGateway {
  constructor(
    private readonly inner: PlexGateway & {
      endpoint(serverId: string, token: string): Promise<{ baseUrl: string; token: string }>;
    },
    private readonly cache: ListCacheStore,
  ) {}

  // --- cached, validator-aware ---

  async listArtists(library: Library, token: string, validator?: string): Promise<Artist[]> {
    return this.cached(`artists:${library.id}`, validator, () =>
      this.inner.listArtists(library, token),
    );
  }

  async listAlbums(
    library: Library,
    artistId: string,
    token: string,
    validator?: string,
  ): Promise<Album[]> {
    return this.cached(`albums:${artistId}`, validator, () =>
      this.inner.listAlbums(library, artistId, token),
    );
  }

  async listTracks(
    library: Library,
    albumId: string,
    token: string,
    validator?: string,
  ): Promise<Track[]> {
    return this.cached(`tracks:${albumId}`, validator, () =>
      this.inner.listTracks(library, albumId, token),
    );
  }

  async listPlaylistTracks(
    playlistId: string,
    serverId: string,
    token: string,
    validator?: string,
  ): Promise<PlaylistTrack[]> {
    return this.cached(`pltracks:${playlistId}`, validator, () =>
      this.inner.listPlaylistTracks(playlistId, serverId, token),
    );
  }

  private async cached<T>(
    key: string,
    validator: string | undefined,
    fetch: () => Promise<T>,
  ): Promise<T> {
    if (validator !== undefined) {
      const hit = await this.cache.get<T>(key, validator);
      if (hit !== null) return hit;
    }
    const data = await fetch();
    if (validator !== undefined) await this.cache.set(key, validator, data);
    return data;
  }

  // --- mutations: delegate then invalidate ---

  async createPlaylist(
    library: Library,
    title: string,
    trackIds: string[],
    token: string,
  ): Promise<Playlist> {
    return this.inner.createPlaylist(library, title, trackIds, token);
  }

  async addToPlaylist(
    playlistId: string,
    serverId: string,
    trackIds: string[],
    token: string,
  ): Promise<void> {
    await this.inner.addToPlaylist(playlistId, serverId, trackIds, token);
    await this.cache.evictKey(`pltracks:${playlistId}`);
  }

  async removeFromPlaylist(
    playlistId: string,
    serverId: string,
    playlistItemIds: string[],
    token: string,
  ): Promise<void> {
    await this.inner.removeFromPlaylist(playlistId, serverId, playlistItemIds, token);
    await this.cache.evictKey(`pltracks:${playlistId}`);
  }

  async renamePlaylist(
    playlistId: string,
    serverId: string,
    title: string,
    token: string,
  ): Promise<void> {
    return this.inner.renamePlaylist(playlistId, serverId, title, token);
  }

  async deletePlaylist(playlistId: string, serverId: string, token: string): Promise<void> {
    await this.inner.deletePlaylist(playlistId, serverId, token);
    await this.cache.evictKey(`pltracks:${playlistId}`);
  }

  // --- pass-through (cheap / live / auth) ---

  createPin(): Promise<Pin> {
    return this.inner.createPin();
  }

  pollPin(id: string): Promise<{ authToken: string | null }> {
    return this.inner.pollPin(id);
  }

  listServers(token: string): Promise<Server[]> {
    return this.inner.listServers(token);
  }

  listMusicLibraries(server: Server, token: string): Promise<Library[]> {
    return this.inner.listMusicLibraries(server, token);
  }

  listPlaylists(library: Library, token: string): Promise<Playlist[]> {
    return this.inner.listPlaylists(library, token);
  }

  search(library: Library, query: string, token: string): Promise<SearchResults> {
    return this.inner.search(library, query, token);
  }

  endpoint(serverId: string, token: string): Promise<{ baseUrl: string; token: string }> {
    return this.inner.endpoint(serverId, token);
  }
}
