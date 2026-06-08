import type { PlaybackEngine, StreamRef } from "@musex/core";
import { Gapless5 } from "@regosen/gapless-5";
import Hls from "hls.js";

type Cb0 = () => void;

export class WebPlaybackEngine implements PlaybackEngine {
  private gapless: Gapless5 | null = null;
  private audio: HTMLAudioElement | null = null;
  private hls: Hls | null = null;
  private mode: "direct" | "hls" | null = null;

  private positionCb: (s: number) => void = () => {};
  private advancedCb: Cb0 = () => {};
  private endedCb: Cb0 = () => {};
  private errorCb: (e: Error) => void = () => {};
  private volume = 1;

  // --- core PlaybackEngine ---

  async load(ref: StreamRef): Promise<void> {
    if (ref.kind === "direct") {
      this.teardownHls();
      const g = this.ensureGapless();
      g.removeAllTracks();
      g.addTrack(ref.url);
      g.gotoTrack(0, true); // play from start
      this.mode = "direct";
    } else {
      this.teardownGaplessPlayback();
      await this.loadHls(ref.url);
      this.mode = "hls";
    }
  }

  async preload(ref: StreamRef): Promise<void> {
    // Gapless only applies to direct tracks queued behind a direct current track.
    if (ref.kind === "direct" && this.mode === "direct" && this.gapless) {
      this.gapless.addTrack(ref.url); // buffered ahead; loadLimit bounds memory
    }
    // For hls next-tracks there is no gapless preload; the session's onEnded
    // fallback will load() the next track when the current one finishes.
  }

  play(): void {
    if (this.mode === "hls") void this.audio?.play();
    else this.gapless?.play();
  }
  pause(): void {
    if (this.mode === "hls") this.audio?.pause();
    else this.gapless?.pause();
  }
  seek(seconds: number): void {
    if (this.mode === "hls") {
      if (this.audio) this.audio.currentTime = seconds;
    } else {
      this.gapless?.setPosition(seconds * 1000); // gapless-5 uses ms
    }
  }
  setVolume(v: number): void {
    this.volume = v;
    this.gapless?.setVolume(v);
    if (this.audio) this.audio.volume = v;
  }

  onPosition(cb: (s: number) => void): void {
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

  // --- gapless-5 wiring ---

  private ensureGapless(): Gapless5 {
    if (this.gapless) return this.gapless;
    const g = new Gapless5({
      // HTML5 audio gives instant progressive start within the user-activation
      // window now that the proxy streams progressively (no buffering). Web Audio
      // handles gapless crossfades. loadLimit caps concurrency to current + next.
      useWebAudio: true,
      useHTML5Audio: true,
      loadLimit: 2,
      volume: this.volume,
    });
    // ontimeupdate receives (current_track_time_ms, current_track_index) — we only need the first
    g.ontimeupdate = (ms: number, _index: number) => this.positionCb(ms / 1000);
    // onnext fires on gapless auto-advance into the preloaded track -> tell the session
    // receives (from_track, to_track) — we don't need either
    g.onnext = (_from: string, _to: string) => this.advancedCb();
    // onfinishedall fires only at the true end of the gapless list
    g.onfinishedall = () => this.endedCb();
    g.onerror = (_path: string, err?: Error | string) =>
      this.errorCb(err instanceof Error ? err : new Error(String(err ?? "audio error")));
    this.gapless = g;
    return g;
  }

  // --- hls.js wiring ---

  private async loadHls(url: string): Promise<void> {
    const audio = this.ensureAudio();
    const hls = new Hls({ enableWorker: true });
    this.hls = hls;
    await new Promise<void>((resolve, reject) => {
      hls.on(Hls.Events.MANIFEST_PARSED, () => resolve());
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) reject(new Error(`hls: ${data.details}`));
      });
      hls.attachMedia(audio);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(url));
    }).catch((e: Error) => this.errorCb(e));
    void audio.play();
  }

  private ensureAudio(): HTMLAudioElement {
    if (this.audio) return this.audio;
    const a = new Audio();
    a.volume = this.volume;
    a.addEventListener("timeupdate", () => this.positionCb(a.currentTime));
    a.addEventListener("ended", () => this.endedCb());
    a.addEventListener("error", () => this.errorCb(new Error("audio element error")));
    this.audio = a;
    return a;
  }

  private teardownHls(): void {
    this.hls?.destroy();
    this.hls = null;
    this.audio?.pause();
  }
  private teardownGaplessPlayback(): void {
    this.gapless?.stop();
  }
}
