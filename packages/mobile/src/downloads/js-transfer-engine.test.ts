import type { TransferEvent, TransferJob } from "@musex/core";
import { describe, expect, it, vi } from "vitest";
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
      _url: string,
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

const originalJob = (over: Partial<TransferJob> = {}): TransferJob => ({
  key: "a",
  mode: "original",
  url: "https://pms/library/parts/a/f.flac?X-Plex-Token=t",
  headers: {},
  destPath: "/downloads/a",
  ...over,
});

const hlsJob = (key: string): TransferJob => ({
  key,
  mode: "hls",
  url: "https://pms/music/:/transcode/universal/start.m3u8?session=s",
  headers: { "X-Plex-Token": "t", "X-Plex-Client-Profile-Extra": "x" },
  destPath: `/downloads/${key}`,
  stopUrl: "https://pms/audio/:/transcode/universal/stop?session=s",
});

/** Collect this engine's events; resolve on the first terminal one for `key`. */
function collect(engine: JsTransferEngine, key: string) {
  const events: TransferEvent[] = [];
  const terminal = new Promise<TransferEvent>((resolve) => {
    engine.onEvent((e) => {
      events.push(e);
      if (e.key === key && e.kind !== "progress") resolve(e);
    });
  });
  return { events, terminal };
}

describe("JsTransferEngine — original", () => {
  it("emits progress then complete on success", async () => {
    const store = fakeStore();
    const engine = new JsTransferEngine({ store: store as never, fetch: fetch as never });
    const { events, terminal } = collect(engine, "a");
    await engine.submit([originalJob()]);
    const end = await terminal;
    expect(end).toEqual({ kind: "complete", key: "a", bytes: 5 });
    expect(events.some((e) => e.kind === "progress" && e.bytes === 3)).toBe(true);
    expect(store.files.has("a")).toBe(true);
  });

  it("under-delivery (truncation) → terminal error and the file is removed", async () => {
    const store = fakeStore();
    store.downloadUrl = async (key: string) => {
      store.files.set(key, "SHORT");
      return 60;
    };
    const engine = new JsTransferEngine({ store: store as never, fetch: fetch as never });
    const { terminal } = collect(engine, "a");
    await engine.submit([originalJob({ expectedBytes: 100 })]);
    const end = await terminal;
    expect(end).toEqual({
      kind: "error",
      key: "a",
      message: "truncated: got 60 want 100",
      terminal: true,
    });
    expect(store.files.has("a")).toBe(false);
  });

  it("a matching expectedBytes completes", async () => {
    const store = fakeStore();
    const engine = new JsTransferEngine({ store: store as never, fetch: fetch as never });
    const { terminal } = collect(engine, "a");
    await engine.submit([originalJob({ expectedBytes: 5 })]);
    expect(await terminal).toEqual({ kind: "complete", key: "a", bytes: 5 });
  });

  it("over-delivery vs the catalog is accepted with a warning (delivered size wins)", async () => {
    const store = fakeStore();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const engine = new JsTransferEngine({ store: store as never, fetch: fetch as never });
      const { terminal } = collect(engine, "a");
      await engine.submit([originalJob({ expectedBytes: 3 })]); // store delivers 5
      expect(await terminal).toEqual({ kind: "complete", key: "a", bytes: 5 });
      expect(store.files.has("a")).toBe(true);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("size differs from Plex catalog"),
        "a",
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("a duplicate key in one submit batch emits a terminal error, not a silent drop", async () => {
    const store = fakeStore();
    const engine = new JsTransferEngine({ store: store as never, fetch: fetch as never });
    const events: TransferEvent[] = [];
    const done = new Promise<void>((resolve) => {
      engine.onEvent((e) => {
        events.push(e);
        if (e.kind === "complete") resolve();
      });
    });
    await engine.submit([originalJob(), originalJob()]);
    await done;
    expect(
      events.some((e) => e.kind === "error" && e.terminal && /duplicate/.test(e.message)),
    ).toBe(true);
    expect(events.some((e) => e.kind === "complete" && e.bytes === 5)).toBe(true);
  });

  it("a thrown download error → terminal error, file removed", async () => {
    const store = fakeStore();
    store.downloadUrl = async () => {
      throw new Error("network down");
    };
    const engine = new JsTransferEngine({ store: store as never, fetch: fetch as never });
    const { terminal } = collect(engine, "a");
    await engine.submit([originalJob()]);
    const end = await terminal;
    expect(end).toMatchObject({ kind: "error", key: "a", message: "network down" });
  });
});

describe("JsTransferEngine — hls", () => {
  const master = "#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=320000\nsession/s/base/index.m3u8\n";
  const media = "#EXTM3U\n#EXTINF:1.0,\nseg0.ts\n#EXTINF:1.0,\nseg1.ts\n#EXT-X-ENDLIST\n";

  it("stitches segments and emits complete with summed bytes", async () => {
    const store = fakeStore();
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("start.m3u8")) return new Response(master);
      if (url.includes("index.m3u8")) return new Response(media);
      if (url.includes(".ts")) return new Response(url.includes("seg0") ? "AAA" : "BBB");
      return new Response("");
    });
    const engine = new JsTransferEngine({ store: store as never, fetch: fetchFn as never });
    const { events, terminal } = collect(engine, "b");
    await engine.submit([hlsJob("b")]);
    const end = await terminal;
    expect(end).toEqual({ kind: "complete", key: "b", bytes: 6 });
    expect(store.files.get("b")).toBe("AAABBB");
    // per-segment progress carries segment counters
    const prog = events.find((e) => e.kind === "progress");
    expect(prog).toMatchObject({ segmentsDone: 1, segmentsTotal: 2 });
    // best-effort stop-session fired
    expect(fetchFn.mock.calls.some(([u]) => String(u).includes("/stop"))).toBe(true);
  });

  it("no ENDLIST → terminal error, stores nothing", async () => {
    const store = fakeStore();
    const noEnd = "#EXTM3U\n#EXTINF:1.0,\nseg0.ts\n";
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("start.m3u8")) return new Response(master);
      if (url.includes("index.m3u8")) return new Response(noEnd);
      return new Response("AAA");
    });
    const engine = new JsTransferEngine({ store: store as never, fetch: fetchFn as never });
    const { terminal } = collect(engine, "h");
    await engine.submit([hlsJob("h")]);
    const end = await terminal;
    expect(end).toMatchObject({ kind: "error", key: "h", terminal: true });
    expect(store.files.has("h")).toBe(false);
  });

  it("retries a 404 segment then succeeds", async () => {
    const store = fakeStore();
    let seg0Attempts = 0;
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("start.m3u8")) return new Response(master);
      if (url.includes("index.m3u8")) return new Response(media);
      if (url.includes("seg0")) {
        seg0Attempts += 1;
        return seg0Attempts === 1 ? new Response("nope", { status: 404 }) : new Response("AAA");
      }
      if (url.includes("seg1")) return new Response("BBB");
      return new Response("");
    });
    const engine = new JsTransferEngine({
      store: store as never,
      fetch: fetchFn as never,
      segmentRetryDelayMs: 0,
    });
    const { terminal } = collect(engine, "r");
    await engine.submit([hlsJob("r")]);
    expect(await terminal).toEqual({ kind: "complete", key: "r", bytes: 6 });
    expect(seg0Attempts).toBe(2);
  });
});
