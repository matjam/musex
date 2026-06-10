import type { Track } from "@musex/core";
import { KEY_SEPARATOR } from "./taste-profile";

/** The three canned smart playlists (sidebar "Smart" section). */
export type SmartKind = "top-rated" | "heavy-rotation" | "rediscover";

export const SMART_TITLES: Record<SmartKind, string> = {
  "top-rated": "Top Rated",
  "heavy-rotation": "Heavy Rotation",
  rediscover: "Rediscover",
};

/** Plex userRating (0–10) threshold for "loved": 4 stars and up. */
const LOVED_RATING = 8;
/** Heavy Rotation needs at least this many full plays. */
const HEAVY_ROTATION_MIN_PLAYS = 2;
/** Rediscover counts an unrated track as loved at this many plays. */
const REDISCOVER_MIN_PLAYS = 3;
/** Rediscover only surfaces tracks not played for longer than this. */
const STALE_AFTER_MS = 60 * 24 * 60 * 60 * 1000;
/** Heavy Rotation / Rediscover list cap (Top Rated is uncapped). */
const MAX_LIST = 100;

/** Join key against taste-profile track stats: lower(artist)␟lower(title). */
export function smartTrackKey(t: { artistName: string; title: string }): string {
  return `${t.artistName.toLowerCase()}${KEY_SEPARATOR}${t.title.toLowerCase()}`;
}

/** The slice of a taste-profile track stat the smart-playlist rules need. */
export interface SmartTrackStat {
  key: string;
  plays: number;
  lastPlayedMs: number;
  decayedPlays: number;
}

/**
 * Pure smart-playlist rules: select + order library tracks for one canned
 * kind, joining main's taste-profile stats by artist+title key. No I/O, no
 * clock — `nowMs` is injected.
 */
export function computeSmartPlaylist(
  kind: SmartKind,
  tracks: Track[],
  stats: SmartTrackStat[],
  artistScores: { name: string; score: number }[],
  nowMs: number,
): Track[] {
  const statByKey = new Map(stats.map((s) => [s.key, s]));

  switch (kind) {
    case "top-rated":
      return tracks
        .filter((t) => (t.userRating ?? 0) >= LOVED_RATING)
        .sort(
          (a, b) =>
            (b.userRating ?? 0) - (a.userRating ?? 0) ||
            a.artistName.localeCompare(b.artistName) ||
            a.title.localeCompare(b.title),
        );

    case "heavy-rotation":
      return tracks
        .flatMap((t) => {
          const s = statByKey.get(smartTrackKey(t));
          return s && s.plays >= HEAVY_ROTATION_MIN_PLAYS ? [{ t, s }] : [];
        })
        .sort((a, b) => b.s.decayedPlays - a.s.decayedPlays)
        .slice(0, MAX_LIST)
        .map((x) => x.t);

    case "rediscover": {
      const affinity = new Map(artistScores.map((a) => [a.name.toLowerCase(), a.score]));
      const score = (t: Track) => affinity.get(t.artistName.toLowerCase()) ?? 0;
      return tracks
        .filter((t) => {
          const s = statByKey.get(smartTrackKey(t));
          const loved =
            (t.userRating ?? 0) >= LOVED_RATING ||
            (s !== undefined && s.plays >= REDISCOVER_MIN_PLAYS);
          const stale = s === undefined || nowMs - s.lastPlayedMs > STALE_AFTER_MS;
          return loved && stale;
        })
        .sort((a, b) => score(b) - score(a) || (b.userRating ?? 0) - (a.userRating ?? 0))
        .slice(0, MAX_LIST);
    }
  }
}
