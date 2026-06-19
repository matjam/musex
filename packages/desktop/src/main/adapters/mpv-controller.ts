import { type ChildProcess, spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import type { EngineEvent } from "../../logic/mpv-ipc.js";
import {
  cmdAppend,
  cmdLoadfile,
  cmdObserve,
  cmdQuit,
  cmdSeekAbs,
  cmdSetAf,
  cmdSetPause,
  cmdSetReplaygain,
  cmdSetVolume,
  encodeLine,
  type MpvCommand,
  MpvEventMapper,
  splitLines,
} from "../../logic/mpv-ipc.js";

export interface MpvPaths {
  binaryPath: string;
  socketPath: string;
}

export interface AudioConfig {
  /** mpv `af` property value ("" = no filters). */
  af: string;
  replaygain: "no" | "track" | "album";
}

const SPAWN_ARGS = [
  "--idle=yes",
  "--no-video",
  "--no-terminal",
  "--no-config",
  "--gapless-audio=yes",
];
const CONNECT_RETRY_MS = 100;
const CONNECT_DEADLINE_MS = 5_000;
const QUIT_GRACE_MS = 200;

interface PendingRequest {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
}

interface LoadWaiter {
  resolve: () => void;
  reject: (err: Error) => void;
}

/**
 * Owns the vendored mpv process and its JSON-IPC socket: spawn, connect,
 * request/reply correlation, and event fan-out to a single sink. All protocol
 * knowledge (command shapes, line framing, event semantics) lives in
 * `logic/mpv-ipc.ts` — this class is only process/socket/promise plumbing.
 *
 * Lifecycle: lazy — nothing is spawned until the first `load()`. If mpv dies
 * unexpectedly the controller clears its state and the next `load()` respawns
 * it (no automatic retry loops).
 */
export class MpvController {
  private child: ChildProcess | null = null;
  private socket: net.Socket | null = null;
  private running = false;
  private disposed = false;
  private starting: Promise<void> | null = null;

  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  /** Resolves when the in-flight explicit load's `file-loaded` arrives. */
  private loadWaiter: LoadWaiter | null = null;

  private mapper = new MpvEventMapper();
  private rest = "";
  private sink: ((e: EngineEvent) => void) | null = null;
  /** Desired audio filters/replaygain — cached so every (re)spawn applies it. */
  private audioConfig: AudioConfig = { af: "", replaygain: "no" };
  /** Desired volume (0..1) — cached so every (re)spawn comes up at it. Default
   *  1 (full) matches mpv's default; a restore-time setVolume before the lazy
   *  spawn lands here and is applied on doStart. */
  private cachedVolume = 1;

  constructor(private readonly paths: MpvPaths) {}

  setSink(sink: ((e: EngineEvent) => void) | null): void {
    this.sink = sink;
  }

  /** Spawn mpv + connect to its IPC socket. Idempotent: no-op if running;
   *  concurrent calls share one in-flight start. */
  async start(): Promise<void> {
    if (this.disposed) throw new Error("MpvController disposed");
    if (this.running) return;
    if (!this.starting) {
      this.starting = this.doStart().finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  private async doStart(): Promise<void> {
    // Remove a stale socket from a previous run; force:true ignores ENOENT
    // (no stale socket is the normal case).
    await rm(this.paths.socketPath, { force: true });

    const child = spawn(
      this.paths.binaryPath,
      [
        ...SPAWN_ARGS,
        `--input-ipc-server=${this.paths.socketPath}`,
        // Opt-in verbose mpv log (demuxer/cache/network state) — invaluable for
        // diagnosing playback issues: MUSEX_MPV_LOG=1 writes <socket>.log.
        ...(process.env.MUSEX_MPV_LOG ? [`--log-file=${this.paths.socketPath}.log`] : []),
      ],
      { stdio: "ignore" },
    );
    this.child = child;
    child.on("exit", () => this.onChildExit(child));
    child.on("error", (err) => {
      // spawn failure (e.g. missing binary) — surfaces via the connect
      // deadline below; log the underlying cause.
      console.error("[musex mpv] spawn error:", err);
    });

    const socket = await this.connectWithRetry();
    socket.setEncoding("utf8");
    this.rest = "";
    this.mapper = new MpvEventMapper(); // fresh process → fresh boot-idle gating
    socket.on("data", (chunk: string) => this.onData(chunk));
    socket.on("error", (err) => {
      // The exit handler owns cleanup; this just prevents an unhandled
      // 'error' event from crashing main when mpv dies mid-stream.
      if (!this.disposed) console.error("[musex mpv] socket error:", err);
    });
    this.socket = socket;
    this.running = true;

    await this.send((id) => cmdObserve(id, 1, "time-pos"));
    await this.send((id) => cmdObserve(id, 2, "pause"));
    await this.sendAudioConfig();
    // Apply the cached volume so a lazy spawn / post-crash respawn comes up at
    // the restored level (a restore-time setVolume before the spawn cached it).
    await this.send((id) => cmdSetVolume(id, this.cachedVolume));
  }

  /** mpv creates the IPC socket shortly after spawn — poll until it accepts. */
  private async connectWithRetry(): Promise<net.Socket> {
    const deadline = Date.now() + CONNECT_DEADLINE_MS;
    for (;;) {
      try {
        return await new Promise<net.Socket>((resolve, reject) => {
          const sock = net.connect(this.paths.socketPath);
          sock.once("connect", () => {
            sock.removeListener("error", reject);
            resolve(sock);
          });
          sock.once("error", reject);
        });
      } catch (err) {
        // Socket not there yet — retrying IS the handling, until the deadline.
        if (Date.now() >= deadline) {
          throw new Error(`timed out connecting to mpv IPC socket: ${String(err)}`);
        }
        await delay(CONNECT_RETRY_MS);
      }
    }
  }

  private onData(chunk: string): void {
    const { lines, rest } = splitLines(this.rest + chunk);
    this.rest = rest;
    for (const line of lines) {
      if (!line.trim()) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line) as Record<string, unknown>;
      } catch (err) {
        console.error("[musex mpv] malformed IPC line:", line, err);
        continue;
      }
      this.route(msg);
    }
  }

  private route(msg: Record<string, unknown>): void {
    // 1. Command replies → resolve/reject the matching pending request.
    if (typeof msg.request_id === "number") {
      const req = this.pending.get(msg.request_id);
      if (req) {
        this.pending.delete(msg.request_id);
        if (msg.error === "success") req.resolve(msg.data);
        else req.reject(new Error(`mpv: ${String(msg.error)}`));
      }
    }

    // 2. Explicit-load completion: `file-loaded` means the file is ready
    //    (seek works from here); a pre-load `end-file reason=error` means the
    //    load failed (the mapper also emits the error event — expected).
    if (msg.event === "file-loaded" && this.loadWaiter) {
      const waiter = this.loadWaiter;
      this.loadWaiter = null;
      waiter.resolve();
    } else if (msg.event === "end-file" && msg.reason === "error" && this.loadWaiter) {
      const waiter = this.loadWaiter;
      this.loadWaiter = null;
      const detail = typeof msg.file_error === "string" ? `: ${msg.file_error}` : "";
      waiter.reject(new Error(`mpv: load failed${detail}`));
    }

    // 3. Every message also feeds the event mapper (it ignores non-events).
    const events = this.mapper.handle(msg);
    for (const e of events) this.sink?.(e);
  }

  private send(build: (id: number) => MpvCommand): Promise<unknown> {
    const socket = this.socket;
    if (!this.running || !socket) return Promise.reject(new Error("mpv is not running"));
    const id = this.nextRequestId++;
    const line = encodeLine(build(id));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      socket.write(line, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  /** Load `url` (paused), resolving once mpv reports `file-loaded`.
   *  Lazily (re)starts mpv. A new load() while one is pending SUPERSEDES it:
   *  the old waiter is resolved harmlessly (the caller asked for a track that
   *  no longer matters — rejecting would surface a spurious error for a
   *  deliberate track change). */
  async load(url: string, opts: { startSec?: number } = {}): Promise<void> {
    await this.start();
    this.loadWaiter?.resolve();
    const fileLoaded = new Promise<void>((resolve, reject) => {
      this.loadWaiter = { resolve, reject };
    });
    this.mapper.noteExplicitLoad();
    await this.send((id) => cmdLoadfile(id, url, opts));
    await fileLoaded;
  }

  /** Append the next track for gapless transition. No-op when mpv isn't
   *  running: with nothing playing there's nothing to be gapless after, and
   *  preloading must not be the thing that spawns the process. */
  async preload(url: string): Promise<void> {
    if (!this.running) return;
    await this.send((id) => cmdAppend(id, url));
  }

  // play/pause/seek are no-ops when mpv isn't running: nothing is playing, so
  // there's nothing to control (and spawning for them would be wrong — load()
  // owns the lifecycle). setVolume differs: it ALWAYS caches (see below) so a
  // restore-time call before the lazy spawn survives.

  async play(): Promise<void> {
    if (!this.running) return;
    await this.send((id) => cmdSetPause(id, false));
  }

  async pause(): Promise<void> {
    if (!this.running) return;
    await this.send((id) => cmdSetPause(id, true));
  }

  async seek(sec: number): Promise<void> {
    if (!this.running) return;
    await this.send((id) => cmdSeekAbs(id, sec));
  }

  /** Set the playback volume (0..1). ALWAYS caches the value so a (re)spawn
   *  applies it (see doStart); sends to mpv immediately only when running. A
   *  restore-time call before the lazy spawn therefore caches instead of being
   *  lost — no throw when mpv isn't running. */
  async setVolume(v01: number): Promise<void> {
    this.cachedVolume = v01;
    if (!this.running) return;
    await this.send((id) => cmdSetVolume(id, v01));
  }

  /** Cache the desired audio config and apply it now if mpv is running. The
   *  cached config is re-applied on every (re)spawn (see doStart), so a lazy
   *  start or post-crash respawn comes up with the right filters. Rejects if
   *  mpv refuses a property set (the caller surfaces that — no silent drop);
   *  the cache rolls back on rejection so respawns never retry a config the
   *  caller was told failed. */
  async applyAudioConfig(cfg: AudioConfig): Promise<void> {
    const prev = this.audioConfig;
    this.audioConfig = cfg;
    if (!this.running) return;
    try {
      await this.sendAudioConfig();
    } catch (err) {
      this.audioConfig = prev;
      throw err;
    }
  }

  private async sendAudioConfig(): Promise<void> {
    await this.send((id) => cmdSetReplaygain(id, this.audioConfig.replaygain));
    await this.send((id) => cmdSetAf(id, this.audioConfig.af));
  }

  private onChildExit(child: ChildProcess): void {
    if (this.child !== child) return; // a stale process from before a respawn
    if (this.disposed) return; // expected during dispose()
    this.teardownState(new Error("mpv exited unexpectedly"));
    this.sink?.({ type: "error", message: "mpv exited unexpectedly" });
  }

  /** Clear running state and fail everything in flight. */
  private teardownState(reason: Error): void {
    this.running = false;
    this.socket?.destroy();
    this.socket = null;
    this.child = null;
    for (const req of this.pending.values()) req.reject(reason);
    this.pending.clear();
    if (this.loadWaiter) {
      const waiter = this.loadWaiter;
      this.loadWaiter = null;
      waiter.reject(reason);
    }
  }

  /** Quit mpv and release everything. Terminal — the controller cannot be
   *  restarted after dispose (it lives exactly as long as the app). */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    const child = this.child;
    const socket = this.socket;
    if (socket && this.running) {
      try {
        socket.write(encodeLine(cmdQuit(this.nextRequestId++)));
      } catch (err) {
        // Best-effort polite quit; the kill() below is the real teardown.
        console.error("[musex mpv] quit write failed:", err);
      }
    }
    if (child && child.exitCode === null) {
      await delay(QUIT_GRACE_MS); // give the polite quit a moment
      if (child.exitCode === null && !child.killed) child.kill();
    }
    this.teardownState(new Error("MpvController disposed"));
    // force:true ignores a missing socket file (mpv may have removed it on quit).
    await rm(this.paths.socketPath, { force: true });
  }
}
