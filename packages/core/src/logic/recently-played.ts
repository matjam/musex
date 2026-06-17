import type { Track } from "../models/index.js";
import { smartTrackKey } from "./smart-playlists.js";

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
