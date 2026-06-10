import { beforeEach, describe, expect, it } from "vitest";
import { KEY_SEPARATOR, TasteProfile, type TasteState } from "./taste-profile";

const DAY_MS = 24 * 60 * 60 * 1000;
const NINETY_DAYS_MS = 90 * DAY_MS;

const t = (title: string, artistName = "Lamb") => ({ title, artistName });

let nowMs: number;
let profile: TasteProfile;

beforeEach(() => {
  nowMs = 1_000_000_000;
  profile = new TasteProfile(() => nowMs);
});

function artistStat(name: string) {
  return profile.serialize().artists[name.toLowerCase()];
}
function trackStat(artist: string, title: string) {
  return profile.serialize().tracks[
    `${artist.toLowerCase()}${KEY_SEPARATOR}${title.toLowerCase()}`
  ];
}

describe("TasteProfile.recordPlay", () => {
  it("full play: +1 artist score, play counted on artist and track", () => {
    profile.recordPlay(t("Gorecki"), "full");
    expect(artistStat("Lamb")).toEqual({
      name: "Lamb",
      score: 1,
      plays: 1,
      skips: 0,
      lastSeenMs: nowMs,
      artistRatingStars: null,
    });
    expect(trackStat("Lamb", "Gorecki")).toEqual({
      artistName: "Lamb",
      title: "Gorecki",
      plays: 1,
      skips: 0,
      lastPlayedMs: nowMs,
      ratingStars: null,
    });
  });

  it("skip: −0.3 artist score, skip counted on artist and track, no plays", () => {
    profile.recordPlay(t("Gorecki"), "skip");
    const a = artistStat("Lamb");
    expect(a?.score).toBeCloseTo(-0.3);
    expect(a?.plays).toBe(0);
    expect(a?.skips).toBe(1);
    const tr = trackStat("Lamb", "Gorecki");
    expect(tr?.plays).toBe(0);
    expect(tr?.skips).toBe(1);
    expect(tr?.lastPlayedMs).toBe(nowMs);
  });

  it("partial: only the track's lastPlayedMs — no artist entry, no plays/skips", () => {
    profile.recordPlay(t("Gorecki"), "partial");
    expect(artistStat("Lamb")).toBeUndefined();
    expect(trackStat("Lamb", "Gorecki")).toEqual({
      artistName: "Lamb",
      title: "Gorecki",
      plays: 0,
      skips: 0,
      lastPlayedMs: nowMs,
      ratingStars: null,
    });
  });

  it("partial on an existing profile leaves the artist score/plays untouched", () => {
    profile.recordPlay(t("Gorecki"), "full");
    const before = artistStat("Lamb");
    nowMs += DAY_MS;
    profile.recordPlay(t("Gorecki"), "partial");
    expect(artistStat("Lamb")).toEqual(before); // lastSeenMs unchanged too
    expect(trackStat("Lamb", "Gorecki")?.lastPlayedMs).toBe(nowMs);
    expect(trackStat("Lamb", "Gorecki")?.plays).toBe(1);
  });

  it("keys are case-insensitive: lower(artist) ␟ lower(title)", () => {
    profile.recordPlay({ title: "Gorecki", artistName: "Lamb" }, "full");
    profile.recordPlay({ title: "GORECKI", artistName: "LAMB" }, "full");
    const state = profile.serialize();
    expect(Object.keys(state.artists)).toEqual(["lamb"]);
    expect(Object.keys(state.tracks)).toEqual([`lamb${KEY_SEPARATOR}gorecki`]);
    expect(state.artists.lamb?.score).toBe(2);
    expect(state.artists.lamb?.name).toBe("Lamb"); // first-seen casing kept
    expect(state.tracks[`lamb${KEY_SEPARATOR}gorecki`]?.plays).toBe(2);
  });
});

describe("TasteProfile ratings", () => {
  it("track rating contributes (stars−3)×1.5 to the artist", () => {
    profile.recordTrackRating(t("Gorecki"), 8); // 4★ → +1.5
    expect(artistStat("Lamb")?.score).toBeCloseTo(1.5);
    expect(trackStat("Lamb", "Gorecki")?.ratingStars).toBe(4);
  });

  it("re-rating replaces the previous contribution (4★ → 2★ → clear nets 0)", () => {
    profile.recordTrackRating(t("Gorecki"), 8); // +1.5
    expect(artistStat("Lamb")?.score).toBeCloseTo(1.5);
    profile.recordTrackRating(t("Gorecki"), 4); // 2★ → contribution −1.5
    expect(artistStat("Lamb")?.score).toBeCloseTo(-1.5);
    profile.recordTrackRating(t("Gorecki"), null); // cleared → contribution 0
    expect(artistStat("Lamb")?.score).toBeCloseTo(0);
    expect(trackStat("Lamb", "Gorecki")?.ratingStars).toBeNull();
  });

  it("rating a never-played track stores ratingStars without counting a play", () => {
    profile.recordTrackRating(t("Gorecki"), 10);
    const tr = trackStat("Lamb", "Gorecki");
    expect(tr?.plays).toBe(0);
    expect(tr?.ratingStars).toBe(5);
  });

  it("rating does not disturb play counts or decay anchor on the track", () => {
    profile.recordPlay(t("Gorecki"), "full");
    const playedAt = nowMs;
    nowMs += DAY_MS;
    profile.recordTrackRating(t("Gorecki"), 8);
    const tr = trackStat("Lamb", "Gorecki");
    expect(tr?.plays).toBe(1);
    expect(tr?.lastPlayedMs).toBe(playedAt); // rating is not a play
  });

  it("artist rating uses double weight and replaces its previous contribution", () => {
    profile.recordArtistRating("Lamb", 10); // 5★ → (5−3)×1.5×2 = +6
    expect(artistStat("Lamb")?.score).toBeCloseTo(6);
    profile.recordArtistRating("Lamb", 2); // 1★ → (1−3)×1.5×2 = −6
    expect(artistStat("Lamb")?.score).toBeCloseTo(-6);
    profile.recordArtistRating("Lamb", null); // cleared → 0
    expect(artistStat("Lamb")?.score).toBeCloseTo(0);
  });
});

describe("TasteProfile decay", () => {
  it("decays the artist score before applying a new delta (half-life 90 days)", () => {
    profile.recordPlay(t("Gorecki"), "full"); // score 1
    nowMs += NINETY_DAYS_MS;
    profile.recordPlay(t("Gabriel"), "full"); // 1×0.5 + 1
    expect(artistStat("Lamb")?.score).toBeCloseTo(1.5);
    expect(artistStat("Lamb")?.lastSeenMs).toBe(nowMs);
  });

  it("topArtists applies read-time decay without mutating stored scores", () => {
    profile.recordPlay(t("Gorecki"), "full");
    nowMs += NINETY_DAYS_MS;
    expect(profile.topArtists()).toEqual([{ name: "Lamb", score: expect.closeTo(0.5) }]);
    expect(profile.topArtists()).toEqual([{ name: "Lamb", score: expect.closeTo(0.5) }]);
    expect(artistStat("Lamb")?.score).toBe(1); // stored score untouched
    nowMs += NINETY_DAYS_MS;
    expect(profile.topArtists()[0]?.score).toBeCloseTo(0.25);
  });

  it("trackStats reports decayed plays (halved at 90 days) without mutating", () => {
    profile.recordPlay(t("Gorecki"), "full");
    profile.recordPlay(t("Gorecki"), "full");
    nowMs += NINETY_DAYS_MS;
    const stats = profile.trackStats();
    expect(stats).toHaveLength(1);
    expect(stats[0]?.key).toBe(`lamb${KEY_SEPARATOR}gorecki`);
    expect(stats[0]?.plays).toBe(2);
    expect(stats[0]?.decayedPlays).toBeCloseTo(1);
  });
});

describe("TasteProfile.topArtists", () => {
  it("sorts by decayed score descending, filters non-positive, respects limit", () => {
    profile.recordPlay(t("A1", "Alpha"), "full");
    profile.recordPlay(t("A2", "Alpha"), "full"); // Alpha = 2
    profile.recordPlay(t("B1", "Beta"), "full"); // Beta = 1
    profile.recordPlay(t("C1", "Gamma"), "skip"); // Gamma = −0.3 → filtered
    expect(profile.topArtists().map((a) => a.name)).toEqual(["Alpha", "Beta"]);
    expect(profile.topArtists(1).map((a) => a.name)).toEqual(["Alpha"]);
  });
});

describe("TasteProfile caps", () => {
  it("caps artists at 500, dropping the smallest |score|", () => {
    profile.recordPlay(t("S", "Weakest"), "skip"); // |−0.3| — smallest
    for (let i = 0; i < 500; i++) profile.recordPlay(t("T", `Artist${i}`), "full"); // |1|
    const artists = profile.serialize().artists;
    expect(Object.keys(artists)).toHaveLength(500);
    expect(artists.weakest).toBeUndefined();
    expect(artists.artist0).toBeDefined();
    expect(artists.artist499).toBeDefined();
  });

  it("caps tracks at 2000, dropping the oldest lastPlayedMs", () => {
    for (let i = 0; i < 2001; i++) {
      profile.recordPlay(t(`Track${i}`, "Lamb"), "full");
      nowMs += 1000;
    }
    const tracks = profile.serialize().tracks;
    expect(Object.keys(tracks)).toHaveLength(2000);
    expect(tracks[`lamb${KEY_SEPARATOR}track0`]).toBeUndefined(); // oldest evicted
    expect(tracks[`lamb${KEY_SEPARATOR}track1`]).toBeDefined();
    expect(tracks[`lamb${KEY_SEPARATOR}track2000`]).toBeDefined();
  });
});

describe("TasteProfile serialize/load", () => {
  it("round-trips state through serialize → load", () => {
    profile.recordPlay(t("Gorecki"), "full");
    profile.recordPlay(t("Gabriel"), "skip");
    profile.recordTrackRating(t("Gorecki"), 8);
    profile.recordArtistRating("Lamb", 6);
    const state: TasteState = profile.serialize();

    const restored = new TasteProfile(() => nowMs);
    restored.load(state);
    expect(restored.serialize()).toEqual(state);
    expect(restored.topArtists()).toEqual(profile.topArtists());
    expect(restored.trackStats()).toEqual(profile.trackStats());
  });

  it("load copies the state — later external mutation does not leak in", () => {
    const state: TasteState = { artists: {}, tracks: {} };
    profile.load(state);
    state.artists.evil = {
      name: "Evil",
      score: 99,
      plays: 0,
      skips: 0,
      lastSeenMs: nowMs,
      artistRatingStars: null,
    };
    expect(profile.topArtists()).toEqual([]);
  });
});
