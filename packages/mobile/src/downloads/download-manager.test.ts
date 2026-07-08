import type { DownloadJob, DownloadRecord, TransferEvent, TransferJob } from "@musex/core";
import { describe, expect, it, vi } from "vitest";
import { DownloadIndex } from "./download-index";
import { DownloadManager } from "./download-manager";
import { JsTransferEngine } from "./js-transfer-engine";
import { RoutingTransferEngine } from "./routing-transfer-engine";

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
      getConnectionType: () => "other",
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
function fakeNativeEngine(supportsConvert = false) {
  const listeners = new Set<(e: TransferEvent) => void>();
  const eng = {
    ownsQueue: true,
    supportsConvert: supportsConvert || undefined,
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

function nativeMgr(opts?: {
  quality?: { mode: "original" | "aac"; bitrateKbps: number };
  connectionType?: "wifi" | "cellular" | "other" | "none";
  supportsConvert?: boolean;
}) {
  const store = fakeStore();
  const index = new DownloadIndex();
  const eng = fakeNativeEngine(opts?.supportsConvert ?? false);
  const m = new DownloadManager({
    store: store as never,
    index,
    engine: eng,
    endpoint: async () => ({ baseUrl: "https://pms", token: "t" }),
    clientId: "cid",
    getQuality: () => opts?.quality ?? { mode: "original" as const, bitrateKbps: 256 },
    getConnectionType: () => opts?.connectionType ?? "other",
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

describe("DownloadManager — convert mode routing (aac + native convert)", () => {
  it("aac + convert-capable engine + wifi → mode convert (original-file url, target bitrate)", async () => {
    const { index, eng, m } = nativeMgr({
      quality: { mode: "aac", bitrateKbps: 192 },
      connectionType: "wifi",
      supportsConvert: true,
    });
    m.markReady();
    await m.enqueue([job("a", 999)]);
    expect(eng.submits).toHaveLength(1);
    const t = eng.submits[0]?.[0];
    expect(t?.mode).toBe("convert");
    expect(t?.url).toBe("https://pms/library/parts/a/f.flac?X-Plex-Token=t");
    expect(t?.targetBitrateKbps).toBe(192);
    expect(t?.expectedBytes).toBe(999);
    expect(t?.stopUrl).toBeUndefined();
    // The committed artifact is an AAC m4a — its destPath carries the reserved
    // `.conv.m4a` suffix so AVPlayer's extension sniffing sees m4a (the bare
    // flat name ends with the SOURCE extension and refuses to play).
    expect(t?.destPath).toBe("/downloads/a.conv.m4a");
    // The artifact is AAC — the pinned per-job format stays "aac".
    expect(index.get("a")?.format).toBe("aac");
  });

  it("aac + convert-capable + wifi but AV-unreadable container (ogg) → hls", async () => {
    // AVFoundation can't open ogg/vorbis — an on-device convert job would
    // fail "Cannot Open" terminally and sync would re-queue it forever.
    const { eng, m } = nativeMgr({
      quality: { mode: "aac", bitrateKbps: 192 },
      connectionType: "wifi",
      supportsConvert: true,
    });
    m.markReady();
    const j = job("a");
    await m.enqueue([{ ...j, meta: { ...j.meta, container: "ogg", audioCodec: "vorbis" } }]);
    expect(eng.submits).toHaveLength(1);
    expect(eng.submits[0]?.[0]?.mode).toBe("hls");
    // Not a convert job — the artifact name stays the BARE flat name.
    expect(eng.submits[0]?.[0]?.destPath).toBe("/downloads/a");
  });

  it("aac + convert-capable engine on CELLULAR → hls (server transcode)", async () => {
    const { eng, m } = nativeMgr({
      quality: { mode: "aac", bitrateKbps: 192 },
      connectionType: "cellular",
      supportsConvert: true,
    });
    m.markReady();
    await m.enqueue([job("a")]);
    expect(eng.submits[0]?.[0]?.mode).toBe("hls");
  });

  it("aac without convert support → hls even on wifi", async () => {
    const { eng, m } = nativeMgr({
      quality: { mode: "aac", bitrateKbps: 192 },
      connectionType: "wifi",
      supportsConvert: false,
    });
    m.markReady();
    await m.enqueue([job("a")]);
    expect(eng.submits[0]?.[0]?.mode).toBe("hls");
  });

  it("convert complete patches the record meta from the EVENT's converted+bitrate", async () => {
    const { index, eng, m } = nativeMgr({
      quality: { mode: "aac", bitrateKbps: 256 },
      connectionType: "wifi",
      supportsConvert: true,
    });
    m.markReady();
    await m.enqueue([job("a")]);
    // The engine reports the ACTUAL artifact bitrate (192) — that wins over
    // the current quality setting (256).
    eng.emit({ kind: "complete", key: "a", bytes: 42, converted: true, bitrateKbps: 192 });
    await tick();
    const r = index.get("a");
    expect(r).toMatchObject({ state: "downloaded", bytes: 42, expectedBytes: 42 });
    expect(r?.meta).toMatchObject({ container: "m4a", audioCodec: "aac", bitrate: 192 });
    // Non-media meta untouched.
    expect(r?.meta.title).toBe("a");
  });

  it("a submitted convert-mode job completing WITHOUT converted keeps the original meta", async () => {
    // The engine fell back to committing the original (or never converted):
    // no `converted` on the event → the record must describe the real file.
    const { index, eng, m } = nativeMgr({
      quality: { mode: "aac", bitrateKbps: 256 },
      connectionType: "wifi",
      supportsConvert: true,
    });
    m.markReady();
    await m.enqueue([job("a")]);
    eng.emit({ kind: "complete", key: "a", bytes: 42 });
    await tick();
    expect(index.get("a")?.meta).toMatchObject({ container: "flac", audioCodec: "flac" });
    expect(index.get("a")?.meta.bitrate).toBeUndefined();
  });

  it("an original-mode complete never patches meta", async () => {
    const { index, eng, m } = nativeMgr({
      quality: { mode: "original", bitrateKbps: 256 },
      connectionType: "wifi",
      supportsConvert: true,
    });
    m.markReady();
    await m.enqueue([job("a")]);
    // Original jobs commit the original bytes — bare artifact name, no suffix.
    expect(eng.submits[0]?.[0]?.destPath).toBe("/downloads/a");
    eng.emit({ kind: "complete", key: "a", bytes: 5 });
    await tick();
    expect(index.get("a")?.meta).toMatchObject({ container: "flac", audioCodec: "flac" });
  });

  it("a reattached-active record completing with converted gets the meta patch (event bitrate)", async () => {
    const { index, eng, m } = nativeMgr({
      quality: { mode: "aac", bitrateKbps: 128 },
      connectionType: "wifi",
      supportsConvert: true,
    });
    await index.upsert({ ...rec("x", "downloading"), format: "aac" });
    m.markReady();
    await tick();
    // The previous run's ACTUAL target (192, carried by the native backlog)
    // beats the current quality setting (128).
    eng.emit({ kind: "complete", key: "x", bytes: 9, converted: true, bitrateKbps: 192 });
    await tick();
    const r = index.get("x");
    expect(r).toMatchObject({ state: "downloaded", bytes: 9, expectedBytes: 9 });
    expect(r?.meta).toMatchObject({ container: "m4a", audioCodec: "aac", bitrate: 192 });
  });

  it("a reattached-active aac record completing WITHOUT converted → meta untouched", async () => {
    // Even on a convert-capable engine with an aac-format record, no
    // `converted` on the event means the committed file is the original —
    // the old format/capability heuristic must not resurrect the m4a guess.
    const { index, eng, m } = nativeMgr({
      quality: { mode: "aac", bitrateKbps: 128 },
      connectionType: "wifi",
      supportsConvert: true,
    });
    await index.upsert({ ...rec("x", "downloading"), format: "aac" });
    m.markReady();
    await tick();
    eng.emit({ kind: "complete", key: "x", bytes: 9 });
    await tick();
    const r = index.get("x");
    expect(r).toMatchObject({ state: "downloaded", bytes: 9, expectedBytes: 9 });
    expect(r?.meta).toMatchObject({ container: "flac", audioCodec: "flac" });
    expect(r?.meta.bitrate).toBeUndefined();
  });
});

describe("DownloadManager — routing engine (hls → JS engine, original → native)", () => {
  it("routes by pinned mode and maps routed events back onto records", async () => {
    const store = fakeStore();
    const index = new DownloadIndex();
    const hls = fakeNativeEngine();
    const native = fakeNativeEngine();
    let mode: "original" | "aac" = "aac";
    const m = new DownloadManager({
      store: store as never,
      index,
      engine: new RoutingTransferEngine({ hls, original: native }),
      endpoint: async () => ({ baseUrl: "https://pms", token: "t" }),
      clientId: "cid",
      getQuality: () => ({ mode, bitrateKbps: 192 }),
      getConnectionType: () => "other",
      onProgress: () => {},
    });
    m.markReady();
    await m.enqueue([job("h1"), job("h2")]); // aac → hls engine
    mode = "original";
    await m.enqueue([job("o1")]); // original → native engine
    expect(hls.submits.map((b) => b.map((t) => t.key))).toEqual([["h1", "h2"]]);
    expect(hls.submits[0]?.every((t) => t.mode === "hls")).toBe(true);
    expect(native.submits.map((b) => b.map((t) => t.key))).toEqual([["o1"]]);
    expect(native.submits[0]?.[0]?.mode).toBe("original");
    // Events from EITHER engine reach the manager's single subscription.
    hls.emit({ kind: "complete", key: "h1", bytes: 7 });
    native.emit({ kind: "error", key: "o1", message: "http 403", terminal: true });
    await tick();
    expect(index.get("h1")).toMatchObject({ state: "downloaded", bytes: 7, expectedBytes: 7 });
    expect(index.get("o1")).toMatchObject({ state: "failed", error: "http 403" });
    // cancelQueued fans the cancel out to both engines.
    await m.cancelQueued(["h2"]);
    expect(hls.cancels).toEqual([["h2"]]);
    expect(native.cancels).toEqual([["h2"]]);
  });
});
