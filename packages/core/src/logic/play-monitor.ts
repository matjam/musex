import type { PlaybackState } from "../playback/playback-session.js";

export type PlayKind = "full" | "skip" | "partial";

const SCROBBLE_ABS_SEC = 240;
const SCROBBLE_FRACTION = 0.5;
const SKIP_MAX_SEC = 60;
const SKIP_MAX_FRACTION = 0.25;
const MAX_CONTINUOUS_DELTA = 2;

/** Classify a finished play from effective listening seconds + track duration.
 *  "full" = listened past min(240s, half); "skip" = under 60s AND under 25%;
 *  otherwise "partial". Unknown duration (<=0) uses the absolute thresholds. */
export function classifyPlay(playedSec: number, durationSec: number): PlayKind {
  const scrobbleAt =
    durationSec > 0 ? Math.min(SCROBBLE_ABS_SEC, durationSec * SCROBBLE_FRACTION) : SCROBBLE_ABS_SEC;
  if (playedSec >= scrobbleAt) return "full";
  const skipFrac = durationSec > 0 ? durationSec * SKIP_MAX_FRACTION : Number.POSITIVE_INFINITY;
  if (playedSec < SKIP_MAX_SEC && playedSec < skipFrac) return "skip";
  return "partial";
}

/** Folds position updates into effective listening seconds, ignoring seeks
 *  (a jump > 2s) and pauses. Pure; the host feeds it position ticks. */
export class PlayTracker {
  private durationSec = 0;
  private accumulated = 0;
  private lastPos: number | null = null;

  start(durationSec: number): void {
    this.durationSec = durationSec;
    this.accumulated = 0;
    this.lastPos = null;
  }

  update(positionSec: number, playing: boolean): void {
    if (this.lastPos !== null && playing) {
      const delta = positionSec - this.lastPos;
      if (delta > 0 && delta <= MAX_CONTINUOUS_DELTA) this.accumulated += delta;
    }
    this.lastPos = positionSec;
  }

  playedSec(): number {
    return this.accumulated;
  }

  finish(): PlayKind {
    return classifyPlay(this.accumulated, this.durationSec);
  }
}

export interface CompletedPlay {
  title: string;
  artistName: string;
  kind: PlayKind;
}

/** Consumes a stream of PlaybackState and emits a CompletedPlay when a track's
 *  play-through ends — by track change, stop, or natural end of the final
 *  track. Records each track at most once (guards double-count when auto-advance
 *  follows a natural end). Pure; the host calls onState in its subscribe loop
 *  and forwards any returned event to TasteProfile.recordPlay. */
export class PlayMonitor {
  private tracker = new PlayTracker();
  private currentId: string | null = null;
  private currentInfo: { title: string; artistName: string } | null = null;
  private recorded = false;

  onState(s: PlaybackState): CompletedPlay | null {
    const cur = s.queue ? s.queue.tracks[s.queue.index] : undefined;

    if (!cur || cur.id !== this.currentId) {
      const completed = this.flush();
      if (cur) {
        this.tracker.start(cur.durationMs / 1000);
        this.currentId = cur.id;
        this.currentInfo = { title: cur.title, artistName: cur.artistName };
        this.recorded = false;
        this.tracker.update(s.positionSec, s.status === "playing");
      } else {
        this.reset();
      }
      return completed;
    }

    if (s.status === "ended" && !this.recorded) {
      this.recorded = true;
      return this.currentInfo ? { ...this.currentInfo, kind: this.tracker.finish() } : null;
    }

    this.tracker.update(s.positionSec, s.status === "playing");
    return null;
  }

  private flush(): CompletedPlay | null {
    if (this.currentInfo && !this.recorded) {
      return { ...this.currentInfo, kind: this.tracker.finish() };
    }
    return null;
  }

  private reset(): void {
    this.currentId = null;
    this.currentInfo = null;
    this.recorded = false;
  }
}
