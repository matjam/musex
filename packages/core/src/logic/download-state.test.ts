import { describe, expect, it } from "vitest";
import { reconcileRecords, type DownloadRecord } from "./download-state.js";

const rec = (key: string, state: DownloadRecord["state"]): DownloadRecord => ({
  key, serverId: "s1", plexPath: `/library/parts/${key}/f.flac`, trackId: key,
  format: "original", state, bytes: 10, addedAt: 1,
  meta: { title: key, artistName: "A", durationMs: 1, albumId: "al", artistId: "ar" },
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
