import { describe, expect, it } from "vitest";
import { sampleThumbs } from "./collage";

const POOL = Array.from({ length: 20 }, (_, i) => `/thumb/${i}`);

describe("sampleThumbs", () => {
  it("is deterministic: same inputs and seed give the same selection", () => {
    const a = sampleThumbs(POOL, 4, "Rock");
    const b = sampleThumbs(POOL, 4, "Rock");
    expect(a).toEqual(b);
    expect(a).toHaveLength(4);
  });

  it("is seed-sensitive: different seeds pick different selections", () => {
    const rock = sampleThumbs(POOL, 4, "Rock");
    const jazz = sampleThumbs(POOL, 4, "Jazz");
    expect(rock).not.toEqual(jazz);
  });

  it("samples without replacement (no duplicate picks)", () => {
    const got = sampleThumbs(POOL, 4, "Ambient");
    expect(new Set(got).size).toBe(4);
    for (const t of got) expect(POOL).toContain(t);
  });

  it("filters out undefined and empty entries", () => {
    const got = sampleThumbs([undefined, "", "/a", undefined, "/b", ""], 4, "x");
    expect(got).toEqual(["/a", "/b"]);
  });

  it("returns everything in input order when fewer than count remain", () => {
    expect(sampleThumbs(["/a", "/b", "/c"], 4, "x")).toEqual(["/a", "/b", "/c"]);
    expect(sampleThumbs([], 4, "x")).toEqual([]);
  });
});
