import type { TrackInfo } from "@musex/plugin-api";

/** Position deltas larger than this (seconds) are treated as seeks, not playback. */
const MAX_PLAY_DELTA_SEC = 2;
/** last.fm rule: tracks of 30s or less never scrobble. */
const MIN_DURATION_MS = 30_000;
/** last.fm rule: 4 minutes of play always scrobbles (if the duration floor passes). */
const ALWAYS_SCROBBLE_SEC = 240;

/**
 * Pure scrobble gate (no timers — callers supply epoch seconds). Tracks how
 * much of one play-through was *actually heard*: position deltas accumulate
 * only while playing and only when small enough to be continuous playback
 * (bigger or negative = seek — ignored, but the cursor still advances so the
 * next delta is measured from the post-seek position).
 *
 * `finish()` applies the last.fm rule once per `start()`:
 * durationMs > 30s AND (played ≥ half the duration OR played ≥ 4 minutes).
 */
export class ScrobbleGate {
  private track: TrackInfo | null = null;
  private startedAtEpochSec = 0;
  private accumulatedSec = 0;
  private lastSec: number | null = null;
  private playing = false;
  private finished = false;

  /** Begin a play-through; resets all state from any previous one. */
  start(track: TrackInfo, atEpochSec: number): void {
    this.track = track;
    this.startedAtEpochSec = atEpochSec;
    this.accumulatedSec = 0;
    this.lastSec = null;
    this.playing = true;
    this.finished = false;
  }

  /** Absolute engine position. Positions keep arriving while paused (mpv emits
   *  on seek) — those only move the cursor, they never accumulate. */
  position(sec: number): void {
    if (!this.track) return;
    const last = this.lastSec;
    this.lastSec = sec;
    if (last === null || !this.playing) return;
    const delta = sec - last;
    if (delta > 0 && delta <= MAX_PLAY_DELTA_SEC) this.accumulatedSec += delta;
  }

  pause(): void {
    this.playing = false;
  }

  resume(): void {
    this.playing = true;
  }

  /** Played time accumulated so far (for trackEnded payloads). */
  playedSec(): number {
    return this.accumulatedSec;
  }

  /** End of play-through (track change/stop). Returns the scrobble payload at
   *  most once per start() — and only if the last.fm rule passes. */
  finish(): { track: TrackInfo; startedAtEpochSec: number } | null {
    if (!this.track || this.finished) return null;
    this.finished = true;
    const passes =
      this.track.durationMs > MIN_DURATION_MS &&
      (this.accumulatedSec >= this.track.durationMs / 2000 ||
        this.accumulatedSec >= ALWAYS_SCROBBLE_SEC);
    return passes ? { track: this.track, startedAtEpochSec: this.startedAtEpochSec } : null;
  }
}
