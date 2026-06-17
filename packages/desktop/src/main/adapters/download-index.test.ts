import type { DownloadRecord } from "@musex/core";
import { describe, expect, it } from "vitest";
import { DownloadIndex } from "./download-index.js";

const rec = (key: string): DownloadRecord => ({
  key,
  serverId: "s1",
  plexPath: `/library/parts/${key}/f.flac`,
  trackId: key,
  format: "original",
  state: "queued",
  bytes: 0,
  addedAt: 1,
  meta: { title: key, artistName: "A", durationMs: 1, albumId: "al", artistId: "ar" },
});

describe("DownloadIndex", () => {
  it("upserts, gets, lists and removes; persists on every mutation", () => {
    const saved: DownloadRecord[][] = [];
    const idx = new DownloadIndex([], (all) => saved.push(all));
    idx.upsert(rec("a"));
    idx.upsert({ ...rec("a"), state: "downloaded", bytes: 99 });
    expect(idx.get("a")?.state).toBe("downloaded");
    expect(idx.list()).toHaveLength(1);
    idx.remove("a");
    expect(idx.get("a")).toBeUndefined();
    expect(saved.length).toBe(3); // 2 upserts + 1 remove
  });

  it("hydrates from initial records", () => {
    const idx = new DownloadIndex([rec("x")], () => {});
    expect(idx.get("x")).toBeDefined();
  });
});
