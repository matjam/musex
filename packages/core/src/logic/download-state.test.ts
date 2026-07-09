import { describe, expect, it } from "vitest";
import {
  type DownloadRecord,
  groupDownloadsByAlbum,
  reconcileRecords,
  recordsToTracks,
  recordToTrack,
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
  meta: {
    title: key,
    artistName: "A",
    durationMs: 1,
    albumId: "al",
    artistId: "ar",
    container: "flac",
    audioCodec: "flac",
    partId: "p1",
  },
});

/** Build a downloaded record with per-album overrides for grouping tests. */
const downloaded = (
  key: string,
  meta: Partial<DownloadRecord["meta"]>,
  bytes = 10,
): DownloadRecord => ({
  ...rec(key, "downloaded"),
  bytes,
  meta: {
    title: key,
    artistName: "A",
    durationMs: 1,
    albumId: "al",
    artistId: "ar",
    container: "flac",
    audioCodec: "flac",
    partId: "p1",
    ...meta,
  },
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
  it("demotes a downloaded record whose on-disk size mismatches expectedBytes", () => {
    const r = { ...rec("k1", "downloaded"), expectedBytes: 100 };
    const out = reconcileRecords([r], new Set(["k1"]), new Map([["k1", 60]]));
    expect(out[0]?.state).toBe("missing");
  });
  it("keeps a downloaded record whose size matches, or that has no expectedBytes", () => {
    const a = { ...rec("a", "downloaded"), expectedBytes: 100 };
    const b = rec("b", "downloaded"); // AAC — no expected size
    const out = reconcileRecords(
      [a, b],
      new Set(["a", "b"]),
      new Map([
        ["a", 100],
        ["b", 42],
      ]),
    );
    expect(out.map((r) => r.state)).toEqual(["downloaded", "downloaded"]);
  });
  it("keeps a downloaded record with expectedBytes when no sizes map is supplied (two-arg callers)", () => {
    const r = { ...rec("k1", "downloaded"), expectedBytes: 100 };
    const out = reconcileRecords([r], new Set(["k1"]));
    expect(out[0]?.state).toBe("downloaded");
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

  it("never merges falsy-albumId records — each keyed per track as track:<trackId>", () => {
    const groups = groupDownloadsByAlbum([
      downloaded("t1", { albumId: "", albumTitle: "One", thumb: "art1" }, 5),
      downloaded("t2", { albumId: "", albumTitle: "Two" }, 7),
      downloaded("t3", { albumId: "a1", albumTitle: "Real" }),
    ]);
    expect(groups).toHaveLength(3);
    const g1 = groups.find((g) => g.albumId === "track:t1");
    expect(g1?.keys).toEqual(["t1"]);
    expect(g1?.trackCount).toBe(1);
    expect(g1?.bytes).toBe(5);
    expect(g1?.albumTitle).toBe("One");
    expect(g1?.thumb).toBe("art1");
    const g2 = groups.find((g) => g.albumId === "track:t2");
    expect(g2?.keys).toEqual(["t2"]);
    expect(g2?.albumTitle).toBe("Two");
    expect(groups.find((g) => g.albumId === "a1")?.keys).toEqual(["t3"]);
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

describe("recordToTrack", () => {
  it("rebuilds a Track with id/serverId/partKey and media from the stored meta", () => {
    const r = downloaded("k1", {
      title: "Song",
      artistName: "Artist",
      albumTitle: "Album",
      durationMs: 240_000,
      trackNumber: 3,
      thumb: "http://127.0.0.1:5/secret/s1/library/metadata/9/thumb/1",
      albumId: "al",
      artistId: "ar",
      container: "flac",
      audioCodec: "flac",
      partId: "p1",
      bitrate: 900,
    });
    const t = recordToTrack(r);
    expect(t.id).toBe("k1");
    expect(t.serverId).toBe("s1");
    expect(t.media.partKey).toBe(r.plexPath);
    expect(t.media).toEqual({
      container: "flac",
      audioCodec: "flac",
      bitrate: 900,
      partId: "p1",
      partKey: r.plexPath,
    });
    // thumb is passed through verbatim (host re-bakes it).
    expect(t.thumb).toBe("http://127.0.0.1:5/secret/s1/library/metadata/9/thumb/1");
    expect(t.title).toBe("Song");
    expect(t.trackNumber).toBe(3);
  });

  it("falls back to empty-string media for old records missing the media fields", () => {
    // Simulate a pre-media-fields record (dev data) by stripping the fields.
    const r = downloaded("old", {});
    const { container: _c, audioCodec: _a, partId: _p, ...legacyMeta } = r.meta;
    const legacy: DownloadRecord = { ...r, meta: legacyMeta as DownloadRecord["meta"] };
    const t = recordToTrack(legacy);
    expect(t.media).toEqual({
      container: "",
      audioCodec: "",
      bitrate: undefined,
      partId: "",
      partKey: legacy.plexPath,
    });
    // Still a valid, playable Track (proxy serves by serverId + partKey).
    expect(t.serverId).toBe("s1");
    expect(t.media.partKey).toBe(legacy.plexPath);
  });
});

describe("recordsToTracks", () => {
  it("includes only downloaded records", () => {
    const tracks = recordsToTracks([
      downloaded("d1", { albumId: "a1", albumTitle: "A" }),
      rec("q1", "queued"),
      rec("dl1", "downloading"),
      rec("m1", "missing"),
      rec("f1", "failed"),
    ]);
    expect(tracks.map((t) => t.id)).toEqual(["d1"]);
  });

  it("sorts by album title (case-insensitive) then track number, undefined last", () => {
    const tracks = recordsToTracks([
      downloaded("z2", { albumTitle: "Zebra", trackNumber: 2 }),
      downloaded("a-no", { albumTitle: "apple", trackNumber: undefined }),
      downloaded("z1", { albumTitle: "Zebra", trackNumber: 1 }),
      downloaded("a1", { albumTitle: "apple", trackNumber: 1 }),
    ]);
    expect(tracks.map((t) => t.id)).toEqual(["a1", "a-no", "z1", "z2"]);
  });
});
