/** Taste expansion: pure planning/lifecycle logic for the optimistic
 *  acquisition feature (see docs/superpowers/specs/2026-06-10-taste-expansion-design.md).
 *  No I/O — the main-process coordinator fetches similar lists / library /
 *  acquisition status and feeds them in. Everything here is unit-tested. */

// ---- Tuning ----------------------------------------------------------------

/** All discovery tuning derived from the single conservative→aggressive
 *  slider (0–100), piecewise-linearly interpolated between anchor points. */
export interface ExpansionParams {
  /** How many taste-profile top artists seed discovery. */
  seedCount: number;
  /** One-hop candidates need at least this last.fm match (0..1). */
  nearMinMatch: number;
  /** Fraction of picks that should be two-hop "far" bets (0..1). */
  farShare: number;
  /** Two-hop candidates must match back to every seed BELOW this (0..1). */
  farMaxSeedMatch: number;
  /** Weighted plays a landed artist needs before deepening. */
  deepenAfterPlays: number;
  /** At the aggressive end, deepening monitors the whole artist. */
  deepenMonitorsArtist: boolean;
}

const ANCHORS = {
  seedCount: [5, 10, 20],
  nearMinMatch: [0.7, 0.55, 0.4],
  farShare: [0.1, 0.3, 0.5],
  farMaxSeedMatch: [0.3, 0.45, 0.6],
  deepenAfterPlays: [10, 6, 3],
} as const;

function lerp3(anchor: readonly [number, number, number], t: number): number {
  // t in 0..100; anchors at 0 / 50 / 100.
  if (t <= 50) return anchor[0] + (anchor[1] - anchor[0]) * (t / 50);
  return anchor[1] + (anchor[2] - anchor[1]) * ((t - 50) / 50);
}

export function expansionParams(aggressiveness: number): ExpansionParams {
  const t = Math.min(100, Math.max(0, aggressiveness));
  return {
    seedCount: Math.round(lerp3(ANCHORS.seedCount, t)),
    nearMinMatch: lerp3(ANCHORS.nearMinMatch, t),
    farShare: lerp3(ANCHORS.farShare, t),
    farMaxSeedMatch: lerp3(ANCHORS.farMaxSeedMatch, t),
    deepenAfterPlays: Math.round(lerp3(ANCHORS.deepenAfterPlays, t)),
    deepenMonitorsArtist: t >= 80,
  };
}

// ---- Ledger ----------------------------------------------------------------

export type ExpansionEntryState =
  | "suggested" // planned this cycle; becomes "requested" once sent to the provider
  | "requested"
  | "landed"
  | "abandoned"
  | "rejected";

export interface ExpansionProvenance {
  /** Taste-profile artist this pick traces back to. */
  seed: string;
  /** last.fm match score of the final hop (0..1). */
  match: number;
  hop: 1 | 2;
  /** Two-hop: the intermediate artist. */
  via?: string;
}

export interface ExpansionEntry {
  /** lower(artistName) — dedupe / blacklist key. */
  artistKey: string;
  artistName: string;
  albumTitle: string;
  /** Acquisition handle once resolved against the provider. */
  providerRef?: string;
  /** Plugin that took the acquisition (routes retries/cancels back to it). */
  providerId?: string;
  /** Human-readable annotation for the feed (e.g. why it was abandoned). */
  note?: string;
  state: ExpansionEntryState;
  /** One re-search has already been issued. */
  retried: boolean;
  provenance: ExpansionProvenance;
  /** True when this acquires MORE of an artist that already landed. */
  deepening: boolean;
  createdAt: number;
  requestedAt?: number;
  landedAt?: number;
  abandonedAt?: number;
  rejectedAt?: number;
}

export function artistKeyOf(name: string): string {
  return name.trim().toLowerCase();
}

export function albumKeyOf(artistName: string, albumTitle: string): string {
  return `${artistKeyOf(artistName)}␟${albumTitle.trim().toLowerCase()}`;
}

// ---- Budget ----------------------------------------------------------------

export const BUDGET_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/** Attempts consuming budget: requested within the trailing window and not
 *  abandoned/rejected (abandonment refunds the slot so a replacement can be
 *  tried — the "try something else" rule). Landed attempts keep counting for
 *  the rest of their window. */
export function budgetUsed(ledger: ExpansionEntry[], now: number): number {
  return ledger.filter(
    (e) =>
      (e.state === "requested" || e.state === "landed") &&
      e.requestedAt !== undefined &&
      now - e.requestedAt < BUDGET_WINDOW_MS,
  ).length;
}

// ---- Candidate planning ----------------------------------------------------

export interface SimilarNeighbor {
  name: string;
  /** 0..1; absent treated as 0 (provider gave no score). */
  match?: number;
}

export interface CandidatePick {
  artistName: string;
  score: number;
  provenance: ExpansionProvenance;
}

export interface PlanArgs {
  /** Taste-profile top artists, best first (scores arbitrary positive). */
  seeds: { name: string; score: number }[];
  /** lower(artist) → its similar-artist list. Must contain entries for the
   *  seeds (one-hop); entries for near candidates enable two-hop "far" picks. */
  similarOf: Map<string, SimilarNeighbor[]>;
  /** lower(artist) for everything already in the library. */
  ownedArtistKeys: Set<string>;
  /** Full ledger — every state excludes the artist from re-suggestion. */
  ledger: ExpansionEntry[];
  params: ExpansionParams;
  /** How many picks to return (typically the remaining weekly budget). */
  count: number;
}

/** Blend near (one-hop) and far (two-hop) candidates per the slider params.
 *  Returns up to `count` picks, best first, each with provenance. Shortfall in
 *  one pool is filled from the other. */
export function planPicks(args: PlanArgs): CandidatePick[] {
  const { similarOf, ownedArtistKeys, params, count } = args;
  if (count <= 0) return [];

  const excluded = new Set(ownedArtistKeys);
  for (const e of args.ledger) excluded.add(e.artistKey);

  const seeds = args.seeds.slice(0, params.seedCount);
  const maxSeedScore = seeds[0]?.score ?? 1;
  for (const s of seeds) excluded.add(artistKeyOf(s.name));

  // One-hop pool; also remember each seed's neighbor matches for the far pass.
  const seedNeighborMatch = new Map<string, number>(); // candidateKey -> best match to ANY seed
  const near = new Map<string, CandidatePick>();
  const nearScoreByKey = new Map<string, number>();
  for (const seed of seeds) {
    const seedWeight = maxSeedScore > 0 ? seed.score / maxSeedScore : 1;
    const neighbors = similarOf.get(artistKeyOf(seed.name)) ?? [];
    for (const n of neighbors) {
      const key = artistKeyOf(n.name);
      const match = n.match ?? 0;
      seedNeighborMatch.set(key, Math.max(seedNeighborMatch.get(key) ?? 0, match));
      if (excluded.has(key) || match < params.nearMinMatch) continue;
      const score = match * seedWeight;
      if ((near.get(key)?.score ?? -1) < score) {
        near.set(key, {
          artistName: n.name,
          score,
          provenance: { seed: seed.name, match, hop: 1 },
        });
        nearScoreByKey.set(key, score);
      }
    }
  }

  // Two-hop pool: neighbors of near candidates that are only weakly connected
  // to the seeds directly — adjacent to the user's taste, but a step beyond.
  const far = new Map<string, CandidatePick>();
  for (const [viaKey, viaPick] of near) {
    const viaNeighbors = similarOf.get(viaKey);
    if (!viaNeighbors) continue; // coordinator only expands a few vias
    for (const n of viaNeighbors) {
      const key = artistKeyOf(n.name);
      if (excluded.has(key) || near.has(key)) continue;
      const directMatch = seedNeighborMatch.get(key) ?? 0;
      if (directMatch > params.farMaxSeedMatch) continue;
      const match = n.match ?? 0;
      if (match < params.nearMinMatch) continue; // must be a STRONG neighbor of the via
      const score = match * (nearScoreByKey.get(viaKey) ?? 0);
      if ((far.get(key)?.score ?? -1) < score) {
        far.set(key, {
          artistName: n.name,
          score,
          provenance: { seed: viaPick.provenance.seed, match, hop: 2, via: viaPick.artistName },
        });
      }
    }
  }

  const nearRanked = [...near.values()].sort((a, b) => b.score - a.score);
  const farRanked = [...far.values()].sort((a, b) => b.score - a.score);

  const farWanted = Math.round(count * params.farShare);
  const picks: CandidatePick[] = [];
  const taken = new Set<string>();
  const take = (pool: CandidatePick[], n: number) => {
    for (const p of pool) {
      if (picks.length >= count || n <= 0) return;
      const key = artistKeyOf(p.artistName);
      if (taken.has(key)) continue;
      taken.add(key);
      picks.push(p);
      n--;
    }
  };
  take(farRanked, farWanted);
  take(nearRanked, count - picks.length);
  take(farRanked, count - picks.length); // backfill if near ran short
  return picks;
}

// ---- Attempt lifecycle -----------------------------------------------------

/** Not-found-yet attempts get one re-search after this long, and are
 *  abandoned (slot refunded, replacement picked) after a second wait. */
export const STALL_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface AttemptActions {
  /** Mark landed (visible in the library now). */
  land: ExpansionEntry[];
  /** Re-issue the acquisition search (set retried, refresh requestedAt). */
  retry: ExpansionEntry[];
  /** Give up: unmonitor in the provider, mark abandoned, refund budget. */
  abandon: ExpansionEntry[];
}

export interface AdvanceArgs {
  ledger: ExpansionEntry[];
  /** lower(artist) for every library artist (lands discovery picks). */
  libraryArtistKeys: Set<string>;
  /** albumKeyOf(artist, album) for owned albums (lands deepening picks,
   *  whose artists are owned by definition). */
  ownedAlbumKeys: Set<string>;
  /** lower(artist) for items currently in the provider's queue/downloading —
   *  in-flight attempts are never stalled, regardless of age. */
  inFlightArtistKeys: Set<string>;
  now: number;
}

export function advanceAttempts(args: AdvanceArgs): AttemptActions {
  const actions: AttemptActions = { land: [], retry: [], abandon: [] };
  for (const e of args.ledger) {
    if (e.state !== "requested" || e.requestedAt === undefined) continue;
    const landed = e.deepening
      ? args.ownedAlbumKeys.has(albumKeyOf(e.artistName, e.albumTitle))
      : args.libraryArtistKeys.has(e.artistKey);
    if (landed) {
      actions.land.push(e);
      continue;
    }
    if (args.inFlightArtistKeys.has(e.artistKey)) continue; // downloading — wait
    if (args.now - e.requestedAt < STALL_WINDOW_MS) continue; // still fresh
    if (!e.retried) actions.retry.push(e);
    else actions.abandon.push(e);
  }
  return actions;
}

// ---- Deepening -------------------------------------------------------------

export interface DeepeningArgs {
  ledger: ExpansionEntry[];
  /** lower(artist) → weighted plays (coordinator aggregates taste stats). */
  artistPlays: Map<string, number>;
  params: ExpansionParams;
}

/** Landed discovery artists whose plays crossed the slider threshold and that
 *  have no deepening attempt (any state) yet. The bet paid off — go deeper. */
export function deepeningCandidates(args: DeepeningArgs): ExpansionEntry[] {
  const alreadyDeepened = new Set(args.ledger.filter((e) => e.deepening).map((e) => e.artistKey));
  const rejected = new Set(
    args.ledger.filter((e) => e.state === "rejected").map((e) => e.artistKey),
  );
  return args.ledger.filter(
    (e) =>
      e.state === "landed" &&
      !e.deepening &&
      !alreadyDeepened.has(e.artistKey) &&
      !rejected.has(e.artistKey) &&
      (args.artistPlays.get(e.artistKey) ?? 0) >= args.params.deepenAfterPlays,
  );
}
