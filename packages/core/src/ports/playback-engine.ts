import type { StreamRef } from "./stream-resolver";

/** Audio output. Implemented in the renderer (Gapless-5 / hls.js). The session
 *  drives it and consumes its events; it performs no queue logic itself.
 *
 *  Gapless contract: after `preload(next)`, when the current track finishes the
 *  engine SHOULD seamlessly continue into the preloaded track. Today the session
 *  is notified via `onEnded` and reloads the next track (the fallback path). The
 *  precise gapless auto-advance signal (so the adapter does NOT restart an
 *  already-playing preloaded track) is finalized with the Gapless-5 adapter.
 *  TODO(Plan B): verify Gapless-5's event API and add an explicit advance signal. */
export interface PlaybackEngine {
  load(ref: StreamRef): Promise<void>;
  /** Buffer the next track ahead of time so the transition is gapless. */
  preload(ref: StreamRef): Promise<void>;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  onPosition(cb: (seconds: number) => void): void;
  onEnded(cb: () => void): void;
  onError(cb: (err: Error) => void): void;
}
