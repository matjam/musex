import { describe, expect, it } from "vitest";
import {
  advanceAttempts,
  albumKeyOf,
  artistKeyOf,
  BUDGET_WINDOW_MS,
  budgetUsed,
  deepeningCandidates,
  type ExpansionEntry,
  expansionParams,
  planPicks,
  type SimilarNeighbor,
  STALL_WINDOW_MS,
} from "./taste-expansion";

const NOW = 1_750_000_000_000;
const HOUR = 60 * 60 * 1000;

function entry(over: Partial<ExpansionEntry> & { artistName: string }): ExpansionEntry {
  return {
    artistKey: artistKeyOf(over.artistName),
    albumTitle: "Album",
    state: "requested",
    retried: false,
    provenance: { seed: "Seed", match: 0.8, hop: 1 },
    deepening: false,
    createdAt: NOW - HOUR,
    requestedAt: NOW - HOUR,
    ...over,
  };
}

describe("expansionParams", () => {
  it("hits the documented anchors at 0 / 50 / 100", () => {
    expect(expansionParams(0)).toEqual({
      seedCount: 5,
      nearMinMatch: 0.7,
      farShare: 0.1,
      farMaxSeedMatch: 0.3,
      deepenAfterPlays: 10,
      deepenMonitorsArtist: false,
    });
    expect(expansionParams(50)).toEqual({
      seedCount: 10,
      nearMinMatch: 0.55,
      farShare: 0.3,
      farMaxSeedMatch: 0.45,
      deepenAfterPlays: 6,
      deepenMonitorsArtist: false,
    });
    expect(expansionParams(100)).toEqual({
      seedCount: 20,
      nearMinMatch: 0.4,
      farShare: 0.5,
      farMaxSeedMatch: 0.6,
      deepenAfterPlays: 3,
      deepenMonitorsArtist: true,
    });
  });

  it("interpolates between anchors and clamps out-of-range input", () => {
    expect(expansionParams(25).nearMinMatch).toBeCloseTo(0.625);
    expect(expansionParams(75).farShare).toBeCloseTo(0.4);
    expect(expansionParams(-10)).toEqual(expansionParams(0));
    expect(expansionParams(250)).toEqual(expansionParams(100));
    expect(expansionParams(79).deepenMonitorsArtist).toBe(false);
    expect(expansionParams(80).deepenMonitorsArtist).toBe(true);
  });
});

describe("budgetUsed", () => {
  it("counts requested+landed inside the window; abandoned/rejected refund", () => {
    const ledger: ExpansionEntry[] = [
      entry({ artistName: "A", state: "requested", requestedAt: NOW - HOUR }),
      entry({ artistName: "B", state: "landed", requestedAt: NOW - 2 * HOUR }),
      entry({ artistName: "C", state: "abandoned", requestedAt: NOW - HOUR }),
      entry({ artistName: "D", state: "rejected", requestedAt: NOW - HOUR }),
      entry({ artistName: "E", state: "requested", requestedAt: NOW - BUDGET_WINDOW_MS - HOUR }),
    ];
    expect(budgetUsed(ledger, NOW)).toBe(2);
  });
});

describe("planPicks", () => {
  const seeds = [
    { name: "Seed One", score: 10 },
    { name: "Seed Two", score: 5 },
  ];
  const params = {
    seedCount: 10,
    nearMinMatch: 0.5,
    farShare: 0.5,
    farMaxSeedMatch: 0.4,
    deepenAfterPlays: 6,
    deepenMonitorsArtist: false,
  };

  function graph(entries: Record<string, SimilarNeighbor[]>): Map<string, SimilarNeighbor[]> {
    return new Map(Object.entries(entries).map(([k, v]) => [artistKeyOf(k), v]));
  }

  it("ranks one-hop candidates by match x seed weight with provenance", () => {
    const picks = planPicks({
      seeds,
      similarOf: graph({
        "Seed One": [
          { name: "Near A", match: 0.9 },
          { name: "Near B", match: 0.6 },
        ],
        "Seed Two": [{ name: "Near C", match: 0.95 }],
      }),
      ownedArtistKeys: new Set(),
      ledger: [],
      params: { ...params, farShare: 0 },
      count: 3,
    });
    // Near A: 0.9*1.0=0.9; Near C: 0.95*0.5=0.475; Near B: 0.6
    expect(picks.map((p) => p.artistName)).toEqual(["Near A", "Near B", "Near C"]);
    expect(picks[0]?.provenance).toEqual({ seed: "Seed One", match: 0.9, hop: 1 });
  });

  it("excludes owned artists, every ledger state, and the seeds themselves", () => {
    const picks = planPicks({
      seeds,
      similarOf: graph({
        "Seed One": [
          { name: "Owned", match: 0.9 },
          { name: "Tried", match: 0.9 },
          { name: "Rejected", match: 0.9 },
          { name: "Seed Two", match: 0.9 },
          { name: "Fresh", match: 0.8 },
        ],
      }),
      ownedArtistKeys: new Set(["owned"]),
      ledger: [
        entry({ artistName: "Tried", state: "abandoned" }),
        entry({ artistName: "Rejected", state: "rejected" }),
      ],
      params,
      count: 5,
    });
    expect(picks.map((p) => p.artistName)).toEqual(["Fresh"]);
  });

  it("drops one-hop candidates below the near floor", () => {
    const picks = planPicks({
      seeds,
      similarOf: graph({
        "Seed One": [
          { name: "Weak", match: 0.3 },
          { name: "OK", match: 0.55 },
        ],
      }),
      ownedArtistKeys: new Set(),
      ledger: [],
      params,
      count: 5,
    });
    expect(picks.map((p) => p.artistName)).toEqual(["OK"]);
  });

  it("finds two-hop far picks only weakly connected to the seeds, with via provenance", () => {
    const picks = planPicks({
      seeds: [{ name: "Seed One", score: 10 }],
      similarOf: graph({
        "Seed One": [
          { name: "Bridge", match: 0.8 },
          { name: "Too Close", match: 0.45 }, // direct match above farMaxSeedMatch
        ],
        Bridge: [
          { name: "Far Out", match: 0.7 }, // direct seed match 0 -> far pick
          { name: "Too Close", match: 0.9 }, // excluded: direct 0.45 > 0.4 ceiling
        ],
      }),
      ownedArtistKeys: new Set(),
      ledger: [],
      params,
      count: 2,
    });
    const far = picks.find((p) => p.provenance.hop === 2);
    expect(far?.artistName).toBe("Far Out");
    expect(far?.provenance.via).toBe("Bridge");
    expect(far?.provenance.seed).toBe("Seed One");
    expect(picks.map((p) => p.artistName)).toContain("Bridge");
  });

  it("respects the far share and backfills from near when far runs dry", () => {
    const picks = planPicks({
      seeds: [{ name: "Seed One", score: 10 }],
      similarOf: graph({
        "Seed One": [
          { name: "N1", match: 0.9 },
          { name: "N2", match: 0.8 },
          { name: "N3", match: 0.7 },
        ],
      }),
      ownedArtistKeys: new Set(),
      ledger: [],
      params: { ...params, farShare: 0.5 }, // wants 2 far of 4 — none exist
      count: 4,
    });
    expect(picks.map((p) => p.artistName)).toEqual(["N1", "N2", "N3"]);
  });

  it("returns nothing when count is zero", () => {
    expect(
      planPicks({
        seeds,
        similarOf: graph({ "Seed One": [{ name: "X", match: 0.9 }] }),
        ownedArtistKeys: new Set(),
        ledger: [],
        params,
        count: 0,
      }),
    ).toEqual([]);
  });
});

describe("advanceAttempts", () => {
  it("lands a discovery attempt when the artist appears in the library", () => {
    const e = entry({ artistName: "New Artist" });
    const actions = advanceAttempts({
      ledger: [e],
      libraryArtistKeys: new Set(["new artist"]),
      ownedAlbumKeys: new Set(),
      inFlightArtistKeys: new Set(),
      now: NOW,
    });
    expect(actions.land).toEqual([e]);
  });

  it("lands a deepening attempt only when the ALBUM appears (artist is already owned)", () => {
    const e = entry({ artistName: "Known", albumTitle: "Second Album", deepening: true });
    const noAlbum = advanceAttempts({
      ledger: [e],
      libraryArtistKeys: new Set(["known"]), // artist owned — must NOT count as landed
      ownedAlbumKeys: new Set(),
      inFlightArtistKeys: new Set(),
      now: NOW,
    });
    expect(noAlbum.land).toEqual([]);
    const withAlbum = advanceAttempts({
      ledger: [e],
      libraryArtistKeys: new Set(["known"]),
      ownedAlbumKeys: new Set([albumKeyOf("Known", "Second Album")]),
      inFlightArtistKeys: new Set(),
      now: NOW,
    });
    expect(withAlbum.land).toEqual([e]);
  });

  it("waits while in flight, retries once after the stall window, then abandons", () => {
    const stale = entry({ artistName: "Ghost", requestedAt: NOW - STALL_WINDOW_MS - HOUR });

    const inFlight = advanceAttempts({
      ledger: [stale],
      libraryArtistKeys: new Set(),
      ownedAlbumKeys: new Set(),
      inFlightArtistKeys: new Set(["ghost"]),
      now: NOW,
    });
    expect(inFlight).toEqual({ land: [], retry: [], abandon: [] });

    const stalled = advanceAttempts({
      ledger: [stale],
      libraryArtistKeys: new Set(),
      ownedAlbumKeys: new Set(),
      inFlightArtistKeys: new Set(),
      now: NOW,
    });
    expect(stalled.retry).toEqual([stale]);

    const retriedAndStale = entry({
      artistName: "Ghost",
      retried: true,
      requestedAt: NOW - STALL_WINDOW_MS - HOUR,
    });
    const giveUp = advanceAttempts({
      ledger: [retriedAndStale],
      libraryArtistKeys: new Set(),
      ownedAlbumKeys: new Set(),
      inFlightArtistKeys: new Set(),
      now: NOW,
    });
    expect(giveUp.abandon).toEqual([retriedAndStale]);
  });

  it("leaves fresh requests and non-requested states alone", () => {
    const actions = advanceAttempts({
      ledger: [
        entry({ artistName: "Fresh", requestedAt: NOW - HOUR }),
        entry({ artistName: "Done", state: "landed" }),
        entry({ artistName: "Gone", state: "abandoned" }),
      ],
      libraryArtistKeys: new Set(),
      ownedAlbumKeys: new Set(),
      inFlightArtistKeys: new Set(),
      now: NOW,
    });
    expect(actions).toEqual({ land: [], retry: [], abandon: [] });
  });
});

describe("deepeningCandidates", () => {
  const params = expansionParams(50); // deepenAfterPlays 6

  it("returns landed artists past the play threshold, once", () => {
    const landed = entry({ artistName: "Hit", state: "landed" });
    const out = deepeningCandidates({
      ledger: [landed],
      artistPlays: new Map([["hit", 6]]),
      params,
    });
    expect(out).toEqual([landed]);
  });

  it("skips under-threshold, already-deepened, and rejected artists", () => {
    const ledger: ExpansionEntry[] = [
      entry({ artistName: "Quiet", state: "landed" }),
      entry({ artistName: "Deep", state: "landed" }),
      entry({ artistName: "Deep", albumTitle: "Second", deepening: true, state: "requested" }),
      entry({ artistName: "Nope", state: "landed" }),
      entry({ artistName: "Nope", state: "rejected" }),
    ];
    const out = deepeningCandidates({
      ledger,
      artistPlays: new Map([
        ["quiet", 2],
        ["deep", 20],
        ["nope", 20],
      ]),
      params,
    });
    expect(out).toEqual([]);
  });
});
