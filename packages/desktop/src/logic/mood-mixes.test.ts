import type { Album, Track } from "@musex/core";
import { describe, expect, it } from "vitest";
import { composeMoodMix, MOOD_MIXES, type MoodMix } from "./mood-mixes";
import { smartTrackKey } from "./smart-playlists";

function album(over: Partial<Album> & { id: string }): Album {
  return {
    serverId: "srv",
    artistId: "art",
    title: `Album ${over.id}`,
    ...over,
  };
}

function track(over: Partial<Track> & { id: string; albumId: string; artistName: string }): Track {
  return {
    serverId: "srv",
    artistId: `art-${over.artistName}`,
    title: `Track ${over.id}`,
    durationMs: 200_000,
    media: { container: "flac", audioCodec: "flac", partId: "p1", partKey: "/k" },
    ...over,
  };
}

type Stat = { plays: number; skips: number; ratingStars?: number | null };

function stats(entries: [Track, Stat][]): Map<string, Stat> {
  return new Map(entries.map(([t, s]) => [smartTrackKey(t), s]));
}

const driving = MOOD_MIXES.find((m) => m.id === "driving") as MoodMix;
const chill = MOOD_MIXES.find((m) => m.id === "chill") as MoodMix;

describe("MOOD_MIXES", () => {
  it("defines the five curated mixes with unique ids and non-empty keywords", () => {
    expect(MOOD_MIXES.map((m) => m.id)).toEqual(["driving", "workout", "chill", "coding", "party"]);
    for (const mix of MOOD_MIXES) {
      expect(mix.title.length).toBeGreaterThan(0);
      expect(mix.description.length).toBeGreaterThan(0);
      expect(mix.keywords.length).toBeGreaterThan(0);
    }
  });
});

describe("composeMoodMix keyword matching", () => {
  it("matches keywords as case-insensitive substrings of track genres", () => {
    const tracks = [
      track({ id: "1", albumId: "a", artistName: "A", genres: ["Indie Rock"] }), // "rock" ⊂ "indie rock"
      track({ id: "2", albumId: "a", artistName: "B", genres: ["Jazz"] }),
    ];
    const out = composeMoodMix(driving, [], tracks, new Map(), []);
    expect(out.map((t) => t.id)).toEqual(["1"]);
  });

  it("matches against track moods too", () => {
    const tracks = [
      track({ id: "1", albumId: "a", artistName: "A", moods: ["Mellow"] }),
      track({ id: "2", albumId: "a", artistName: "B", moods: ["Aggressive"] }),
    ];
    const out = composeMoodMix(chill, [], tracks, new Map(), []);
    expect(out.map((t) => t.id)).toEqual(["1"]);
  });

  it("inherits the album's genres and moods when the track itself is untagged", () => {
    const albums = [
      album({ id: "alb-genre", genres: ["Krautrock"] }),
      album({ id: "alb-mood", moods: ["Road Trip"] }),
      album({ id: "alb-none" }),
    ];
    const tracks = [
      track({ id: "1", albumId: "alb-genre", artistName: "A" }),
      track({ id: "2", albumId: "alb-mood", artistName: "B" }),
      track({ id: "3", albumId: "alb-none", artistName: "C" }),
    ];
    const out = composeMoodMix(driving, albums, tracks, new Map(), []);
    expect(out.map((t) => t.id).sort()).toEqual(["1", "2"]);
  });

  it("returns empty when nothing matches", () => {
    const tracks = [track({ id: "1", albumId: "a", artistName: "A", genres: ["Classical"] })];
    expect(composeMoodMix(driving, [], tracks, new Map(), [])).toEqual([]);
  });
});

describe("composeMoodMix scoring", () => {
  it("ranks artist affinity: top artist gets +2, half-score +1, unknown 0", () => {
    const tracks = [
      track({ id: "1", albumId: "a", artistName: "Nobody", genres: ["Rock"] }),
      track({ id: "2", albumId: "a", artistName: "Half", genres: ["Rock"] }),
      track({ id: "3", albumId: "a", artistName: "Top", genres: ["Rock"] }),
    ];
    // Suppress the freshness bonus so only affinity differs.
    const s = stats(tracks.map((t) => [t, { plays: 1, skips: 0 }]));
    const out = composeMoodMix(driving, [], tracks, s, [
      { name: "top", score: 10 }, // case-insensitive lookup
      { name: "Half", score: 5 },
    ]);
    expect(out.map((t) => t.artistName)).toEqual(["Top", "Half", "Nobody"]);
  });

  it("applies the rating bonus (stars - 3)", () => {
    const five = track({ id: "1", albumId: "a", artistName: "A", genres: ["Rock"] });
    const one = track({ id: "2", albumId: "a", artistName: "B", genres: ["Rock"] });
    const unrated = track({ id: "3", albumId: "a", artistName: "C", genres: ["Rock"] });
    const s = stats([
      [five, { plays: 1, skips: 0, ratingStars: 5 }], // +2
      [one, { plays: 1, skips: 0, ratingStars: 1 }], // -2
      [unrated, { plays: 1, skips: 0, ratingStars: null }], // 0
    ]);
    const out = composeMoodMix(driving, [], [five, one, unrated], s, []);
    expect(out.map((t) => t.id)).toEqual(["1", "3", "2"]);
  });

  it("penalises skips at 0.5 each", () => {
    const skipped = track({ id: "1", albumId: "a", artistName: "A", genres: ["Rock"] });
    const clean = track({ id: "2", albumId: "a", artistName: "B", genres: ["Rock"] });
    const s = stats([
      [skipped, { plays: 5, skips: 2 }], // -1
      [clean, { plays: 5, skips: 0 }], // 0
    ]);
    const out = composeMoodMix(driving, [], [skipped, clean], s, []);
    expect(out.map((t) => t.id)).toEqual(["2", "1"]);
  });

  it("gives never-played tracks the +1 freshness bonus", () => {
    const fresh = track({ id: "1", albumId: "a", artistName: "Z", genres: ["Rock"] });
    const played = track({ id: "2", albumId: "a", artistName: "A", genres: ["Rock"] });
    const s = stats([[played, { plays: 3, skips: 0 }]]); // fresh has no stat -> plays 0
    const out = composeMoodMix(driving, [], [fresh, played], s, []);
    // Without the bonus the tie-break (artist asc) would put A first.
    expect(out.map((t) => t.id)).toEqual(["1", "2"]);
  });

  it("excludes tracks with skips >= 3 and plays <= 1, but keeps warmed-to ones", () => {
    const hated = track({ id: "1", albumId: "a", artistName: "A", genres: ["Rock"] });
    const warmed = track({ id: "2", albumId: "a", artistName: "B", genres: ["Rock"] });
    const s = stats([
      [hated, { plays: 1, skips: 3 }],
      [warmed, { plays: 2, skips: 3 }],
    ]);
    const out = composeMoodMix(driving, [], [hated, warmed], s, []);
    expect(out.map((t) => t.id)).toEqual(["2"]);
  });
});

describe("composeMoodMix shaping", () => {
  it("caps any one artist at 5 tracks", () => {
    const tracks = [
      ...Array.from({ length: 8 }, (_, i) =>
        track({ id: `dom-${i}`, albumId: "a", artistName: "Dominant", genres: ["Rock"] }),
      ),
      track({ id: "other", albumId: "a", artistName: "Other", genres: ["Rock"] }),
    ];
    const out = composeMoodMix(driving, [], tracks, new Map(), []);
    expect(out.filter((t) => t.artistName === "Dominant")).toHaveLength(5);
    expect(out.filter((t) => t.artistName === "Other")).toHaveLength(1);
  });

  it("caps the mix at 150 tracks", () => {
    // 40 artists x 5 tracks = 200 candidates, none hit the per-artist cap.
    const tracks = Array.from({ length: 200 }, (_, i) =>
      track({
        id: `t-${String(i).padStart(3, "0")}`,
        albumId: "a",
        artistName: `Artist ${i % 40}`,
        genres: ["Rock"],
      }),
    );
    expect(composeMoodMix(driving, [], tracks, new Map(), [])).toHaveLength(150);
  });

  it("is deterministic: equal scores tie-break by artist, title, id", () => {
    const tracks = [
      track({ id: "2", albumId: "a", artistName: "B", title: "Same", genres: ["Rock"] }),
      track({ id: "1", albumId: "a", artistName: "A", title: "Zed", genres: ["Rock"] }),
      track({ id: "3", albumId: "a", artistName: "A", title: "Alpha", genres: ["Rock"] }),
    ];
    const run1 = composeMoodMix(driving, [], tracks, new Map(), []);
    const run2 = composeMoodMix(driving, [], [...tracks].reverse(), new Map(), []);
    expect(run1.map((t) => t.id)).toEqual(["3", "1", "2"]);
    expect(run2.map((t) => t.id)).toEqual(run1.map((t) => t.id));
  });
});
