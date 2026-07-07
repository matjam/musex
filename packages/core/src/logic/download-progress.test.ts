import { describe, expect, it } from "vitest";
import { downloadProgress } from "./download-progress.js";
import type { DownloadRecord } from "./download-state.js";

const rec = (
  key: string,
  state: DownloadRecord["state"],
  bytes = 0,
  expectedBytes?: number,
): DownloadRecord => ({
  key,
  serverId: "s1",
  plexPath: `/library/parts/${key}/f.flac`,
  trackId: key,
  format: "original",
  state,
  bytes,
  addedAt: 1,
  expectedBytes,
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

describe("downloadProgress", () => {
  it("returns total 0, fraction null, state none for empty keys", () => {
    const p = downloadProgress([], []);
    expect(p).toEqual({
      done: 0,
      total: 0,
      inFlight: 0,
      failed: 0,
      bytes: 0,
      expectedBytes: null,
      fraction: null,
      state: "none",
    });
  });

  it("counts mixed states; a key with no record counts as not started", () => {
    const records = [
      rec("a", "downloaded", 100),
      rec("b", "downloading", 40),
      rec("c", "queued"),
      rec("d", "failed"),
      rec("e", "missing"),
    ];
    const p = downloadProgress(records, ["a", "b", "c", "d", "e", "f"]);
    expect(p.total).toBe(6);
    expect(p.done).toBe(1);
    expect(p.inFlight).toBe(2); // queued + downloading
    expect(p.failed).toBe(2); // failed + missing
    expect(p.state).toBe("downloading");
  });

  it("reports complete when every key is downloaded", () => {
    const p = downloadProgress(
      [rec("a", "downloaded", 10), rec("b", "downloaded", 20)],
      ["a", "b"],
    );
    expect(p.state).toBe("complete");
    expect(p.done).toBe(2);
    expect(p.fraction).toBe(1);
  });

  it("reports partial when some are done and none in flight", () => {
    const p = downloadProgress([rec("a", "downloaded", 10), rec("b", "failed")], ["a", "b"]);
    expect(p.state).toBe("partial");
  });

  it("blends bytes into the fraction when every counted record has expectedBytes", () => {
    const records = [rec("a", "downloaded", 100, 100), rec("b", "downloading", 25, 100)];
    const p = downloadProgress(records, ["a", "b"]);
    expect(p.bytes).toBe(125);
    expect(p.expectedBytes).toBe(200);
    expect(p.fraction).toBeCloseTo(0.625);
  });

  it("falls back to count fraction when a record lacks expectedBytes", () => {
    const records = [rec("a", "downloaded", 100, 100), rec("b", "downloading", 25)];
    const p = downloadProgress(records, ["a", "b"]);
    expect(p.expectedBytes).toBeNull();
    expect(p.fraction).toBe(0.5); // done/total
  });

  it("falls back to count fraction when a key has no record at all", () => {
    const records = [rec("a", "downloaded", 100, 100)];
    const p = downloadProgress(records, ["a", "b"]);
    expect(p.expectedBytes).toBeNull();
    expect(p.fraction).toBe(0.5);
    expect(p.state).toBe("partial");
  });

  it("accepts a Map of records too", () => {
    const map = new Map([["a", rec("a", "downloaded", 100, 100)]]);
    const p = downloadProgress(map, ["a"]);
    expect(p.done).toBe(1);
    expect(p.bytes).toBe(100);
    expect(p.expectedBytes).toBe(100);
    expect(p.state).toBe("complete");
  });

  it("ignores records for keys outside the container", () => {
    const records = [rec("a", "downloaded", 100), rec("zzz", "downloading", 5)];
    const p = downloadProgress(records, ["a"]);
    expect(p.total).toBe(1);
    expect(p.inFlight).toBe(0);
    expect(p.bytes).toBe(100);
    expect(p.state).toBe("complete");
  });
});
