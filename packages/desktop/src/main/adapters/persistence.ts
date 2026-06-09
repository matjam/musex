import { randomUUID } from "node:crypto";
import type { Library, RepeatMode, Track } from "@musex/core";
import Store from "electron-store";

export interface PersistedState {
  clientId: string;
  library: Library | null;
  volume: number;
  cacheEnabled: boolean;
  cacheMaxBytes: number;
}

/** Default local-cache cap: 5 GiB. */
export const DEFAULT_CACHE_MAX_BYTES = 5 * 1024 ** 3;

const store = new Store<PersistedState>({
  defaults: {
    clientId: "",
    library: null,
    volume: 1,
    cacheEnabled: false,
    cacheMaxBytes: DEFAULT_CACHE_MAX_BYTES,
  },
});

export interface PlaybackCursor {
  index: number;
  positionSec: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

// The big track list lives in its own file so frequent cursor writes never
// rewrite it. Tracks are stored with RAW thumbs (the IPC layer normalizes them),
// so no per-launch proxy secret is ever persisted.
const queueStore = new Store<{ tracks: Track[] | null }>({
  name: "playback-queue",
  defaults: { tracks: null },
});
const cursorStore = new Store<{ cursor: PlaybackCursor | null }>({
  name: "playback-cursor",
  defaults: { cursor: null },
});

/** A stable per-install Plex client identifier (generated once, then reused). */
export function getClientId(): string {
  let id = store.get("clientId");
  if (!id) {
    id = randomUUID();
    store.set("clientId", id);
  }
  return id;
}

export const persistence = {
  getLibrary(): Library | null {
    return store.get("library") ?? null;
  },
  setLibrary(lib: Library): void {
    store.set("library", lib);
  },
  getVolume(): number {
    return store.get("volume");
  },
  setVolume(v: number): void {
    store.set("volume", v);
  },
  getCacheEnabled(): boolean {
    return store.get("cacheEnabled");
  },
  setCacheEnabled(v: boolean): void {
    store.set("cacheEnabled", v);
  },
  getCacheMaxBytes(): number {
    return store.get("cacheMaxBytes");
  },
  setCacheMaxBytes(v: number): void {
    store.set("cacheMaxBytes", v);
  },
  getPlaybackQueue(): Track[] | null {
    return queueStore.get("tracks") ?? null;
  },
  setPlaybackQueue(tracks: Track[]): void {
    queueStore.set("tracks", tracks);
  },
  getPlaybackCursor(): PlaybackCursor | null {
    return cursorStore.get("cursor") ?? null;
  },
  setPlaybackCursor(cursor: PlaybackCursor): void {
    cursorStore.set("cursor", cursor);
  },
};
