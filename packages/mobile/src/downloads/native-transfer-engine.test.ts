import type { TransferEvent, TransferJob } from "@musex/core";
import { describe, expect, it, vi } from "vitest";
import {
  type BackgroundDownloadsModuleLike,
  createNativeTransferEngine,
  NativeTransferEngine,
} from "./native-transfer-engine";

function fakeModule(reattachJson = '{"active":[],"completed":[],"failed":[]}') {
  const listeners = new Map<string, (e: never) => void>();
  const fake = {
    submits: [] as string[],
    cancels: [] as string[][],
    reattachJson,
    reattachCalls: 0,
    async submit(jobsJson: string) {
      fake.submits.push(jobsJson);
    },
    async cancel(keys: string[]) {
      fake.cancels.push(keys);
    },
    async reattach() {
      fake.reattachCalls += 1;
      return fake.reattachJson;
    },
    addListener(name: string, cb: (e: never) => void) {
      listeners.set(name, cb);
      return { remove: () => void listeners.delete(name) };
    },
    emit(name: string, e: unknown) {
      (listeners.get(name) as ((e: unknown) => void) | undefined)?.(e);
    },
  };
  return fake;
}

const job = (key: string): TransferJob => ({
  key,
  mode: "original",
  url: `https://pms/library/parts/${key}/f.flac?X-Plex-Token=t`,
  headers: {},
  destPath: `/downloads/${key}`,
  expectedBytes: 42,
});

describe("createNativeTransferEngine", () => {
  it("returns null when the native module is absent", () => {
    expect(createNativeTransferEngine(null)).toBeNull();
  });

  it("returns an engine when the module is present", () => {
    const mod = fakeModule();
    expect(createNativeTransferEngine(mod as BackgroundDownloadsModuleLike)).toBeInstanceOf(
      NativeTransferEngine,
    );
  });
});

describe("NativeTransferEngine", () => {
  it("submit serializes the jobs faithfully as JSON", async () => {
    const mod = fakeModule();
    const engine = new NativeTransferEngine(mod as BackgroundDownloadsModuleLike);
    const jobs = [job("a"), { ...job("b"), mode: "hls" as const, stopUrl: "https://pms/stop" }];
    await engine.submit(jobs);
    expect(mod.submits).toHaveLength(1);
    expect(JSON.parse(mod.submits[0]!)).toEqual(jobs);
  });

  it("submit with no jobs never crosses the bridge", async () => {
    const mod = fakeModule();
    const engine = new NativeTransferEngine(mod as BackgroundDownloadsModuleLike);
    await engine.submit([]);
    expect(mod.submits).toHaveLength(0);
  });

  it("cancel passes keys through (and skips the bridge for none)", async () => {
    const mod = fakeModule();
    const engine = new NativeTransferEngine(mod as BackgroundDownloadsModuleLike);
    await engine.cancel(["a", "b"]);
    await engine.cancel([]);
    expect(mod.cancels).toEqual([["a", "b"]]);
  });

  it("maps native events 1:1 onto TransferEvents", () => {
    const mod = fakeModule();
    const engine = new NativeTransferEngine(mod as BackgroundDownloadsModuleLike);
    const events: TransferEvent[] = [];
    engine.onEvent((e) => events.push(e));
    mod.emit("onProgress", { key: "a", bytes: 10 });
    mod.emit("onProgress", { key: "h", bytes: 20, segmentsDone: 2, segmentsTotal: 9 });
    mod.emit("onError", { key: "a", message: "http 503", terminal: false });
    mod.emit("onComplete", { key: "a", bytes: 42 });
    mod.emit("onError", { key: "h", message: "hls http 403", terminal: true });
    expect(events).toEqual([
      { kind: "progress", key: "a", bytes: 10, segmentsDone: undefined, segmentsTotal: undefined },
      { kind: "progress", key: "h", bytes: 20, segmentsDone: 2, segmentsTotal: 9 },
      { kind: "error", key: "a", message: "http 503", terminal: false },
      { kind: "complete", key: "a", bytes: 42 },
      { kind: "error", key: "h", message: "hls http 403", terminal: true },
    ]);
  });

  it("onEvent unsubscribe stops delivery", () => {
    const mod = fakeModule();
    const engine = new NativeTransferEngine(mod as BackgroundDownloadsModuleLike);
    const events: TransferEvent[] = [];
    const off = engine.onEvent((e) => events.push(e));
    mod.emit("onComplete", { key: "a", bytes: 1 });
    off();
    mod.emit("onComplete", { key: "b", bytes: 2 });
    expect(events).toHaveLength(1);
  });

  it("reattach parses the native snapshot", async () => {
    const mod = fakeModule(
      '{"active":["x"],"completed":[{"key":"c","bytes":9}],"failed":[{"key":"f","message":"boom"}]}',
    );
    const engine = new NativeTransferEngine(mod as BackgroundDownloadsModuleLike);
    expect(await engine.reattach()).toEqual({
      active: ["x"],
      completed: [{ key: "c", bytes: 9 }],
      failed: [{ key: "f", message: "boom" }],
    });
    expect(mod.reattachCalls).toBe(1);
  });

  it("reattach tolerates a malformed snapshot (warn + empty)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const mod = fakeModule("not json");
      const engine = new NativeTransferEngine(mod as BackgroundDownloadsModuleLike);
      expect(await engine.reattach()).toEqual({ active: [], completed: [], failed: [] });
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
