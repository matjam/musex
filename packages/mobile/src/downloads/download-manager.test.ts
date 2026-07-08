import type { DownloadJob, DownloadRecord, TransferEvent, TransferJob } from "@musex/core";
import { describe, expect, it, vi } from "vitest";
import { DownloadIndex } from "./download-index";
import { DownloadManager } from "./download-manager";
import { JsTransferEngine } from "./js-transfer-engine";

function fakeStore() {
  const files = new Map<string, string>();
  return {
    files,
    has: (k: string) => files.has(k),
    size: (k: string) => files.get(k)?.length ?? 0,
    uri: (k: string) => `file:///downloads/${k}`,
    path: (k: string) => `/downloads/${k}`,
    beginWrite(key: string) {
      let buf = "";
      return {
        write: (b: Uint8Array) => {
          buf += new TextDecoder().decode(b);
        },
        commit: async () => {
          files.set(key, buf);
        },
        abort: async () => {},
      };
    },
    downloadUrl: async (
      key: string,
      _url?: string,
      onProgress?: (bytesWritten: number, totalBytes: number) => void,
    ) => {
      onProgress?.(3, 5);
      files.set(key, "AUDIO");
      return 5;
    },
    remove: (k: string) => void files.delete(k),
    presentFileSizes: () => new Map([...files.entries()].map(([k, v]) => [k, v.length])),
    totalBytes: () => 0,
  };
}
const job = (key: string, expectedBytes?: number): DownloadJob => ({
  key,
  serverId: "s1",
  plexPath: `/library/parts/${key}/f.flac`,
  trackId: key,
  expectedBytes,
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

vi.mock("@react-native-async-storage/async-storage", () => {
  const m = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => m.get(k) ?? null,
      setItem: async (k: string, v: string) => void m.set(k, v),
    },
  };
});

function mgr(
  store: ReturnType<typeof fakeStore>,
  fetchFn: typeof fetch,
  quality:
    | { mode: "original" | "aac"; bitrateKbps: number }
    | (() => { mode: "original" | "aac"; bitrateKbps: number }),
) {
  const index = new DownloadIndex();
  return {
    index,
    m: new DownloadManager({
      store: store as never,
      index,
      engine: new JsTransferEngine({ store: store as never, fetch: fetchFn }),
      endpoint: async () => ({ baseUrl: "https://pms", token: "t" }),
      clientId: "cid",
      getQuality: typeof quality === "function" ? quality : () => quality,
      onProgress: () => {},
    }),
  };
}

describe("DownloadManager", () => {
  it("original: downloads to the store and marks downloaded", async () => {
    const store = fakeStore();
    const { index, m } = mgr(store, (async () => new Response("x")) as never, {
      mode: "original",
      bitrateKbps: 256,
    });
    await m.enqueue([job("a")]);
    await m.drain();
    expect(store.files.has("a")).toBe(true);
    expect(index.get("a")?.state).toBe("downloaded");
  });
  it("aac: stitches HLS segments then requires ENDLIST", async () => {
    const store = fakeStore();
    const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=320000\nsession/s/base/index.m3u8\n";
    const media = "#EXTM3U\n#EXTINF:1.0,\nseg0.ts\n#EXTINF:1.0,\nseg1.ts\n#EXT-X-ENDLIST\n";
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("start.m3u8")) return new Response(master);
      if (url.includes("index.m3u8")) return new Response(media);
      if (url.includes(".ts")) return new Response(url.includes("seg0") ? "AAA" : "BBB");
      return new Response("");
    });
    const { index, m } = mgr(store, fetchFn as never, {
      mode: "aac",
      bitrateKbps: 192,
    });
    await m.enqueue([job("b")]);
    await m.drain();
    expect(store.files.get("b")).toBe("AAABBB");
    expect(index.get("b")?.state).toBe("downloaded");
    expect(index.get("b")?.format).toBe("aac");
  });
  it("persists the DELIVERED size as expectedBytes on complete (catalog drift accepted)", async () => {
    const store = fakeStore();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { index, m } = mgr(store, (async () => new Response("x")) as never, {
        mode: "original",
        bitrateKbps: 256,
      });
      // Catalog says 3, the store delivers 5 — accepted, and the record's
      // expectedBytes becomes the actual committed size (reconcile truth).
      await m.enqueue([job("a", 3)]);
      await m.drain();
      const rec = index.get("a");
      expect(rec?.state).toBe("downloaded");
      expect(rec?.bytes).toBe(5);
      expect(rec?.expectedBytes).toBe(5);
    } finally {
      warn.mockRestore();
    }
  });

  it("under-delivery vs the catalog → failed, file removed", async () => {
    const store = fakeStore();
    const { index, m } = mgr(store, (async () => new Response("x")) as never, {
      mode: "original",
      bitrateKbps: 256,
    });
    await m.enqueue([job("a", 100)]); // store delivers 5 < 100
    await m.drain();
    expect(store.files.has("a")).toBe(false);
    const rec = index.get("a");
    expect(rec?.state).toBe("failed");
    expect(rec?.error).toContain("truncated");
  });

  it("re-enqueueing an in-flight key is a no-op (no second download)", async () => {
    const store = fakeStore();
    let downloads = 0;
    const orig = store.downloadUrl;
    store.downloadUrl = async (...args) => {
      downloads += 1;
      return orig(...args);
    };
    const { index, m } = mgr(store, (async () => new Response("x")) as never, {
      mode: "original",
      bitrateKbps: 256,
    });
    await m.enqueue([job("a"), job("a")]); // duplicate within one batch
    await m.enqueue([job("a")]); // duplicate while queued/downloading
    await m.drain();
    expect(downloads).toBe(1);
    expect(index.get("a")?.state).toBe("downloaded");
  });

  it("mid-flight progress bytes reach the index record", async () => {
    const store = fakeStore();
    const { index, m } = mgr(store, (async () => new Response("x")) as never, {
      mode: "original",
      bitrateKbps: 256,
    });
    const upserts: Parameters<typeof index.upsert>[0][] = [];
    const origUpsert = index.upsert.bind(index);
    vi.spyOn(index, "upsert").mockImplementation(async (r) => {
      upserts.push(r);
      return origUpsert(r);
    });
    await m.enqueue([job("a")]);
    await m.drain();
    // The fake store fires onProgress(3, 5) before completing.
    expect(upserts.some((r) => r.state === "downloading" && r.bytes === 3)).toBe(true);
  });

  it("format + transfer mode are pinned at enqueue (a quality toggle mid-flight doesn't flip them)", async () => {
    const store = fakeStore();
    const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=320000\nsession/s/base/index.m3u8\n";
    const media = "#EXTM3U\n#EXTINF:1.0,\nseg0.ts\n#EXTINF:1.0,\nseg1.ts\n#EXT-X-ENDLIST\n";
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("start.m3u8")) return new Response(master);
      if (url.includes("index.m3u8")) return new Response(media);
      if (url.includes(".ts")) return new Response(url.includes("seg0") ? "AAA" : "BBB");
      return new Response("");
    });
    // First getQuality call (the enqueue pin) says aac; every later call says
    // original — the transfer must still run HLS and the record stay "aac".
    let calls = 0;
    const { index, m } = mgr(store, fetchFn as never, () =>
      calls++ === 0
        ? { mode: "aac" as const, bitrateKbps: 192 }
        : { mode: "original" as const, bitrateKbps: 256 },
    );
    await m.enqueue([job("b")]);
    await m.drain();
    expect(store.files.get("b")).toBe("AAABBB"); // HLS stitch, not an original GET
    expect(index.get("b")?.format).toBe("aac");
    expect(index.get("b")?.state).toBe("downloaded");
  });

  it("cancelQueued drops a not-yet-running job (the running one is untouched)", async () => {
    const store = fakeStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let downloads = 0;
    const orig = store.downloadUrl;
    store.downloadUrl = async (...args) => {
      downloads += 1;
      await gate;
      return orig(...args);
    };
    const { index, m } = mgr(store, (async () => new Response("x")) as never, {
      mode: "original",
      bitrateKbps: 256,
    });
    await m.enqueue([job("a"), job("b")]); // "a" starts (blocked on the gate), "b" queues
    await m.cancelQueued(["b"]);
    release();
    await m.drain();
    expect(downloads).toBe(1); // "b" never ran
    expect(index.get("a")?.state).toBe("downloaded");
    // The record cleanup belongs to the caller (store.tsx drops + re-enqueues).
    expect(index.get("b")?.state).toBe("queued");
  });

  it("aac: no ENDLIST → failed, stores nothing", async () => {
    const store = fakeStore();
    const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nsession/s/base/index.m3u8\n";
    const media = "#EXTM3U\n#EXTINF:1.0,\nseg0.ts\n"; // no ENDLIST
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("start.m3u8")) return new Response(master);
      if (url.includes("index.m3u8")) return new Response(media);
      return new Response("AAA");
    });
    const { index, m } = mgr(store, fetchFn as never, {
      mode: "aac",
      bitrateKbps: 192,
    });
    await m.enqueue([job("h")]);
    await m.drain();
    expect(store.files.has("h")).toBe(false);
    expect(index.get("h")?.state).toBe("failed");
  });
});

// --- native (ownsQueue) mode ---

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** Fake of the native background engine: records submits/cancels, lets tests
 *  emit events. ownsQueue → the manager batch-submits and never awaits. */
function fakeNativeEngine() {
  const listeners = new Set<(e: TransferEvent) => void>();
  const eng = {
    ownsQueue: true,
    submits: [] as TransferJob[][],
    cancels: [] as string[][],
    async submit(jobs: TransferJob[]) {
      eng.submits.push(jobs);
    },
    async cancel(keys: string[]) {
      eng.cancels.push(keys);
    },
    async reattach() {
      return { active: [], completed: [], failed: [] };
    },
    onEvent(cb: (e: TransferEvent) => void) {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    emit(e: TransferEvent) {
      for (const cb of listeners) cb(e);
    },
  };
  return eng;
}

function nativeMgr() {
  const store = fakeStore();
  const index = new DownloadIndex();
  const eng = fakeNativeEngine();
  const m = new DownloadManager({
    store: store as never,
    index,
    engine: eng,
    endpoint: async () => ({ baseUrl: "https://pms", token: "t" }),
    clientId: "cid",
    getQuality: () => ({ mode: "original" as const, bitrateKbps: 256 }),
    onProgress: () => {},
  });
  return { store, index, eng, m };
}

/** A record as a previous run would have left it (reattached-active). */
const rec = (key: string, state: DownloadRecord["state"]): DownloadRecord => ({
  key,
  serverId: "s1",
  plexPath: `/library/parts/${key}/f.flac`,
  trackId: key,
  format: "original",
  state,
  bytes: 0,
  addedAt: 1,
  origin: "manual",
  meta: job(key).meta,
});

describe("DownloadManager — native engine (ownsQueue)", () => {
  it("submits the WHOLE batch to the native backlog; drain resolves immediately", async () => {
    const { store, index, eng, m } = nativeMgr();
    m.markReady();
    await m.enqueue([job("a"), job("b"), job("c")]);
    expect(eng.submits).toHaveLength(1); // one batch, not one submit per job
    expect(eng.submits[0]?.map((t) => t.key)).toEqual(["a", "b", "c"]);
    for (const k of ["a", "b", "c"]) expect(index.get(k)?.state).toBe("queued");
    await m.drain(); // native owns completion — nothing to await in JS
    expect(store.files.size).toBe(0);
  });

  it("maps events onto records for its own submissions (progress/complete/error)", async () => {
    const { index, eng, m } = nativeMgr();
    m.markReady();
    await m.enqueue([job("a", 3), job("b")]);
    eng.emit({ kind: "progress", key: "a", bytes: 2 });
    await tick();
    expect(index.get("a")?.state).toBe("downloading");
    expect(index.get("a")?.bytes).toBe(2);
    // non-terminal error → still downloading (native retries on its own)
    eng.emit({ kind: "error", key: "a", message: "http 503", terminal: false });
    await tick();
    expect(index.get("a")?.state).toBe("downloading");
    // delivered size is authoritative on complete
    eng.emit({ kind: "complete", key: "a", bytes: 5 });
    eng.emit({ kind: "error", key: "b", message: "http 403", terminal: true });
    await tick();
    expect(index.get("a")).toMatchObject({ state: "downloaded", bytes: 5, expectedBytes: 5 });
    expect(index.get("b")).toMatchObject({ state: "failed", error: "http 403" });
  });

  it("patches a reattached-active record it never submitted itself", async () => {
    const { index, eng, m } = nativeMgr();
    await index.upsert(rec("x", "downloading"));
    m.markReady();
    await tick();
    eng.emit({ kind: "progress", key: "x", bytes: 4 });
    await tick();
    expect(index.get("x")).toMatchObject({ state: "downloading", bytes: 4 });
    eng.emit({ kind: "complete", key: "x", bytes: 9 });
    await tick();
    expect(index.get("x")).toMatchObject({ state: "downloaded", bytes: 9, expectedBytes: 9 });
  });

  it("a terminal event for a key with NO record cleans the orphan file, creates nothing", async () => {
    const { store, index, eng, m } = nativeMgr();
    m.markReady();
    await tick();
    store.files.set("ghost", "AUDIO"); // Swift committed it; JS forgot the key
    eng.emit({ kind: "complete", key: "ghost", bytes: 5 });
    await tick();
    expect(store.files.has("ghost")).toBe(false);
    expect(index.get("ghost")).toBeUndefined();
  });

  it("a stale 'cancelled' terminal never fails a cancelled-then-re-enqueued record", async () => {
    const { index, eng, m } = nativeMgr();
    m.markReady();
    await m.enqueue([job("a")]);
    // Quality change (store.tsx order): cancelQueued → drop records → re-enqueue.
    await m.cancelQueued(["a"]);
    expect(eng.cancels).toEqual([["a"]]);
    await index.remove("a");
    await m.enqueue([job("a")]);
    expect(eng.submits).toHaveLength(2); // re-submitted at the new mode
    // The old job's terminal "cancelled" event arrives late — bookkeeping
    // already done, must not touch the fresh record.
    eng.emit({ kind: "error", key: "a", message: "cancelled", terminal: true });
    await tick();
    expect(index.get("a")?.state).toBe("queued");
  });

  it("removeDownload cancels the transfer FIRST; a late terminal never resurrects", async () => {
    const { store, index, eng, m } = nativeMgr();
    m.markReady();
    await m.enqueue([job("a")]);
    store.files.set("a", "PART"); // some bytes already landed
    await m.removeDownload("a");
    expect(eng.cancels).toEqual([["a"]]);
    expect(store.files.has("a")).toBe(false);
    expect(index.get("a")).toBeUndefined();
    // The transfer finished before the cancel landed: native committed the
    // file and its late complete event arrives → orphan cleanup, no record.
    store.files.set("a", "AUDIO");
    eng.emit({ kind: "complete", key: "a", bytes: 5 });
    await tick();
    expect(index.get("a")).toBeUndefined();
    expect(store.files.has("a")).toBe(false);
    // and the cancelled terminal is bookkeeping-only too
    eng.emit({ kind: "error", key: "a", message: "cancelled", terminal: true });
    await tick();
    expect(index.get("a")).toBeUndefined();
  });

  it("buffers events until markReady so the reattach fold wins", async () => {
    const { index, eng, m } = nativeMgr();
    await index.upsert(rec("x", "downloading"));
    eng.emit({ kind: "complete", key: "x", bytes: 7 }); // before markReady
    await tick();
    expect(index.get("x")?.state).toBe("downloading"); // held back
    m.markReady();
    await tick();
    expect(index.get("x")?.state).toBe("downloaded"); // released after the fold
  });

  it("dedupes against in-flight records and already-present files", async () => {
    const { store, index, eng, m } = nativeMgr();
    m.markReady();
    await index.upsert(rec("active", "downloading")); // reattached-active
    store.files.set("done", "AUDIO"); // already downloaded
    await m.enqueue([job("active"), job("done"), job("fresh")]);
    expect(eng.submits).toHaveLength(1);
    expect(eng.submits[0]?.map((t) => t.key)).toEqual(["fresh"]);
    expect(index.get("active")?.state).toBe("downloading"); // untouched
  });
});
