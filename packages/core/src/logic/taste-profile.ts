/** Key separator between lower(artist) and lower(title) in track keys. */
export const KEY_SEPARATOR = "␟";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
/** Score delta for a full play-through (the scrobble gate passed). */
const FULL_PLAY_DELTA = 1;
/** Score delta for an early skip (<60s AND <25% of the track). */
const SKIP_DELTA = -0.3;
/** A star rating contributes (stars − 3) × this to the artist score. */
const STAR_WEIGHT = 1.5;
/** Direct artist ratings count double vs a track rating. */
const ARTIST_RATING_MULTIPLIER = 2;
const MAX_ARTISTS = 500;
const MAX_TRACKS = 2000;

export interface ArtistStat {
  /** First-seen display casing (keys are lowercased). */
  name: string;
  /** Affinity score as of lastSeenMs — decay is applied lazily from there. */
  score: number;
  plays: number;
  skips: number;
  lastSeenMs: number;
  /** The user's direct artist rating (1–5), kept so a re-rate can replace its
   *  previous score contribution exactly. null = unrated. */
  artistRatingStars: number | null;
}

export interface TrackStat {
  artistName: string;
  title: string;
  plays: number;
  skips: number;
  lastPlayedMs: number;
  /** Last track rating (1–5 stars), kept for exact contribution replacement. */
  ratingStars: number | null;
}

export interface TasteState {
  artists: Record<string, ArtistStat>;
  tracks: Record<string, TrackStat>;
}

/** Half-life decay factor for the time elapsed since `sinceMs`. */
function decayFactor(sinceMs: number, nowMs: number): number {
  return 0.5 ** ((nowMs - sinceMs) / NINETY_DAYS_MS);
}

/** Score contribution of a star rating (null = unrated → 0). */
function ratingContribution(stars: number | null): number {
  return stars === null ? 0 : (stars - 3) * STAR_WEIGHT;
}

/**
 * Pure, persisted listening profile: per-artist affinity scores (full plays,
 * early skips, ratings) with 90-day half-life decay, plus per-track play stats.
 * No timers, no I/O — the clock is injected and the caller persists
 * `serialize()` output. Backs `ctx.library.topArtists` / discover seeding and
 * the smart playlists.
 */
export class TasteProfile {
  private state: TasteState = { artists: {}, tracks: {} };

  constructor(private readonly now: () => number = () => Date.now()) {}

  load(state: TasteState): void {
    this.state = structuredClone(state);
  }

  serialize(): TasteState {
    return structuredClone(this.state);
  }

  /** Record the end of a play-through. `partial` (heard some, not enough to
   *  scrobble, not an early skip) only refreshes the track's lastPlayedMs. */
  recordPlay(t: { title: string; artistName: string }, kind: "full" | "skip" | "partial"): void {
    const now = this.now();
    const track = this.ensureTrack(t, now);
    track.lastPlayedMs = now;
    if (kind !== "partial") {
      if (kind === "full") track.plays += 1;
      else track.skips += 1;
      const artist = this.ensureArtist(t.artistName, now);
      artist.score += kind === "full" ? FULL_PLAY_DELTA : SKIP_DELTA;
      if (kind === "full") artist.plays += 1;
      else artist.skips += 1;
    }
    this.enforceCaps();
  }

  /** Track rated (Plex 0–10 scale; null = cleared). The artist score delta is
   *  the new contribution minus the previous one, so re-rating replaces. */
  recordTrackRating(t: { title: string; artistName: string }, rating10: number | null): void {
    const now = this.now();
    const stars = rating10 === null ? null : rating10 / 2;
    const track = this.ensureTrack(t, now);
    const delta = ratingContribution(stars) - ratingContribution(track.ratingStars);
    track.ratingStars = stars;
    this.ensureArtist(t.artistName, now).score += delta;
    this.enforceCaps();
  }

  /** Direct artist rating — same replacement scheme, double weight. */
  recordArtistRating(artistName: string, rating10: number | null): void {
    const now = this.now();
    const stars = rating10 === null ? null : rating10 / 2;
    const artist = this.ensureArtist(artistName, now);
    const delta =
      (ratingContribution(stars) - ratingContribution(artist.artistRatingStars)) *
      ARTIST_RATING_MULTIPLIER;
    artist.artistRatingStars = stars;
    artist.score += delta;
    this.enforceCaps();
  }

  /** Decayed affinity, best first, positive scores only. Read-only. */
  topArtists(limit?: number): { name: string; score: number }[] {
    const now = this.now();
    const list = Object.values(this.state.artists)
      .map((a) => ({ name: a.name, score: a.score * decayFactor(a.lastSeenMs, now) }))
      .filter((a) => a.score > 0)
      .sort((x, y) => y.score - x.score);
    return limit === undefined ? list : list.slice(0, Math.max(0, limit));
  }

  /** All track stats with their key and read-time decayed play count. */
  trackStats(): (TrackStat & { key: string; decayedPlays: number })[] {
    const now = this.now();
    return Object.entries(this.state.tracks).map(([key, t]) => ({
      ...t,
      key,
      decayedPlays: t.plays * decayFactor(t.lastPlayedMs, now),
    }));
  }

  /** Get-or-create the artist stat; decays the existing score up to `now` (the
   *  caller then adds its delta on top of the decayed value). */
  private ensureArtist(name: string, now: number): ArtistStat {
    const key = name.toLowerCase();
    const existing = this.state.artists[key];
    if (existing) {
      existing.score *= decayFactor(existing.lastSeenMs, now);
      existing.lastSeenMs = now;
      return existing;
    }
    const created: ArtistStat = {
      name,
      score: 0,
      plays: 0,
      skips: 0,
      lastSeenMs: now,
      artistRatingStars: null,
    };
    this.state.artists[key] = created;
    return created;
  }

  private ensureTrack(t: { title: string; artistName: string }, now: number): TrackStat {
    const key = `${t.artistName.toLowerCase()}${KEY_SEPARATOR}${t.title.toLowerCase()}`;
    const existing = this.state.tracks[key];
    if (existing) return existing;
    const created: TrackStat = {
      artistName: t.artistName,
      title: t.title,
      plays: 0,
      skips: 0,
      lastPlayedMs: now,
      ratingStars: null,
    };
    this.state.tracks[key] = created;
    return created;
  }

  /** Bound the profile: artists by smallest |score|, tracks by oldest play. */
  private enforceCaps(): void {
    const artists = Object.entries(this.state.artists);
    if (artists.length > MAX_ARTISTS) {
      artists.sort((a, b) => Math.abs(b[1].score) - Math.abs(a[1].score));
      this.state.artists = Object.fromEntries(artists.slice(0, MAX_ARTISTS));
    }
    const tracks = Object.entries(this.state.tracks);
    if (tracks.length > MAX_TRACKS) {
      tracks.sort((a, b) => b[1].lastPlayedMs - a[1].lastPlayedMs);
      this.state.tracks = Object.fromEntries(tracks.slice(0, MAX_TRACKS));
    }
  }
}
