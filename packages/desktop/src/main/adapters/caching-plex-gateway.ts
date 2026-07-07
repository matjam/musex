import type { PlaylistTrack } from "@musex/core";
import { CachingPlexGateway } from "@musex/core";
import type { ListCacheStore } from "./list-cache-store.js";
import type { PlexapiGateway } from "./plex-gateway.js";

/** Desktop's caching gateway: the shared `@musex/core` `CachingPlexGateway`
 *  (validator-keyed list caching + mutation eviction) wired with desktop's fs
 *  `ListCacheStore`, always-online (`isOnline: () => true` — the offline branch
 *  never runs on desktop) and the schema version `v7`. Adds the two
 *  non-port extras Runtime/IPC rely on (`endpoint`, `listPlaylistTracksPage`),
 *  delegating to the concrete `PlexapiGateway`. */
export class DesktopCachingGateway extends CachingPlexGateway {
  constructor(
    private readonly desktopInner: PlexapiGateway,
    cache: ListCacheStore,
  ) {
    // v7: MediaInfo.sizeBytes added to the mapped Track shape (downloads v2 integrity).
    super(desktopInner, cache, { isOnline: () => true, schemaVersion: "v7" });
  }

  endpoint(serverId: string, token: string): Promise<{ baseUrl: string; token: string }> {
    return this.desktopInner.endpoint(serverId, token);
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
    return this.desktopInner.listPlaylistTracksPage(playlistId, serverId, start, size, token);
  }
}
