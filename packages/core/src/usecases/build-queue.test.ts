import { describe, expect, it } from "vitest";
import { makeTrack } from "../testing/fakes";
import { buildQueue } from "./build-queue";

describe("buildQueue", () => {
  it("builds a queue starting at the given index", () => {
    const tracks = [makeTrack("1"), makeTrack("2"), makeTrack("3")];
    const queue = buildQueue(tracks, 1);
    expect(queue.tracks).toBe(tracks);
    expect(queue.index).toBe(1);
  });

  it("defaults to index 0", () => {
    const queue = buildQueue([makeTrack("1")]);
    expect(queue.index).toBe(0);
  });

  it("clamps an out-of-range index", () => {
    const tracks = [makeTrack("1"), makeTrack("2")];
    expect(buildQueue(tracks, 99).index).toBe(1);
    expect(buildQueue(tracks, -5).index).toBe(0);
  });

  it("clamps to 0 for an empty track list", () => {
    expect(buildQueue([], 3).index).toBe(0);
  });
});
