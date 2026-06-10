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
import type { ListCacheStore } from "./list-cache-store.js";

/** A PlexGateway that caches item-heavy list results keyed by a caller-supplied
 *  validator, and invalidates on mutations. Transparent: same port surface
 *  (cached methods take an extra optional `validator`), plus the non-port
 *  `endpoint()` that Runtime relies on. */
export class CachingPlexGateway implements PlexGateway {
  constructor(
    private readonly inner: PlexGateway & {
      endpoint(serverId: string, token: string): Promise<{ baseUrl: string; token: string }>;
      listPlaylistTracksPage(
        playlistId: string,
        serverId: string,
        start: number,
        size: number,
        token: string,
      ): Promise<{ items: PlaylistTrack[]; total: number }>;
      listAllTracksPage(
        library: Library,
        sort: LibrarySort,
        start: number,
        size: number,
        token: string,
      ): Promise<{ items: Track[]; total: number }>;
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

  async listAllAlbums(
    library: Library,
    sort: LibrarySort,
    token: string,
    validator?: string,
  ): Promise<Album[]> {
    return this.cached(`allalbums:${library.id}:${sort}`, validator, () =>
      this.inner.listAllAlbums(library, sort, token),
    );
  }

  async listAllTracks(
    library: Library,
    sort: LibrarySort,
    token: string,
    validator?: string,
  ): Promise<Track[]> {
    return this.cached(`alltracks:${library.id}:${sort}`, validator, () =>
      this.inner.listAllTracks(library, sort, token),
    );
  }

  /** Pass-through: paged results are not individually cached. The renderer
   *  assembles pages and populates a full-list cache via a separate call. */
  listAllTracksPage(
    library: Library,
    sort: LibrarySort,
    start: number,
    size: number,
    token: string,
  ): Promise<{ items: Track[]; total: number }> {
    return this.inner.listAllTracksPage(library, sort, start, size, token);
  }

  /** Bump when the MAPPED shape changes (cached entries hold mapper OUTPUT, so a
   *  mapper fix is invisible to existing entries until their Plex validator
   *  changes — versioning the key makes corrected data flow immediately).
   *  v2: Track.artistId (2026-06-09).
   *  v3: userRating on Track/Artist (2026-06-09).
   *  v4: Album.userRating (2026-06-09). */
  private vkey(key: string): string {
    return `v4:${key}`;
  }

  private async cached<T>(
    key: string,
    validator: string | undefined,
    fetch: () => Promise<T>,
  ): Promise<T> {
    const vkey = this.vkey(key);
    if (validator !== undefined) {
      const hit = await this.cache.get<T>(vkey, validator);
      if (hit !== null) return hit;
    }
    const data = await fetch();
    if (validator !== undefined) await this.cache.set(vkey, validator, data);
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
    await this.cache.evictKey(this.vkey(`pltracks:${playlistId}`));
  }

  async removeFromPlaylist(
    playlistId: string,
    serverId: string,
    playlistItemIds: string[],
    token: string,
  ): Promise<void> {
    await this.inner.removeFromPlaylist(playlistId, serverId, playlistItemIds, token);
    await this.cache.evictKey(this.vkey(`pltracks:${playlistId}`));
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
    await this.cache.evictKey(this.vkey(`pltracks:${playlistId}`));
  }

  /** Rate, then evict the exactly-addressable list caches the rated item appears
   *  in: a track's album track list (albumId), an album's artist album list
   *  (artistId), and the library-wide track AND album lists for every sort
   *  (libraryId — a track rating passes albumId+libraryId, an album rating
   *  passes artistId+libraryId; evicting both list families on libraryId is
   *  simpler than threading the item type through).
   *  The opts live on this class only — the core port stays minimal, and the IPC
   *  layer calls the caching class directly (like `endpoint()`). Playlist lists
   *  are NOT evicted: the renderer session overlay covers live UI and their
   *  validators refresh them eventually. */
  async rateItem(
    serverId: string,
    itemId: string,
    rating: number | null,
    token: string,
    opts?: { albumId?: string; artistId?: string; libraryId?: string },
  ): Promise<void> {
    await this.inner.rateItem(serverId, itemId, rating, token);
    if (opts?.albumId) {
      await this.cache.evictKey(this.vkey(`tracks:${opts.albumId}`));
    }
    if (opts?.artistId) {
      await this.cache.evictKey(this.vkey(`albums:${opts.artistId}`));
    }
    if (opts?.libraryId) {
      for (const sort of ["title", "artist", "added"] as const) {
        await this.cache.evictKey(this.vkey(`alltracks:${opts.libraryId}:${sort}`));
        await this.cache.evictKey(this.vkey(`allalbums:${opts.libraryId}:${sort}`));
      }
    }
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

  getUserRating(serverId: string, itemId: string, token: string): Promise<number | null> {
    return this.inner.getUserRating(serverId, itemId, token);
  }

  endpoint(serverId: string, token: string): Promise<{ baseUrl: string; token: string }> {
    return this.inner.endpoint(serverId, token);
  }

  /**
   * Paged fetch — pass-through only. Pages are NOT individually cached here;
   * the renderer assembles all pages and then populates the full-list cache
   * via the normal listPlaylistTracks IPC call once all pages are loaded.
   * That guarantees re-open uses a single cached full-list hit, not repeated pages.
   */
  listPlaylistTracksPage(
    playlistId: string,
    serverId: string,
    start: number,
    size: number,
    token: string,
  ): Promise<{ items: PlaylistTrack[]; total: number }> {
    return this.inner.listPlaylistTracksPage(playlistId, serverId, start, size, token);
  }
}
