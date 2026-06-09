import type { PlaybackEngine, StreamRef } from "@musex/core";
import Hls from "hls.js";

type Cb0 = () => void;

/**
 * Web playback engine.
 *
 * Direct-play uses raw HTML5 `<audio>`: setting `src` + `play()` streams
 * progressively and starts on the first buffered chunk (instant start), is
 * browser-managed and reliable, and plays straight from the proxy/disk cache.
 * A second `<audio>` element buffers the *next* track ahead of time so the
 * transition is near-gapless (a tiny gap is possible — not sample-accurate).
 *
 * Transcoded tracks use hls.js attached to the same active element.
 *
 * Only the active (`current`) element drives the callbacks; the other element
 * is purely a look-ahead buffer, so its events are ignored until we swap to it.
 */
export class WebPlaybackEngine implements PlaybackEngine {
  private current: HTMLAudioElement;
  private next: HTMLAudioElement;
  private nextReady = false; // `next` holds a preloaded direct src
  private hls: Hls | null = null;
  private mode: "direct" | "hls" = "direct";

  private positionCb: (s: number) => void = () => {};
  private advancedCb: Cb0 = () => {};
  private endedCb: Cb0 = () => {};
  private errorCb: (e: Error) => void = () => {};
  private volume = 1;

  constructor() {
    this.current = new Audio();
    this.next = new Audio();
    this.wire(this.current);
    this.wire(this.next);
  }

  private wire(el: HTMLAudioElement): void {
    el.preload = "auto";
    el.volume = this.volume;
    el.addEventListener("timeupdate", () => {
      if (el === this.current) this.positionCb(el.currentTime);
    });
    el.addEventListener("ended", () => {
      if (el === this.current) this.handleCurrentEnded();
    });
    el.addEventListener("error", () => {
      if (el === this.current && el.currentSrc) {
        this.errorCb(new Error(`audio error (code ${el.error?.code ?? "?"})`));
      }
    });
  }

  // --- core PlaybackEngine ---

  async load(ref: StreamRef): Promise<void> {
    if (ref.kind === "direct") {
      this.teardownHls();
      this.mode = "direct";
      this.clearNext();
      this.current.src = ref.url;
      void this.current.play(); // progressive — starts as the stream buffers
    } else {
      this.mode = "hls";
      this.current.pause();
      this.clearNext();
      await this.loadHls(ref.url);
    }
  }

  async preload(ref: StreamRef): Promise<void> {
    // Buffer the next direct track ahead for a near-gapless swap.
    if (ref.kind === "direct" && this.mode === "direct") {
      this.next.src = ref.url;
      this.next.load();
      this.nextReady = true;
    }
    // HLS next-tracks aren't preloaded; the session's onEnded fallback load()s them.
  }

  play(): void {
    void this.current.play();
  }

  pause(): void {
    this.current.pause();
  }

  seek(seconds: number): void {
    this.current.currentTime = seconds;
  }

  setVolume(v: number): void {
    this.volume = v;
    this.current.volume = v;
    this.next.volume = v;
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

  // --- internals ---

  private handleCurrentEnded(): void {
    if (this.mode === "hls") {
      this.endedCb();
      return;
    }
    if (this.nextReady) {
      // Swap to the preloaded element for a near-gapless transition.
      const finished = this.current;
      this.current = this.next;
      this.next = finished;
      this.nextReady = false;
      this.clearNext(); // reset the just-finished element (now the look-ahead buffer)
      this.current.volume = this.volume;
      void this.current.play();
      this.advancedCb(); // session advances its index + preloads the new next
    } else {
      this.endedCb();
    }
  }

  private clearNext(): void {
    this.nextReady = false;
    this.next.pause();
    this.next.removeAttribute("src");
    this.next.load(); // abandon any buffered data
  }

  // --- hls.js (transcode) ---

  private async loadHls(url: string): Promise<void> {
    this.teardownHls();
    const hls = new Hls({ enableWorker: true });
    this.hls = hls;
    await new Promise<void>((resolve, reject) => {
      hls.on(Hls.Events.MANIFEST_PARSED, () => resolve());
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) reject(new Error(`hls: ${data.details}`));
      });
      hls.attachMedia(this.current);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(url));
    }).catch((e: Error) => this.errorCb(e));
    void this.current.play();
  }

  private teardownHls(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
  }
}
