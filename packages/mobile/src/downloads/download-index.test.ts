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
    const corrupt = idx.resolveStaleInFlight(
      new Map([
        ["done", 7],
        ["keep", 7],
      ]), // "done"+"keep" on disk
    );
    // No expectedBytes on the record → presence promotes, with bytes and
    // expectedBytes set to the actual on-disk size.
    expect(idx.get("done")).toMatchObject({ state: "downloaded", bytes: 7, expectedBytes: 7 });
    expect(idx.get("partial")).toBeUndefined();
    expect(idx.get("keep")?.state).toBe("downloaded");
    expect(corrupt).toEqual([]);
  });

  it("resolveStaleInFlight is size-gated: a mismatched partial is dropped and its key returned", async () => {
    const idx = new DownloadIndex();
    await idx.load();
    await idx.upsert({ ...rec("match", "downloading"), expectedBytes: 5 });
    await idx.upsert({ ...rec("short", "downloading"), expectedBytes: 10 });
    const corrupt = idx.resolveStaleInFlight(
      new Map([
        ["match", 5],
        ["short", 4], // partially-committed file present
      ]),
    );
    expect(idx.get("match")).toMatchObject({ state: "downloaded", bytes: 5, expectedBytes: 5 });
    expect(idx.get("short")).toBeUndefined(); // dropped — next sync re-queues
    expect(corrupt).toEqual(["short"]); // caller deletes the partial file
  });

  it("resolveStaleInFlight leaves natively-active keys untouched", async () => {
    const idx = new DownloadIndex();
    await idx.load();
    await idx.upsert({ ...rec("live", "downloading"), bytes: 3, expectedBytes: 100 });
    await idx.upsert(rec("stale", "queued")); // no file, not active → dropped
    const corrupt = idx.resolveStaleInFlight(
      new Map([["live", 3]]), // a partial .final would mismatch expectedBytes...
      new Set(["live"]), // ...but the native engine is still writing it
    );
    expect(idx.get("live")).toMatchObject({ state: "downloading", bytes: 3 });
    expect(idx.get("stale")).toBeUndefined();
    expect(corrupt).toEqual([]);
  });
});
