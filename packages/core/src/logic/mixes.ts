import type { Track } from "../models/index";

/** djb2-style string hash (same scheme as collage's sampleThumbs / AlbumArt). */
function hashSeed(seed: string): number {
  let hash = 5381;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 33) ^ seed.charCodeAt(i);
  }
  return hash >>> 0;
}

/** mulberry32 PRNG: a tiny, fast, well-distributed 32-bit generator. Pure —
 *  the seed is injected so core never touches Math.random or the clock. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic Fisher-Yates shuffle seeded from a string. Same seed +
 *  same input order → same output order. Does not mutate the input. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = items.slice();
  const rand = mulberry32(hashSeed(seed) || 1);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const a = out[i] as T;
    const b = out[j] as T;
    out[i] = b;
    out[j] = a;
  }
  return out;
}

/** Default Daily Mix size. */
export const DAILY_MIX_COUNT = 80;

/**
 * Daily Mix: a deterministic seeded shuffle of the whole library, capped at
 * `count`. The caller passes a date string (e.g. "2026-06-18") as the seed so
 * the selection is stable for a day and rotates the next. No clock in core.
 */
export function dailyMix(tracks: Track[], seed: string, count = DAILY_MIX_COUNT): Track[] {
  return seededShuffle(tracks, `daily:${seed}`).slice(0, count);
}

/** The decade a year belongs to (1985 → 1980). */
export function decadeOf(year: number): number {
  return Math.floor(year / 10) * 10;
}

/**
 * Decade mix: every track whose resolved year falls in [decadeStart,
 * decadeStart + 9], seeded-shuffled. `yearOf` resolves a track's year (Track
 * carries no year of its own — the caller joins it to its album's year), so
 * core stays pure and decade-source-agnostic. Tracks with no resolvable year
 * are excluded.
 */
export function decadeMix(
  tracks: Track[],
  decadeStart: number,
  seed: string,
  yearOf: (track: Track) => number | undefined,
): Track[] {
  const inDecade = tracks.filter((t) => {
    const y = yearOf(t);
    return y !== undefined && y >= decadeStart && y <= decadeStart + 9;
  });
  return seededShuffle(inDecade, seed);
}

/** Distinct decade starts present across the given years, newest first. */
export function decadesInLibrary(years: (number | undefined)[]): number[] {
  const seen = new Set<number>();
  for (const y of years) {
    if (y !== undefined) seen.add(decadeOf(y));
  }
  return [...seen].sort((a, b) => b - a);
}
