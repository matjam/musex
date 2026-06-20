import { describe, expect, it } from "vitest";
import type { Track } from "../models/index.js";
import { downloadKey } from "./download-lookup.js";
import type { DownloadMeta } from "./download-plan.js";
import type { DownloadOrigin, DownloadRecord, DownloadStatus } from "./download-state.js";
import {
  estimateSyncBytes,
  planLibrarySync,
  runLibrarySync,
  type SyncPorts,
} from "./library-sync.js";

function track(id: string, partKey: string, durationMs = 240_000, bitrate?: number): Track {
  return {
    id,
    serverId: "srv",
    albumId: "al",
    artistId: "ar",
    artistName: "Artist",
    albumTitle: "Album",
    title: `Track ${id}`,
    durationMs,
    media: { container: "flac", audioCodec: "flac", bitrate, partId: "p", partKey },
  };
}

function record(
  partKey: string,
  state: DownloadStatus,
  origin?: DownloadOrigin, // omitted = undefined, i.e. a pre-origin (legacy) record
): DownloadRecord {
  const meta: DownloadMeta = {
    albumId: "al",
    artistId: "ar",
    artistName: "Artist",
    albumTitle: "Album",
    title: "T",
    durationMs: 240_000,
    container: "flac",
    audioCodec: "flac",
    partId: "p",
  };
  return {
    key: downloadKey("srv", partKey),
    serverId: "srv",
    plexPath: partKey,
    trackId: "t",
    format: "aac",
    state,
    bytes: 1,
    addedAt: 0,
    meta,
    origin,
  };
}

describe("planLibrarySync", () => {
  it("downloads library tracks that have no downloaded/in-flight record", () => {
    const lib = [track("1", "/a"), track("2", "/b"), track("3", "/c")];
    const have = [record("/a", "downloaded"), record("/b", "downloading")];
    const plan = planLibrarySync(lib, have, { allowRemovals: false });
    expect(plan.toDownload.map((t) => t.media.partKey)).toEqual(["/c"]);
  });

  it("re-downloads failed and missing records", () => {
    const lib = [track("1", "/a"), track("2", "/b")];
    const have = [record("/a", "failed"), record("/b", "missing")];
    const plan = planLibrarySync(lib, have, { allowRemovals: false });
    expect(plan.toDownload.map((t) => t.media.partKey).sort()).toEqual(["/a", "/b"]);
  });

  it("removes sync-origin downloads no longer in the library when allowRemovals", () => {
    const lib = [track("1", "/a")];
    const have = [record("/a", "downloaded"), record("/gone", "downloaded", "sync")];
    const plan = planLibrarySync(lib, have, { allowRemovals: true });
    expect(plan.toRemove).toEqual([downloadKey("srv", "/gone")]);
  });

  it("NEVER removes when allowRemovals is false, even if the library is empty", () => {
    const have = [record("/a", "downloaded", "sync"), record("/b", "downloaded", "sync")];
    const plan = planLibrarySync([], have, { allowRemovals: false });
    expect(plan.toRemove).toEqual([]);
  });

  it("never removes manual-origin pins, even if absent from the library", () => {
    const lib = [track("1", "/a")];
    const have = [
      record("/a", "downloaded", "sync"),
      record("/manual", "downloaded", "manual"),
      record("/legacy", "downloaded", undefined), // pre-origin record → treated as manual
    ];
    const plan = planLibrarySync(lib, have, { allowRemovals: true });
    expect(plan.toRemove).toEqual([]);
  });
});

describe("runLibrarySync", () => {
  function ports(
    over: Partial<SyncPorts> & Pick<SyncPorts, "listAllTracks" | "downloadedRecords">,
  ) {
    const enqueued: Track[][] = [];
    const removed: string[] = [];
    const p: SyncPorts = {
      isEnabled: () => true,
      enqueue: async (t) => {
        enqueued.push(t);
      },
      remove: async (k) => {
        removed.push(k);
      },
      ...over,
    };
    return { p, enqueued, removed };
  }

  it("does nothing when disabled", async () => {
    const { p, enqueued, removed } = ports({
      isEnabled: () => false,
      listAllTracks: async () => {
        throw new Error("should not be called");
      },
      downloadedRecords: () => [],
    });
    const res = await runLibrarySync(p);
    expect(res).toEqual({ downloaded: 0, removed: 0, reconciled: false });
    expect(enqueued).toEqual([]);
    expect(removed).toEqual([]);
  });

  it("downloads the missing tracks and removes departed sync downloads", async () => {
    const lib = [track("1", "/a"), track("2", "/b")];
    const have = [record("/a", "downloaded", "sync"), record("/gone", "downloaded", "sync")];
    const { p, enqueued, removed } = ports({
      listAllTracks: async () => lib,
      downloadedRecords: () => have,
    });
    const res = await runLibrarySync(p);
    expect(enqueued[0]?.map((t) => t.media.partKey)).toEqual(["/b"]);
    expect(removed).toEqual([downloadKey("srv", "/gone")]);
    expect(res).toMatchObject({ downloaded: 1, removed: 1, reconciled: true });
  });

  it("SAFETY: a failed/offline fetch removes nothing and downloads nothing", async () => {
    const have = [record("/a", "downloaded", "sync"), record("/b", "downloaded", "sync")];
    const { p, enqueued, removed } = ports({
      listAllTracks: async () => {
        throw new Error("offline");
      },
      downloadedRecords: () => have,
    });
    const res = await runLibrarySync(p);
    expect(enqueued).toEqual([]);
    expect(removed).toEqual([]);
    expect(res.reconciled).toBe(false);
  });
});

describe("estimateSyncBytes", () => {
  it("estimates AAC from duration × bitrate", () => {
    // 240s × (256_000 / 8) = 240 × 32000 = 7_680_000
    const bytes = estimateSyncBytes([track("1", "/a", 240_000)], { mode: "aac", bitrateKbps: 256 });
    expect(bytes).toBe(7_680_000);
  });

  it("estimates Original from each track's media bitrate", () => {
    // 240s × (1000_000 / 8) = 240 × 125000 = 30_000_000
    const bytes = estimateSyncBytes([track("1", "/a", 240_000, 1000)], {
      mode: "original",
      bitrateKbps: 256,
    });
    expect(bytes).toBe(30_000_000);
  });

  it("falls back to the configured bitrate for Original tracks with no media bitrate", () => {
    const bytes = estimateSyncBytes([track("1", "/a", 240_000, undefined)], {
      mode: "original",
      bitrateKbps: 256,
    });
    expect(bytes).toBe(7_680_000); // same as the AAC-256 floor
  });

  it("is zero for an empty list", () => {
    expect(estimateSyncBytes([], { mode: "aac", bitrateKbps: 256 })).toBe(0);
  });
});
