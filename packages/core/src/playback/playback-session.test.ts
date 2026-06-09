import { describe, expect, it, vi } from "vitest";
import type { StreamResolver } from "../ports/stream-resolver";
import { FakePlaybackEngine, FakeStreamResolver, makeTrack } from "../testing/fakes";
import { PlaybackSession } from "./playback-session";

/** Deterministic shuffle: reverse the array. Lets tests predict the shuffled order. */
function reverseShuffleRest<T>(items: T[]): T[] {
  return [...items].reverse();
}

function setup(shuffleRest?: <T>(items: T[]) => T[]) {
  const engine = new FakePlaybackEngine();
  const resolver = new FakeStreamResolver();
  const session = new PlaybackSession(engine, resolver, shuffleRest);
  return { engine, resolver, session };
}

// ──────────────────────────────────────────────────────────────────────────────
// Original tests (unchanged — ensure no regressions)
// ──────────────────────────────────────────────────────────────────────────────

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

  it("does not preload past the end of the queue (repeat none)", async () => {
    const { engine, session } = setup();
    await session.loadQueue({ tracks: [makeTrack("1")], index: 0, shuffle: false, repeat: "none" });
    expect(engine.preloaded).toEqual([]);
  });

  it("advances to the next track when the current one ends", async () => {
    const { engine, session } = setup();
    const tracks = [makeTrack("1"), makeTrack("2")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "none" });
    engine.emitEnded();

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
    engine.emitAdvanced();

    await vi.waitFor(() => {
      expect(session.getState().queue?.index).toBe(1);
      expect(engine.preloaded.map((r) => r.url)).toEqual(["fake://stream/2", "fake://stream/3"]);
    });
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

    const first = session.loadQueue({
      tracks: [makeTrack("1"), makeTrack("2")],
      index: 0,
      shuffle: false,
      repeat: "none",
    });
    const second = session.playIndex(1);
    await second;
    releaseTrack1();
    await first;

    expect(engine.loaded.map((r) => r.url)).toEqual(["fake://stream/2"]);
    expect(session.getState().queue?.index).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// restore()
// ──────────────────────────────────────────────────────────────────────────────

describe("PlaybackSession — restore()", () => {
  it("restore() loads the current track paused at the saved position, no autoplay", async () => {
    const engine = new FakePlaybackEngine();
    const resolver = new FakeStreamResolver();
    const session = new PlaybackSession(engine, resolver);
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c")];
    const queue = { tracks, index: 1, shuffle: false, repeat: "none" as const };

    await session.restore(queue, 42);

    const s = session.getState();
    expect(s.status).toBe("paused");
    expect(s.queue?.index).toBe(1);
    expect(s.positionSec).toBe(42);
    expect(engine.loaded.at(-1)?.url).toBe("fake://stream/b");
    expect(engine.seekCalls).toContain(42);
    expect(engine.playCalls).toBe(0);
    expect(engine.preloaded.at(-1)?.url).toBe("fake://stream/c");
  });

  it("restore() clamps an out-of-bounds index", async () => {
    const engine = new FakePlaybackEngine();
    const session = new PlaybackSession(engine, new FakeStreamResolver());
    const tracks = [makeTrack("a"), makeTrack("b")];
    await session.restore({ tracks, index: 99, shuffle: false, repeat: "none" }, 0);
    expect(session.getState().queue?.index).toBe(1);
    expect(engine.loaded.at(-1)?.url).toBe("fake://stream/b");
  });

  it("restore() is a no-op for an empty queue", async () => {
    const engine = new FakePlaybackEngine();
    const session = new PlaybackSession(engine, new FakeStreamResolver());
    await session.restore({ tracks: [], index: 0, shuffle: false, repeat: "none" }, 0);
    expect(session.getState().queue).toBeNull();
    expect(engine.loaded).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Repeat mode tests
// ──────────────────────────────────────────────────────────────────────────────

describe("PlaybackSession — repeat none", () => {
  it("ends naturally at the last track when repeat is none", async () => {
    const { engine, session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "none" });
    engine.emitEnded(); // track a ends
    await vi.waitFor(() => expect(session.getState().queue?.index).toBe(1));
    engine.emitEnded(); // track b ends
    await vi.waitFor(() => expect(session.getState().status).toBe("ended"));
  });

  it("manual next() on last track → status ended", async () => {
    const { session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b")];
    await session.loadQueue({ tracks, index: 1, shuffle: false, repeat: "none" });
    await session.next();
    expect(session.getState().status).toBe("ended");
  });

  it("does not preload when on the last track (repeat none)", async () => {
    const { engine, session } = setup();
    await session.loadQueue({
      tracks: [makeTrack("a"), makeTrack("b")],
      index: 1,
      shuffle: false,
      repeat: "none",
    });
    // Only the initial load, no preload (we're last)
    expect(engine.preloaded).toEqual([]);
  });
});

describe("PlaybackSession — repeat all", () => {
  it("wraps to index 0 when the last track ends", async () => {
    const { engine, session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b")];
    await session.loadQueue({ tracks, index: 1, shuffle: false, repeat: "all" });
    engine.emitEnded();
    await vi.waitFor(() => expect(session.getState().queue?.index).toBe(0));
    expect(engine.loaded.map((r) => r.url)).toContain("fake://stream/a");
  });

  it("manual next() on the last track wraps to index 0", async () => {
    const { session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b")];
    await session.loadQueue({ tracks, index: 1, shuffle: false, repeat: "all" });
    await session.next();
    expect(session.getState().queue?.index).toBe(0);
    expect(session.getState().status).toBe("playing");
  });

  it("preloads index 0 when currently on the last track (repeat all)", async () => {
    const { engine, session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b")];
    await session.loadQueue({ tracks, index: 1, shuffle: false, repeat: "all" });
    expect(engine.preloaded.map((r) => r.url)).toEqual(["fake://stream/a"]);
  });

  it("gapless advance wraps index from last to 0", async () => {
    const { engine, session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b")];
    await session.loadQueue({ tracks, index: 1, shuffle: false, repeat: "all" });
    engine.emitAdvanced();
    await vi.waitFor(() => expect(session.getState().queue?.index).toBe(0));
    // After wrapping, the next preload should be index 1 again
    expect(engine.preloaded.map((r) => r.url)).toContain("fake://stream/b");
  });
});

describe("PlaybackSession — repeat one", () => {
  it("replays the current track when it ends (index unchanged)", async () => {
    const { engine, session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "one" });
    engine.emitEnded();
    await vi.waitFor(() => expect(engine.loaded.map((r) => r.url)).toContain("fake://stream/a"));
    // index stays at 0
    expect(session.getState().queue?.index).toBe(0);
  });

  it("manual next() overrides repeat-one and advances to the real next", async () => {
    const { session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "one" });
    await session.next();
    expect(session.getState().queue?.index).toBe(1);
    expect(session.getState().status).toBe("playing");
  });

  it("manual next() on the last track with repeat-one → ended (no wrap)", async () => {
    const { session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b")];
    await session.loadQueue({ tracks, index: 1, shuffle: false, repeat: "one" });
    await session.next();
    expect(session.getState().status).toBe("ended");
  });

  it("preloadNext preloads the CURRENT track again (gapless loop) for repeat-one", async () => {
    const { engine, session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "one" });
    // preloaded[0] should be track "a" again
    expect(engine.preloaded.map((r) => r.url)).toEqual(["fake://stream/a"]);
  });

  it("gapless advance with repeat-one keeps index and preloads current again", async () => {
    const { engine, session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "one" });
    engine.emitAdvanced();
    await vi.waitFor(() => {
      // After advance, index stays 0 and we preload "a" again
      expect(engine.preloaded.map((r) => r.url)).toContain("fake://stream/a");
    });
    expect(session.getState().queue?.index).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// previous() tests
// ──────────────────────────────────────────────────────────────────────────────

describe("PlaybackSession — previous()", () => {
  it("goes to the previous track", async () => {
    const { session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c")];
    await session.loadQueue({ tracks, index: 2, shuffle: false, repeat: "none" });
    await session.previous();
    expect(session.getState().queue?.index).toBe(1);
  });

  it("clamps to index 0 at the start (repeat none)", async () => {
    const { session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "none" });
    await session.previous();
    // Should stay at 0
    expect(session.getState().queue?.index).toBe(0);
  });

  it("wraps to last track with repeat all", async () => {
    const { session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "all" });
    await session.previous();
    expect(session.getState().queue?.index).toBe(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// cycleRepeat / setRepeat
// ──────────────────────────────────────────────────────────────────────────────

describe("PlaybackSession — cycleRepeat()", () => {
  it("cycles none → all → one → none", async () => {
    const { session } = setup();
    await session.loadQueue({
      tracks: [makeTrack("a"), makeTrack("b")],
      index: 0,
      shuffle: false,
      repeat: "none",
    });
    session.cycleRepeat();
    expect(session.getState().queue?.repeat).toBe("all");
    session.cycleRepeat();
    expect(session.getState().queue?.repeat).toBe("one");
    session.cycleRepeat();
    expect(session.getState().queue?.repeat).toBe("none");
  });

  it("updates preload target when cycling to repeat-all on the last track", async () => {
    const { engine, session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b")];
    await session.loadQueue({ tracks, index: 1, shuffle: false, repeat: "none" });
    // Before: no preload (last track, repeat none)
    expect(engine.preloaded).toEqual([]);
    session.cycleRepeat(); // → all
    await vi.waitFor(() => expect(engine.preloaded.map((r) => r.url)).toContain("fake://stream/a"));
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// enqueueNext / enqueueEnd
// ──────────────────────────────────────────────────────────────────────────────

describe("PlaybackSession — enqueueNext()", () => {
  it("starts playback when the queue is idle/empty", async () => {
    const { session } = setup();
    await session.enqueueNext([makeTrack("a"), makeTrack("b")]);
    expect(session.getState().status).toBe("playing");
    expect(session.getState().queue?.index).toBe(0);
  });

  it("inserts tracks immediately after the current track", async () => {
    const { session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "none" });
    await session.enqueueNext([makeTrack("x"), makeTrack("y")]);
    const q = session.getState().queue;
    if (!q) throw new Error("queue is null");
    expect(q.tracks.map((t) => t.id)).toEqual(["a", "x", "y", "b", "c"]);
    expect(q.index).toBe(0);
  });

  it("updates the preload after enqueueNext changes what's next", async () => {
    const { engine, session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "none" });
    // preloaded "b" initially
    const preloadedBefore = engine.preloaded.length;
    await session.enqueueNext([makeTrack("x")]);
    // now "x" should be preloaded
    expect(engine.preloaded.length).toBeGreaterThan(preloadedBefore);
    const lastPreload = engine.preloaded[engine.preloaded.length - 1];
    expect(lastPreload?.url).toBe("fake://stream/x");
  });
});

describe("PlaybackSession — enqueueEnd()", () => {
  it("starts playback when the queue is idle/empty", async () => {
    const { session } = setup();
    await session.enqueueEnd([makeTrack("a"), makeTrack("b")]);
    expect(session.getState().status).toBe("playing");
    expect(session.getState().queue?.index).toBe(0);
  });

  it("appends tracks to the end of the queue", async () => {
    const { session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "none" });
    await session.enqueueEnd([makeTrack("x"), makeTrack("y")]);
    const q = session.getState().queue;
    if (!q) throw new Error("queue is null");
    expect(q.tracks.map((t) => t.id)).toEqual(["a", "b", "x", "y"]);
    expect(q.index).toBe(0);
  });

  it("triggers a preload when appended track becomes the immediate next", async () => {
    const { engine, session } = setup();
    // Single track queue: nothing to preload initially
    await session.loadQueue({ tracks: [makeTrack("a")], index: 0, shuffle: false, repeat: "none" });
    expect(engine.preloaded).toEqual([]);
    await session.enqueueEnd([makeTrack("x")]);
    await vi.waitFor(() => expect(engine.preloaded.map((r) => r.url)).toContain("fake://stream/x"));
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// removeAt
// ──────────────────────────────────────────────────────────────────────────────

describe("PlaybackSession — removeAt()", () => {
  it("removes a track after the current index without changing index", async () => {
    const { session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "none" });
    session.removeAt(2); // remove "c"
    const q = session.getState().queue;
    if (!q) throw new Error("queue is null");
    expect(q.tracks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(q.index).toBe(0);
  });

  it("removes a track before the current index and decrements index", async () => {
    const { session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c")];
    await session.loadQueue({ tracks, index: 2, shuffle: false, repeat: "none" });
    session.removeAt(0); // remove "a"
    const q = session.getState().queue;
    if (!q) throw new Error("queue is null");
    expect(q.tracks.map((t) => t.id)).toEqual(["b", "c"]);
    expect(q.index).toBe(1); // was 2, decremented to 1
  });

  it("removes the current track and starts playing the track that takes its slot", async () => {
    const { engine, session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c")];
    await session.loadQueue({ tracks, index: 1, shuffle: false, repeat: "none" });
    session.removeAt(1); // remove current "b"
    // "c" is now at index 1 and should be loaded
    await vi.waitFor(() => expect(engine.loaded.map((r) => r.url)).toContain("fake://stream/c"));
    const q = session.getState().queue;
    if (!q) throw new Error("queue is null");
    expect(q.tracks.map((t) => t.id)).toEqual(["a", "c"]);
    expect(q.index).toBe(1);
  });

  it("removes the current track when it's the last track → ended", async () => {
    const { session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b")];
    await session.loadQueue({ tracks, index: 1, shuffle: false, repeat: "none" });
    session.removeAt(1); // remove last track (current)
    await vi.waitFor(() => expect(session.getState().status).toBe("ended"));
  });

  it("removes the only track → ended", async () => {
    const { session } = setup();
    await session.loadQueue({ tracks: [makeTrack("a")], index: 0, shuffle: false, repeat: "none" });
    session.removeAt(0);
    await vi.waitFor(() => expect(session.getState().status).toBe("ended"));
    expect(session.getState().queue?.tracks).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// move
// ──────────────────────────────────────────────────────────────────────────────

describe("PlaybackSession — move()", () => {
  it("moves a track within the queue and keeps the current track at the same index", async () => {
    const { session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c"), makeTrack("d")];
    await session.loadQueue({ tracks, index: 1, shuffle: false, repeat: "none" }); // playing "b"
    session.move(3, 0); // move "d" to front
    const q = session.getState().queue;
    if (!q) throw new Error("queue is null");
    expect(q.tracks.map((t) => t.id)).toEqual(["d", "a", "b", "c"]);
    expect(q.tracks[q.index]?.id).toBe("b"); // still playing "b"
  });

  it("move of current track updates index", async () => {
    const { session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "none" }); // playing "a"
    session.move(0, 2); // move "a" to end
    const q = session.getState().queue;
    if (!q) throw new Error("queue is null");
    expect(q.tracks.map((t) => t.id)).toEqual(["b", "c", "a"]);
    expect(q.index).toBe(2); // index follows "a"
    expect(q.tracks[q.index]?.id).toBe("a");
  });

  it("move track forward (from < to)", async () => {
    const { session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c"), makeTrack("d")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "none" });
    session.move(1, 3); // "b" moves to end
    const q = session.getState().queue;
    if (!q) throw new Error("queue is null");
    expect(q.tracks.map((t) => t.id)).toEqual(["a", "c", "d", "b"]);
    expect(q.index).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// clearQueue
// ──────────────────────────────────────────────────────────────────────────────

describe("PlaybackSession — clearQueue()", () => {
  it("drops upcoming tracks but keeps history and current", async () => {
    const { session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c"), makeTrack("d")];
    await session.loadQueue({ tracks, index: 1, shuffle: false, repeat: "none" }); // playing "b"
    session.clearQueue();
    const q = session.getState().queue;
    if (!q) throw new Error("queue is null");
    expect(q.tracks.map((t) => t.id)).toEqual(["a", "b"]);
    expect(q.index).toBe(1);
    expect(session.getState().status).toBe("playing");
  });

  it("current track keeps playing after clearQueue", async () => {
    const { engine, session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "none" });
    const loadsBefore = engine.loaded.length;
    session.clearQueue();
    // No new load should happen
    expect(engine.loaded.length).toBe(loadsBefore);
    expect(session.getState().status).toBe("playing");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// jumpTo
// ──────────────────────────────────────────────────────────────────────────────

describe("PlaybackSession — jumpTo()", () => {
  it("jumps to the specified index and starts playing", async () => {
    const { engine, session } = setup();
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "none" });
    await session.jumpTo(2);
    expect(session.getState().queue?.index).toBe(2);
    expect(engine.loaded.map((r) => r.url)).toContain("fake://stream/c");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// setShuffle
// ──────────────────────────────────────────────────────────────────────────────

describe("PlaybackSession — setShuffle()", () => {
  it("shuffle on keeps current track at its index; shuffles only tracks AFTER current", async () => {
    const { session } = setup(reverseShuffleRest);
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c"), makeTrack("d")];
    await session.loadQueue({ tracks, index: 1, shuffle: false, repeat: "none" }); // playing "b"
    session.setShuffle(true);
    const q = session.getState().queue;
    if (!q) throw new Error("queue is null");
    // "a" (before current) and "b" (current) stay put; "c","d" reversed → "d","c"
    expect(q.tracks.map((t) => t.id)).toEqual(["a", "b", "d", "c"]);
    expect(q.index).toBe(1);
    expect(q.shuffle).toBe(true);
  });

  it("shuffle off restores original order and repoints index at the still-playing track", async () => {
    const { session } = setup(reverseShuffleRest);
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c"), makeTrack("d")];
    await session.loadQueue({ tracks, index: 1, shuffle: false, repeat: "none" }); // playing "b"
    session.setShuffle(true);
    // shuffled: ["a","b","d","c"]
    session.setShuffle(false);
    const q = session.getState().queue;
    if (!q) throw new Error("queue is null");
    expect(q.tracks.map((t) => t.id)).toEqual(["a", "b", "c", "d"]);
    expect(q.index).toBe(1); // "b" is still at index 1 in the original order
    expect(q.shuffle).toBe(false);
  });

  it("shuffle off is a no-op when already off", async () => {
    const { session } = setup(reverseShuffleRest);
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "none" });
    session.setShuffle(false);
    const q = session.getState().queue;
    if (!q) throw new Error("queue is null");
    expect(q.tracks.map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(q.shuffle).toBe(false);
  });

  it("round-trip shuffle on→enqueueEnd→off: added track survives restore", async () => {
    const { session } = setup(reverseShuffleRest);
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "none" }); // playing "a"
    session.setShuffle(true);
    // shuffled order after reverse: ["a","c","b"] (current "a" stays, ["b","c"] reversed)
    // Add "x" to the end while shuffled
    await session.enqueueEnd([makeTrack("x")]);
    // shuffled should now be ["a","c","b","x"] or ["a",<rest+x>]
    session.setShuffle(false);
    const q = session.getState().queue;
    if (!q) throw new Error("queue is null");
    // Original order (unshuffled) was a,b,c; "x" was added at end in both
    // After restore: all of a,b,c,x should be present, "a" at index 0
    expect(q.tracks.map((t) => t.id)).toContain("a");
    expect(q.tracks.map((t) => t.id)).toContain("b");
    expect(q.tracks.map((t) => t.id)).toContain("c");
    expect(q.tracks.map((t) => t.id)).toContain("x");
    expect(q.index).toBe(0); // "a" is still the current track
    expect(q.shuffle).toBe(false);
  });

  it("setShuffle updates the preload for the new 'next' track", async () => {
    const { engine, session } = setup(reverseShuffleRest);
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c"), makeTrack("d")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "none" });
    // Before: next is "b"; preloaded "b"
    session.setShuffle(true);
    // After shuffle (reverse rest): next should be "d"
    await vi.waitFor(() => {
      const preloadUrls = engine.preloaded.map((r) => r.url);
      return expect(preloadUrls).toContain("fake://stream/d");
    });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Shuffle + removeAt interaction
// ──────────────────────────────────────────────────────────────────────────────

describe("PlaybackSession — shuffle + removeAt interaction", () => {
  it("removeAt while shuffled keeps unshuffled consistent", async () => {
    const { session } = setup(reverseShuffleRest);
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c"), makeTrack("d")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "none" }); // "a" playing
    session.setShuffle(true);
    // shuffled: ["a","d","c","b"]
    session.removeAt(3); // remove "b" (last in shuffled order)
    // Now turn off shuffle: should restore without "b"
    session.setShuffle(false);
    const q = session.getState().queue;
    if (!q) throw new Error("queue is null");
    expect(q.tracks.map((t) => t.id)).toEqual(["a", "c", "d"]);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// playTrackNext (double-click to play)
// ──────────────────────────────────────────────────────────────────────────────

describe("PlaybackSession — playTrackNext", () => {
  it("starts a fresh queue when nothing is loaded", async () => {
    const { engine, session } = setup();
    await session.playTrackNext(makeTrack("x"));
    const q = session.getState().queue;
    if (!q) throw new Error("queue is null");
    expect(q.tracks.map((t) => t.id)).toEqual(["x"]);
    expect(engine.loaded.at(-1)?.url).toBe("fake://stream/x");
    expect(session.getState().status).toBe("playing");
  });

  it("inserts after current and plays it, preserving shuffle/repeat", async () => {
    const { engine, session } = setup(reverseShuffleRest);
    const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c")];
    await session.loadQueue({ tracks, index: 0, shuffle: false, repeat: "all" });
    session.setShuffle(true); // shuffle on, repeat "all"

    await session.playTrackNext(makeTrack("x"));

    const q = session.getState().queue;
    if (!q) throw new Error("queue is null");
    expect(q.shuffle).toBe(true); // not reset
    expect(q.repeat).toBe("all"); // not reset
    expect(q.tracks[q.index]?.id).toBe("x"); // x is now playing
    expect(q.tracks[q.index - 1]?.id).toBe("a"); // inserted right after the old current
    expect(engine.loaded.at(-1)?.url).toBe("fake://stream/x");
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// loadQueueShuffled (shuffle-play an album/artist)
// ──────────────────────────────────────────────────────────────────────────────

describe("PlaybackSession — loadQueueShuffled", () => {
  it("shuffles the whole list, plays from the top, shuffle on", async () => {
    const { engine, session } = setup(reverseShuffleRest);
    await session.loadQueueShuffled([makeTrack("a"), makeTrack("b"), makeTrack("c")]);
    const q = session.getState().queue;
    if (!q) throw new Error("queue is null");
    expect(q.shuffle).toBe(true);
    expect(q.tracks.map((t) => t.id)).toEqual(["c", "b", "a"]);
    expect(q.index).toBe(0);
    expect(engine.loaded.at(-1)?.url).toBe("fake://stream/c");
  });
});
