import type { PlaybackEngine, StreamRef } from "@musex/core";

type Cb0 = () => void;

/**
 * PlaybackEngine adapter that forwards every port call over IPC to the
 * main-process MpvController (vendored mpv binary) and re-emits the pushed
 * engine events. No audio runs in the renderer.
 *
 * Contract parity: `load()` is prepare-only — mpv loads paused (`pause:"yes"`)
 * and main resolves the call on mpv's `file-loaded`, so a `seek()` issued right
 * after `load()` (PlaybackSession.restore) always lands.
 */
export class IpcPlaybackEngine implements PlaybackEngine {
  private positionCb: (s: number) => void = () => {};
  private advancedCb: Cb0 = () => {};
  private endedCb: Cb0 = () => {};
  private errorCb: (e: Error) => void = () => {};

  constructor() {
    window.musex.onPlaybackEvent((e) => {
      switch (e.type) {
        case "position":
          this.positionCb(e.sec);
          break;
        case "advanced":
          this.advancedCb();
          break;
        case "ended":
          this.endedCb();
          break;
        case "error":
          this.errorCb(new Error(e.message));
          break;
      }
    });
  }

  async load(ref: StreamRef): Promise<void> {
    await window.musex.playbackLoad({ url: ref.url });
  }

  async preload(ref: StreamRef): Promise<void> {
    await window.musex.playbackPreload(ref.url);
  }

  play(): void {
    void window.musex.playbackPlay();
  }

  pause(): void {
    void window.musex.playbackPause();
  }

  seek(seconds: number): void {
    void window.musex.playbackSeek(seconds);
  }

  setVolume(volume: number): void {
    void window.musex.playbackSetVolume(volume);
  }

  onPosition(cb: (seconds: number) => void): void {
    this.positionCb = cb;
  }
  onAdvanced(cb: Cb0): void {
    this.advancedCb = cb;
  }
  onEnded(cb: Cb0): void {
    this.endedCb = cb;
  }
  onError(cb: (e: Error) => void): void {
    this.errorCb = cb;
  }
}
