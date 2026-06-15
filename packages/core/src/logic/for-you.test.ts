import { describe, expect, it } from "vitest";
import type { Track } from "../models/index";
import { composeForYou, type ForYouInput, type ForYouTrackStat } from "./for-you";
import { smartTrackKey } from "./smart-playlists";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_000_000_000_000;

function track(over: Partial<Track> & { title: string; artistName: string }): Track {
  return {
    id: `${over.artistName}/${over.title}`,
    serverId: "srv",
    albumId: "alb",
    artistId: over.artistName, // tests key tracksByArtist by artist name for readability
    durationMs: 200_000,
    media: { container: "flac", audioCodec: "flac", partId: "p1", partKey: "/k" },
    ...over,
  };
}

function statsOf(
  entries: [{ artistName: string; title: string }, Partial<ForYouTrackStat>][],
): Map<string, ForYouTrackStat> {
  return new Map(
    entries.map(([t, over]) => [
      smartTrackKey(t),
      { plays: 0, skips: 0, lastPlayedMs: NOW, ...over },
    ]),
  );
}

function input(over: Partial<ForYouInput>): ForYouInput {
  return {
    ownTop: [],
    similarOwned: [],
    tracksByArtist: new Map(),
    stats: new Map(),
    nowMs: NOW,
    ...over,
  };
}

/** One own artist with the given tracks/stats — the common single-artist case. */
function singleArtist(tracks: Track[], stats: Map<string, ForYouTrackStat>): ForYouInput {
  const artistId = tracks[0]?.artistId ?? "A";
  return input({
    ownTop: [{ artistId, name: artistId, score: 10 }],
    tracksByArtist: new Map([[artistId, tracks]]),
    stats,
  });
}

describe("composeForYou — scoring", () => {
  it("never-played tracks (+3) outrank recently played ones (0)", () => {
    const fresh = track({ title: "Fresh", artistName: "A" });
    const heard = track({ title: "Heard", artistName: "A" });
    const stats = statsOf([[heard, { plays: 5, lastPlayedMs: NOW - DAY_MS }]]);
    const out = composeForYou(singleArtist([heard, fresh], stats));
    expect(out.map((t) => t.title)).toEqual(["Fresh", "Heard"]);
  });

  it("a track with no stat entry counts as never played (+3)", () => {
    const unknown = track({ title: "Unknown", artistName: "A" });
    const recent = track({ title: "Recent", artistName: "A" });
    const stats = statsOf([[recent, { plays: 1, lastPlayedMs: NOW - DAY_MS }]]);
    const out = composeForYou(singleArtist([recent, unknown], stats));
    expect(out.map((t) => t.title)).toEqual(["Unknown", "Recent"]);
  });

  it("staleness tiers: >90d (+2) beats >30d (+1) beats recent (0)", () => {
    const ancient = track({ title: "Ancient", artistName: "A" });
    const stale = track({ title: "Stale", artistName: "A" });
    const recent = track({ title: "Recent", artistName: "A" });
    const stats = statsOf([
      [ancient, { plays: 1, lastPlayedMs: NOW - 91 * DAY_MS }],
      [stale, { plays: 1, lastPlayedMs: NOW - 31 * DAY_MS }],
      [recent, { plays: 1, lastPlayedMs: NOW - DAY_MS }],
    ]);
    const out = composeForYou(singleArtist([recent, stale, ancient], stats));
    expect(out.map((t) => t.title)).toEqual(["Ancient", "Stale", "Recent"]);
  });

  it("applies the staleness boundaries exactly (90d/30d are NOT past the threshold)", () => {
    const at90 = track({ title: "At90", artistName: "A" });
    const at30 = track({ title: "At30", artistName: "A" });
    const just31 = track({ title: "Just31", artistName: "A" });
    const stats = statsOf([
      [at90, { plays: 1, lastPlayedMs: NOW - 90 * DAY_MS }], // exactly 90d → +1 tier only
      [at30, { plays: 1, lastPlayedMs: NOW - 30 * DAY_MS }], // exactly 30d → no bonus
      [just31, { plays: 1, lastPlayedMs: NOW - 31 * DAY_MS }], // > 30d → +1
    ]);
    const out = composeForYou(singleArtist([at30, at90, just31], stats));
    // at90 and just31 both score +1; tie broken by title (At90 < Just31).
    expect(out.map((t) => t.title)).toEqual(["At90", "Just31", "At30"]);
  });

  it("rating bonus adds (stars − 3): 5 stars +2, 1 star −2", () => {
    const loved = track({ title: "Loved", artistName: "A" });
    const hated = track({ title: "Hated", artistName: "A" });
    const neutral = track({ title: "Neutral", artistName: "A" });
    const stats = statsOf([
      [loved, { plays: 1, lastPlayedMs: NOW, ratingStars: 5 }],
      [hated, { plays: 1, lastPlayedMs: NOW, ratingStars: 1 }],
      [neutral, { plays: 1, lastPlayedMs: NOW, ratingStars: null }],
    ]);
    const out = composeForYou(singleArtist([hated, neutral, loved], stats));
    expect(out.map((t) => t.title)).toEqual(["Loved", "Neutral", "Hated"]);
  });

  it("skip penalty subtracts 0.5 per skip", () => {
    const clean = track({ title: "Clean", artistName: "A" });
    const skipped = track({ title: "Skipped", artistName: "A" });
    const stats = statsOf([
      [clean, { plays: 2, lastPlayedMs: NOW }],
      [skipped, { plays: 2, skips: 2, lastPlayedMs: NOW }],
    ]);
    const out = composeForYou(singleArtist([skipped, clean], stats));
    expect(out.map((t) => t.title)).toEqual(["Clean", "Skipped"]);
  });

  it("tracks from similar-owned artists get +1 over identical own-artist tracks", () => {
    const own = track({ title: "Same", artistName: "Own" });
    const disc = track({ title: "Same", artistName: "Disc" });
    const out = composeForYou(
      input({
        ownTop: [{ artistId: "Own", name: "Own", score: 10 }],
        similarOwned: [{ artistId: "Disc", name: "Disc", viaArtist: "Own" }],
        tracksByArtist: new Map([
          ["Own", [own]],
          ["Disc", [disc]],
        ]),
      }),
    );
    expect(out.map((t) => t.artistName)).toEqual(["Disc", "Own"]);
  });

  it("an artist in both ownTop and similarOwned counts as own (no +1)", () => {
    const both = track({ title: "Track", artistName: "Both" });
    const other = track({ title: "Track", artistName: "Other" });
    const out = composeForYou(
      input({
        ownTop: [{ artistId: "Both", name: "Both", score: 10 }],
        similarOwned: [
          { artistId: "Both", name: "Both", viaArtist: "X" },
          { artistId: "Other", name: "Other", viaArtist: "X" },
        ],
        tracksByArtist: new Map([
          ["Both", [both]],
          ["Other", [other]],
        ]),
      }),
    );
    expect(out.map((t) => t.artistName)).toEqual(["Other", "Both"]);
  });
});

describe("composeForYou — exclusion", () => {
  it("excludes tracks with skips >= 3 and plays <= 1", () => {
    const rejected = track({ title: "Rejected", artistName: "A" });
    const keeper = track({ title: "Keeper", artistName: "A" });
    const stats = statsOf([
      [rejected, { plays: 1, skips: 3, lastPlayedMs: NOW - 100 * DAY_MS }],
      [keeper, { plays: 0, skips: 0 }],
    ]);
    const out = composeForYou(singleArtist([rejected, keeper], stats));
    expect(out.map((t) => t.title)).toEqual(["Keeper"]);
  });

  it("keeps a much-skipped track if it also has plays > 1", () => {
    const conflicted = track({ title: "Conflicted", artistName: "A" });
    const stats = statsOf([[conflicted, { plays: 2, skips: 5, lastPlayedMs: NOW }]]);
    const out = composeForYou(singleArtist([conflicted], stats));
    expect(out.map((t) => t.title)).toEqual(["Conflicted"]);
  });

  it("keeps a never-played track with only 2 skips", () => {
    const t = track({ title: "TwoSkips", artistName: "A" });
    const stats = statsOf([[t, { plays: 0, skips: 2, lastPlayedMs: NOW }]]);
    expect(composeForYou(singleArtist([t], stats))).toHaveLength(1);
  });
});

describe("composeForYou — interleave and caps", () => {
  it("caps each artist at 4 tracks even when it has 20 great ones", () => {
    const hoarder = Array.from({ length: 20 }, (_, i) =>
      track({ title: `H${String(i).padStart(2, "0")}`, artistName: "Hoarder" }),
    );
    const other = [track({ title: "Only", artistName: "Other" })];
    const out = composeForYou(
      input({
        ownTop: [
          { artistId: "Hoarder", name: "Hoarder", score: 10 },
          { artistId: "Other", name: "Other", score: 5 },
        ],
        tracksByArtist: new Map([
          ["Hoarder", hoarder],
          ["Other", other],
        ]),
      }),
    );
    expect(out.filter((t) => t.artistName === "Hoarder")).toHaveLength(4);
    expect(out).toHaveLength(5);
  });

  it("interleaves artists round-robin: one track per artist per round", () => {
    const mk = (artist: string, n: number) =>
      Array.from({ length: n }, (_, i) => track({ title: `${artist}${i}`, artistName: artist }));
    const out = composeForYou(
      input({
        ownTop: [
          { artistId: "A", name: "A", score: 10 },
          { artistId: "B", name: "B", score: 5 },
        ],
        tracksByArtist: new Map([
          ["A", mk("A", 4)],
          ["B", mk("B", 4)],
        ]),
      }),
    );
    // Every artist appears once before any appears twice, etc.
    const artists = out.map((t) => t.artistName);
    expect(artists.slice(0, 2).sort()).toEqual(["A", "B"]);
    expect(artists.slice(2, 4).sort()).toEqual(["A", "B"]);
    expect(out).toHaveLength(8);
  });

  it("orders within a round by score desc", () => {
    const low = track({ title: "Low", artistName: "LowArtist" });
    const high = track({ title: "High", artistName: "HighArtist" });
    // high never played (+3); low played recently (0)
    const stats = statsOf([[low, { plays: 1, lastPlayedMs: NOW }]]);
    const out = composeForYou(
      input({
        ownTop: [
          { artistId: "LowArtist", name: "LowArtist", score: 10 },
          { artistId: "HighArtist", name: "HighArtist", score: 5 },
        ],
        tracksByArtist: new Map([
          ["LowArtist", [low]],
          ["HighArtist", [high]],
        ]),
        stats,
      }),
    );
    expect(out.map((t) => t.title)).toEqual(["High", "Low"]);
  });

  it("picks each artist's top 4 by score (best tracks survive the per-artist cap)", () => {
    const good = Array.from({ length: 4 }, (_, i) => track({ title: `Good${i}`, artistName: "A" }));
    const bad = Array.from({ length: 4 }, (_, i) => track({ title: `Bad${i}`, artistName: "A" }));
    const stats = statsOf(bad.map((t) => [t, { plays: 3, lastPlayedMs: NOW }]));
    const out = composeForYou(singleArtist([...bad, ...good], stats));
    expect(out.map((t) => t.title).sort()).toEqual(["Good0", "Good1", "Good2", "Good3"]);
  });

  it("caps the mix at 100 tracks", () => {
    const ownTop = Array.from({ length: 30 }, (_, i) => ({
      artistId: `A${i}`,
      name: `A${i}`,
      score: 30 - i,
    }));
    const tracksByArtist = new Map(
      ownTop.map((a) => [
        a.artistId,
        Array.from({ length: 4 }, (_, i) => track({ title: `T${i}`, artistName: a.name })),
      ]),
    );
    const out = composeForYou(input({ ownTop, tracksByArtist }));
    expect(out).toHaveLength(100);
  });

  it("returns empty for empty input", () => {
    expect(composeForYou(input({}))).toEqual([]);
  });

  it("ignores artists with no tracksByArtist entry", () => {
    const out = composeForYou(input({ ownTop: [{ artistId: "Ghost", name: "Ghost", score: 9 }] }));
    expect(out).toEqual([]);
  });
});

describe("composeForYou — determinism", () => {
  it("same input produces the identical output, call after call", () => {
    const mk = (artist: string, n: number) =>
      Array.from({ length: n }, (_, i) => track({ title: `${artist}-${i}`, artistName: artist }));
    const stats = statsOf([
      [
        { artistName: "A", title: "A-0" },
        { plays: 2, lastPlayedMs: NOW - 40 * DAY_MS },
      ],
      [
        { artistName: "B", title: "B-1" },
        { plays: 0, skips: 1, lastPlayedMs: NOW },
      ],
      [
        { artistName: "C", title: "C-2" },
        { plays: 1, ratingStars: 5, lastPlayedMs: NOW },
      ],
    ]);
    const args = input({
      ownTop: [
        { artistId: "A", name: "A", score: 10 },
        { artistId: "B", name: "B", score: 8 },
      ],
      similarOwned: [{ artistId: "C", name: "C", viaArtist: "A" }],
      tracksByArtist: new Map([
        ["A", mk("A", 6)],
        ["B", mk("B", 6)],
        ["C", mk("C", 6)],
      ]),
      stats,
    });
    const first = composeForYou(args);
    const second = composeForYou(args);
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(0);
  });

  it("breaks score ties deterministically (artist, then title, then id)", () => {
    // All tracks identical score (+3 never played); order must be stable.
    const out = composeForYou(
      input({
        ownTop: [
          { artistId: "Zed", name: "Zed", score: 10 },
          { artistId: "Ann", name: "Ann", score: 10 },
        ],
        tracksByArtist: new Map([
          [
            "Zed",
            [track({ title: "B", artistName: "Zed" }), track({ title: "A", artistName: "Zed" })],
          ],
          [
            "Ann",
            [track({ title: "B", artistName: "Ann" }), track({ title: "A", artistName: "Ann" })],
          ],
        ]),
      }),
    );
    expect(out.map((t) => `${t.artistName}/${t.title}`)).toEqual([
      "Ann/A",
      "Zed/A",
      "Ann/B",
      "Zed/B",
    ]);
  });
});
