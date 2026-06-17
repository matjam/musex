import type { Track } from "../models/index";
import { KEY_SEPARATOR } from "./taste-profile";

/** The canned smart playlists (sidebar "Smart" section). */
export type SmartKind = "for-you" | "top-rated" | "heavy-rotation" | "rediscover";

export const SMART_TITLES: Record<SmartKind, string> = {
  "for-you": "For You",
  "top-rated": "Top Rated",
  "heavy-rotation": "Heavy Rotation",
  rediscover: "Rediscover",
};

/** Tile descriptions (Home "Smart Mixes" row) — every card gets one so the
 *  smart and mood tiles share the same structure and align. */
export const SMART_DESCRIPTIONS: Record<SmartKind, string> = {
  "for-you": "Fresh picks from your favorite artists and their neighbors.",
  "top-rated": "Everything you've rated four stars and up.",
  "heavy-rotation": "The tracks you keep coming back to.",
  rediscover: "Old favorites you haven't played in a while.",
};

/** Plex 0–10 rating at/above which a track counts as "loved" (8 = 4 stars). */
export const LOVED_RATING = 8;
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

/** Up to the first 8 top-taste artists feed the For You tile art. */
const FOR_YOU_ART_ARTISTS = 8;

function dedupedThumbs(thumbs: (string | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of thumbs) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Album-art candidates for a smart-mix tile collage. Rule-based kinds reuse
 *  the real playlist computation (track thumb = album art). "for-you"'s full
 *  composition is a multi-IPC fan-out — far too heavy for a Home tile — so it
 *  approximates with the top-taste artists' track art. */
export function smartMixThumbs(
  kind: SmartKind,
  tracks: Track[],
  stats: SmartTrackStat[],
  artistScores: { name: string; score: number }[],
  nowMs: number,
): string[] {
  if (kind === "for-you") {
    const top = new Set(
      artistScores.slice(0, FOR_YOU_ART_ARTISTS).map((a) => a.name.toLowerCase()),
    );
    return dedupedThumbs(
      tracks.filter((t) => top.has(t.artistName.toLowerCase())).map((t) => t.thumb),
    );
  }
  return dedupedThumbs(
    computeSmartPlaylist(kind, tracks, stats, artistScores, nowMs).map((t) => t.thumb),
  );
}

/** True when a smart mix would compose to nothing (its Home tile hides).
 *  "for-you" approximates: it composes from the top-taste artists, so an
 *  empty taste profile means an empty mix. */
export function smartMixEmpty(
  kind: SmartKind,
  tracks: Track[],
  stats: SmartTrackStat[],
  artistScores: { name: string; score: number }[],
  nowMs: number,
): boolean {
  if (kind === "for-you") return artistScores.length === 0;
  return computeSmartPlaylist(kind, tracks, stats, artistScores, nowMs).length === 0;
}

/**
 * Pure smart-playlist rules: select + order library tracks for one canned
 * kind, joining main's taste-profile stats by artist+title key. No I/O, no
 * clock — `nowMs` is injected. "for-you" is NOT handled here — it has its own
 * multi-source composer (`logic/for-you.ts`) and the view branches to it.
 */
export function computeSmartPlaylist(
  kind: Exclude<SmartKind, "for-you">,
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
