import type { DownloadJob } from "@musex/core";
import { describe, expect, it, vi } from "vitest";
import { DownloadIndex } from "../adapters/download-index.js";
import { DownloadManager } from "./download-manager.js";

function fakeStore() {
  const files = new Map<string, string>();
  return {
    files,
    has: async (k: string) => files.has(k),
    beginWrite(key: string) {
      let buf = "";
      return {
        stream: {
          write: (c: string) => {
            buf += c;
          },
          end: () => {},
          destroyed: false,
        } as never,
        commit: async () => {
          files.set(key, buf);
        },
        abort: async () => {},
      };
    },
    remove: async (k: string) => {
      files.delete(k);
    },
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
    partId: "p1",
  },
});

describe("DownloadManager", () => {
  it("downloads a job: queued→downloaded, file stored, progress emitted", async () => {
    const store = fakeStore();
    const index = new DownloadIndex([], () => {});
    const progress: string[] = [];
    const fetchFn = vi.fn(
      async () =>
        new Response("AUDIODATA", {
          status: 200,
          headers: { "content-length": "9", "content-type": "audio/flac" },
        }),
    );
    const mgr = new DownloadManager({
      store: store as never,
      index,
      fetch: fetchFn as never,
      endpoint: async () => ({ baseUrl: "https://pms", token: "t" }),
      clientId: "cid",
      getQuality: () => ({ mode: "original", bitrateKbps: 256 }),
      onProgress: (e) => progress.push(`${e.key}:${e.state}`),
    });
    await mgr.enqueue([job("a")]);
    await mgr.drain();
    expect(store.files.has("a")).toBe(true);
    expect(index.get("a")?.state).toBe("downloaded");
    expect(progress).toContain("a:downloaded");
  });

  it("transcode mode fetches the MP3 start URL then the stop URL, both via the injected fetch", async () => {
    const store = fakeStore();
    const index = new DownloadIndex([], () => {});
    const urls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      urls.push(url);
      return new Response("MP3", { status: 200, headers: { "content-type": "audio/mpeg" } });
    });
    const mgr = new DownloadManager({
      store: store as never,
      index,
      fetch: fetchFn as never,
      endpoint: async () => ({ baseUrl: "https://pms", token: "t" }),
      clientId: "cid",
      getQuality: () => ({ mode: "mp3", bitrateKbps: 192 }),
      onProgress: () => {},
    });
    await mgr.enqueue([job("b")]);
    await mgr.drain();
    const start = urls.find((u) => u.includes("/audio/:/transcode/universal/start.mp3"));
    expect(start).toBeDefined();
    expect(start).toContain("musicBitrate=192");
    // The best-effort stop call must use the same injected fetch (so a custom
    // TLS client applies to it too), not globalThis.fetch.
    expect(urls.some((u) => u.includes("/audio/:/transcode/universal/stop"))).toBe(true);
    expect(index.get("b")?.format).toBe("mp3");
  });

  it("marks failed on non-200 and stores nothing", async () => {
    const store = fakeStore();
    const index = new DownloadIndex([], () => {});
    const mgr = new DownloadManager({
      store: store as never,
      index,
      fetch: (async () => new Response("nope", { status: 500 })) as never,
      endpoint: async () => ({ baseUrl: "https://pms", token: "t" }),
      clientId: "cid",
      getQuality: () => ({ mode: "original", bitrateKbps: 256 }),
      onProgress: () => {},
    });
    await mgr.enqueue([job("c")]);
    await mgr.drain();
    expect(store.files.has("c")).toBe(false);
    expect(index.get("c")?.state).toBe("failed");
  });

  it("marks failed on empty body and stores nothing", async () => {
    const store = fakeStore();
    const index = new DownloadIndex([], () => {});
    const mgr = new DownloadManager({
      store: store as never,
      index,
      fetch: (async () => new Response("", { status: 200 })) as never,
      endpoint: async () => ({ baseUrl: "https://pms", token: "t" }),
      clientId: "cid",
      getQuality: () => ({ mode: "original", bitrateKbps: 256 }),
      onProgress: () => {},
    });
    await mgr.enqueue([job("d")]);
    await mgr.drain();
    expect(store.files.has("d")).toBe(false);
    expect(index.get("d")?.state).toBe("failed");
    expect(index.get("d")?.error).toBe("empty body");
  });

  it("marks failed when content-length mismatches actual body size and stores nothing", async () => {
    const store = fakeStore();
    const index = new DownloadIndex([], () => {});
    const mgr = new DownloadManager({
      store: store as never,
      index,
      fetch: (async () =>
        new Response("SHORT", { status: 200, headers: { "content-length": "9999" } })) as never,
      endpoint: async () => ({ baseUrl: "https://pms", token: "t" }),
      clientId: "cid",
      getQuality: () => ({ mode: "original", bitrateKbps: 256 }),
      onProgress: () => {},
    });
    await mgr.enqueue([job("e")]);
    await mgr.drain();
    expect(store.files.has("e")).toBe(false);
    expect(index.get("e")?.state).toBe("failed");
    expect(index.get("e")?.error).toMatch(/truncated: got 5 of 9999 bytes/);
  });

  it("marks failed when content-type is text/* (Plex error page) and stores nothing", async () => {
    const store = fakeStore();
    const index = new DownloadIndex([], () => {});
    const mgr = new DownloadManager({
      store: store as never,
      index,
      fetch: (async () =>
        new Response("<html>error</html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        })) as never,
      endpoint: async () => ({ baseUrl: "https://pms", token: "t" }),
      clientId: "cid",
      getQuality: () => ({ mode: "original", bitrateKbps: 256 }),
      onProgress: () => {},
    });
    await mgr.enqueue([job("f")]);
    await mgr.drain();
    expect(store.files.has("f")).toBe(false);
    expect(index.get("f")?.state).toBe("failed");
    expect(index.get("f")?.error).toBe("non-audio content-type: text/html; charset=utf-8");
  });

  it("saves a valid audio response with matching content-length as downloaded", async () => {
    const store = fakeStore();
    const index = new DownloadIndex([], () => {});
    const body = "VALIDAUDIO";
    const mgr = new DownloadManager({
      store: store as never,
      index,
      fetch: (async () =>
        new Response(body, {
          status: 200,
          headers: {
            "content-type": "audio/flac",
            "content-length": String(Buffer.byteLength(body)),
          },
        })) as never,
      endpoint: async () => ({ baseUrl: "https://pms", token: "t" }),
      clientId: "cid",
      getQuality: () => ({ mode: "original", bitrateKbps: 256 }),
      onProgress: () => {},
    });
    await mgr.enqueue([job("g")]);
    await mgr.drain();
    expect(store.files.has("g")).toBe(true);
    expect(index.get("g")?.state).toBe("downloaded");
  });
});
