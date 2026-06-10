import type { Track } from "@musex/core";
import type { RecommendedTrack } from "@musex/plugin-api";
import { KEY_SEPARATOR } from "../../logic/taste-profile.js";

/** How many tracks an artist-level suggestion may contribute. */
const ARTIST_PICKS_MAX = 2;

/** Artist+title join key — same shape the taste profile / smart playlists use. */
function trackKey(artist: string, title: string): string {
  return `${artist.toLowerCase()}${KEY_SEPARATOR}${title.toLowerCase()}`;
}

/**
 * Resolve plugin radio suggestions against the user's library. Track-level
 * suggestions (`title` present) search `"artist title"` and take the first
 * result with a case-insensitive artist+title match; artist-level suggestions
 * search the artist name and take up to 2 of that artist's tracks. Picks are
 * deduped by track id AND artist+title key, never re-pick anything in
 * `exclude` (case-insensitive), and stop at `count`. A failing search skips
 * that suggestion (logged) — one bad query must not kill the batch.
 */
export async function resolveRecommendations(
  recs: RecommendedTrack[],
  exclude: { title: string; artist: string }[],
  count: number,
  search: (query: string) => Promise<{ tracks: Track[] }>,
): Promise<Track[]> {
  const excluded = new Set(exclude.map((e) => trackKey(e.artist, e.title)));
  const picked: Track[] = [];
  const pickedIds = new Set<string>();
  const pickedKeys = new Set<string>();

  const pickable = (t: Track): boolean => {
    const key = trackKey(t.artistName, t.title);
    return !excluded.has(key) && !pickedIds.has(t.id) && !pickedKeys.has(key);
  };
  const pick = (t: Track): void => {
    picked.push(t);
    pickedIds.add(t.id);
    pickedKeys.add(trackKey(t.artistName, t.title));
  };

  for (const rec of recs) {
    if (picked.length >= count) break;
    let tracks: Track[];
    try {
      const query = rec.title !== undefined ? `${rec.artistName} ${rec.title}` : rec.artistName;
      tracks = (await search(query)).tracks;
    } catch (err) {
      console.error(`[radio] library search failed for "${rec.artistName}":`, err);
      continue;
    }
    if (rec.title !== undefined) {
      const wantArtist = rec.artistName.toLowerCase();
      const wantTitle = rec.title.toLowerCase();
      const match = tracks.find(
        (t) =>
          t.artistName.toLowerCase() === wantArtist &&
          t.title.toLowerCase() === wantTitle &&
          pickable(t),
      );
      if (match) pick(match);
    } else {
      const wantArtist = rec.artistName.toLowerCase();
      let taken = 0;
      for (const t of tracks) {
        if (taken >= ARTIST_PICKS_MAX || picked.length >= count) break;
        if (t.artistName.toLowerCase() !== wantArtist || !pickable(t)) continue;
        pick(t);
        taken += 1;
      }
    }
  }
  return picked;
}
