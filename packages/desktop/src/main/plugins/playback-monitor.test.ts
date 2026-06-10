import type { PluginEvents, TrackInfo } from "@musex/plugin-api";
import { beforeEach, describe, expect, it } from "vitest";
import { PlaybackMonitor, type PlayKind } from "./playback-monitor";

function track(title: string, durationMs = 240_000, artistName = "Artist"): TrackInfo {
  return { title, artistName, durationMs };
}

type Emitted = { event: keyof PluginEvents; payload: PluginEvents[keyof PluginEvents] };

let emitted: Emitted[];
let persisted: TrackInfo[];
let plays: { track: TrackInfo; kind: PlayKind }[];
let monitor: PlaybackMonitor;

function makeMonitor(initialHistory: TrackInfo[] = []): PlaybackMonitor {
  persisted = initialHistory;
  return new PlaybackMonitor({
    emit: (event, payload) => emitted.push({ event, payload }),
    loadHistory: () => persisted,
    saveHistory: (h) => {
      persisted = h;
    },
    recordPlay: (t, kind) => plays.push({ track: t, kind }),
  });
}

beforeEach(() => {
  emitted = [];
  plays = [];
  monitor = makeMonitor();
});

function tick(from: number, to: number): void {
  for (let s = from; s <= to; s += 1) monitor.handleEnginePosition(s);
}

describe("PlaybackMonitor", () => {
  it("emits trackStarted on start and records history", () => {
    const a = track("A");
    monitor.handleNowPlaying({ kind: "start", track: a, atEpochSec: 1000 });
    expect(emitted).toEqual([
      { event: "trackStarted", payload: { track: a, startedAtEpochSec: 1000 } },
    ]);
    expect(monitor.history()).toEqual([a]);
    expect(persisted).toEqual([a]); // history is persisted via saveHistory
  });

  it("track change after enough play: scrobble + trackEnded for A, then trackStarted B", () => {
    const a = track("A", 240_000);
    const b = track("B", 200_000);
    monitor.handleNowPlaying({ kind: "start", track: a, atEpochSec: 1000 });
    tick(0, 130); // 130s ≥ 120s (half of 240s) → scrobble passes
    monitor.handleNowPlaying({ kind: "start", track: b, atEpochSec: 2000 });

    expect(emitted.map((e) => e.event)).toEqual([
      "trackStarted", // A
      "scrobble", // A passed the gate
      "trackEnded", // A
      "trackStarted", // B
    ]);
    expect(emitted[1]?.payload).toEqual({ track: a, startedAtEpochSec: 1000 });
    expect(emitted[2]?.payload).toEqual({ track: a, playedSec: 130 });
    expect(emitted[3]?.payload).toEqual({ track: b, startedAtEpochSec: 2000 });
  });

  it("track change without enough play: trackEnded but no scrobble", () => {
    const a = track("A", 240_000);
    monitor.handleNowPlaying({ kind: "start", track: a, atEpochSec: 1000 });
    tick(0, 60); // 60s < 120s, < 240s
    monitor.handleNowPlaying({ kind: "start", track: track("B"), atEpochSec: 2000 });
    expect(emitted.map((e) => e.event)).toEqual(["trackStarted", "trackEnded", "trackStarted"]);
    expect(emitted[1]?.payload).toEqual({ track: a, playedSec: 60 });
  });

  it("pause/resume emit events and gate accumulation respects the pause", () => {
    const a = track("A", 240_000);
    monitor.handleNowPlaying({ kind: "start", track: a, atEpochSec: 1000 });
    tick(0, 60); // 60s playing
    monitor.handleNowPlaying({ kind: "pause" });
    tick(60, 200); // paused — must not accumulate
    monitor.handleNowPlaying({ kind: "resume" });
    tick(200, 250); // 50s playing → 110s total < 120s half
    monitor.handleNowPlaying({ kind: "stop" });

    expect(emitted.map((e) => e.event)).toEqual([
      "trackStarted",
      "paused",
      "resumed",
      "trackEnded", // no scrobble: only 110s actually played
    ]);
    expect(emitted[1]?.payload).toEqual({ track: a });
    expect(emitted[2]?.payload).toEqual({ track: a });
    expect(emitted[3]?.payload).toEqual({ track: a, playedSec: 110 });
  });

  it("stop after enough play emits scrobble then trackEnded and clears current", () => {
    const a = track("A", 240_000);
    monitor.handleNowPlaying({ kind: "start", track: a, atEpochSec: 1000 });
    tick(0, 130);
    monitor.handleNowPlaying({ kind: "stop" });
    expect(emitted.map((e) => e.event)).toEqual(["trackStarted", "scrobble", "trackEnded"]);

    // current is cleared: further messages emit nothing
    emitted = [];
    monitor.handleNowPlaying({ kind: "pause" });
    monitor.handleNowPlaying({ kind: "resume" });
    monitor.handleNowPlaying({ kind: "stop" });
    expect(emitted).toEqual([]);
  });

  it("pause/resume with no current track emit nothing", () => {
    monitor.handleNowPlaying({ kind: "pause" });
    monitor.handleNowPlaying({ kind: "resume" });
    expect(emitted).toEqual([]);
  });

  it("history is most-recent-first and respects limit", () => {
    monitor.handleNowPlaying({ kind: "start", track: track("A"), atEpochSec: 1 });
    monitor.handleNowPlaying({ kind: "start", track: track("B"), atEpochSec: 2 });
    monitor.handleNowPlaying({ kind: "start", track: track("C"), atEpochSec: 3 });
    expect(monitor.history().map((t) => t.title)).toEqual(["C", "B", "A"]);
    expect(monitor.history(2).map((t) => t.title)).toEqual(["C", "B"]);
  });

  it("dedupes consecutive identical title+artist (repeat-one does not flood history)", () => {
    const a = track("A");
    monitor.handleNowPlaying({ kind: "start", track: a, atEpochSec: 1 });
    monitor.handleNowPlaying({ kind: "start", track: a, atEpochSec: 2 });
    monitor.handleNowPlaying({ kind: "start", track: track("B"), atEpochSec: 3 });
    monitor.handleNowPlaying({ kind: "start", track: a, atEpochSec: 4 }); // non-consecutive → kept
    expect(monitor.history().map((t) => t.title)).toEqual(["A", "B", "A"]);
  });

  it("same title by a different artist is NOT deduped", () => {
    monitor.handleNowPlaying({ kind: "start", track: track("A", 240_000, "X"), atEpochSec: 1 });
    monitor.handleNowPlaying({ kind: "start", track: track("A", 240_000, "Y"), atEpochSec: 2 });
    expect(monitor.history()).toHaveLength(2);
  });

  it("caps history at 50, evicting the oldest", () => {
    for (let i = 0; i < 60; i++) {
      monitor.handleNowPlaying({ kind: "start", track: track(`T${i}`), atEpochSec: i });
    }
    const h = monitor.history();
    expect(h).toHaveLength(50);
    expect(h[0]?.title).toBe("T59"); // most recent first
    expect(h[49]?.title).toBe("T10"); // oldest 10 evicted
    expect(persisted).toHaveLength(50);
  });

  it("seeds history from loadHistory so it survives restarts", () => {
    const seeded = [track("Old1"), track("Old2")];
    monitor = makeMonitor(seeded);
    expect(monitor.history().map((t) => t.title)).toEqual(["Old1", "Old2"]);
    monitor.handleNowPlaying({ kind: "start", track: track("New"), atEpochSec: 1 });
    expect(monitor.history().map((t) => t.title)).toEqual(["New", "Old1", "Old2"]);
  });

  it("positions before any start are harmless", () => {
    tick(0, 100);
    monitor.handleNowPlaying({ kind: "stop" });
    expect(emitted).toEqual([]);
    expect(plays).toEqual([]);
  });

  describe("recordPlay classification", () => {
    function playFor(durationMs: number, playedSec: number): PlayKind {
      const a = track("A", durationMs);
      monitor.handleNowPlaying({ kind: "start", track: a, atEpochSec: 1000 });
      tick(0, playedSec);
      monitor.handleNowPlaying({ kind: "stop" });
      expect(plays).toHaveLength(1);
      expect(plays[0]?.track).toEqual(a);
      // biome-ignore lint/style/noNonNullAssertion: length asserted above
      return plays[0]!.kind;
    }

    it("full when the scrobble gate passes (half the track heard)", () => {
      expect(playFor(240_000, 130)).toBe("full");
    });

    it("skip when under 60s AND under 25% of the duration", () => {
      expect(playFor(240_000, 30)).toBe("skip"); // 30 < 60, 30 < 60 (25% of 240)
    });

    it("partial at exactly 60s (not strictly under)", () => {
      expect(playFor(240_000, 60)).toBe("partial"); // 60s is not < 60s
    });

    it("partial when under 60s but past 25% of a short track", () => {
      expect(playFor(150_000, 50)).toBe("partial"); // 50 < 60 but ≥ 37.5 (25% of 150)
    });

    it("partial in the long middle ground (past 60s, no scrobble)", () => {
      expect(playFor(1_000_000, 70)).toBe("partial"); // 70 ≥ 60, < half, < 240s
    });

    it("records exactly one play per play-through across track changes", () => {
      const a = track("A", 240_000);
      monitor.handleNowPlaying({ kind: "start", track: a, atEpochSec: 1 });
      tick(0, 10);
      monitor.handleNowPlaying({ kind: "start", track: track("B"), atEpochSec: 2 });
      monitor.handleNowPlaying({ kind: "stop" });
      expect(plays.map((p) => [p.track.title, p.kind])).toEqual([
        ["A", "skip"],
        ["B", "skip"],
      ]);
    });
  });
});
