/** Pure cache-key builders + mutation-eviction-key derivation shared by every
 *  CachingPlexGateway. Keys are schema-version-prefixed by the gateway, not
 *  here. The sort family `["title","artist","added"]` mirrors the library lists. */

const SORTS = ["title", "artist", "added"] as const;

export const cacheKeys = {
  artists: (libId: string) => `artists:${libId}`,
  albums: (artistId: string) => `albums:${artistId}`,
  tracks: (albumId: string) => `tracks:${albumId}`,
  playlistTracks: (id: string) => `pltracks:${id}`,
  allAlbums: (libId: string, sort: string) => `allalbums:${libId}:${sort}`,
  allTracks: (libId: string, sort: string) => `alltracks:${libId}:${sort}`,
  playlists: (libId: string) => `playlists:${libId}`,
  artist: (artistId: string) => `artist:${artistId}`, // mobile extra
  artistTracks: (artistId: string) => `artisttracks:${artistId}`, // mobile extra
} as const;

/** The exact list caches a rated item appears in: a track's album track list
 *  (albumId), an album's artist album list (artistId), and the library-wide
 *  track AND album lists for every sort (libraryId). */
export function evictKeysForRating(opts: {
  albumId?: string;
  artistId?: string;
  libraryId?: string;
}): string[] {
  const keys: string[] = [];
  if (opts.albumId) keys.push(cacheKeys.tracks(opts.albumId));
  if (opts.artistId) keys.push(cacheKeys.albums(opts.artistId));
  if (opts.libraryId) {
    for (const sort of SORTS) {
      keys.push(cacheKeys.allTracks(opts.libraryId, sort));
      keys.push(cacheKeys.allAlbums(opts.libraryId, sort));
    }
  }
  return keys;
}

/** The playlist's track list, plus the library's playlists list when known. */
export function evictKeysForPlaylist(playlistId: string, libraryId?: string): string[] {
  return [
    cacheKeys.playlistTracks(playlistId),
    ...(libraryId ? [cacheKeys.playlists(libraryId)] : []),
  ];
}
