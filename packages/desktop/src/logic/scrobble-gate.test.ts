import type { TrackInfo } from "@musex/plugin-api";
import { beforeEach, describe, expect, it } from "vitest";
import { ScrobbleGate } from "./scrobble-gate";

function track(durationMs: number, title = "Song"): TrackInfo {
  return { title, artistName: "Artist", durationMs };
}

/** Feed continuous 1s position ticks from `from` to `to` inclusive. */
function tick(gate: ScrobbleGate, from: number, to: number): void {
  for (let s = from; s <= to; s += 1) gate.position(s);
}

describe("ScrobbleGate", () => {
  let gate: ScrobbleGate;
  beforeEach(() => {
    gate = new ScrobbleGate();
  });

  it("finish() without start() returns null", () => {
    expect(gate.finish()).toBeNull();
  });

  it("never scrobbles a track of 30s or less, even fully played", () => {
    gate.start(track(30_000), 100);
    tick(gate, 0, 30);
    expect(gate.finish()).toBeNull();

    gate.start(track(25_000), 200);
    tick(gate, 0, 25);
    expect(gate.finish()).toBeNull();
  });

  it("scrobbles a track barely over 30s once half is played", () => {
    gate.start(track(30_001), 100);
    tick(gate, 0, 16); // 16s ≥ 15.0005s (half)
    expect(gate.finish()).toEqual({ track: track(30_001), startedAtEpochSec: 100 });
  });

  it("half-rule: 200s track scrobbles at 100s played", () => {
    const t = track(200_000);
    gate.start(t, 1_700_000_000);
    tick(gate, 0, 100); // 100s accumulated
    expect(gate.finish()).toEqual({ track: t, startedAtEpochSec: 1_700_000_000 });
  });

  it("half-rule: 200s track does NOT scrobble at 99s played", () => {
    gate.start(track(200_000), 100);
    tick(gate, 0, 99); // 99s accumulated
    expect(gate.finish()).toBeNull();
  });

  it("4-minute rule: 600s track scrobbles at 240s played (before half)", () => {
    const t = track(600_000);
    gate.start(t, 100);
    tick(gate, 0, 240); // 240s accumulated, half would be 300s
    expect(gate.finish()).toEqual({ track: t, startedAtEpochSec: 100 });
  });

  it("4-minute rule: 600s track does NOT scrobble at 239s played", () => {
    gate.start(track(600_000), 100);
    tick(gate, 0, 239);
    expect(gate.finish()).toBeNull();
  });

  it("does not accumulate while paused, even though positions keep arriving", () => {
    gate.start(track(200_000), 100);
    tick(gate, 0, 50); // 50s playing
    gate.pause();
    tick(gate, 50, 120); // paused — ignored
    gate.resume();
    tick(gate, 120, 160); // 40s playing → 90s total
    expect(gate.finish()).toBeNull();
  });

  it("resumes accumulation from the latest position seen while paused", () => {
    gate.start(track(200_000), 100);
    tick(gate, 0, 50); // 50s
    gate.pause();
    tick(gate, 50, 80); // ignored, but lastSec advances to 80
    gate.resume();
    tick(gate, 80, 130); // 50s → 100s total = half of 200s
    expect(gate.finish()).not.toBeNull();
  });

  it("a forward seek (delta > 2s) does not count as played time", () => {
    gate.start(track(200_000), 100);
    tick(gate, 0, 50); // 50s
    gate.position(150); // jump +100 → seek, ignored
    tick(gate, 151, 199); // 49s → 99s total
    expect(gate.finish()).toBeNull();
  });

  it("accumulation continues correctly after a forward seek", () => {
    gate.start(track(200_000), 100);
    tick(gate, 0, 60); // 60s
    gate.position(150); // seek, ignored
    tick(gate, 151, 190); // 40s → 100s total
    expect(gate.finish()).not.toBeNull();
  });

  it("a backward seek (negative delta) does not count and does not corrupt the total", () => {
    gate.start(track(200_000), 100);
    tick(gate, 0, 49); // 49s
    gate.position(20); // jump backwards, ignored
    tick(gate, 21, 69); // 49s → 98s total
    expect(gate.finish()).toBeNull();
  });

  it("replayed material after a backward seek counts again (real listening)", () => {
    gate.start(track(200_000), 100);
    tick(gate, 0, 50); // 50s
    gate.position(0); // back to the top
    tick(gate, 1, 50); // 50s → 100s total
    expect(gate.finish()).not.toBeNull();
  });

  it("fires at most once per start(): second finish() returns null", () => {
    gate.start(track(200_000), 100);
    tick(gate, 0, 150);
    expect(gate.finish()).not.toBeNull();
    expect(gate.finish()).toBeNull();
  });

  it("a new start() re-arms the gate", () => {
    gate.start(track(200_000), 100);
    tick(gate, 0, 150);
    expect(gate.finish()).not.toBeNull();

    const second = track(180_000, "Next Song");
    gate.start(second, 500);
    tick(gate, 0, 90); // half of 180s
    expect(gate.finish()).toEqual({ track: second, startedAtEpochSec: 500 });
  });

  it("start() resets accumulated time from any previous play-through", () => {
    gate.start(track(200_000), 100);
    tick(gate, 0, 150); // would scrobble — but never finished
    gate.start(track(200_000, "Other"), 200); // reset without finish()
    tick(gate, 0, 10); // only 10s on the new track
    expect(gate.finish()).toBeNull();
  });

  it("positions before any start() are ignored", () => {
    tick(gate, 0, 300);
    expect(gate.finish()).toBeNull();
  });

  it("nothing accumulates when paused immediately after start", () => {
    gate.start(track(200_000), 100);
    gate.pause();
    tick(gate, 0, 199);
    expect(gate.finish()).toBeNull();
  });

  it("playedSec() reports accumulated played time (for trackEnded payloads)", () => {
    gate.start(track(200_000), 100);
    expect(gate.playedSec()).toBe(0);
    tick(gate, 0, 30);
    gate.pause();
    tick(gate, 30, 60); // ignored
    gate.resume();
    tick(gate, 60, 70);
    expect(gate.playedSec()).toBe(40);
  });
});
