import { describe, expect, it } from "vitest";
import { cacheBytes, planCacheEviction } from "./cache-eviction.js";
import type { DownloadMeta } from "./download-plan.js";
import type { DownloadOrigin, DownloadRecord } from "./download-state.js";

const meta: DownloadMeta = {
  title: "T",
  artistName: "A",
  albumTitle: "Al",
  durationMs: 1,
  albumId: "al",
  artistId: "ar",
  container: "m4a",
  audioCodec: "aac",
  partId: "p",
};

function rec(
  key: string,
  origin: DownloadOrigin | undefined,
  bytes: number,
  lastAccessMs: number,
): DownloadRecord {
  return {
    key,
    serverId: "s",
    plexPath: `/p/${key}`,
    trackId: key,
    format: "aac",
    state: "downloaded",
    bytes,
    addedAt: 0,
    meta,
    origin,
    lastAccessMs,
  };
}

describe("planCacheEviction", () => {
  it("evicts least-recently-played cache records until within cap", () => {
    const records = [
      rec("old", "cache", 100, 1),
      rec("mid", "cache", 100, 2),
      rec("new", "cache", 100, 3),
    ];
    // cap 250 → total 300, must drop 50+ → evict the single oldest (100).
    expect(planCacheEviction(records, 250)).toEqual(["old"]);
    // cap 150 → drop two oldest.
    expect(planCacheEviction(records, 150)).toEqual(["old", "mid"]);
  });

  it("never evicts pinned (manual/sync/legacy) and excludes them from the cap", () => {
    const records = [
      rec("pin-sync", "sync", 1000, 1),
      rec("pin-manual", "manual", 1000, 1),
      rec("pin-legacy", undefined, 1000, 1),
      rec("cache", "cache", 100, 5),
    ];
    // Cap 100: cache total is 100 already (pinned don't count) → evict nothing.
    expect(planCacheEviction(records, 100)).toEqual([]);
  });

  it("Unlimited (null cap) evicts nothing", () => {
    const records = [rec("a", "cache", 1_000_000, 1), rec("b", "cache", 1_000_000, 2)];
    expect(planCacheEviction(records, null)).toEqual([]);
  });

  it("falls back to addedAt when lastAccessMs is absent", () => {
    const a: DownloadRecord = { ...rec("a", "cache", 100, 0), lastAccessMs: undefined, addedAt: 1 };
    const b: DownloadRecord = { ...rec("b", "cache", 100, 0), lastAccessMs: undefined, addedAt: 2 };
    expect(planCacheEviction([a, b], 100)).toEqual(["a"]); // older addedAt evicted first
  });

  it("cacheBytes sums only cache-origin downloaded records", () => {
    const records = [
      rec("c1", "cache", 100, 1),
      rec("c2", "cache", 200, 1),
      rec("pin", "manual", 999, 1),
    ];
    expect(cacheBytes(records)).toBe(300);
  });
});
