import type { PluginEvents, TrackInfo } from "@musex/plugin-api";
import { ScrobbleGate } from "../../logic/scrobble-gate.js";
import type { NowPlayingMsg } from "../../shared/ipc-contract.js";

/** Most-recent-first recently-played cap (backs ctx.library.recentlyPlayed). */
const HISTORY_MAX = 50;
/** Early skip = heard less than this many seconds… */
const SKIP_MAX_SEC = 60;
/** …AND less than this fraction of the track. */
const SKIP_MAX_FRACTION = 0.25;

export type PlayKind = "full" | "skip" | "partial";

export interface PlaybackMonitorDeps {
  /** Host fan-out (PluginHost.emitEvent) — per-subscriber try/catch lives
   *  THERE; the monitor just emits. */
  emit: (event: keyof PluginEvents, payload: PluginEvents[keyof PluginEvents]) => void;
  /** Persistence-backed so the history survives restarts. */
  loadHistory: () => TrackInfo[];
  saveHistory: (h: TrackInfo[]) => void;
  /** Taste-profile feed, classified at the end of each play-through: full =
   *  the scrobble gate passed; skip = early skip; partial = everything else. */
  recordPlay: (track: TrackInfo, kind: PlayKind) => void;
}

/**
 * Electron-free playback monitor: combines the renderer's now-playing
 * transitions with the mpv engine's position ticks (forwarded from the sink in
 * main/index.ts) to drive the plugin events pipeline — trackStarted / paused /
 * resumed / trackEnded / scrobble — and the recently-played history.
 */
export class PlaybackMonitor {
  private readonly gate = new ScrobbleGate();
  private current: TrackInfo | null = null;
  private recentlyPlayed: TrackInfo[];

  constructor(private readonly deps: PlaybackMonitorDeps) {
    this.recentlyPlayed = deps.loadHistory();
  }

  handleNowPlaying(msg: NowPlayingMsg): void {
    switch (msg.kind) {
      case "start":
        this.finishCurrent(); // close the previous play-through first
        this.current = msg.track;
        this.gate.start(msg.track, msg.atEpochSec);
        this.deps.emit("trackStarted", { track: msg.track, startedAtEpochSec: msg.atEpochSec });
        this.pushHistory(msg.track);
        break;
      case "pause":
        if (!this.current) return;
        this.gate.pause();
        this.deps.emit("paused", { track: this.current });
        break;
      case "resume":
        if (!this.current) return;
        this.gate.resume();
        this.deps.emit("resumed", { track: this.current });
        break;
      case "stop":
        this.finishCurrent();
        this.current = null;
        break;
    }
  }

  /** Absolute mpv position, forwarded from the engine sink. */
  handleEnginePosition(sec: number): void {
    this.gate.position(sec);
  }

  /** Most recent first, capped at 50. */
  history(limit?: number): TrackInfo[] {
    const n = limit === undefined ? this.recentlyPlayed.length : Math.max(0, limit);
    return this.recentlyPlayed.slice(0, n);
  }

  /** End the current play-through: scrobble (if the gate passes), feed the
   *  taste profile, then trackEnded. */
  private finishCurrent(): void {
    if (!this.current) return;
    const playedSec = this.gate.playedSec();
    const scrobble = this.gate.finish();
    if (scrobble) this.deps.emit("scrobble", scrobble);
    this.deps.recordPlay(this.current, classifyPlay(playedSec, this.current, scrobble !== null));
    this.deps.emit("trackEnded", { track: this.current, playedSec });
  }

  private pushHistory(track: TrackInfo): void {
    const head = this.recentlyPlayed[0];
    // Dedupe consecutive identical plays (repeat-one would flood the history).
    if (head && head.title === track.title && head.artistName === track.artistName) return;
    this.recentlyPlayed = [track, ...this.recentlyPlayed].slice(0, HISTORY_MAX);
    this.deps.saveHistory(this.recentlyPlayed);
  }
}

/** full = scrobbled; skip = <60s heard AND <25% of the track; else partial. */
function classifyPlay(playedSec: number, track: TrackInfo, scrobbled: boolean): PlayKind {
  if (scrobbled) return "full";
  const isSkip =
    playedSec < SKIP_MAX_SEC && playedSec < SKIP_MAX_FRACTION * (track.durationMs / 1000);
  return isSkip ? "skip" : "partial";
}
