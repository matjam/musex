import { describe, expect, it } from "vitest";
import { type DownloadJob, dedupeJobs } from "./download-plan.js";

const job = (key: string): DownloadJob => ({
  key,
  serverId: "s1",
  plexPath: `/library/parts/${key}/file.flac`,
  trackId: key,
  meta: {
    title: key,
    artistName: "A",
    albumTitle: "Al",
    durationMs: 1000,
    thumb: undefined,
    trackNumber: 1,
    albumId: "al",
    artistId: "ar",
    container: "flac",
    audioCodec: "flac",
    partId: "p1",
  },
});

describe("dedupeJobs", () => {
  it("drops jobs whose key is already present", () => {
    const out = dedupeJobs([job("a"), job("b"), job("a")], new Set(["b"]));
    expect(out.map((j) => j.key)).toEqual(["a"]);
  });
  it("keeps order and removes duplicates within the batch", () => {
    const out = dedupeJobs([job("x"), job("y"), job("x")], new Set());
    expect(out.map((j) => j.key)).toEqual(["x", "y"]);
  });
});
