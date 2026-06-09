import type {
  MusicSection,
  Album as PlexAlbum,
  Artist as PlexArtist,
  Track as PlexTrack,
} from "@ctrl/plex";
import {
  MyPlexAccount,
  Album as PlexAlbumCls,
  Playlist as PlexPlaylistCls,
  PlexServer,
  Track as PlexTrackCls,
  X_PLEX_IDENTIFIER,
} from "@ctrl/plex";
// fetchItems is not re-exported from @ctrl/plex's root; deep-importing the internal
// path resolves at runtime because the package ships no "exports" map (only
// main/typings + files:["dist/src"]). Re-verify this path when upgrading @ctrl/plex.
// NOTE: pass the item Class so results are HYDRATED instances (with .media/.parts etc.);
// without a Cls, fetchItem(s) returns raw PlexItemData and methods like .albums() are absent.
import { fetchItems } from "@ctrl/plex/dist/src/baseFunctionality.js";
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
import { PlexAuthError } from "@musex/core";
import { plexSort } from "../../logic/library-sort.js";
import { toAlbum, toArtist, toTrack } from "../../logic/plex-mapping.js";

/** Translate @ctrl/plex ofetch HTTP errors into PlexAuthError where appropriate.
 *  ofetch throws an object with a `response.status` number for HTTP errors. */
function asPlexAuthError(err: unknown): never {
  if (
    typeof err === "object" &&
    err !== null &&
    "response" in err &&
    typeof (err as { response?: { status?: number } }).response?.status === "number"
  ) {
    const status = (err as { response: { status: number } }).response.status;
    if (status === 401 || status === 403) throw new PlexAuthError();
  }
  throw err;
}

/** Persists each server's last known-good base URL so we can skip @ctrl/plex's
 *  slow connection probe on subsequent launches. Backed by electron-store in the
 *  real app; trivially fakeable in tests. */
export interface ServerUrlCache {
  get(serverId: string): string | undefined;
  set(serverId: string, baseUrl: string): void;
  delete(serverId: string): void;
}

/** Bound for both the cached-URL reachability check and the discovery probe, so
 *  an unreachable URL fails fast instead of hanging ~10s. */
const CONNECT_TIMEOUT_MS = 4000;

export class PlexapiGateway implements PlexGateway {
  /** Cache connected PlexServer objects by Plex machine identifier so browse
   *  calls reuse the same connection within a gateway instance lifetime. */
  private readonly serverCache = new Map<string, PlexServer>();
  /** De-dupes concurrent connect() calls for the same server (e.g. a browse +
   *  a playback restore racing on launch) onto a single network operation. */
  private readonly inflight = new Map<string, Promise<PlexServer>>();

  constructor(private readonly urlCache?: ServerUrlCache) {}

  async createPin(): Promise<Pin> {
    // WebLogin shape: { id: number, code: string, uri: string }
    const web = await MyPlexAccount.getWebLogin();
    return { id: String(web.id), code: web.code, authUrl: web.uri };
  }

  async pollPin(id: string): Promise<{ authToken: string | null }> {
    // Single-shot poll — the core signIn use-case owns the loop/timeout.
    const res = await fetch(`https://plex.tv/api/v2/pins/${id}`, {
      headers: {
        accept: "application/json",
        // Must match the identifier getWebLogin used (both default to X_PLEX_IDENTIFIER)
        // so Plex associates this poll with the pin we created.
        "X-Plex-Client-Identifier": X_PLEX_IDENTIFIER,
      },
    });
    if (res.status === 401 || res.status === 403) throw new PlexAuthError();
    if (!res.ok) return { authToken: null };
    const body = (await res.json()) as { authToken: string | null };
    return { authToken: body.authToken ?? null };
  }

  async listServers(token: string): Promise<Server[]> {
    try {
      const account = this.account(token);
      const resources = await account.resources();
      return resources
        .filter((r) => r.provides?.includes("server"))
        .map((r) => ({
          id: r.clientIdentifier,
          name: r.name,
          // ResourceConnection exposes uri + local; relay is in the raw Connection
          // data only. Default relay to false — callers should prefer local connections.
          connections: (r.connections ?? []).map((c) => ({
            uri: c.uri,
            local: Boolean(c.local),
            relay: false,
          })),
        }));
    } catch (err) {
      asPlexAuthError(err);
    }
  }

  async listMusicLibraries(server: Server, token: string): Promise<Library[]> {
    try {
      const plexServer = await this.connect(server.id, token);
      const library = await plexServer.library();
      const sections = await library.sections();
      return sections
        .filter((s) => s.type === "artist") // music sections have type "artist"
        .map((s) => ({
          id: String(s.key),
          serverId: server.id,
          serverName: server.name,
          title: s.title,
          type: "music" as const,
          updatedAt: s.updatedAt.getTime(),
        }));
    } catch (err) {
      asPlexAuthError(err);
    }
  }

  async listArtists(library: Library, token: string): Promise<Artist[]> {
    try {
      const section = await this.musicSection(library, token);
      const artists = await section.searchArtists();
      return artists.map((a) => toArtistSafe(a, library.serverId));
    } catch (err) {
      asPlexAuthError(err);
    }
  }

  async listAllAlbums(library: Library, sort: LibrarySort, token: string): Promise<Album[]> {
    try {
      const section = await this.musicSection(library, token);
      const albums = await section.searchAlbums({ sort: plexSort(sort) });
      return albums.map((a) => toAlbumSafe(a, library.serverId));
    } catch (err) {
      asPlexAuthError(err);
    }
  }

  async listAllTracks(library: Library, sort: LibrarySort, token: string): Promise<Track[]> {
    try {
      const section = await this.musicSection(library, token);
      const tracks = await section.searchTracks({ sort: plexSort(sort) });
      return tracks.map((t) => toTrackSafe(t, library.serverId));
    } catch (err) {
      asPlexAuthError(err);
    }
  }

  async listAllTracksPage(
    library: Library,
    sort: LibrarySort,
    start: number,
    size: number,
    token: string,
  ): Promise<{ items: Track[]; total: number }> {
    try {
      const server = await this.connect(library.serverId, token);
      // type=10 is "track" (confirmed from @ctrl/plex SEARCHTYPES).
      // Pagination mirrors listPlaylistTracksPage: bake container params into the
      // path string and call server.query() directly (fetchItems options are
      // client-side filtering, not URL params).
      const path =
        `/library/sections/${library.id}/all` +
        `?type=10&sort=${plexSort(sort)}` +
        `&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${size}`;
      const response = (await server.query({ path })) as {
        MediaContainer: {
          totalSize?: number;
          size?: number;
          Metadata?: Record<string, unknown>[];
        };
      };
      const total = response.MediaContainer.totalSize ?? 0;
      const rawItems = response.MediaContainer.Metadata ?? [];
      const items: Track[] = rawItems.map((raw) => {
        const t = new PlexTrackCls(server, raw, undefined, undefined);
        return toTrackSafe(t as PlexTrack, library.serverId);
      });
      return { items, total };
    } catch (err) {
      asPlexAuthError(err);
    }
  }

  async listAlbums(library: Library, artistId: string, token: string): Promise<Album[]> {
    try {
      const plexServer = await this.connect(library.serverId, token);
      // Fetch the artist's children (albums) directly, hydrated as Album instances.
      const albums = await fetchItems(
        plexServer,
        `/library/metadata/${artistId}/children`,
        undefined,
        PlexAlbumCls,
      );
      return albums.map((al) => toAlbumSafe(al, library.serverId));
    } catch (err) {
      asPlexAuthError(err);
    }
  }

  async listTracks(library: Library, albumId: string, token: string): Promise<Track[]> {
    try {
      const plexServer = await this.connect(library.serverId, token);
      // Fetch the album's children (tracks) directly, hydrated as Track instances.
      const tracks = await fetchItems(
        plexServer,
        `/library/metadata/${albumId}/children`,
        undefined,
        PlexTrackCls,
      );
      return tracks.map((t) => toTrackSafe(t, library.serverId));
    } catch (err) {
      asPlexAuthError(err);
    }
  }

  async search(library: Library, query: string, token: string): Promise<SearchResults> {
    try {
      const section = await this.musicSection(library, token);
      // Per-type search, capped for responsiveness; run concurrently.
      const [artists, albums, tracks] = await Promise.all([
        section.searchArtists({ title: query, maxresults: 8 }),
        section.searchAlbums({ title: query, maxresults: 8 }),
        section.searchTracks({ title: query, maxresults: 30 }),
      ]);
      return {
        artists: artists.map((a) => toArtistSafe(a, library.serverId)),
        albums: albums.map((al) => toAlbumSafe(al, library.serverId)),
        tracks: tracks.map((t) => toTrackSafe(t, library.serverId)),
      };
    } catch (err) {
      asPlexAuthError(err);
    }
  }

  async listPlaylists(library: Library, token: string): Promise<Playlist[]> {
    try {
      const section = await this.musicSection(library, token);
      const all = await section.playlists();
      return all.map((p) => toPlaylistSafe(p, library.serverId));
    } catch (err) {
      asPlexAuthError(err);
    }
  }

  async listPlaylistTracks(
    playlistId: string,
    serverId: string,
    token: string,
  ): Promise<PlaylistTrack[]> {
    try {
      const playlist = await this.findPlaylist(serverId, playlistId, token);
      const items = await playlist.items<PlexTrack>();
      return items.map((t) => ({
        track: toTrackSafe(t, serverId),
        playlistItemId: String(t.playlistItemID ?? ""),
      }));
    } catch (err) {
      asPlexAuthError(err);
    }
  }

  /**
   * Fetch a single page of playlist tracks using Plex container windowing.
   *
   * Pagination is implemented by appending X-Plex-Container-Start and
   * X-Plex-Container-Size as URL query params directly on the path string,
   * then calling server.query() directly — fetchItems()'s `options` param is
   * used for client-side result filtering only, not URL params.
   *
   * `total` is read from MediaContainer.totalSize returned by Plex (same
   * mechanism used by @ctrl/plex's own server.history() pagination).
   */
  async listPlaylistTracksPage(
    playlistId: string,
    serverId: string,
    start: number,
    size: number,
    token: string,
  ): Promise<{ items: PlaylistTrack[]; total: number }> {
    try {
      const server = await this.connect(serverId, token);
      const path = `/playlists/${playlistId}/items?X-Plex-Container-Start=${start}&X-Plex-Container-Size=${size}&includeGuids=1`;
      const response = (await server.query({ path })) as {
        MediaContainer: {
          totalSize?: number;
          size?: number;
          Metadata?: Record<string, unknown>[];
        };
      };
      const total = response.MediaContainer.totalSize ?? 0;
      const rawItems = response.MediaContainer.Metadata ?? [];
      // Hydrate raw metadata objects into PlexTrack instances so toTrackSafe can read .media etc.
      const items: PlaylistTrack[] = rawItems.map((raw) => {
        const t = new PlexTrackCls(server, raw, undefined, undefined);
        return {
          track: toTrackSafe(t as PlexTrack, serverId),
          playlistItemId: String((raw["playlistItemID"] as number | undefined) ?? ""),
        };
      });
      return { items, total };
    } catch (err) {
      asPlexAuthError(err);
    }
  }

  async createPlaylist(
    library: Library,
    title: string,
    trackIds: string[],
    token: string,
  ): Promise<Playlist> {
    try {
      const server = await this.connect(library.serverId, token);
      const items = await this.fetchTracksByIds(library.serverId, trackIds, token);
      const created = await PlexPlaylistCls.create(server, title, { items });
      return toPlaylistSafe(created, library.serverId);
    } catch (err) {
      asPlexAuthError(err);
    }
  }

  async addToPlaylist(
    playlistId: string,
    serverId: string,
    trackIds: string[],
    token: string,
  ): Promise<void> {
    try {
      const playlist = await this.findPlaylist(serverId, playlistId, token);
      const tracks = await this.fetchTracksByIds(serverId, trackIds, token);
      if (tracks.length > 0) await playlist.addItems(tracks);
    } catch (err) {
      asPlexAuthError(err);
    }
  }

  async removeFromPlaylist(
    playlistId: string,
    serverId: string,
    playlistItemIds: string[],
    token: string,
  ): Promise<void> {
    try {
      const playlist = await this.findPlaylist(serverId, playlistId, token);
      const items = await playlist.items<PlexTrack>();
      const targets = items.filter((t) => playlistItemIds.includes(String(t.playlistItemID ?? "")));
      if (targets.length > 0) await playlist.removeItems(targets);
    } catch (err) {
      asPlexAuthError(err);
    }
  }

  async renamePlaylist(
    playlistId: string,
    serverId: string,
    title: string,
    token: string,
  ): Promise<void> {
    try {
      const server = await this.connect(serverId, token);
      await PlexPlaylistCls.update(server, playlistId, { title });
    } catch (err) {
      asPlexAuthError(err);
    }
  }

  async deletePlaylist(playlistId: string, serverId: string, token: string): Promise<void> {
    try {
      const playlist = await this.findPlaylist(serverId, playlistId, token);
      await playlist.delete();
    } catch (err) {
      asPlexAuthError(err);
    }
  }

  /** Return the working connection URL and token for a server, using the cached
   *  connection (cheap after the first browse call for that server). */
  async endpoint(serverId: string, token: string): Promise<{ baseUrl: string; token: string }> {
    const server = await this.connect(serverId, token);
    return { baseUrl: server.baseurl, token };
  }

  // --- internal helpers ---

  private account(token: string): MyPlexAccount {
    return new MyPlexAccount({ token });
  }

  /** Connect to a Plex server by its machine identifier, caching the result.
   *  Reuses the in-session connection, de-dupes concurrent connects, and prefers
   *  the persisted base URL to skip @ctrl/plex's slow connection probe. */
  private async connect(serverId: string, token: string): Promise<PlexServer> {
    const cached = this.serverCache.get(serverId);
    if (cached) return cached;
    const pending = this.inflight.get(serverId);
    if (pending) return pending;
    const p = this.doConnect(serverId, token);
    this.inflight.set(serverId, p);
    try {
      return await p;
    } finally {
      this.inflight.delete(serverId);
    }
  }

  private async doConnect(serverId: string, token: string): Promise<PlexServer> {
    // Fast path: reuse the last working base URL (skips the ~10s probe). Validate
    // with one cheap, timeout-bounded query; if it's stale (e.g. network changed)
    // drop it and fall through to full discovery.
    const cachedUrl = this.urlCache?.get(serverId);
    if (cachedUrl) {
      const server = new PlexServer(cachedUrl, token, CONNECT_TIMEOUT_MS);
      try {
        await server.query({ path: "/" }); // cheap, timeout-bounded reachability check
        this.serverCache.set(serverId, server);
        return server;
      } catch {
        this.urlCache?.delete(serverId); // stale (e.g. network changed) -> rediscover
      }
    }

    const account = this.account(token);
    const resources = await account.resources();
    const resource = resources.find((r) => r.clientIdentifier === serverId);
    if (!resource) throw new Error(`Plex server ${serverId} not found for this account`);
    const plexServer = await resource.connect(null, CONNECT_TIMEOUT_MS);
    this.urlCache?.set(serverId, plexServer.baseurl);
    this.serverCache.set(serverId, plexServer);
    return plexServer;
  }

  private async musicSection(library: Library, token: string): Promise<MusicSection> {
    const plexServer = await this.connect(library.serverId, token);
    const lib = await plexServer.library();
    return lib.sectionByID<MusicSection>(Number(library.id));
  }

  /** Fetch hydrated Track instances for the given ratingKeys (for add/create). */
  private async fetchTracksByIds(
    serverId: string,
    ids: string[],
    token: string,
  ): Promise<PlexTrack[]> {
    if (ids.length === 0) return [];
    const server = await this.connect(serverId, token);
    return fetchItems(server, `/library/metadata/${ids.join(",")}`, undefined, PlexTrackCls);
  }

  /** Find a hydrated Playlist instance by ratingKey by listing all audio playlists
   *  on the server (Plex playlists are server-global, not section-scoped). */
  private async findPlaylist(
    serverId: string,
    playlistId: string,
    token: string,
  ): Promise<PlexPlaylistCls> {
    const server = await this.connect(serverId, token);
    const all = await fetchItems(
      server,
      "/playlists?type=15&playlistType=audio",
      undefined,
      PlexPlaylistCls,
    );
    const found = all.find((p) => String(p.ratingKey) === playlistId);
    if (!found) throw new Error(`Playlist ${playlistId} not found`);
    return found;
  }
}

// --- thin adapters from @ctrl/plex concrete types to the mapper's raw interfaces ---
// These exist because @ctrl/plex uses `number | string | undefined` for ratingKey and
// other optional fields, while our mappers require `string`. We do the coercions here
// so the tested mappers stay unchanged.

function toArtistSafe(a: PlexArtist, serverId: string): Artist {
  return toArtist(
    {
      ratingKey: String(a.ratingKey ?? ""),
      title: a.title ?? "",
      thumb: a.thumb,
      updatedAt: a.updatedAt ? a.updatedAt.getTime() : undefined,
    },
    serverId,
  );
}

function toAlbumSafe(al: PlexAlbum, serverId: string): Album {
  return toAlbum(
    {
      ratingKey: String(al.ratingKey ?? ""),
      title: al.title ?? "",
      year: al.year,
      thumb: al.thumb,
      parentRatingKey: al.parentRatingKey !== undefined ? String(al.parentRatingKey) : undefined,
      updatedAt: al.updatedAt ? al.updatedAt.getTime() : undefined,
    },
    serverId,
  );
}

function toPlaylistSafe(p: PlexPlaylistCls, serverId: string): Playlist {
  return {
    id: String(p.ratingKey ?? ""),
    serverId,
    title: p.title ?? "",
    trackCount: Number(p.leafCount ?? 0),
    durationMs: typeof p.duration === "number" ? p.duration : undefined,
    // composite is the playlist cover image (mosaic of track art); Playlist has no .thumb
    thumb: p.composite || undefined,
    updatedAt: p.updatedAt ? p.updatedAt.getTime() : undefined,
  };
}

function toTrackSafe(t: PlexTrack, serverId: string): Track {
  return toTrack(
    {
      ratingKey: String(t.ratingKey ?? ""),
      title: t.title ?? "",
      index: t.index,
      duration: t.duration,
      parentRatingKey: t.parentRatingKey !== undefined ? String(t.parentRatingKey) : undefined,
      parentTitle: t.parentTitle,
      grandparentTitle: t.grandparentTitle,
      thumb: t.thumb,
      // MediaPart.key (from PlexObject.key) is the Plex server-relative path.
      // Media.id is number; MediaPart.id is number.
      media: t.media?.map((m) => ({
        audioCodec: m.audioCodec,
        container: undefined as string | undefined, // container is on MediaPart, not Media
        bitrate: m.bitrate,
        parts: m.parts.map((p) => ({
          id: p.id,
          key: p.key,
          container: p.container,
        })),
      })),
    },
    serverId,
  );
}
