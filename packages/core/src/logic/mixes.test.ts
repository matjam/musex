import { describe, expect, it } from "vitest";
import type { Track } from "../models/index";
import { dailyMix, decadeMix, decadeOf, decadesInLibrary, seededShuffle } from "./mixes";
import { decadeKind, parseDecadeKind } from "./smart-playlists";

function track(id: string): Track {
  return {
    id,
    serverId: "srv",
    albumId: `alb-${id}`,
    artistId: "art",
    artistName: "Artist",
    title: id,
    durationMs: 200_000,
    media: { container: "flac", audioCodec: "flac", partId: "p1", partKey: "/k" },
  };
}

const tracks = (...ids: string[]) => ids.map(track);

describe("seededShuffle", () => {
  it("is deterministic for the same seed and input", () => {
    const input = tracks("a", "b", "c", "d", "e", "f", "g");
    expect(seededShuffle(input, "x")).toEqual(seededShuffle(input, "x"));
  });

  it("differs across seeds", () => {
    const input = tracks("a", "b", "c", "d", "e", "f", "g", "h");
    expect(seededShuffle(input, "x")).not.toEqual(seededShuffle(input, "y"));
  });

  it("does not mutate the input and preserves membership", () => {
    const input = tracks("a", "b", "c");
    const copy = [...input];
    const out = seededShuffle(input, "x");
    expect(input).toEqual(copy);
    expect(new Set(out.map((t) => t.id))).toEqual(new Set(["a", "b", "c"]));
  });
});

describe("dailyMix", () => {
  it("caps at count and is stable for the same date seed", () => {
    const input = tracks(...Array.from({ length: 200 }, (_, i) => `t${i}`));
    const a = dailyMix(input, "2026-06-18", 80);
    const b = dailyMix(input, "2026-06-18", 80);
    expect(a).toHaveLength(80);
    expect(a).toEqual(b);
  });

  it("rotates across days", () => {
    const input = tracks(...Array.from({ length: 200 }, (_, i) => `t${i}`));
    expect(dailyMix(input, "2026-06-18", 80)).not.toEqual(dailyMix(input, "2026-06-19", 80));
  });

  it("returns all tracks when the library is smaller than count", () => {
    const input = tracks("a", "b", "c");
    expect(dailyMix(input, "2026-06-18", 80)).toHaveLength(3);
  });
});

describe("decadeOf / parseDecadeKind / decadeKind", () => {
  it("floors to the decade start", () => {
    expect(decadeOf(1985)).toBe(1980);
    expect(decadeOf(1980)).toBe(1980);
    expect(decadeOf(1989)).toBe(1980);
    expect(decadeOf(2001)).toBe(2000);
  });

  it("round-trips decadeKind / parseDecadeKind", () => {
    expect(decadeKind(1980)).toBe("decade-1980");
    expect(parseDecadeKind("decade-1980")).toBe(1980);
    expect(parseDecadeKind("top-rated")).toBeNull();
    expect(parseDecadeKind("daily")).toBeNull();
  });
});

describe("decadeMix", () => {
  const years: Record<string, number | undefined> = {
    a: 1979,
    b: 1980,
    c: 1985,
    d: 1989,
    e: 1990,
    f: undefined,
  };
  const yearOf = (t: Track) => years[t.id];

  it("includes only tracks within [start, start+9]", () => {
    const out = decadeMix(tracks("a", "b", "c", "d", "e", "f"), 1980, "decade-1980", yearOf);
    expect(new Set(out.map((t) => t.id))).toEqual(new Set(["b", "c", "d"]));
  });

  it("handles boundaries 1980 and 1989", () => {
    expect(decadeMix(tracks("a"), 1980, "s", yearOf)).toHaveLength(0); // 1979 excluded
    expect(decadeMix(tracks("e"), 1980, "s", yearOf)).toHaveLength(0); // 1990 excluded
    expect(decadeMix(tracks("b", "d"), 1980, "s", yearOf)).toHaveLength(2); // 1980 & 1989 in
  });

  it("excludes tracks with no resolvable year", () => {
    expect(decadeMix(tracks("f"), 1980, "s", yearOf)).toHaveLength(0);
  });

  it("is deterministic for the same seed", () => {
    const input = tracks("b", "c", "d");
    expect(decadeMix(input, 1980, "decade-1980", yearOf)).toEqual(
      decadeMix(input, 1980, "decade-1980", yearOf),
    );
  });
});

describe("decadesInLibrary", () => {
  it("returns distinct decade starts newest-first, ignoring undefined", () => {
    expect(decadesInLibrary([1985, 1999, 2001, 1980, undefined, 2005])).toEqual([
      2000, 1990, 1980,
    ]);
  });

  it("is empty when no years are present", () => {
    expect(decadesInLibrary([undefined, undefined])).toEqual([]);
  });
});
