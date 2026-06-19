import { describe, expect, it } from "vitest";
import { LOVED_RATING } from "../index.js";
import type { Track } from "../models/index";
import {
  computeSmartPlaylist,
  type SmartKind,
  smartDescription,
  type SmartTrackStat,
  smartMixEmpty,
  smartMixThumbs,
  smartTitle,
  smartTrackKey,
} from "./smart-playlists";
import { KEY_SEPARATOR } from "./taste-profile";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_000_000_000_000;

function track(over: Partial<Track> & { title: string; artistName: string }): Track {
  return {
    id: `${over.artistName}/${over.title}`,
    serverId: "srv",
    albumId: "alb",
    artistId: "art",
    durationMs: 200_000,
    media: { container: "flac", audioCodec: "flac", partId: "p1", partKey: "/k" },
    ...over,
  };
}

function stat(
  t: { artistName: string; title: string },
  over: Partial<Omit<SmartTrackStat, "key">> = {},
): SmartTrackStat {
  const plays = over.plays ?? 0;
  return {
    key: smartTrackKey(t),
    plays,
    lastPlayedMs: over.lastPlayedMs ?? NOW,
    decayedPlays: over.decayedPlays ?? plays,
  };
}

describe("smartTrackKey", () => {
  it("lowercases artist and title joined by the taste-profile separator", () => {
    expect(smartTrackKey({ artistName: "Lamb", title: "Górecki" })).toBe(
      `lamb${KEY_SEPARATOR}górecki`,
    );
  });
});

describe("smartTitle", () => {
  it("names the rule kinds and the daily mix", () => {
    expect(smartTitle("for-you")).toBe("For You");
    expect(smartTitle("top-rated")).toBe("Top Rated");
    expect(smartTitle("heavy-rotation")).toBe("Heavy Rotation");
    expect(smartTitle("rediscover")).toBe("Rediscover");
    expect(smartTitle("daily")).toBe("Daily Mix");
  });

  it("renders a decade kind as e.g. 1980s", () => {
    expect(smartTitle("decade-1980")).toBe("1980s");
    expect(smartTitle("decade-2000")).toBe("2000s");
  });
});

describe("top-rated", () => {
  it("includes rating 8, excludes rating 7 and unrated", () => {
    const four = track({ title: "Four", artistName: "A", userRating: 8 });
    const tracks = [
      four,
      track({ title: "ThreeAndAHalf", artistName: "A", userRating: 7 }),
      track({ title: "Unrated", artistName: "A" }),
    ];
    expect(computeSmartPlaylist("top-rated", tracks, [], [], NOW)).toEqual([four]);
  });

  it("sorts by rating desc, then artist, then title", () => {
    const tracks = [
      track({ title: "B-side", artistName: "Beta", userRating: 8 }),
      track({ title: "Zeta", artistName: "Alpha", userRating: 8 }),
      track({ title: "Apex", artistName: "Alpha", userRating: 8 }),
      track({ title: "Best", artistName: "Zed", userRating: 10 }),
    ];
    const titles = computeSmartPlaylist("top-rated", tracks, [], [], NOW).map((t) => t.title);
    expect(titles).toEqual(["Best", "Apex", "Zeta", "B-side"]);
  });
});

describe("heavy-rotation", () => {
  it("includes plays >= 2, excludes single plays and never-played", () => {
    const hot = track({ title: "Hot", artistName: "A" });
    const once = track({ title: "Once", artistName: "A" });
    const never = track({ title: "Never", artistName: "A" });
    const stats = [stat(hot, { plays: 2 }), stat(once, { plays: 1 })];
    expect(computeSmartPlaylist("heavy-rotation", [hot, once, never], stats, [], NOW)).toEqual([
      hot,
    ]);
  });

  it("joins stats case-insensitively and sorts by decayed plays desc", () => {
    const a = track({ title: "Slow Burn", artistName: "Lamb" });
    const b = track({ title: "Fresh", artistName: "Orbital" });
    const stats = [
      stat({ artistName: "LAMB", title: "SLOW BURN" }, { plays: 10, decayedPlays: 2.5 }),
      stat(b, { plays: 3, decayedPlays: 2.9 }),
    ];
    expect(computeSmartPlaylist("heavy-rotation", [a, b], stats, [], NOW)).toEqual([b, a]);
  });

  it("caps at 100", () => {
    const tracks = Array.from({ length: 120 }, (_, i) =>
      track({ title: `T${i}`, artistName: "A" }),
    );
    const stats = tracks.map((t, i) => stat(t, { plays: 2, decayedPlays: i }));
    expect(computeSmartPlaylist("heavy-rotation", tracks, stats, [], NOW)).toHaveLength(100);
  });
});

describe("rediscover", () => {
  it("includes a never-played 5-star track", () => {
    const gem = track({ title: "Gem", artistName: "A", userRating: 10 });
    expect(computeSmartPlaylist("rediscover", [gem], [], [], NOW)).toEqual([gem]);
  });

  it("applies the 60-day staleness boundary (61 days in, 59 days out)", () => {
    const stale = track({ title: "Stale", artistName: "A", userRating: 8 });
    const recent = track({ title: "Recent", artistName: "A", userRating: 8 });
    const stats = [
      stat(stale, { plays: 1, lastPlayedMs: NOW - 61 * DAY_MS }),
      stat(recent, { plays: 1, lastPlayedMs: NOW - 59 * DAY_MS }),
    ];
    expect(computeSmartPlaylist("rediscover", [stale, recent], stats, [], NOW)).toEqual([stale]);
  });

  it("qualifies unrated tracks with plays >= 3, not 2", () => {
    const loved = track({ title: "Loved", artistName: "A" });
    const meh = track({ title: "Meh", artistName: "A" });
    const stats = [
      stat(loved, { plays: 3, lastPlayedMs: NOW - 90 * DAY_MS }),
      stat(meh, { plays: 2, lastPlayedMs: NOW - 90 * DAY_MS }),
    ];
    expect(computeSmartPlaylist("rediscover", [loved, meh], stats, [], NOW)).toEqual([loved]);
  });

  it("excludes rating 7 never-played tracks", () => {
    const t = track({ title: "Nope", artistName: "A", userRating: 7 });
    expect(computeSmartPlaylist("rediscover", [t], [], [], NOW)).toEqual([]);
  });

  it("sorts by artist affinity desc (case-insensitive, missing = 0), then rating desc", () => {
    const fav = track({ title: "Fav", artistName: "Lamb", userRating: 8 });
    const other = track({ title: "Other", artistName: "Orbital", userRating: 10 });
    const unknownHi = track({ title: "Hi", artistName: "Nobody", userRating: 10 });
    const unknownLo = track({ title: "Lo", artistName: "Nobody", userRating: 8 });
    const scores = [
      { name: "LAMB", score: 5 },
      { name: "orbital", score: 9 },
    ];
    const out = computeSmartPlaylist(
      "rediscover",
      [unknownLo, fav, unknownHi, other],
      [],
      scores,
      NOW,
    );
    expect(out.map((t) => t.title)).toEqual(["Other", "Fav", "Hi", "Lo"]);
  });

  it("caps at 100", () => {
    const tracks = Array.from({ length: 130 }, (_, i) =>
      track({ title: `T${i}`, artistName: "A", userRating: 10 }),
    );
    expect(computeSmartPlaylist("rediscover", tracks, [], [], NOW)).toHaveLength(100);
  });
});

describe("smartMixThumbs", () => {
  const t = (artist: string, title: string, thumb?: string, rating?: number) =>
    ({
      id: `${artist}-${title}`,
      serverId: "s",
      artistName: artist,
      title,
      thumb,
      userRating: rating,
      albumId: "al",
      artistId: "ar",
      durationMs: 1000,
    }) as unknown as Track;

  it("rule kinds: thumbs of the computed playlist, deduped, no undefineds", () => {
    const tracks = [
      t("a", "one", "art1.jpg", 10),
      t("a", "two", "art1.jpg", 9), // same album art → deduped
      t("b", "three", undefined, 8), // no art → dropped
      t("c", "four", "art2.jpg", 2), // below threshold → not in playlist
    ];
    expect(smartMixThumbs("top-rated", tracks, [], [], 0)).toEqual(["art1.jpg"]);
  });

  it("for-you approximates with top-taste artists' track art", () => {
    const tracks = [t("fav", "x", "fav.jpg"), t("other", "y", "other.jpg")];
    const scores = [{ name: "Fav", score: 5 }];
    expect(smartMixThumbs("for-you", tracks, [], scores, 0)).toEqual(["fav.jpg"]);
  });
});

describe("smartMixEmpty", () => {
  const t = (artist: string, title: string, rating?: number) =>
    ({
      id: `${artist}-${title}`,
      serverId: "s",
      artistName: artist,
      title,
      userRating: rating,
      albumId: "al",
      artistId: "ar",
      durationMs: 1000,
    }) as unknown as Track;

  it("rule kinds: empty when the computed playlist is empty", () => {
    expect(smartMixEmpty("top-rated", [t("a", "x", 2)], [], [], 0)).toBe(true);
    expect(smartMixEmpty("top-rated", [t("a", "x", 10)], [], [], 0)).toBe(false);
    expect(smartMixEmpty("heavy-rotation", [t("a", "x")], [], [], 0)).toBe(true);
  });

  it("for-you: empty exactly when the taste profile has no artists", () => {
    expect(smartMixEmpty("for-you", [t("a", "x")], [], [], 0)).toBe(true);
    expect(smartMixEmpty("for-you", [], [], [{ name: "a", score: 1 }], 0)).toBe(false);
  });
});

describe("smartDescription", () => {
  it("every smart kind has a tile description", () => {
    const kinds: SmartKind[] = ["for-you", "top-rated", "heavy-rotation", "rediscover", "daily"];
    for (const k of kinds) expect(smartDescription(k).length).toBeGreaterThan(0);
    expect(smartDescription("decade-1990").length).toBeGreaterThan(0);
  });
});

describe("LOVED_RATING", () => {
  it("is the public 0–10 loved threshold (8 = 4 stars)", () => {
    expect(LOVED_RATING).toBe(8);
  });
});
