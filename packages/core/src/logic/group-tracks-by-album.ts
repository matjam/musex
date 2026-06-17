import type { Track } from "../models/index.js";

/** One album's worth of playable downloaded tracks, for the "On this device" grid. */
export interface TrackAlbumGroup {
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
    const existing = byAlbum.get(t.albumId);
    if (existing) {
      existing.tracks.push(t);
      if (!existing.thumb && t.thumb) existing.thumb = t.thumb;
    } else {
      byAlbum.set(t.albumId, {
        albumId: t.albumId,
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
