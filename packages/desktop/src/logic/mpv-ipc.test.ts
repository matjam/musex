import { describe, expect, it } from "vitest";
import {
  cmdAppend,
  cmdLoadfile,
  cmdObserve,
  cmdSeekAbs,
  cmdSetPause,
  cmdSetVolume,
  encodeLine,
  MpvEventMapper,
  splitLines,
} from "./mpv-ipc";

describe("command builders", () => {
  it("cmdLoadfile without startSec", () => {
    expect(cmdLoadfile(7, "http://x/a.flac")).toEqual({
      command: ["loadfile", "http://x/a.flac", "replace", "-1", { pause: "yes" }],
      request_id: 7,
    });
  });

  it("cmdLoadfile with startSec", () => {
    expect(cmdLoadfile(8, "http://x/a.flac", { startSec: 0.3 })).toEqual({
      command: ["loadfile", "http://x/a.flac", "replace", "-1", { pause: "yes", start: "0.3" }],
      request_id: 8,
    });
  });

  it("cmdLoadfile with startSec 0 still includes start", () => {
    expect(cmdLoadfile(9, "u", { startSec: 0 })).toEqual({
      command: ["loadfile", "u", "replace", "-1", { pause: "yes", start: "0" }],
      request_id: 9,
    });
  });

  it("cmdAppend", () => {
    expect(cmdAppend(2, "http://x/b.flac")).toEqual({
      command: ["loadfile", "http://x/b.flac", "append", "-1", {}],
      request_id: 2,
    });
  });

  it("cmdSetPause", () => {
    expect(cmdSetPause(3, true)).toEqual({
      command: ["set_property", "pause", true],
      request_id: 3,
    });
    expect(cmdSetPause(4, false)).toEqual({
      command: ["set_property", "pause", false],
      request_id: 4,
    });
  });

  it("cmdSeekAbs", () => {
    expect(cmdSeekAbs(5, 42.5)).toEqual({
      command: ["seek", 42.5, "absolute"],
      request_id: 5,
    });
  });

  it("cmdSetVolume maps 0..1 to 0..100 with clamping", () => {
    expect(cmdSetVolume(1, 0)).toEqual({ command: ["set_property", "volume", 0], request_id: 1 });
    expect(cmdSetVolume(1, 0.5)).toEqual({
      command: ["set_property", "volume", 50],
      request_id: 1,
    });
    expect(cmdSetVolume(1, 1)).toEqual({ command: ["set_property", "volume", 100], request_id: 1 });
    expect(cmdSetVolume(1, -0.2)).toEqual({
      command: ["set_property", "volume", 0],
      request_id: 1,
    });
    expect(cmdSetVolume(1, 1.7)).toEqual({
      command: ["set_property", "volume", 100],
      request_id: 1,
    });
    expect(cmdSetVolume(1, 0.333)).toEqual({
      command: ["set_property", "volume", 33],
      request_id: 1,
    });
  });

  it("cmdObserve", () => {
    expect(cmdObserve(6, 1, "time-pos")).toEqual({
      command: ["observe_property", 1, "time-pos"],
      request_id: 6,
    });
  });

  it("encodeLine emits newline-terminated JSON", () => {
    const line = encodeLine(cmdSetPause(3, true));
    expect(line.endsWith("\n")).toBe(true);
    expect(JSON.parse(line)).toEqual({ command: ["set_property", "pause", true], request_id: 3 });
  });
});

describe("splitLines", () => {
  it("empty chunk", () => {
    expect(splitLines("")).toEqual({ lines: [], rest: "" });
  });

  it("one full line", () => {
    expect(splitLines('{"event":"idle"}\n')).toEqual({
      lines: ['{"event":"idle"}'],
      rest: "",
    });
  });

  it("partial line carries as rest", () => {
    expect(splitLines('{"event":"id')).toEqual({ lines: [], rest: '{"event":"id' });
  });

  it("multiple lines plus trailing partial", () => {
    expect(splitLines('{"a":1}\n{"b":2}\n{"c"')).toEqual({
      lines: ['{"a":1}', '{"b":2}'],
      rest: '{"c"',
    });
  });
});

describe("MpvEventMapper", () => {
  function makeMapper(startMs = 1000) {
    let t = startMs;
    const mapper = new MpvEventMapper(() => t);
    return {
      mapper,
      advance(ms: number) {
        t += ms;
      },
    };
  }

  it("scenario A: explicit load, throttled positions, eof then idle ends", () => {
    const { mapper, advance } = makeMapper();
    mapper.noteExplicitLoad();
    expect(mapper.handle({ event: "start-file", playlist_entry_id: 1 })).toEqual([]);
    // first position after start-file always emits
    expect(mapper.handle({ event: "property-change", id: 1, name: "time-pos", data: 0.3 })).toEqual(
      [{ type: "position", sec: 0.3 }],
    );
    advance(10);
    // within throttle window → nothing
    expect(
      mapper.handle({ event: "property-change", id: 1, name: "time-pos", data: 0.31 }),
    ).toEqual([]);
    advance(290); // 300ms since last emitted position
    expect(mapper.handle({ event: "property-change", id: 1, name: "time-pos", data: 0.6 })).toEqual(
      [{ type: "position", sec: 0.6 }],
    );
    expect(mapper.handle({ event: "end-file", reason: "eof", playlist_entry_id: 1 })).toEqual([]);
    expect(mapper.handle({ event: "idle" })).toEqual([{ type: "ended" }]);
  });

  it("ignores property-change with absent or non-numeric data", () => {
    const { mapper } = makeMapper();
    mapper.noteExplicitLoad();
    mapper.handle({ event: "start-file", playlist_entry_id: 1 });
    expect(mapper.handle({ event: "property-change", id: 1, name: "time-pos" })).toEqual([]);
    expect(
      mapper.handle({ event: "property-change", id: 1, name: "time-pos", data: "0.3" }),
    ).toEqual([]);
  });

  it("ignores property-change for other property names", () => {
    const { mapper } = makeMapper();
    mapper.noteExplicitLoad();
    mapper.handle({ event: "start-file", playlist_entry_id: 1 });
    expect(mapper.handle({ event: "property-change", id: 2, name: "volume", data: 50 })).toEqual(
      [],
    );
  });

  it("scenario B: gapless advance — start-file without pending flag emits advanced", () => {
    const { mapper } = makeMapper();
    mapper.noteExplicitLoad();
    expect(mapper.handle({ event: "start-file", playlist_entry_id: 1 })).toEqual([]);
    expect(mapper.handle({ event: "end-file", reason: "eof", playlist_entry_id: 1 })).toEqual([]);
    expect(mapper.handle({ event: "start-file", playlist_entry_id: 2 })).toEqual([
      { type: "advanced" },
    ]);
  });

  it("advance resets the position throttle", () => {
    const { mapper, advance } = makeMapper();
    mapper.noteExplicitLoad();
    mapper.handle({ event: "start-file", playlist_entry_id: 1 });
    expect(mapper.handle({ event: "property-change", id: 1, name: "time-pos", data: 100 })).toEqual(
      [{ type: "position", sec: 100 }],
    );
    advance(10);
    mapper.handle({ event: "end-file", reason: "eof", playlist_entry_id: 1 });
    mapper.handle({ event: "start-file", playlist_entry_id: 2 });
    // only 10ms elapsed, but start-file reset the throttle → emits
    expect(mapper.handle({ event: "property-change", id: 1, name: "time-pos", data: 0 })).toEqual([
      { type: "position", sec: 0 },
    ]);
  });

  it("scenario C: end-file reason error emits error with reason", () => {
    const { mapper } = makeMapper();
    mapper.noteExplicitLoad();
    mapper.handle({ event: "start-file", playlist_entry_id: 1 });
    const events = mapper.handle({ event: "end-file", reason: "error", playlist_entry_id: 1 });
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev?.type).toBe("error");
    if (ev?.type === "error") {
      expect(ev.message).toContain("error");
    }
  });

  it("end-file error includes file_error when present", () => {
    const { mapper } = makeMapper();
    mapper.noteExplicitLoad();
    mapper.handle({ event: "start-file", playlist_entry_id: 1 });
    const events = mapper.handle({
      event: "end-file",
      reason: "error",
      file_error: "unrecognized format",
      playlist_entry_id: 1,
    });
    const ev = events[0];
    expect(ev?.type).toBe("error");
    if (ev?.type === "error") {
      expect(ev.message).toContain("error");
      expect(ev.message).toContain("unrecognized format");
    }
  });

  it("end-file with stop/quit/redirect emits nothing", () => {
    const { mapper } = makeMapper();
    mapper.noteExplicitLoad();
    mapper.handle({ event: "start-file", playlist_entry_id: 1 });
    for (const reason of ["stop", "quit", "redirect"]) {
      expect(mapper.handle({ event: "end-file", reason, playlist_entry_id: 1 })).toEqual([]);
    }
  });

  it("scenario D: boot idle is gated; post-playback idle ends once", () => {
    const { mapper } = makeMapper();
    // boot-time idle (--idle=yes) before any file → nothing
    expect(mapper.handle({ event: "idle" })).toEqual([]);
    mapper.noteExplicitLoad();
    mapper.handle({ event: "start-file", playlist_entry_id: 1 });
    mapper.handle({ event: "end-file", reason: "eof", playlist_entry_id: 1 });
    expect(mapper.handle({ event: "idle" })).toEqual([{ type: "ended" }]);
    // stray second idle → nothing
    expect(mapper.handle({ event: "idle" })).toEqual([]);
  });

  it("scenario E: two explicit loads consume two start-files, zero advanced", () => {
    const { mapper } = makeMapper();
    mapper.noteExplicitLoad();
    mapper.noteExplicitLoad();
    expect(mapper.handle({ event: "start-file", playlist_entry_id: 1 })).toEqual([]);
    expect(mapper.handle({ event: "start-file", playlist_entry_id: 2 })).toEqual([]);
  });

  it("ignores noise events and replies", () => {
    const { mapper } = makeMapper();
    expect(mapper.handle({ event: "file-loaded" })).toEqual([]);
    expect(mapper.handle({ event: "seek" })).toEqual([]);
    expect(mapper.handle({ event: "playback-restart" })).toEqual([]);
    expect(mapper.handle({ event: "audio-reconfig" })).toEqual([]);
    expect(mapper.handle({ request_id: 1, error: "success", data: null })).toEqual([]);
    expect(mapper.handle({ event: "totally-unknown" })).toEqual([]);
  });
});
