import type { Track } from "@musex/core";
import { smartTrackKey } from "./smart-playlists";

/** Unexplored bonus: never played at all. */
const NEVER_PLAYED_BONUS = 3;
/** Unexplored bonus: not played for more than 90 days. */
const VERY_STALE_BONUS = 2;
/** Unexplored bonus: not played for more than 30 days. */
const STALE_BONUS = 1;
/** Each early skip costs this much. */
const SKIP_PENALTY = 0.5;
/** Tracks from similar-owned (non-seed) artists get the discovery edge. */
const SIMILAR_SOURCE_BONUS = 1;
/** Exclusion: the user keeps skipping it without ever warming to it. */
const EXCLUDE_MIN_SKIPS = 3;
const EXCLUDE_MAX_PLAYS = 1;
/** No artist may dominate the mix. */
const MAX_PER_ARTIST = 4;
/** Total mix size. */
const MAX_MIX = 100;

const DAY_MS = 24 * 60 * 60 * 1000;
const VERY_STALE_MS = 90 * DAY_MS;
const STALE_MS = 30 * DAY_MS;

/** Per-track listening stat the composer scores against (keyed by smartTrackKey). */
export interface ForYouTrackStat {
  plays: number;
  skips: number;
  lastPlayedMs: number;
  ratingStars?: number | null;
}

export interface ForYouInput {
  /** Resolved owned taste-profile top artists (seeds). */
  ownTop: { artistId: string; name: string; score: number }[];
  /** Owned artists similar to a seed (the discovery half). */
  similarOwned: { artistId: string; name: string; viaArtist: string }[];
  /** artistId → that artist's library tracks. */
  tracksByArtist: Map<string, Track[]>;
  /** smartTrackKey → listening stat. */
  stats: Map<string, ForYouTrackStat>;
  nowMs: number;
}

interface Scored {
  track: Track;
  score: number;
}

/**
 * Pure "For You" mix composer: resurfaces under-played tracks from the user's
 * top artists plus owned artists similar to them. Scores every track
 * (unexplored/staleness bonus, rating bonus, skip penalty, similar-source
 * bonus), drops tracks the user keeps skipping, interleaves artists
 * round-robin (max 4 tracks each, best first), and caps at 100. No I/O, no
 * randomness — fully deterministic for a given input.
 */
export function composeForYou(input: ForYouInput): Track[] {
  const { ownTop, similarOwned, tracksByArtist, stats, nowMs } = input;
  const seedIds = new Set(ownTop.map((a) => a.artistId));

  // Artist iteration order: seeds first, then similars, deduped.
  const artistIds: string[] = [];
  const seen = new Set<string>();
  for (const a of [...ownTop, ...similarOwned]) {
    if (seen.has(a.artistId)) continue;
    seen.add(a.artistId);
    artistIds.push(a.artistId);
  }

  // Per-artist: score, exclude, keep the best MAX_PER_ARTIST.
  const picksByArtist: Scored[][] = [];
  for (const artistId of artistIds) {
    const tracks = tracksByArtist.get(artistId);
    if (!tracks || tracks.length === 0) continue;
    const fromSimilar = !seedIds.has(artistId);
    const picks = tracks
      .flatMap((track) => {
        const stat = stats.get(smartTrackKey(track));
        if (excluded(stat)) return [];
        return [{ track, score: scoreTrack(stat, fromSimilar, nowMs) }];
      })
      .sort(byScoreThenIdentity)
      .slice(0, MAX_PER_ARTIST);
    if (picks.length > 0) picksByArtist.push(picks);
  }

  // Interleave: round r takes every artist's r-th pick, best score first.
  const mix: Track[] = [];
  for (let round = 0; round < MAX_PER_ARTIST && mix.length < MAX_MIX; round++) {
    const roundPicks = picksByArtist
      .flatMap((picks) => picks[round] ?? [])
      .sort(byScoreThenIdentity);
    for (const pick of roundPicks) {
      if (mix.length >= MAX_MIX) break;
      mix.push(pick.track);
    }
  }
  return mix;
}

function scoreTrack(
  stat: ForYouTrackStat | undefined,
  fromSimilar: boolean,
  nowMs: number,
): number {
  let score = 0;
  const plays = stat?.plays ?? 0;
  if (plays === 0) {
    score += NEVER_PLAYED_BONUS;
  } else if (stat !== undefined) {
    const sincePlayed = nowMs - stat.lastPlayedMs;
    if (sincePlayed > VERY_STALE_MS) score += VERY_STALE_BONUS;
    else if (sincePlayed > STALE_MS) score += STALE_BONUS;
  }
  const stars = stat?.ratingStars;
  if (stars !== undefined && stars !== null) score += stars - 3;
  score -= (stat?.skips ?? 0) * SKIP_PENALTY;
  if (fromSimilar) score += SIMILAR_SOURCE_BONUS;
  return score;
}

function excluded(stat: ForYouTrackStat | undefined): boolean {
  return stat !== undefined && stat.skips >= EXCLUDE_MIN_SKIPS && stat.plays <= EXCLUDE_MAX_PLAYS;
}

/** Deterministic ordering: score desc, then artist, title, id. */
function byScoreThenIdentity(a: Scored, b: Scored): number {
  return (
    b.score - a.score ||
    a.track.artistName.localeCompare(b.track.artistName) ||
    a.track.title.localeCompare(b.track.title) ||
    a.track.id.localeCompare(b.track.id)
  );
}
