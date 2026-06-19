import type { Album, Track } from "../models/index";

/** One entry in the library genre index. */
export interface GenreEntry {
  genre: string; // display name: first-seen casing
  albumCount: number;
}

/**
 * Enrich each album's `genres` with the union of its tracks' genres, matched by
 * `track.albumId`. Plex's bulk album-list endpoint omits Genre tags for most
 * albums, but the bulk track-list response carries them, so the album genres
 * alone make the genre index look almost empty. Folding track genres up to the
 * album level recovers the real library shape.
 *
 * Casing is preserved (first-seen wins) and duplicates are merged
 * case-insensitively, matching the rest of this module. Returns NEW album
 * objects; the inputs are not mutated.
 */
export function albumsWithTrackGenres(albums: Album[], tracks: Track[]): Album[] {
  // Per album: lower-cased key -> first-seen display casing.
  const genresByAlbum = new Map<string, Map<string, string>>();
  const add = (albumId: string, genre: string) => {
    let byKey = genresByAlbum.get(albumId);
    if (!byKey) {
      byKey = new Map();
      genresByAlbum.set(albumId, byKey);
    }
    const key = genre.toLowerCase();
    if (!byKey.has(key)) byKey.set(key, genre);
  };

  for (const album of albums) {
    for (const genre of album.genres ?? []) add(album.id, genre);
  }
  for (const track of tracks) {
    for (const genre of track.genres ?? []) add(track.albumId, genre);
  }

  return albums.map((album) => {
    const byKey = genresByAlbum.get(album.id);
    if (!byKey) return album;
    return { ...album, genres: [...byKey.values()] };
  });
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

/** Albums tagged with the genre, matched case-insensitively. */
export function albumsForGenre(genre: string, albums: Album[]): Album[] {
  const wanted = genre.toLowerCase();
  return albums.filter((a) => (a.genres ?? []).some((g) => g.toLowerCase() === wanted));
}

/**
 * Tracks belonging to a genre: every track whose album is tagged with the
 * genre (matched case-insensitively). Sorted artist -> album title -> track
 * number (tracks without a number sort last within their album).
 */
export function tracksForGenre(genre: string, albums: Album[], tracks: Track[]): Track[] {
  const albumIds = new Set(albumsForGenre(genre, albums).map((a) => a.id));
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
