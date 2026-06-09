import type { StreamRef } from "./stream-resolver";

/** Audio output. Implemented per surface (desktop: renderer IpcPlaybackEngine
 *  bridging to an mpv process in main). The session drives it and consumes its
 *  events; it performs no queue logic itself.
 *
 *  Gapless contract: when the current track ends and a track was `preload`ed,
 *  the engine seamlessly continues into it and fires `onAdvanced` (NOT
 *  `onEnded`). `onEnded` fires only when playback fully stops with nothing
 *  buffered to continue (true end of content). Manual skips go through
 *  `load()` (teardown + reload; a tiny gap is acceptable). */
export interface PlaybackEngine {
  /** Prepare a track for playback. `load()` does NOT start playback — it only
   *  prepares the track; the caller must call `play()` to start. */
  load(ref: StreamRef): Promise<void>;
  preload(ref: StreamRef): Promise<void>;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  onPosition(cb: (seconds: number) => void): void;
  onAdvanced(cb: () => void): void;
  onEnded(cb: () => void): void;
  onError(cb: (err: Error) => void): void;
}
