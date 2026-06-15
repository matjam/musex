import type { Album, Track } from "../models/index";
import { smartTrackKey } from "./smart-playlists";

/** One curated mood mix: keywords are matched as case-insensitive SUBSTRINGS
 *  against each track's genre+mood tags (so "rock" matches "Indie Rock"). */
export interface MoodMix {
  id: string;
  title: string;
  description: string;
  keywords: string[];
}

/** The curated mixes, in display order. Overlap between mixes is natural —
 *  a track may land in several. */
export const MOOD_MIXES: MoodMix[] = [
  {
    id: "driving",
    title: "Open Road",
    description: "Open-road rock, motorik grooves and synthwave for the highway.",
    keywords: [
      "rock",
      "indie",
      "synthwave",
      "new wave",
      "power pop",
      "krautrock",
      "motorik",
      "stoner",
      "surf",
      "britpop",
      "road",
    ],
  },
  {
    id: "workout",
    title: "Sweat It Out",
    description: "High-BPM electronic, metal and hip hop to keep the pace up.",
    keywords: [
      "electronic",
      "dance",
      "edm",
      "drum and bass",
      "dubstep",
      "metal",
      "punk",
      "hip hop",
      "hip-hop",
      "rap",
      "techno",
      "house",
      "hardcore",
      "breakbeat",
      "energetic",
      "aggressive",
    ],
  },
  {
    id: "chill",
    title: "Wind Down",
    description: "Ambient, downtempo and mellow acoustic sounds for winding down.",
    keywords: [
      "ambient",
      "downtempo",
      "chillout",
      "chill",
      "trip hop",
      "trip-hop",
      "lounge",
      "acoustic",
      "folk",
      "dream pop",
      "shoegaze",
      "slowcore",
      "mellow",
      "calm",
      "soft",
    ],
  },
  {
    id: "coding",
    title: "Deep Focus",
    description: "Instrumental, atmospheric and minimal electronic for deep focus.",
    keywords: [
      "ambient",
      "idm",
      "electronic",
      "instrumental",
      "post-rock",
      "post rock",
      "minimal",
      "techno",
      "downtempo",
      "glitch",
      "drone",
      "berlin school",
      "atmospheric",
    ],
  },
  {
    id: "party",
    title: "Dance Floor",
    description: "Disco, funk and upbeat dance-floor fillers to get people moving.",
    keywords: ["dance", "disco", "funk", "pop", "house", "edm", "party", "groovy", "upbeat"],
  },
];

/** True when any (lowercased) keyword is a substring of any (lowercased) tag. */
function tagsMatchKeywords(keywords: string[], tags: string[]): boolean {
  return keywords.some((kw) => tags.some((tag) => tag.includes(kw)));
}

/** True when the album's own genre+mood tags hit any mix keyword
 *  (case-insensitive substring — the same matching composeMoodMix uses). */
export function albumMatchesMix(mix: MoodMix, album: Album): boolean {
  const keywords = mix.keywords.map((k) => k.toLowerCase());
  const tags = [...(album.genres ?? []), ...(album.moods ?? [])].map((t) => t.toLowerCase());
  return tagsMatchKeywords(keywords, tags);
}

/** Albums whose genre+mood tags match the mix — usable without tracks/stats
 *  (e.g. for sampling card collage art). */
export function albumsForMix(mix: MoodMix, albums: Album[]): Album[] {
  return albums.filter((album) => albumMatchesMix(mix, album));
}

/** Per-track stat slice the composer scores against (keyed by smartTrackKey). */
export interface MoodMixStat {
  plays: number;
  skips: number;
  ratingStars?: number | null;
}

/** Artist affinity caps out at this bonus (top taste-profile artist). */
const AFFINITY_MAX_BONUS = 2;
/** Never played at all — surface fresh material. */
const FRESHNESS_BONUS = 1;
/** Each early skip costs this much. */
const SKIP_PENALTY = 0.5;
/** Exclusion: the user keeps skipping it without ever warming to it. */
const EXCLUDE_MIN_SKIPS = 3;
const EXCLUDE_MAX_PLAYS = 1;
/** No artist may dominate the mix. */
const MAX_PER_ARTIST = 5;
/** Total mix size. */
const MAX_MIX = 150;

interface Scored {
  track: Track;
  score: number;
}

/**
 * Pure mood-mix composer: candidate tracks are those whose genre+mood tags
 * (the track's own UNION its album's, matched as case-insensitive substrings)
 * hit any mix keyword. Each candidate is scored by taste-profile artist
 * affinity (normalised to a 0–2 bonus), rating bonus (stars − 3), skip
 * penalty, and a freshness bonus for never-played tracks; chronic skips are
 * dropped. Ordered score desc with artist/title/id tie-breaks, capped at 5
 * tracks per artist and 150 total. No I/O, no randomness — deterministic.
 */
export function composeMoodMix(
  mix: MoodMix,
  albums: Album[],
  tracks: Track[],
  stats: Map<string, MoodMixStat>,
  artistScores: { name: string; score: number }[],
): Track[] {
  const albumById = new Map(albums.map((a) => [a.id, a]));
  const keywords = mix.keywords.map((k) => k.toLowerCase());

  const affinity = new Map(artistScores.map((a) => [a.name.toLowerCase(), a.score]));
  const maxScore = artistScores.reduce((max, a) => Math.max(max, a.score), 0);

  const scored: Scored[] = [];
  for (const track of tracks) {
    const album = albumById.get(track.albumId);
    const tags = [
      ...(track.genres ?? []),
      ...(track.moods ?? []),
      ...(album?.genres ?? []),
      ...(album?.moods ?? []),
    ].map((t) => t.toLowerCase());
    if (!tagsMatchKeywords(keywords, tags)) continue;

    const stat = stats.get(smartTrackKey(track));
    if (stat !== undefined && stat.skips >= EXCLUDE_MIN_SKIPS && stat.plays <= EXCLUDE_MAX_PLAYS) {
      continue;
    }

    let score = 0;
    const artistScore = affinity.get(track.artistName.toLowerCase()) ?? 0;
    if (artistScore > 0 && maxScore > 0) {
      score += (artistScore / maxScore) * AFFINITY_MAX_BONUS;
    }
    const stars = stat?.ratingStars;
    if (stars !== undefined && stars !== null) score += stars - 3;
    score -= (stat?.skips ?? 0) * SKIP_PENALTY;
    if ((stat?.plays ?? 0) === 0) score += FRESHNESS_BONUS;
    scored.push({ track, score });
  }

  scored.sort(byScoreThenIdentity);

  // Walk best-first, taking at most MAX_PER_ARTIST per artist.
  const perArtist = new Map<string, number>();
  const out: Track[] = [];
  for (const { track } of scored) {
    if (out.length >= MAX_MIX) break;
    const artistKey = track.artistId || track.artistName.toLowerCase();
    const taken = perArtist.get(artistKey) ?? 0;
    if (taken >= MAX_PER_ARTIST) continue;
    perArtist.set(artistKey, taken + 1);
    out.push(track);
  }
  return out;
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
