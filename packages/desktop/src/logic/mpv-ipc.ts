/** Pure mpv JSON-IPC helpers: command builders, line framing, and the
 *  mpv-event → engine-event mapper. No sockets, no processes — the controller
 *  (main process) owns the transport and feeds parsed messages in here.
 *
 *  Wire format (verified against the vendored mpv): newline-delimited JSON.
 *  Commands: `{"command":[...],"request_id":N}`; replies echo `request_id`.
 *  NOTE: this mpv's `loadfile` requires the playlist-index arg ("-1") BEFORE
 *  the options object. */

export interface MpvCommand {
  command: unknown[];
  request_id: number;
}

/** Load a file, replacing the playlist. Always loads PAUSED — the controller
 *  decides when to play (mirrors the engine's prepare-only `load()`). */
export function cmdLoadfile(id: number, url: string, opts: { startSec?: number } = {}): MpvCommand {
  const options: Record<string, string> = { pause: "yes" };
  if (opts.startSec != null) options.start = String(opts.startSec);
  return { command: ["loadfile", url, "replace", "-1", options], request_id: id };
}

/** Append a file to the playlist (gapless next-track buffering). */
export function cmdAppend(id: number, url: string): MpvCommand {
  return { command: ["loadfile", url, "append", "-1", {}], request_id: id };
}

export function cmdSetPause(id: number, paused: boolean): MpvCommand {
  return { command: ["set_property", "pause", paused], request_id: id };
}

export function cmdSeekAbs(id: number, sec: number): MpvCommand {
  return { command: ["seek", sec, "absolute"], request_id: id };
}

/** Volume takes 0..1 (engine convention); mpv wants 0..100. */
export function cmdSetVolume(id: number, v01: number): MpvCommand {
  const clamped = Math.min(1, Math.max(0, v01));
  return { command: ["set_property", "volume", Math.round(clamped * 100)], request_id: id };
}

/** Set the audio filter chain ("" clears it). Values come exclusively from
 *  logic/audio-filters.ts — never free-form user text. The structured command
 *  array keeps commas inside `lavfi=[...]` opaque to mpv's option parser. */
export function cmdSetAf(id: number, af: string): MpvCommand {
  return { command: ["set_property", "af", af], request_id: id };
}

export function cmdSetReplaygain(id: number, mode: "no" | "track" | "album"): MpvCommand {
  return { command: ["set_property", "replaygain", mode], request_id: id };
}

export function cmdObserve(id: number, observeId: number, prop: string): MpvCommand {
  return { command: ["observe_property", observeId, prop], request_id: id };
}

/** Ask mpv to exit (fire-and-forget — the process may die before replying). */
export function cmdQuit(id: number): MpvCommand {
  return { command: ["quit"], request_id: id };
}

export function encodeLine(c: MpvCommand): string {
  return `${JSON.stringify(c)}\n`;
}

/** Split a buffer of socket data into complete lines + the trailing remainder.
 *  Caller keeps `rest` and prepends it to the next chunk. */
export function splitLines(chunk: string): { lines: string[]; rest: string } {
  const parts = chunk.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts, rest };
}

export type EngineEvent =
  | { type: "position"; sec: number }
  | { type: "advanced" }
  | { type: "ended" }
  | { type: "error"; message: string };

const POSITION_THROTTLE_MS = 250;

/** Maps raw mpv IPC events to engine events.
 *
 *  Key behaviors:
 *  - time-pos ticks (~every 64ms) are throttled to one position per 250ms,
 *    except the first tick after each start-file always emits.
 *  - `start-file` from our own explicit `loadfile … replace` (announced via
 *    noteExplicitLoad) is swallowed; an unannounced one means mpv auto-advanced
 *    into an appended playlist entry → "advanced".
 *  - `idle` means playback truly ended — but mpv runs with --idle=yes and fires
 *    one idle at boot, so it's gated on "a file has started". */
export class MpvEventMapper {
  private pendingExplicitLoads = 0;
  private fileHasStarted = false;
  private lastPositionEmitMs: number | null = null; // null → next position always emits
  private readonly now: () => number;

  constructor(now: () => number = () => Date.now()) {
    this.now = now;
  }

  /** Call right before sending an explicit `loadfile … replace`, so the
   *  resulting start-file isn't misread as an auto-advance. */
  noteExplicitLoad(): void {
    this.pendingExplicitLoads += 1;
  }

  /** Feed one parsed IPC message; returns zero or more engine events. */
  handle(msg: Record<string, unknown>): EngineEvent[] {
    switch (msg.event) {
      case "property-change":
        return this.handlePropertyChange(msg);
      case "start-file":
        return this.handleStartFile();
      case "end-file":
        return this.handleEndFile(msg);
      case "idle":
        return this.handleIdle();
      default:
        // file-loaded / seek / playback-restart / audio-reconfig / command
        // replies (request_id) / anything unknown — not engine-relevant.
        return [];
    }
  }

  private handlePropertyChange(msg: Record<string, unknown>): EngineEvent[] {
    if (msg.name !== "time-pos" || typeof msg.data !== "number") return [];
    const t = this.now();
    if (this.lastPositionEmitMs !== null && t - this.lastPositionEmitMs < POSITION_THROTTLE_MS) {
      return [];
    }
    this.lastPositionEmitMs = t;
    return [{ type: "position", sec: msg.data }];
  }

  private handleStartFile(): EngineEvent[] {
    this.fileHasStarted = true;
    this.lastPositionEmitMs = null; // first position after a start always emits
    if (this.pendingExplicitLoads > 0) {
      this.pendingExplicitLoads -= 1;
      return []; // our own load — not an advance
    }
    return [{ type: "advanced" }];
  }

  private handleEndFile(msg: Record<string, unknown>): EngineEvent[] {
    if (msg.reason !== "error") return []; // eof → start-file/idle decides; stop/quit/redirect → controller-initiated
    const detail = typeof msg.file_error === "string" ? `: ${msg.file_error}` : "";
    return [{ type: "error", message: `mpv: playback failed (error)${detail}` }];
  }

  private handleIdle(): EngineEvent[] {
    if (!this.fileHasStarted) return []; // boot-time idle from --idle=yes
    this.fileHasStarted = false; // a stray second idle must not double-fire
    return [{ type: "ended" }];
  }
}
