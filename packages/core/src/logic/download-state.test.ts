import { describe, expect, it } from "vitest";
import {
  type DownloadRecord,
  formatBytes,
  groupDownloadsByAlbum,
  reconcileRecords,
} from "./download-state.js";

const rec = (key: string, state: DownloadRecord["state"]): DownloadRecord => ({
  key,
  serverId: "s1",
  plexPath: `/library/parts/${key}/f.flac`,
  trackId: key,
  format: "original",
  state,
  bytes: 10,
  addedAt: 1,
  meta: { title: key, artistName: "A", durationMs: 1, albumId: "al", artistId: "ar" },
});

/** Build a downloaded record with per-album overrides for grouping tests. */
const downloaded = (
  key: string,
  meta: Partial<DownloadRecord["meta"]>,
  bytes = 10,
): DownloadRecord => ({
  ...rec(key, "downloaded"),
  bytes,
  meta: { title: key, artistName: "A", durationMs: 1, albumId: "al", artistId: "ar", ...meta },
});

describe("reconcileRecords", () => {
  it("downgrades a 'downloaded' record to 'missing' when its file is missing on disk", () => {
    const out = reconcileRecords([rec("a", "downloaded"), rec("b", "downloaded")], new Set(["a"]));
    expect(out.find((r) => r.key === "a")?.state).toBe("downloaded");
    expect(out.find((r) => r.key === "b")?.state).toBe("missing");
  });
  it("leaves queued/downloading records untouched (file not expected yet)", () => {
    const out = reconcileRecords([rec("c", "queued"), rec("d", "downloading")], new Set());
    expect(out.map((r) => r.state)).toEqual(["queued", "downloading"]);
  });
});

describe("groupDownloadsByAlbum", () => {
  it("groups downloaded tracks by albumId, summing bytes and collecting keys", () => {
    const groups = groupDownloadsByAlbum([
      downloaded("t1", { albumId: "a1", albumTitle: "Aaa", artistName: "Artist", thumb: "x" }, 100),
      downloaded("t2", { albumId: "a1", albumTitle: "Aaa", artistName: "Artist" }, 200),
      downloaded("t3", { albumId: "a2", albumTitle: "Bbb", artistName: "Other" }, 50),
    ]);
    expect(groups).toHaveLength(2);
    const a1 = groups.find((g) => g.albumId === "a1");
    expect(a1?.keys.sort()).toEqual(["t1", "t2"]);
    expect(a1?.trackCount).toBe(2);
    expect(a1?.bytes).toBe(300);
    expect(a1?.thumb).toBe("x");
    expect(a1?.albumTitle).toBe("Aaa");
    expect(a1?.artistName).toBe("Artist");
  });

  it("ignores non-downloaded records", () => {
    const groups = groupDownloadsByAlbum([
      rec("q", "queued"),
      rec("d", "downloading"),
      downloaded("t1", { albumId: "a1" }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.keys).toEqual(["t1"]);
  });

  it("falls through to the first track that has a thumb", () => {
    const groups = groupDownloadsByAlbum([
      downloaded("t1", { albumId: "a1" }),
      downloaded("t2", { albumId: "a1", thumb: "art" }),
    ]);
    expect(groups[0]?.thumb).toBe("art");
  });

  it("sorts groups by album title then artist (case-insensitive)", () => {
    const groups = groupDownloadsByAlbum([
      downloaded("t1", { albumId: "a1", albumTitle: "Zebra" }),
      downloaded("t2", { albumId: "a2", albumTitle: "apple" }),
    ]);
    expect(groups.map((g) => g.albumTitle)).toEqual(["apple", "Zebra"]);
  });

  it("defaults a missing album title to 'Unknown Album'", () => {
    const groups = groupDownloadsByAlbum([
      downloaded("t1", { albumId: "a1", albumTitle: undefined }),
    ]);
    expect(groups[0]?.albumTitle).toBe("Unknown Album");
  });
});

describe("formatBytes", () => {
  it("renders bytes under 1000 as B", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
  });
  it("scales through KB/MB/GB with one decimal under 10, none above", () => {
    expect(formatBytes(1500)).toBe("1.5 KB");
    expect(formatBytes(2_500_000)).toBe("2.5 MB");
    expect(formatBytes(45_000_000)).toBe("45 MB");
    expect(formatBytes(1_400_000_000)).toBe("1.4 GB");
  });
});
