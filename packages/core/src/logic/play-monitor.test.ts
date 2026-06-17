import { describe, expect, it } from "vitest";
import type { PlaybackState, Track } from "../index.js";
import { classifyPlay, PlayMonitor, PlayTracker } from "./play-monitor.js";

function track(id: string, durationMs = 200_000): Track {
  return {
    id,
    serverId: "s",
    albumId: "al",
    artistId: "ar",
    artistName: `Artist ${id}`,
    title: `Track ${id}`,
    durationMs,
    media: { container: "", audioCodec: "", partId: "p", partKey: "/p" },
  };
}

function state(tracks: Track[], index: number, status: PlaybackState["status"], positionSec: number): PlaybackState {
  return {
    queue: tracks.length ? { tracks, index, shuffle: false, repeat: "none" } : null,
    status,
    positionSec,
    durationSec: tracks[index] ? tracks[index].durationMs / 1000 : 0,
    volume: 1,
    error: null,
  };
}

describe("classifyPlay", () => {
  it("full when played past the scrobble threshold (min 240s or half)", () => {
    expect(classifyPlay(120, 200)).toBe("full"); // half of 200 = 100, played 120
    expect(classifyPlay(240, 1000)).toBe("full"); // abs cap 240 on a long track
  });
  it("skip when under 60s AND under 25% of duration", () => {
    expect(classifyPlay(10, 200)).toBe("skip"); // 10 < 60 and 10 < 50
  });
  it("partial otherwise", () => {
    expect(classifyPlay(70, 200)).toBe("partial"); // not full (<100), not skip (>=60)
  });
  it("unknown duration falls back to the absolute thresholds", () => {
    expect(classifyPlay(10, 0)).toBe("skip");
    expect(classifyPlay(250, 0)).toBe("full");
  });
});

describe("PlayTracker", () => {
  it("accumulates continuous playing deltas", () => {
    const t = new PlayTracker();
    t.start(200);
    for (let p = 0; p <= 120; p++) t.update(p, true);
    expect(t.playedSec()).toBeGreaterThanOrEqual(119);
    expect(t.finish()).toBe("full");
  });
  it("ignores seeks (jumps > 2s)", () => {
    const t = new PlayTracker();
    t.start(200);
    t.update(0, true);
    t.update(120, true); // a 120s jump = seek, not credited
    expect(t.playedSec()).toBe(0);
  });
  it("does not accrue while paused", () => {
    const t = new PlayTracker();
    t.start(200);
    t.update(0, true);
    t.update(1, true); // +1
    t.update(2, false); // paused, no credit
    t.update(3, false);
    expect(t.playedSec()).toBe(1);
  });
});

describe("PlayMonitor", () => {
  it("records the previous track as a skip when the user jumps to the next early", () => {
    const m = new PlayMonitor();
    const tracks = [track("a"), track("b")];
    expect(m.onState(state(tracks, 0, "playing", 0))).toBeNull(); // start a
    expect(m.onState(state(tracks, 0, "playing", 5))).toBeNull(); // 5s in
    const ev = m.onState(state(tracks, 1, "playing", 0)); // jumped to b
    expect(ev).toEqual({ title: "Track a", artistName: "Artist a", kind: "skip" });
  });

  it("records a full play on natural end of the final track exactly once", () => {
    const m = new PlayMonitor();
    const tracks = [track("a", 100_000)];
    m.onState(state(tracks, 0, "playing", 0));
    for (let p = 0; p <= 80; p++) m.onState(state(tracks, 0, "playing", p));
    const ev = m.onState(state(tracks, 0, "ended", 80));
    expect(ev).toEqual({ title: "Track a", artistName: "Artist a", kind: "full" });
    // a second "ended" must not double-record
    expect(m.onState(state(tracks, 0, "ended", 80))).toBeNull();
  });

  it("does not double-record when auto-advance follows a natural end", () => {
    const m = new PlayMonitor();
    const tracks = [track("a", 100_000), track("b")];
    m.onState(state(tracks, 0, "playing", 0));
    for (let p = 0; p <= 80; p++) m.onState(state(tracks, 0, "playing", p));
    const ended = m.onState(state(tracks, 0, "ended", 80));
    expect(ended?.kind).toBe("full");
    const advance = m.onState(state(tracks, 1, "playing", 0)); // index moved to b
    expect(advance).toBeNull(); // already recorded a; now tracking b
  });
});
