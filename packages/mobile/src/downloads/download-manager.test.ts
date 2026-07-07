import type { DownloadJob } from "@musex/core";
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
    presentNonEmptyKeys: () => new Set(files.keys()),
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
