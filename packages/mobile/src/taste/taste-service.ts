import type { ArtistStat, PlayKind, TrackStat } from "@musex/core";
import { TasteProfile } from "@musex/core";
import { loadTasteState, saveTasteState } from "../adapters/taste-persistence";

const SAVE_DEBOUNCE_MS = 5_000;

export interface TasteSnapshot {
  topArtists: { name: string; score: number }[];
  trackStats: (TrackStat & { key: string; decayedPlays: number })[];
  nowMs: number;
}

/** Owns the on-device TasteProfile: loads it on init, records plays, persists
 *  with a 5s debounce (mirrors desktop), and hands the Home screen a snapshot. */
export class TasteService {
  private profile = new TasteProfile();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  async init(): Promise<void> {
    const state = await loadTasteState();
    if (state) this.profile.load(state);
  }

  recordPlay(t: { title: string; artistName: string }, kind: PlayKind): void {
    this.profile.recordPlay(t, kind);
    this.scheduleSave();
  }

  recordTrackRating(t: { title: string; artistName: string }, rating10: number | null): void {
    this.profile.recordTrackRating(t, rating10);
    this.scheduleSave();
  }

  snapshot(): TasteSnapshot {
    return {
      topArtists: this.profile.topArtists(),
      trackStats: this.profile.trackStats(),
      nowMs: Date.now(),
    };
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void saveTasteState(this.profile.serialize());
    }, SAVE_DEBOUNCE_MS);
  }
}

// Re-export so consumers can keep one import site.
export type { ArtistStat };
