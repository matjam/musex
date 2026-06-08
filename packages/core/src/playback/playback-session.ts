import type { Queue } from "../models/index";
import type { PlaybackEngine } from "../ports/playback-engine";
import type { StreamResolver } from "../ports/stream-resolver";

export type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

export interface PlaybackState {
  queue: Queue | null;
  status: PlaybackStatus;
  positionSec: number;
  durationSec: number;
  volume: number;
  error: string | null;
}

const INITIAL_STATE: PlaybackState = {
  queue: null,
  status: "idle",
  positionSec: 0,
  durationSec: 0,
  volume: 1,
  error: null,
};

export class PlaybackSession {
  private state: PlaybackState = INITIAL_STATE;
  private readonly listeners = new Set<(s: PlaybackState) => void>();
  private preloadedIndex: number | null = null;

  constructor(
    private readonly engine: PlaybackEngine,
    private readonly resolver: StreamResolver,
  ) {
    this.engine.onPosition((sec) => this.patch({ positionSec: sec }));
    this.engine.onEnded(() => {
      void this.handleEnded();
    });
    this.engine.onError((err) => this.patch({ status: "error", error: err.message }));
  }

  getState(): PlaybackState {
    return this.state;
  }

  subscribe(cb: (s: PlaybackState) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  async loadQueue(queue: Queue): Promise<void> {
    this.patch({ queue, error: null });
    await this.playIndex(queue.index);
  }

  async playIndex(index: number): Promise<void> {
    const queue = this.state.queue;
    if (!queue) return;
    const track = queue.tracks[index];
    if (!track) return;

    this.preloadedIndex = null;
    this.patch({ queue: { ...queue, index }, status: "loading", positionSec: 0 });
    const ref = await this.resolver.resolve(track);
    await this.engine.load(ref);
    this.engine.play();
    this.patch({ status: "playing", durationSec: track.durationMs / 1000 });
    await this.preloadNext();
  }

  play(): void {
    if (!this.state.queue) return;
    this.engine.play();
    this.patch({ status: "playing" });
  }

  pause(): void {
    this.engine.pause();
    this.patch({ status: "paused" });
  }

  async next(): Promise<void> {
    const queue = this.state.queue;
    if (queue) await this.playIndex(queue.index + 1);
  }

  async previous(): Promise<void> {
    const queue = this.state.queue;
    if (queue) await this.playIndex(queue.index - 1);
  }

  seek(seconds: number): void {
    this.engine.seek(seconds);
    this.patch({ positionSec: seconds });
  }

  setVolume(volume: number): void {
    this.engine.setVolume(volume);
    this.patch({ volume });
  }

  private async preloadNext(): Promise<void> {
    const queue = this.state.queue;
    if (!queue) return;
    const nextIndex = queue.index + 1;
    const nextTrack = queue.tracks[nextIndex];
    if (!nextTrack || this.preloadedIndex === nextIndex) return;
    const ref = await this.resolver.resolve(nextTrack);
    await this.engine.preload(ref);
    this.preloadedIndex = nextIndex;
  }

  private async handleEnded(): Promise<void> {
    const queue = this.state.queue;
    if (!queue) return;
    if (queue.index + 1 < queue.tracks.length) {
      await this.playIndex(queue.index + 1);
    } else {
      this.patch({ status: "ended" });
    }
  }

  private patch(partial: Partial<PlaybackState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener(this.state);
  }
}
