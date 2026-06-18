import type { Artist, Library, ListCache, Track } from "@musex/core";
import { CachingPlexGateway, cacheKeys } from "@musex/core";
import type { PlexGatewayImpl } from "../adapters/plex-gateway";

/** The mobile caching gateway: the shared core `CachingPlexGateway` plus the
 *  two mobile-only methods that aren't on the core port (`getArtist`,
 *  `listArtistTracks`) routed through the same validator-aware `cached()`, and
 *  `baseUrlFor` delegated to the concrete inner gateway. Transparent: the store
 *  can use this anywhere a `PlexGatewayImpl` was used before. */
export class MobileCachingGateway extends CachingPlexGateway {
  constructor(
    private readonly mobileInner: PlexGatewayImpl,
    cache: ListCache,
    isOnline: () => boolean,
  ) {
    super(mobileInner, cache, { isOnline, schemaVersion: "m1" });
  }

  /** Base URL for a server's stream/art URLs — not part of the core port. */
  baseUrlFor(serverId: string): string {
    return this.mobileInner.baseUrlFor(serverId);
  }

  /** Liveness probe used by ConnectivityMonitor — always hits the network
   *  (never cached); it's what decides online/offline in the first place. */
  probe(serverId: string, token: string): Promise<void> {
    return this.mobileInner.probe(serverId, token);
  }

  /** Single artist by ratingKey (mobile artist header). Cached per artist. */
  getArtist(
    library: Library,
    artistId: string,
    token: string,
    validator?: string,
  ): Promise<Artist | null> {
    return this.cached(cacheKeys.artist(artistId), validator, () =>
      this.mobileInner.getArtist(library, artistId, token),
    );
  }

  /** All tracks for an artist (Plex allLeaves; mobile action bar). Cached per artist. */
  listArtistTracks(
    artistId: string,
    library: Library,
    token: string,
    validator?: string,
  ): Promise<Track[]> {
    return this.cached(cacheKeys.artistTracks(artistId), validator, () =>
      this.mobileInner.listArtistTracks(artistId, library, token),
    );
  }
}
