import type { TransferEvent, TransferJob, TransferSnapshot } from "@musex/core";
import { describe, expect, it } from "vitest";
import { RoutingTransferEngine } from "./routing-transfer-engine";
import type { TransferEngine } from "./transfer-engine";

function fakeEngine(ownsQueue: boolean, snapshot?: TransferSnapshot) {
  const listeners = new Set<(e: TransferEvent) => void>();
  const eng = {
    ownsQueue,
    submits: [] as TransferJob[][],
    cancels: [] as string[][],
    async submit(jobs: TransferJob[]) {
      eng.submits.push(jobs);
    },
    async cancel(keys: string[]) {
      eng.cancels.push(keys);
    },
    async reattach() {
      return snapshot ?? { active: [], completed: [], failed: [] };
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

const job = (key: string, mode: TransferJob["mode"]): TransferJob => ({
  key,
  mode,
  url: `https://pms/${mode}/${key}`,
  headers: {},
  destPath: `/downloads/${key}`,
});

function router(nativeSnapshot?: TransferSnapshot) {
  const hls = fakeEngine(false);
  const original = fakeEngine(true, nativeSnapshot);
  const eng = new RoutingTransferEngine({ hls, original });
  return { hls, original, eng };
}

describe("RoutingTransferEngine", () => {
  it("owns the queue (manager batch-submits, no per-job await)", () => {
    expect(router().eng.ownsQueue).toBe(true);
  });

  it("splits a mixed batch by mode: hls jobs → hls engine, original → original engine", async () => {
    const { hls, original, eng } = router();
    await eng.submit([job("h1", "hls"), job("o1", "original"), job("h2", "hls")]);
    expect(hls.submits).toEqual([[job("h1", "hls"), job("h2", "hls")]]);
    expect(original.submits).toEqual([[job("o1", "original")]]);
  });

  it("a single-mode batch never touches the other engine", async () => {
    const { hls, original, eng } = router();
    await eng.submit([job("o1", "original"), job("o2", "original")]);
    expect(hls.submits).toHaveLength(0);
    expect(original.submits).toEqual([[job("o1", "original"), job("o2", "original")]]);
  });

  it("cancel fans out to BOTH engines (each ignores unknown keys)", async () => {
    const { hls, original, eng } = router();
    await eng.cancel(["a", "b"]);
    expect(hls.cancels).toEqual([["a", "b"]]);
    expect(original.cancels).toEqual([["a", "b"]]);
  });

  it("reattach merges both snapshots (JS side is always empty in practice)", async () => {
    const { eng } = router({
      active: ["x"],
      completed: [{ key: "c", bytes: 9 }],
      failed: [{ key: "f", message: "boom" }],
    });
    expect(await eng.reattach()).toEqual({
      active: ["x"],
      completed: [{ key: "c", bytes: 9 }],
      failed: [{ key: "f", message: "boom" }],
    });
  });

  it("fans in events from both engines through one callback", () => {
    const { hls, original, eng } = router();
    const events: TransferEvent[] = [];
    eng.onEvent((e) => events.push(e));
    hls.emit({ kind: "progress", key: "h", bytes: 3 });
    original.emit({ kind: "complete", key: "o", bytes: 5 });
    expect(events).toEqual([
      { kind: "progress", key: "h", bytes: 3 },
      { kind: "complete", key: "o", bytes: 5 },
    ]);
  });

  it("unsubscribe detaches from BOTH engines", () => {
    const { hls, original, eng } = router();
    const events: TransferEvent[] = [];
    const off = eng.onEvent((e) => events.push(e));
    off();
    hls.emit({ kind: "progress", key: "h", bytes: 1 });
    original.emit({ kind: "complete", key: "o", bytes: 2 });
    expect(events).toHaveLength(0);
  });

  it("satisfies the TransferEngine interface", () => {
    const { eng } = router();
    const seam: TransferEngine = eng;
    expect(seam.ownsQueue).toBe(true);
  });
});
