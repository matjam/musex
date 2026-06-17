import { describe, expect, it, vi } from "vitest";
import { DownloadManager } from "./download-manager.js";
import { DownloadIndex } from "../adapters/download-index.js";
import type { DownloadJob } from "@musex/core";

function fakeStore() {
  const files = new Map<string, string>();
  return {
    files,
    has: async (k: string) => files.has(k),
    beginWrite(key: string) {
      let buf = "";
      return {
        stream: { write: (c: string) => { buf += c; }, end: () => {}, destroyed: false } as never,
        commit: async () => { files.set(key, buf); },
        abort: async () => {},
      };
    },
    remove: async (k: string) => { files.delete(k); },
  };
}

const job = (key: string): DownloadJob => ({
  key, serverId: "s1", plexPath: `/library/parts/${key}/f.flac`, trackId: key,
  meta: { title: key, artistName: "A", durationMs: 1, albumId: "al", artistId: "ar" },
});

describe("DownloadManager", () => {
  it("downloads a job: queued→downloaded, file stored, progress emitted", async () => {
    const store = fakeStore();
    const index = new DownloadIndex([], () => {});
    const progress: string[] = [];
    const fetchFn = vi.fn(async () =>
      new Response("AUDIODATA", { status: 200, headers: { "content-length": "9" } }),
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

  it("transcode mode fetches the MP3 transcode URL", async () => {
    const store = fakeStore();
    const index = new DownloadIndex([], () => {});
    let fetchedUrl = "";
    const fetchFn = vi.fn(async (url: string) => {
      fetchedUrl = url;
      return new Response("MP3", { status: 200 });
    });
    const mgr = new DownloadManager({
      store: store as never, index, fetch: fetchFn as never,
      endpoint: async () => ({ baseUrl: "https://pms", token: "t" }),
      clientId: "cid",
      getQuality: () => ({ mode: "mp3", bitrateKbps: 192 }),
      onProgress: () => {},
    });
    await mgr.enqueue([job("b")]);
    await mgr.drain();
    expect(fetchedUrl).toContain("/audio/:/transcode/universal/start.mp3");
    expect(fetchedUrl).toContain("musicBitrate=192");
    expect(index.get("b")?.format).toBe("mp3");
  });

  it("marks failed on non-200 and stores nothing", async () => {
    const store = fakeStore();
    const index = new DownloadIndex([], () => {});
    const mgr = new DownloadManager({
      store: store as never, index,
      fetch: (async () => new Response("nope", { status: 500 })) as never,
      endpoint: async () => ({ baseUrl: "https://pms", token: "t" }),
      clientId: "cid", getQuality: () => ({ mode: "original", bitrateKbps: 256 }),
      onProgress: () => {},
    });
    await mgr.enqueue([job("c")]);
    await mgr.drain();
    expect(store.files.has("c")).toBe(false);
    expect(index.get("c")?.state).toBe("failed");
  });
});
