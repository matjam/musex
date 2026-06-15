import type { Queue, RepeatMode, Track } from "../models/index.js";
import type { PlaybackEngine } from "../ports/playback-engine.js";
import type { StreamResolver } from "../ports/stream-resolver.js";
import { buildQueue } from "../usecases/build-queue.js";

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

/** Fisher-Yates shuffle — returns a new array, never mutates input. */
function fisherYates<T>(a: T[]): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    // i and j are always valid indices — TypeScript's noUncheckedIndexedAccess
    // can't see that, so we widen through `unknown` to avoid the lint rule.
    const tmp = out[i] as unknown as T;
    out[i] = out[j] as unknown as T;
    out[j] = tmp;
  }
  return out;
}

export class PlaybackSession {
  private state: PlaybackState = INITIAL_STATE;
  private readonly listeners = new Set<(s: PlaybackState) => void>();
  private preloadedIndex: number | null = null;
  private loadToken = 0;
  /** Original (unshuffled) order while shuffle is active; null when shuffle is off. */
  private unshuffled: Track[] | null = null;

  constructor(
    private readonly engine: PlaybackEngine,
    private readonly resolver: StreamResolver,
    private readonly shuffleRest: <T>(items: T[]) => T[] = fisherYates,
  ) {
    this.engine.onPosition((sec) => this.patch({ positionSec: sec }));
    this.engine.onEnded(() => {
      void this.handleEnded();
    });
    this.engine.onAdvanced(() => {
      void this.handleAdvanced();
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
    this.unshuffled = null;
    this.patch({ queue, error: null });
    await this.playIndex(queue.index);
  }

  /** Replace the queue with `tracks` shuffled and play from the top (shuffle on).
   *  `repeat` defaults to "none" — callers pass the mode to start with. */
  async loadQueueShuffled(tracks: Track[], repeat: RepeatMode = "none"): Promise<void> {
    if (tracks.length === 0) return;
    this.unshuffled = [...tracks];
    const shuffled = this.shuffleRest(tracks) as Track[];
    this.preloadedIndex = null;
    this.patch({
      queue: { tracks: shuffled, index: 0, shuffle: true, repeat },
      error: null,
    });
    await this.playIndex(0);
  }

  /** Restore a previously-persisted queue, paused at `positionSec`, without
   *  auto-playing (load() is prepare-only). Loads the current track, seeks to the
   *  saved position, leaves status "paused", and preloads the next track.
   *  We do not persist the pre-shuffle order, so a restored shuffled queue treats
   *  its current order as the base (unshuffled = null). */
  async restore(queue: Queue, positionSec: number): Promise<void> {
    if (queue.tracks.length === 0) return;
    const index = Math.min(Math.max(queue.index, 0), queue.tracks.length - 1);
    const track = queue.tracks[index];
    if (!track) return;
    this.unshuffled = null;
    const token = ++this.loadToken;
    this.preloadedIndex = null;
    this.patch({
      queue: { ...queue, index },
      status: "paused",
      positionSec,
      durationSec: track.durationMs / 1000,
      error: null,
    });
    const ref = await this.resolver.resolve(track);
    if (token !== this.loadToken) return;
    try {
      await this.engine.load(ref);
    } catch (err) {
      this.patch({ status: "error", error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (token !== this.loadToken) return;
    this.engine.seek(positionSec);
    this.patch({ status: "paused", positionSec });
    await this.preloadNext();
  }

  async playIndex(index: number): Promise<void> {
    const queue = this.state.queue;
    if (!queue) return;
    const track = queue.tracks[index];
    if (!track) return;

    const token = ++this.loadToken;
    this.preloadedIndex = null;
    this.patch({ queue: { ...queue, index }, status: "loading", positionSec: 0 });
    const ref = await this.resolver.resolve(track);
    if (token !== this.loadToken) return; // superseded by a newer load
    try {
      await this.engine.load(ref);
    } catch (err) {
      this.patch({ status: "error", error: err instanceof Error ? err.message : String(err) });
      return;
    }
    if (token !== this.loadToken) return; // superseded by a newer load
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
    if (!queue) return;
    // Manual next always overrides repeat-one: go to real next track.
    const nextIndex = queue.index + 1;
    if (nextIndex < queue.tracks.length) {
      await this.playIndex(nextIndex);
    } else if (queue.repeat === "all") {
      await this.playIndex(0);
    } else {
      this.patch({ status: "ended" });
    }
  }

  async previous(): Promise<void> {
    const queue = this.state.queue;
    if (!queue) return;
    if (queue.index - 1 >= 0) {
      await this.playIndex(queue.index - 1);
    } else if (queue.repeat === "all") {
      await this.playIndex(queue.tracks.length - 1);
    } else {
      // Clamp to 0 — restart the first track
      await this.playIndex(0);
    }
  }

  seek(seconds: number): void {
    this.engine.seek(seconds);
    this.patch({ positionSec: seconds });
  }

  setVolume(volume: number): void {
    this.engine.setVolume(volume);
    this.patch({ volume });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Queue mutations
  // ──────────────────────────────────────────────────────────────────────────

  async enqueueNext(tracks: Track[]): Promise<void> {
    const queue = this.state.queue;
    if (!queue || queue.tracks.length === 0) {
      await this.loadQueue(buildQueue(tracks, 0));
      return;
    }
    const insertAt = queue.index + 1;
    const newTracks = [
      ...queue.tracks.slice(0, insertAt),
      ...tracks,
      ...queue.tracks.slice(insertAt),
    ];
    if (this.unshuffled !== null) {
      // Find where the current track sits in unshuffled; insert after it
      const currentTrack = queue.tracks[queue.index];
      const unshuffledInsertAt = currentTrack
        ? this.unshuffled.indexOf(currentTrack) + 1
        : this.unshuffled.length;
      this.unshuffled = [
        ...this.unshuffled.slice(0, unshuffledInsertAt),
        ...tracks,
        ...this.unshuffled.slice(unshuffledInsertAt),
      ];
    }
    // Clear cached preload index: the "next" track may have changed identity
    this.preloadedIndex = null;
    this.patch({ queue: { ...queue, tracks: newTracks } });
    await this.preloadNext();
  }

  async enqueueEnd(tracks: Track[]): Promise<void> {
    const queue = this.state.queue;
    if (!queue || queue.tracks.length === 0) {
      await this.loadQueue(buildQueue(tracks, 0));
      return;
    }
    const wasLastTrack = queue.index === queue.tracks.length - 1;
    const newTracks = [...queue.tracks, ...tracks];
    if (this.unshuffled !== null) {
      this.unshuffled = [...this.unshuffled, ...tracks];
    }
    this.patch({ queue: { ...queue, tracks: newTracks } });
    // Only re-preload if this might change what's next (we were on the last track)
    if (wasLastTrack) {
      await this.preloadNext();
    }
  }

  /** Play `track` immediately, inserted right after the current track, WITHOUT
   *  resetting shuffle/repeat (double-click-to-play). Starts a fresh single-track
   *  queue if nothing is loaded. */
  async playTrackNext(track: Track): Promise<void> {
    const queue = this.state.queue;
    if (!queue || queue.tracks.length === 0) {
      await this.loadQueue(buildQueue([track], 0));
      return;
    }
    const insertAt = queue.index + 1;
    const newTracks = [...queue.tracks.slice(0, insertAt), track, ...queue.tracks.slice(insertAt)];
    if (this.unshuffled !== null) {
      const currentTrack = queue.tracks[queue.index];
      const at = currentTrack ? this.unshuffled.indexOf(currentTrack) + 1 : this.unshuffled.length;
      this.unshuffled = [...this.unshuffled.slice(0, at), track, ...this.unshuffled.slice(at)];
    }
    this.preloadedIndex = null;
    this.patch({ queue: { ...queue, tracks: newTracks } });
    await this.playIndex(insertAt);
  }

  removeAt(i: number): void {
    const queue = this.state.queue;
    if (!queue) return;

    const removedTrack = queue.tracks[i];
    const newTracks = queue.tracks.filter((_, idx) => idx !== i);

    // Keep unshuffled in sync
    if (this.unshuffled !== null && removedTrack) {
      this.unshuffled = this.unshuffled.filter((t) => t !== removedTrack);
    }

    if (i < queue.index) {
      // Before current: decrement index
      this.patch({ queue: { ...queue, tracks: newTracks, index: queue.index - 1 } });
      void this.preloadNext();
    } else if (i === queue.index) {
      // Current track removed: load whatever is now at this slot, or stop
      this.patch({ queue: { ...queue, tracks: newTracks } });
      if (newTracks.length === 0) {
        // Empty queue
        this.patch({ queue: { ...queue, tracks: newTracks, index: 0 }, status: "ended" });
      } else if (i < newTracks.length) {
        // There's a track at this slot now (former next)
        void this.playIndex(i);
      } else {
        // Was the last track and nothing comes after
        this.patch({
          queue: { ...queue, tracks: newTracks, index: newTracks.length - 1 },
          status: "ended",
        });
      }
    } else {
      // After current: just remove
      this.patch({ queue: { ...queue, tracks: newTracks } });
      void this.preloadNext();
    }
  }

  move(from: number, to: number): void {
    const queue = this.state.queue;
    if (!queue) return;
    if (from === to) return;

    const newTracks = [...queue.tracks];
    const [moved] = newTracks.splice(from, 1);
    if (moved === undefined) return;
    newTracks.splice(to, 0, moved);

    // Recompute index so it still points at the same track
    const currentTrack = queue.tracks[queue.index];
    const newIndex = currentTrack ? newTracks.indexOf(currentTrack) : queue.index;

    // Keep unshuffled in sync
    if (this.unshuffled !== null) {
      // The user is reordering the shuffled view; mirror in unshuffled by
      // doing the same move (best-effort for drag-reorder UX)
      const newUnshuffled = [...this.unshuffled];
      const [movedU] = newUnshuffled.splice(from, 1);
      if (movedU !== undefined) newUnshuffled.splice(to, 0, movedU);
      this.unshuffled = newUnshuffled;
    }

    this.patch({ queue: { ...queue, tracks: newTracks, index: newIndex } });
    void this.preloadNext();
  }

  clearQueue(): void {
    const queue = this.state.queue;
    if (!queue) return;
    const newTracks = queue.tracks.slice(0, queue.index + 1);
    if (this.unshuffled !== null) {
      // Trim unshuffled to only contain the current track (and preceding history)
      const currentTrack = queue.tracks[queue.index];
      if (currentTrack) {
        const unshuffledIdx = this.unshuffled.indexOf(currentTrack);
        this.unshuffled =
          unshuffledIdx >= 0 ? this.unshuffled.slice(0, unshuffledIdx + 1) : this.unshuffled;
      }
    }
    this.patch({ queue: { ...queue, tracks: newTracks } });
    // Preloaded next is now gone
    this.preloadedIndex = null;
  }

  setShuffle(on: boolean): void {
    const queue = this.state.queue;
    if (!queue) return;

    if (on) {
      if (queue.shuffle) return; // already on
      // Save original order
      this.unshuffled = [...queue.tracks];
      const before = queue.tracks.slice(0, queue.index + 1);
      const after = queue.tracks.slice(queue.index + 1);
      const shuffledAfter = this.shuffleRest(after) as Track[];
      const newTracks = [...before, ...shuffledAfter];
      // Clear cached preload: the "next" track identity has changed
      this.preloadedIndex = null;
      this.patch({ queue: { ...queue, tracks: newTracks, shuffle: true } });
      void this.preloadNext();
    } else {
      if (!queue.shuffle) return; // already off
      if (this.unshuffled === null) {
        // Safety: just clear the flag
        this.patch({ queue: { ...queue, shuffle: false } });
        return;
      }
      // Rebuild from unshuffled: keep only tracks still present in current shuffled list
      const currentSet = new Set(queue.tracks);
      const restored = this.unshuffled.filter((t) => currentSet.has(t));
      const currentTrack = queue.tracks[queue.index];
      const newIndex = currentTrack ? restored.indexOf(currentTrack) : 0;
      this.unshuffled = null;
      // Clear cached preload: the "next" track identity has changed
      this.preloadedIndex = null;
      this.patch({
        queue: { ...queue, tracks: restored, index: newIndex >= 0 ? newIndex : 0, shuffle: false },
      });
      void this.preloadNext();
    }
  }

  cycleRepeat(): void {
    const queue = this.state.queue;
    if (!queue) return;
    const next: Record<RepeatMode, RepeatMode> = { none: "all", all: "one", one: "none" };
    this.setRepeat(next[queue.repeat]);
  }

  setRepeat(mode: RepeatMode): void {
    const queue = this.state.queue;
    if (!queue) return;
    this.patch({ queue: { ...queue, repeat: mode } });
    void this.preloadNext();
  }

  async jumpTo(index: number): Promise<void> {
    await this.playIndex(index);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Internal helpers
  // ──────────────────────────────────────────────────────────────────────────

  /** Index to play after `index`, per repeat mode; null = nothing next (stop). */
  private computeNext(q: Queue): number | null {
    if (q.repeat === "one") return q.index;
    if (q.index + 1 < q.tracks.length) return q.index + 1;
    return q.repeat === "all" ? 0 : null;
  }

  private async preloadNext(): Promise<void> {
    const queue = this.state.queue;
    if (!queue) return;
    const nextIndex = this.computeNext(queue);
    if (nextIndex === null) return;
    // Don't re-preload if we already preloaded this index
    if (this.preloadedIndex === nextIndex) return;
    const nextTrack = queue.tracks[nextIndex];
    if (!nextTrack) return;
    const ref = await this.resolver.resolve(nextTrack);
    await this.engine.preload(ref);
    this.preloadedIndex = nextIndex;
  }

  private async handleAdvanced(): Promise<void> {
    const queue = this.state.queue;
    if (!queue) return;
    const nextIndex = this.computeNext(queue);
    if (nextIndex === null) return; // engine signalled advance but we have no next; onEnded will finalize

    this.preloadedIndex = null;

    if (queue.repeat === "one") {
      // Gapless loop: keep index the same, just reset position/duration
      const currentTrack = queue.tracks[queue.index];
      if (!currentTrack) return;
      this.patch({
        status: "playing",
        positionSec: 0,
        durationSec: currentTrack.durationMs / 1000,
      });
    } else {
      const nextTrack = queue.tracks[nextIndex];
      if (!nextTrack) return;
      this.patch({
        queue: { ...queue, index: nextIndex },
        status: "playing",
        positionSec: 0,
        durationSec: nextTrack.durationMs / 1000,
      });
    }
    await this.preloadNext();
  }

  private async handleEnded(): Promise<void> {
    const queue = this.state.queue;
    if (!queue) return;
    const n = this.computeNext(queue);
    if (n === null) {
      this.patch({ status: "ended" });
    } else {
      await this.playIndex(n);
    }
  }

  private patch(partial: Partial<PlaybackState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener(this.state);
  }
}
