import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => {
  const m = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => m.get(k) ?? null,
      setItem: async (k: string, v: string) => void m.set(k, v),
    },
  };
});

import type { DownloadRecord } from "@musex/core";
import { DownloadIndex } from "./download-index";

const rec = (key: string, state: DownloadRecord["state"] = "downloaded"): DownloadRecord => ({
  key,
  serverId: "s",
  plexPath: `/p/${key}`,
  trackId: key,
  format: "original",
  state,
  bytes: 1,
  addedAt: 0,
  meta: {
    title: key,
    artistName: "A",
    durationMs: 1,
    albumId: "al",
    artistId: "ar",
    container: "flac",
    audioCodec: "flac",
    partId: "1",
  },
});

describe("DownloadIndex", () => {
  it("upsert/get/all round-trips and persists", async () => {
    const idx = new DownloadIndex();
    await idx.load();
    await idx.upsert(rec("a"));
    expect(idx.get("a")?.state).toBe("downloaded");
    expect(idx.all()).toHaveLength(1);
    await idx.flush(); // persistence is debounced; force the write before reloading
    const idx2 = new DownloadIndex();
    await idx2.load();
    expect(idx2.get("a")?.trackId).toBe("a");
  });
  it("reconcile marks downloaded records whose file vanished as missing", async () => {
    const idx = new DownloadIndex();
    await idx.load();
    await idx.upsert(rec("a"));
    await idx.upsert(rec("b"));
    await idx.reconcile(new Set(["a"])); // only "a" present on disk
    expect(idx.get("a")?.state).toBe("downloaded");
    expect(idx.get("b")?.state).toBe("missing");
  });

  it("resolveStaleInFlight: committed file → downloaded, otherwise dropped", async () => {
    const idx = new DownloadIndex();
    await idx.load();
    await idx.upsert(rec("done", "downloading")); // finished, state never advanced
    await idx.upsert(rec("partial", "queued")); // never finished, no file
    await idx.upsert(rec("keep", "downloaded")); // already complete
    idx.resolveStaleInFlight(new Set(["done", "keep"])); // "done"+"keep" on disk
    expect(idx.get("done")?.state).toBe("downloaded");
    expect(idx.get("partial")).toBeUndefined();
    expect(idx.get("keep")?.state).toBe("downloaded");
  });
});
