import type { StreamRef } from "./stream-resolver";

/** Audio output. Implemented in the renderer (Gapless-5 / hls.js). The session
 *  drives it and consumes its events; it performs no queue logic itself. */
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
