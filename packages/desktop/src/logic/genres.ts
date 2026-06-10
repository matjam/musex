import type { Album, Track } from "@musex/core";

/** One entry in the library genre index. */
export interface GenreEntry {
  genre: string; // display name: first-seen casing
  albumCount: number;
}

/**
 * Pure genre index over the album list. Albums carry Plex Genre tags (the
 * best-tagged level in music libraries); group them case-insensitively,
 * keeping the first-seen casing as the display name. Sorted by album count
 * desc, then name asc.
 */
export function genreIndex(albums: Album[]): GenreEntry[] {
  const byKey = new Map<string, GenreEntry>();
  for (const album of albums) {
    for (const genre of album.genres ?? []) {
      const key = genre.toLowerCase();
      const entry = byKey.get(key);
      if (entry) {
        entry.albumCount += 1;
      } else {
        byKey.set(key, { genre, albumCount: 1 });
      }
    }
  }
  return [...byKey.values()].sort(
    (a, b) => b.albumCount - a.albumCount || a.genre.localeCompare(b.genre),
  );
}

/**
 * Tracks belonging to a genre: every track whose album is tagged with the
 * genre (matched case-insensitively). Sorted artist -> album title -> track
 * number (tracks without a number sort last within their album).
 */
export function tracksForGenre(genre: string, albums: Album[], tracks: Track[]): Track[] {
  const wanted = genre.toLowerCase();
  const albumIds = new Set(
    albums.filter((a) => (a.genres ?? []).some((g) => g.toLowerCase() === wanted)).map((a) => a.id),
  );
  return tracks
    .filter((t) => albumIds.has(t.albumId))
    .sort((a, b) => {
      const byArtist = a.artistName.localeCompare(b.artistName);
      if (byArtist !== 0) return byArtist;
      const byAlbum = (a.albumTitle ?? "").localeCompare(b.albumTitle ?? "");
      if (byAlbum !== 0) return byAlbum;
      // Nullish track numbers sort last; avoid Infinity-Infinity (NaN comparator).
      const an = a.trackNumber ?? Number.POSITIVE_INFINITY;
      const bn = b.trackNumber ?? Number.POSITIVE_INFINITY;
      return an < bn ? -1 : an > bn ? 1 : 0;
    });
}
