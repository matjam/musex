import { PlexAuthError } from "@musex/core";
import { describe, expect, it, vi } from "vitest";
import { ConnectivityMonitor } from "./connectivity-monitor.js";

// Inject a fake timer so we drive ticks deterministically without real time.
function makeFakeTimers() {
  let id = 0;
  const timers = new Map<number, { fn: () => void; intervalMs: number }>();
  const setInterval = (fn: () => void, ms: number): number => {
    const handle = ++id;
    timers.set(handle, { fn, intervalMs: ms });
    return handle;
  };
  const clearInterval = (handle: number): void => {
    timers.delete(handle);
  };
  const tick = () => {
    for (const { fn } of timers.values()) fn();
  };
  return { setInterval, clearInterval, tick, timers };
}

describe("ConnectivityMonitor", () => {
  it("starts online", () => {
    const mon = new ConnectivityMonitor();
    expect(mon.online).toBe(true);
  });

  it("one noteFailure stays online (below threshold)", () => {
    const changes: boolean[] = [];
    const mon = new ConnectivityMonitor();
    mon.onChange((v) => changes.push(v));
    mon.noteFailure(new Error("x"));
    expect(mon.online).toBe(true);
    expect(changes).toHaveLength(0);
  });

  it("two consecutive noteFailures flip to offline and fire onChange(false) once", () => {
    const changes: boolean[] = [];
    const mon = new ConnectivityMonitor();
    mon.onChange((v) => changes.push(v));
    mon.noteFailure(new Error("x"));
    mon.noteFailure(new Error("x"));
    expect(mon.online).toBe(false);
    expect(changes).toEqual([false]);
  });

  it("noteSuccess after offline flips back to online and fires onChange(true)", () => {
    const changes: boolean[] = [];
    const mon = new ConnectivityMonitor();
    mon.onChange((v) => changes.push(v));
    mon.noteFailure(new Error("x"));
    mon.noteFailure(new Error("x"));
    mon.noteSuccess();
    expect(mon.online).toBe(true);
    expect(changes).toEqual([false, true]);
  });

  it("noteSuccess while already online resets counter without firing onChange", () => {
    const changes: boolean[] = [];
    const mon = new ConnectivityMonitor();
    mon.onChange((v) => changes.push(v));
    mon.noteFailure(new Error("x")); // 1 failure, still online
    mon.noteSuccess(); // reset counter
    mon.noteFailure(new Error("x")); // 1 failure again — still below threshold
    expect(mon.online).toBe(true);
    expect(changes).toHaveLength(0);
  });

  it("PlexAuthError does NOT count toward offline (even twice)", () => {
    const changes: boolean[] = [];
    const mon = new ConnectivityMonitor();
    mon.onChange((v) => changes.push(v));
    const authErr = new PlexAuthError("401");
    mon.noteFailure(authErr);
    mon.noteFailure(authErr);
    // Still online — auth errors are not connectivity failures
    expect(mon.online).toBe(true);
    expect(changes).toHaveLength(0);
  });

  it("a PlexAuthError-shaped error (name only) does NOT count toward offline", () => {
    const changes: boolean[] = [];
    const mon = new ConnectivityMonitor();
    mon.onChange((v) => changes.push(v));
    const authErr = Object.assign(new Error("401"), { name: "PlexAuthError" });
    mon.noteFailure(authErr);
    mon.noteFailure(authErr);
    expect(mon.online).toBe(true);
    expect(changes).toHaveLength(0);
  });

  describe("start / stop", () => {
    it("a rejecting probe drives offline after threshold ticks", async () => {
      const fake = makeFakeTimers();
      const mon = new ConnectivityMonitor({
        setInterval: fake.setInterval,
        clearInterval: fake.clearInterval,
      });
      const changes: boolean[] = [];
      mon.onChange((v) => changes.push(v));

      const probe = vi.fn().mockRejectedValue(new Error("unreachable"));
      mon.start(probe, 1000);

      // tick once — 1 failure, still online
      await fake.tick();
      await Promise.resolve(); // flush microtasks
      expect(mon.online).toBe(true);

      // tick again — 2nd failure, crosses threshold
      await fake.tick();
      await Promise.resolve();
      expect(mon.online).toBe(false);
      expect(changes).toEqual([false]);
    });

    it("stop() halts further probe ticks", async () => {
      const fake = makeFakeTimers();
      const mon = new ConnectivityMonitor({
        setInterval: fake.setInterval,
        clearInterval: fake.clearInterval,
      });
      const probe = vi.fn().mockRejectedValue(new Error("unreachable"));
      mon.start(probe, 1000);
      mon.stop();

      await fake.tick();
      await Promise.resolve();
      expect(mon.online).toBe(true); // no ticks were processed
      expect(probe).not.toHaveBeenCalled();
    });

    it("a resolving probe drives back online after being offline", async () => {
      const fake = makeFakeTimers();
      const mon = new ConnectivityMonitor({
        setInterval: fake.setInterval,
        clearInterval: fake.clearInterval,
      });
      const changes: boolean[] = [];
      mon.onChange((v) => changes.push(v));

      // Force offline first via direct calls
      mon.noteFailure(new Error("x"));
      mon.noteFailure(new Error("x"));
      expect(mon.online).toBe(false);

      const probe = vi.fn().mockResolvedValue(undefined);
      mon.start(probe, 1000);

      await fake.tick();
      await Promise.resolve();
      expect(mon.online).toBe(true);
      expect(changes).toEqual([false, true]);
    });
  });
});
