import type { PlaybackEngine, StreamRef } from "@musex/core";
import {
  type AudioMetadata,
  type AudioPlayer,
  type AudioStatus,
  createAudioPlayer,
  setAudioModeAsync,
} from "expo-audio";

const POSITION_UPDATE_MS = 250;
const LOAD_TIMEOUT_MS = 30000;

type NowPlayingMeta = { title: string; artist: string; album?: string; artwork?: string };

/** PlaybackEngine over expo-audio (AVPlayer on iOS). A fresh AudioPlayer is
 *  created per load() and the previous one disposed; one status listener fans
 *  out to the core callbacks. preload() is a no-op — gapless is deferred to a
 *  later phase, so every track end is a true stop reported via onEnded, and the
 *  session drives the queue with next(). */
export class ExpoAudioEngine implements PlaybackEngine {
  private player: AudioPlayer | null = null;
  private sub: { remove: () => void } | null = null;

  private positionCb: ((seconds: number) => void) | null = null;
  private endedCb: (() => void) | null = null;
  private errorCb: ((err: Error) => void) | null = null;

  private lastEnded = false;
  private lockScreenActive = false;
  // Cached now-playing metadata. The store pushes this on track change, which
  // fires DURING the "loading" patch — before load() has created the new
  // player. We stash it and apply it once the new player is loaded.
  private pendingMeta: NowPlayingMeta | null = null;

  /** Must be awaited once before first playback (sets the iOS audio session so
   *  audio plays even when the ringer is silent). Call from app bootstrap. */
  async init(): Promise<void> {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "doNotMix",
    });
  }

  async load(ref: StreamRef): Promise<void> {
    this.teardownPlayer();
    this.lastEnded = false;
    const player = createAudioPlayer({ uri: ref.url }, { updateInterval: POSITION_UPDATE_MS });
    this.player = player;
    this.sub = player.addListener("playbackStatusUpdate", (status: AudioStatus) => {
      this.onStatus(status);
    });
    // expo-audio loads asynchronously; resolve when isLoaded flips true (or error).
    await this.waitUntilLoaded(player);
    // Apply any metadata the store pushed before this player existed, so the
    // lock-screen / Control Center widget shows for the now-loaded track.
    this.applyNowPlaying();
  }

  preload(_ref: StreamRef): Promise<void> {
    // Gapless deferred (Phase 1): no-op keeps the port satisfied.
    return Promise.resolve();
  }

  play(): void {
    this.player?.play();
  }

  pause(): void {
    this.player?.pause();
  }

  seek(seconds: number): void {
    void this.player?.seekTo(seconds);
  }

  setVolume(volume: number): void {
    if (this.player) this.player.volume = Math.max(0, Math.min(1, volume));
  }

  onPosition(cb: (seconds: number) => void): void {
    this.positionCb = cb;
  }

  onAdvanced(_cb: () => void): void {
    // Gapless deferred (Phase 1): this engine never auto-continues into a
    // preloaded track, so onAdvanced never fires. The session finalizes every
    // track end through onEnded -> next(). Registration is intentionally a no-op.
  }

  onEnded(cb: () => void): void {
    this.endedCb = cb;
  }

  onError(cb: (err: Error) => void): void {
    this.errorCb = cb;
  }

  /** Mobile-only: push now-playing metadata to the lock screen / Control Center.
   *  Called by the store on track change. Caches the metadata and applies it
   *  now if a player is loaded; otherwise load() applies it once the new player
   *  is ready (the store pushes during "loading", before the player exists). */
  setNowPlaying(meta: NowPlayingMeta): void {
    this.pendingMeta = meta;
    if (this.player?.isLoaded) this.applyNowPlaying();
  }

  /** Applies the cached now-playing metadata to the current player's lock
   *  screen. Note: AudioMetadata uses `albumTitle` (not `album`) and
   *  `artworkUrl` (a plain string, not `{ uri }`), per the installed typings. */
  private applyNowPlaying(): void {
    const player = this.player;
    const meta = this.pendingMeta;
    if (!player || !meta) return;
    const md: AudioMetadata = {
      title: meta.title,
      artist: meta.artist,
      albumTitle: meta.album,
      artworkUrl: meta.artwork,
    };
    try {
      if (this.lockScreenActive) {
        player.updateLockScreenMetadata(md);
      } else {
        player.setActiveForLockScreen(true, md);
        this.lockScreenActive = true;
      }
    } catch {
      // lock screen optional; never break playback over it
    }
  }

  dispose(): void {
    try {
      this.player?.clearLockScreenControls();
    } catch {
      // ignore
    }
    this.teardownPlayer();
  }

  private onStatus(status: AudioStatus): void {
    if (typeof status.currentTime === "number") this.positionCb?.(status.currentTime);
    if (status.didJustFinish && !this.lastEnded) {
      this.lastEnded = true;
      this.endedCb?.();
    }
  }

  private waitUntilLoaded(player: AudioPlayer): Promise<void> {
    if (player.isLoaded) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const sub = player.addListener("playbackStatusUpdate", (status: AudioStatus) => {
        if (status.isLoaded) {
          sub.remove();
          resolve();
        }
      });
      // Safety timeout so a dead URL doesn't hang the session forever.
      setTimeout(() => {
        sub.remove();
        if (!player.isLoaded) {
          const err = new Error("audio load timed out");
          this.errorCb?.(err);
          reject(err);
        }
      }, LOAD_TIMEOUT_MS);
    });
  }

  private teardownPlayer(): void {
    this.sub?.remove();
    this.sub = null;
    // Pause BEFORE remove: expo-audio's remove() doesn't reliably halt the
    // native player synchronously, so a rapid next-load otherwise overlaps.
    try {
      this.player?.pause();
    } catch {
      // player may already be released; ignore
    }
    this.player?.remove();
    this.player = null;
    this.lockScreenActive = false;
  }
}
