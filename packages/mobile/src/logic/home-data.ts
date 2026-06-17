import type { ForYouInput, ForYouTrackStat, Track } from "@musex/core";
import { smartTrackKey } from "@musex/core";

/** Most-recently-played library tracks, joined from taste stats by track key. */
export function recentlyPlayedTracks(
  stats: { key: string; lastPlayedMs: number }[],
  allTracks: Track[],
  limit: number,
): Track[] {
  const byKey = new Map<string, Track>();
  for (const t of allTracks) byKey.set(smartTrackKey(t), t);
  return stats
    .filter((s) => s.lastPlayedMs > 0)
    .slice()
    .sort((a, b) => b.lastPlayedMs - a.lastPlayedMs)
    .map((s) => byKey.get(s.key))
    .filter((t): t is Track => !!t)
    .slice(0, limit);
}

/** Assemble ForYouInput for the mobile (seeds-only) For You mix: resolve top
 *  artist names to ids, group the library by artist, and leave similarOwned
 *  empty (no recommendation provider on mobile). */
export function buildForYouInput(
  topArtists: { name: string; score: number }[],
  allArtists: { id: string; name: string }[],
  allTracks: Track[],
  stats: {
    key: string;
    plays: number;
    skips: number;
    lastPlayedMs: number;
    ratingStars: number | null;
  }[],
  nowMs: number,
): ForYouInput {
  const idByName = new Map<string, string>();
  for (const a of allArtists) idByName.set(a.name.toLowerCase(), a.id);

  const ownTop = topArtists
    .map((a) => ({
      artistId: idByName.get(a.name.toLowerCase()) ?? "",
      name: a.name,
      score: a.score,
    }))
    .filter((a) => a.artistId);

  const tracksByArtist = new Map<string, Track[]>();
  for (const t of allTracks) {
    const list = tracksByArtist.get(t.artistId);
    if (list) list.push(t);
    else tracksByArtist.set(t.artistId, [t]);
  }

  const statMap = new Map<string, ForYouTrackStat>();
  for (const s of stats) {
    statMap.set(s.key, {
      plays: s.plays,
      skips: s.skips,
      lastPlayedMs: s.lastPlayedMs,
      ratingStars: s.ratingStars,
    });
  }

  return { ownTop, similarOwned: [], tracksByArtist, stats: statMap, nowMs };
}
