import type { Track } from "../models/index.js";

/** One album's worth of playable downloaded tracks, for the "On this device" grid. */
export interface TrackAlbumGroup {
  /** The tracks' `albumId`, or — when the tracks carry NO albumId (legacy
   *  download records predate the field) — a per-track fallback key
   *  `track:<trackId>`. The prefix can't collide with a real Plex ratingKey;
   *  consumers must not treat a fallback key as a navigable album id. */
  albumId: string;
  /** First track's album title; "Unknown Album" when none carry one. */
  albumTitle: string;
  artistName: string;
  /** First track that actually has a (baked) thumb, if any. */
  thumb?: string;
  /** The album's tracks, in the order they arrived (already album→trackNumber
   *  sorted by `downloadedTracks()`). */
  tracks: Track[];
}

/** Group playable tracks by `albumId` for tiled display. Buckets preserve the
 *  input order of their tracks (callers pass tracks pre-sorted album→trackNumber);
 *  the bucket's title/artist come from its first track, its thumb falls through to
 *  the first track that actually carries one. Groups are returned sorted by album
 *  title (case-insensitive) then artist — a stable order so the grid doesn't
 *  reshuffle on refetch. */
export function groupTracksByAlbum(tracks: Track[]): TrackAlbumGroup[] {
  const byAlbum = new Map<string, TrackAlbumGroup>();
  for (const t of tracks) {
    // Falsy albumId (""/undefined — legacy records predate the field): NEVER
    // merge such tracks into one shared bucket (one tile would wear another
    // album's art/title and swallow unrelated tracks) — give each its own
    // group keyed per track.
    const key = t.albumId || `track:${t.id}`;
    const existing = byAlbum.get(key);
    if (existing) {
      existing.tracks.push(t);
      if (!existing.thumb && t.thumb) existing.thumb = t.thumb;
    } else {
      byAlbum.set(key, {
        albumId: key,
        albumTitle: t.albumTitle ?? "Unknown Album",
        artistName: t.artistName,
        thumb: t.thumb,
        tracks: [t],
      });
    }
  }
  return [...byAlbum.values()].sort(
    (a, b) =>
      a.albumTitle.localeCompare(b.albumTitle, undefined, { sensitivity: "base" }) ||
      a.artistName.localeCompare(b.artistName, undefined, { sensitivity: "base" }),
  );
}
