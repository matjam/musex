import { describe, expect, it, vi } from "vitest";
import type { StreamResolver } from "../ports/stream-resolver";
import { FakePlaybackEngine, FakeStreamResolver, makeTrack } from "../testing/fakes";
import { PlaybackSession } from "./playback-session";

function setup() {
  const engine = new FakePlaybackEngine();
  const resolver = new FakeStreamResolver();
  const session = new PlaybackSession(engine, resolver);
  return { engine, resolver, session };
}

describe("PlaybackSession", () => {
  it("loads a queue, plays the start index, and reports playing", async () => {
    const { engine, session } = setup();
    const tracks = [makeTrack("1"), makeTrack("2"), makeTrack("3")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "none" });

    expect(engine.loaded.map((r) => r.url)).toEqual(["fake://stream/1"]);
    expect(engine.playCalls).toBe(1);
    expect(session.getState().status).toBe("playing");
    expect(session.getState().durationSec).toBe(180);
  });

  it("preloads the next track for gapless playback", async () => {
    const { engine, session } = setup();
    const tracks = [makeTrack("1"), makeTrack("2")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "none" });

    expect(engine.preloaded.map((r) => r.url)).toEqual(["fake://stream/2"]);
  });

  it("does not preload past the end of the queue", async () => {
    const { engine, session } = setup();
    await session.loadQueue({ tracks: [makeTrack("1")], index: 0, shuffle: false, repeat: "none" });
    expect(engine.preloaded).toEqual([]);
  });

  it("advances to the next track when the current one ends", async () => {
    const { engine, session } = setup();
    const tracks = [makeTrack("1"), makeTrack("2")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "none" });
    engine.emitEnded();

    // onEnded triggers an async advance chain; poll until it settles.
    await vi.waitFor(() => {
      expect(engine.loaded.map((r) => r.url)).toEqual(["fake://stream/1", "fake://stream/2"]);
    });
    expect(session.getState().queue?.index).toBe(1);
  });

  it("ends when the last track finishes", async () => {
    const { engine, session } = setup();
    await session.loadQueue({ tracks: [makeTrack("1")], index: 0, shuffle: false, repeat: "none" });
    engine.emitEnded();

    await vi.waitFor(() => {
      expect(session.getState().status).toBe("ended");
    });
  });

  it("pause and play update status and call the engine", async () => {
    const { engine, session } = setup();
    await session.loadQueue({ tracks: [makeTrack("1")], index: 0, shuffle: false, repeat: "none" });
    session.pause();
    expect(engine.pauseCalls).toBe(1);
    expect(session.getState().status).toBe("paused");
    session.play();
    expect(session.getState().status).toBe("playing");
  });

  it("seek and setVolume delegate to the engine and update state", async () => {
    const { engine, session } = setup();
    await session.loadQueue({ tracks: [makeTrack("1")], index: 0, shuffle: false, repeat: "none" });
    session.seek(42);
    session.setVolume(0.5);
    expect(engine.seekCalls).toEqual([42]);
    expect(engine.volumeCalls).toEqual([0.5]);
    expect(session.getState().positionSec).toBe(42);
    expect(session.getState().volume).toBe(0.5);
  });

  it("surfaces engine errors as error status", async () => {
    const { engine, session } = setup();
    await session.loadQueue({ tracks: [makeTrack("1")], index: 0, shuffle: false, repeat: "none" });
    engine.emitError(new Error("decode failed"));
    expect(session.getState().status).toBe("error");
    expect(session.getState().error).toBe("decode failed");
  });

  it("notifies subscribers on state change", async () => {
    const { session } = setup();
    const states: string[] = [];
    session.subscribe((s) => states.push(s.status));
    await session.loadQueue({ tracks: [makeTrack("1")], index: 0, shuffle: false, repeat: "none" });
    expect(states).toContain("playing");
  });

  it("goes to ended when next() is called on the last track", async () => {
    const { session } = setup();
    await session.loadQueue({ tracks: [makeTrack("1")], index: 0, shuffle: false, repeat: "none" });
    await session.next();
    expect(session.getState().status).toBe("ended");
  });

  it("on gapless auto-advance, bumps the index without reloading and preloads the following track", async () => {
    const { engine, session } = setup();
    const tracks = [makeTrack("1"), makeTrack("2"), makeTrack("3")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "none" });
    // after load: engine.loaded == ["1"], engine.preloaded == ["2"]
    engine.emitAdvanced();

    await vi.waitFor(() => {
      expect(session.getState().queue?.index).toBe(1);
      expect(engine.preloaded.map((r) => r.url)).toEqual(["fake://stream/2", "fake://stream/3"]);
    });
    // crucially, the engine was NOT told to load track 2 again — it auto-advanced
    expect(engine.loaded.map((r) => r.url)).toEqual(["fake://stream/1"]);
    expect(session.getState().status).toBe("playing");
    expect(session.getState().durationSec).toBe(180);
  });

  it("ignores a superseded load when a newer playIndex starts", async () => {
    let releaseTrack1!: () => void;
    const track1Gate = new Promise<void>((resolve) => {
      releaseTrack1 = resolve;
    });
    const engine = new FakePlaybackEngine();
    const resolver: StreamResolver = {
      async resolve(track) {
        if (track.id === "1") await track1Gate;
        return { url: `fake://stream/${track.id}`, kind: "direct" };
      },
    };
    const session = new PlaybackSession(engine, resolver);

    // Start loading track index 0 (id "1"); it suspends inside resolve().
    const first = session.loadQueue({
      tracks: [makeTrack("1"), makeTrack("2")],
      index: 0,
      shuffle: false,
      repeat: "none",
    });
    // Start a newer load for index 1 (id "2"); it resolves immediately and wins.
    const second = session.playIndex(1);
    await second;
    // Let the stale track-1 load finish; it must detect it was superseded.
    releaseTrack1();
    await first;

    expect(engine.loaded.map((r) => r.url)).toEqual(["fake://stream/2"]);
    expect(session.getState().queue?.index).toBe(1);
  });
});
