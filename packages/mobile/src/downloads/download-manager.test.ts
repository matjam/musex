import type { DownloadJob } from "@musex/core";
import { describe, expect, it, vi } from "vitest";
import { DownloadIndex } from "./download-index";
import { DownloadManager } from "./download-manager";

function fakeStore() {
  const files = new Map<string, string>();
  return {
    files,
    has: (k: string) => files.has(k),
    size: (k: string) => files.get(k)?.length ?? 0,
    uri: (k: string) => `file:///downloads/${k}`,
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
    downloadUrl: async (key: string) => {
      files.set(key, "AUDIO");
      return 5;
    },
    remove: (k: string) => void files.delete(k),
    presentNonEmptyKeys: () => new Set(files.keys()),
    totalBytes: () => 0,
  };
}
const job = (key: string): DownloadJob => ({
  key,
  serverId: "s1",
  plexPath: `/library/parts/${key}/f.flac`,
  trackId: key,
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
  quality: { mode: "original" | "aac"; bitrateKbps: number },
) {
  const index = new DownloadIndex();
  return {
    index,
    m: new DownloadManager({
      store: store as never,
      index,
      fetch: fetchFn,
      endpoint: async () => ({ baseUrl: "https://pms", token: "t" }),
      clientId: "cid",
      getQuality: () => quality,
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
