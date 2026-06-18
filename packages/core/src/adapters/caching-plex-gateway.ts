import { cacheKeys, evictKeysForPlaylist, evictKeysForRating } from "../logic/list-cache-keys";
import type {
  Album,
  Artist,
  Library,
  LibrarySort,
  Playlist,
  PlaylistTrack,
  SearchResults,
  Server,
  Track,
} from "../models/index";
import type { ListCache } from "../ports/list-cache";
import type { Pin, PlexGateway } from "../ports/plex-gateway";
import { OfflineUnavailable } from "../ports/plex-gateway";

export interface CachingGatewayOpts {
  /** When false, lists are served only from the cache (stale), never fetched. */
  isOnline: () => boolean;
  /** Prefixed onto every cache key — bump when the MAPPED shape changes
   *  (desktop "v6", mobile "m1"). */
  schemaVersion: string;
}

/** A PlexGateway that caches item-heavy list results keyed by a caller-supplied
 *  validator and invalidates on mutations. Transparent: same port surface, with
 *  each cached method taking an extra optional `validator`. When offline (per the
 *  injected `isOnline()`), cached methods serve stale data or throw
 *  `OfflineUnavailable`. Caching is opt-in per call: a method with no validator
 *  is a pass-through (fetch, no set). Subclasses add platform-specific extras. */
export class CachingPlexGateway implements PlexGateway {
  constructor(
    protected readonly inner: PlexGateway,
    protected readonly cache: ListCache,
    protected readonly opts: CachingGatewayOpts,
  ) {}

  // --- cached, validator-aware ---

  async listArtists(library: Library, token: string, validator?: string): Promise<Artist[]> {
    return this.cached(cacheKeys.artists(library.id), validator, () =>
      this.inner.listArtists(library, token),
    );
  }

  async listAlbums(
    library: Library,
    artistId: string,
    token: string,
    validator?: string,
  ): Promise<Album[]> {
    return this.cached(cacheKeys.albums(artistId), validator, () =>
      this.inner.listAlbums(library, artistId, token),
    );
  }

  async listTracks(
    library: Library,
    albumId: string,
    token: string,
    validator?: string,
  ): Promise<Track[]> {
    return this.cached(cacheKeys.tracks(albumId), validator, () =>
      this.inner.listTracks(library, albumId, token),
    );
  }

  async listPlaylistTracks(
    playlistId: string,
    serverId: string,
    token: string,
    validator?: string,
  ): Promise<PlaylistTrack[]> {
    return this.cached(cacheKeys.playlistTracks(playlistId), validator, () =>
      this.inner.listPlaylistTracks(playlistId, serverId, token),
    );
  }

  async listAllAlbums(
    library: Library,
    sort: LibrarySort,
    token: string,
    validator?: string,
  ): Promise<Album[]> {
    return this.cached(cacheKeys.allAlbums(library.id, sort), validator, () =>
      this.inner.listAllAlbums(library, sort, token),
    );
  }

  async listAllTracks(
    library: Library,
    sort: LibrarySort,
    token: string,
    validator?: string,
  ): Promise<Track[]> {
    return this.cached(cacheKeys.allTracks(library.id, sort), validator, () =>
      this.inner.listAllTracks(library, sort, token),
    );
  }

  async listPlaylists(library: Library, token: string, validator?: string): Promise<Playlist[]> {
    return this.cached(cacheKeys.playlists(library.id), validator, () =>
      this.inner.listPlaylists(library, token),
    );
  }

  /** Pass-through: paged results are not individually cached. */
  listAllTracksPage(
    library: Library,
    sort: LibrarySort,
    start: number,
    size: number,
    token: string,
  ): Promise<{ items: Track[]; total: number }> {
    return this.inner.listAllTracksPage(library, sort, start, size, token);
  }

  /** The heart: exact-validation serve-stale-first, gated by `isOnline()`.
   *  Offline → serve stale or throw OfflineUnavailable. Online with a validator
   *  → cache hit on match, else fetch + set. No validator → fetch, no set. */
  protected async cached<T>(
    key: string,
    validator: string | undefined,
    fetch: () => Promise<T>,
  ): Promise<T> {
    const vkey = `${this.opts.schemaVersion}:${key}`;
    if (!this.opts.isOnline()) {
      const stale = await this.cache.getStale<T>(vkey);
      if (stale !== null) return stale;
      throw new OfflineUnavailable(`offline: ${key} not cached`);
    }
    if (validator !== undefined) {
      const hit = await this.cache.get<T>(vkey, validator);
      if (hit !== null) return hit;
    }
    const data = await fetch();
    if (validator !== undefined) await this.cache.set(vkey, validator, data);
    return data;
  }

  /** Evict each key with the schema-version prefix applied. */
  protected async evict(keys: string[]): Promise<void> {
    for (const key of keys) {
      await this.cache.evictKey(`${this.opts.schemaVersion}:${key}`);
    }
  }

  // --- mutations: delegate then invalidate ---

  async createPlaylist(
    library: Library,
    title: string,
    trackIds: string[],
    token: string,
  ): Promise<Playlist> {
    const playlist = await this.inner.createPlaylist(library, title, trackIds, token);
    await this.evict(evictKeysForPlaylist(playlist.id, library.id));
    return playlist;
  }

  async addToPlaylist(
    playlistId: string,
    serverId: string,
    trackIds: string[],
    token: string,
  ): Promise<void> {
    await this.inner.addToPlaylist(playlistId, serverId, trackIds, token);
    await this.evict(evictKeysForPlaylist(playlistId));
  }

  async removeFromPlaylist(
    playlistId: string,
    serverId: string,
    playlistItemIds: string[],
    token: string,
  ): Promise<void> {
    await this.inner.removeFromPlaylist(playlistId, serverId, playlistItemIds, token);
    await this.evict(evictKeysForPlaylist(playlistId));
  }

  async renamePlaylist(
    playlistId: string,
    serverId: string,
    title: string,
    token: string,
  ): Promise<void> {
    await this.inner.renamePlaylist(playlistId, serverId, title, token);
  }

  async deletePlaylist(playlistId: string, serverId: string, token: string): Promise<void> {
    await this.inner.deletePlaylist(playlistId, serverId, token);
    await this.evict(evictKeysForPlaylist(playlistId));
  }

  /** Rate, then evict the exactly-addressable list caches the rated item appears
   *  in (album track list / artist album list / library-wide track+album lists).
   *  The opts live on this class only — the core port stays minimal; callers that
   *  need eviction call the caching class directly. */
  async rateItem(
    serverId: string,
    itemId: string,
    rating: number | null,
    token: string,
    opts?: { albumId?: string; artistId?: string; libraryId?: string },
  ): Promise<void> {
    await this.inner.rateItem(serverId, itemId, rating, token);
    await this.evict(evictKeysForRating(opts ?? {}));
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

  search(library: Library, query: string, token: string): Promise<SearchResults> {
    return this.inner.search(library, query, token);
  }

  getUserRating(serverId: string, itemId: string, token: string): Promise<number | null> {
    return this.inner.getUserRating(serverId, itemId, token);
  }
}
