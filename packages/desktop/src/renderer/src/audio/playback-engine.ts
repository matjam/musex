import type { PlaybackEngine, StreamRef } from "@musex/core";
import { Gapless5 } from "@regosen/gapless-5";
import Hls from "hls.js";

type Cb0 = () => void;

/** Mask long hex runs (the proxy's per-launch secret + server id) in debug logs
 *  so the secret never reaches the console / a pasted log. Keeps the track path
 *  (e.g. /library/parts/12345/…) visible for diagnostics. */
function scrub(s: string): string {
  return s.replace(/[0-9a-f]{32,}/gi, "<redacted>");
}

/** If a freshly-loaded direct track produces no audio progress within this
 *  window, the play watchdog re-issues the load (recovering from silent HTML5
 *  stalls). */
const PLAY_WATCHDOG_MS = 3000;
const MAX_PLAY_RETRIES = 2;

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

  // Play watchdog state (direct tracks only).
  private currentRef: StreamRef | null = null;
  /** True once the current track has actually produced audio progress. */
  private progressed = false;
  private watchdog: ReturnType<typeof setTimeout> | null = null;
  private retries = 0;

  // --- core PlaybackEngine ---

  async load(ref: StreamRef): Promise<void> {
    console.log("[musex-debug] engine.load", ref.kind, scrub(ref.url));
    this.currentRef = ref;
    this.retries = 0;
    if (ref.kind === "direct") {
      this.teardownHls();
      this.mode = "direct";
      this.playDirect(ref.url);
      this.armWatchdog();
    } else {
      this.clearWatchdog();
      this.teardownGaplessPlayback();
      await this.loadHls(ref.url);
      this.mode = "hls";
    }
  }

  /** (Re)load a direct track into gapless and play from the start. */
  private playDirect(url: string): void {
    const g = this.ensureGapless();
    g.removeAllTracks();
    g.addTrack(url);
    g.gotoTrack(0, true);
  }

  async preload(ref: StreamRef): Promise<void> {
    console.log(
      "[musex-debug] engine.preload",
      ref.kind,
      this.mode,
      this.gapless?.getTracks?.().length ?? "n/a",
      scrub(ref.url),
    );
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
    this.clearWatchdog(); // intentional non-progress — don't let the watchdog retry
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
      // HTML5-only: progressive playback starts as soon as the stream begins
      // buffering (instant start), is browser-managed and reliable, and benefits
      // from the prefetch/disk cache. The Web Audio path was disabled because it
      // fully downloads + decodes each file before playing — slow over the network
      // and destabilizing when a load stalls. Trade-off: transitions are
      // near-gapless (a tiny gap is possible) rather than sample-accurate.
      // loadLimit caps concurrency to current + next.
      useWebAudio: false,
      useHTML5Audio: true,
      loadLimit: 2,
      volume: this.volume,
    });
    // ontimeupdate receives (current_track_time_ms, current_track_index) — we only need the first
    g.ontimeupdate = (ms: number, _index: number) => {
      // Real audio progress -> the track actually started; cancel the watchdog.
      if (ms > 200) {
        this.progressed = true;
        this.clearWatchdog();
      }
      this.positionCb(ms / 1000);
    };
    // onnext fires on gapless auto-advance into the preloaded track -> tell the session
    // receives (from_track, to_track) — we don't need either
    g.onnext = (from: string, to: string) => {
      console.log("[musex-debug] gapless onnext", scrub(from), "->", scrub(to));
      this.advancedCb();
    };
    // onfinishedall fires only at the true end of the gapless list
    g.onfinishedall = () => {
      console.log("[musex-debug] gapless onfinishedall");
      this.endedCb();
    };
    g.onerror = (path: string, err?: Error | string) => {
      console.log("[musex-debug] gapless onerror", scrub(path), scrub(String(err ?? "")));
      this.errorCb(err instanceof Error ? err : new Error(String(err ?? "audio error")));
    };
    this.gapless = g;
    return g;
  }

  // --- play watchdog: recover from a silent HTML5 stall ---
  // Occasionally an HTML5 audio load stalls and never starts, with no 'error'
  // event. If a freshly-loaded direct track produces no audio progress within
  // the window, re-issue the load — which re-requests through the proxy (served
  // from the disk cache if present, else downloaded). Give up after a few tries
  // and surface an error so the session leaves the stuck state.

  private armWatchdog(): void {
    this.clearWatchdog();
    this.progressed = false;
    this.watchdog = setTimeout(() => this.onWatchdog(), PLAY_WATCHDOG_MS);
  }

  private clearWatchdog(): void {
    if (this.watchdog !== null) {
      clearTimeout(this.watchdog);
      this.watchdog = null;
    }
  }

  private onWatchdog(): void {
    this.watchdog = null;
    if (this.progressed || this.mode !== "direct" || !this.currentRef) return;
    if (this.retries >= MAX_PLAY_RETRIES) {
      console.log("[musex-debug] watchdog gave up", scrub(this.currentRef.url));
      this.errorCb(new Error("Track failed to start playing"));
      return;
    }
    this.retries += 1;
    console.log("[musex-debug] watchdog retry", this.retries, scrub(this.currentRef.url));
    this.playDirect(this.currentRef.url); // re-request via the proxy (cache or download)
    this.armWatchdog();
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
