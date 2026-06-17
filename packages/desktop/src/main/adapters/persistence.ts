import { randomUUID } from "node:crypto";
import type { ExpansionEntry, Library, RepeatMode, TasteState, Track } from "@musex/core";
import type { TrackInfo } from "@musex/plugin-api";
import Store from "electron-store";
import {
  type AudioPrefs,
  DEFAULT_AUDIO_PREFS,
  sanitizeAudioPrefs,
} from "../../logic/audio-filters.js";

export interface PluginSource {
  owner: string;
  repo: string;
  version: string;
}

/** Last.fm service config — non-secret fields live here; secrets (apiSecret,
 *  sessionKey) are stored encrypted via secureEncrypt/secureDecrypt. */
export interface LastfmConfig {
  /** Last.fm API key (public). */
  apiKey: string;
  /** Whether scrobbling is enabled (default: true). */
  scrobbling: boolean;
  /** Whether to sync ratings ≥ 4★ as "loved" tracks (default: true). */
  loveOnRating: boolean;
  /** Last.fm username, populated after a successful auth. */
  username: string | null;
  /** Human-readable connection status shown in the settings UI. */
  connection: string;
}

export interface PersistedState {
  clientId: string;
  library: Library | null;
  volume: number;
  cacheEnabled: boolean;
  cacheMaxBytes: number;
  // Volume leveling + EQ preset (see logic/audio-filters.ts).
  audioPrefs: AudioPrefs;
  // Last known-good base URL per Plex server (machineIdentifier -> URL). Lets us
  // skip @ctrl/plex's slow connection probe on startup — we connect straight to
  // the cached URL and only rediscover if it's unreachable.
  serverUrls: Record<string, string>;
  // Plugins the user switched off (enabled is the default, so we store the
  // exceptions — an unknown/new plugin id is enabled without a write).
  disabledPlugins: string[];
  // Recently-played history (most recent first, capped by the PlaybackMonitor)
  // — TrackInfo only (no ids/URLs/tokens); backs ctx.library.recentlyPlayed.
  recentlyPlayed: TrackInfo[];
  // Source record for user-installed plugins (owner/repo/version), keyed by
  // plugin id — used to detect updates and power the installer.
  pluginSources: Record<string, PluginSource>;
  // Last.fm non-secret config (secrets are stored encrypted in separate files).
  lastfm: LastfmConfig;
}

/** Default local-cache cap: 5 GiB. */
export const DEFAULT_CACHE_MAX_BYTES = 5 * 1024 ** 3;

const DEFAULT_LASTFM_CONFIG: LastfmConfig = {
  apiKey: "",
  scrobbling: true,
  loveOnRating: true,
  username: null,
  connection: "Not connected",
};

const store = new Store<PersistedState>({
  defaults: {
    clientId: "",
    library: null,
    volume: 1,
    cacheEnabled: false,
    cacheMaxBytes: DEFAULT_CACHE_MAX_BYTES,
    audioPrefs: DEFAULT_AUDIO_PREFS,
    serverUrls: {},
    disabledPlugins: [],
    recentlyPlayed: [],
    pluginSources: {},
    lastfm: DEFAULT_LASTFM_CONFIG,
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
// Last.fm service miscellaneous storage (artist art cache, etc.) — separate
// file to keep the main settings store from growing unboundedly.
const lastfmStore = new Store<Record<string, unknown>>({
  name: "lastfm-data",
  defaults: {},
});

// Taste profile (artist affinity + track stats) — its own file because it's
// written on every play/rating (debounced in the Runtime) and can grow large.
const tasteStore = new Store<{ taste: TasteState | null }>({
  name: "listening-profile",
  defaults: { taste: null },
});
// Taste-expansion attempt ledger + prefs (see @musex/core's taste-expansion).
const expansionStore = new Store<{ ledger: ExpansionEntry[]; prefs: ExpansionPrefs }>({
  name: "expansion-ledger",
  defaults: { ledger: [], prefs: { enabled: false, albumsPerWeek: 2, aggressiveness: 50 } },
});

export interface ExpansionPrefs {
  enabled: boolean;
  albumsPerWeek: number;
  aggressiveness: number;
}

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
  getAudioPrefs(): AudioPrefs {
    // sanitize on read: defends against hand-edited or stale store JSON.
    return sanitizeAudioPrefs(store.get("audioPrefs"));
  },
  setAudioPrefs(p: AudioPrefs): void {
    store.set("audioPrefs", p);
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
  getServerUrl(serverId: string): string | undefined {
    return store.get("serverUrls")[serverId];
  },
  setServerUrl(serverId: string, baseUrl: string): void {
    store.set("serverUrls", { ...store.get("serverUrls"), [serverId]: baseUrl });
  },
  deleteServerUrl(serverId: string): void {
    const all = { ...store.get("serverUrls") };
    delete all[serverId];
    store.set("serverUrls", all);
  },
  getTasteState(): TasteState | null {
    return tasteStore.get("taste") ?? null;
  },
  setTasteState(s: TasteState): void {
    tasteStore.set("taste", s);
  },
  getExpansionLedger(): ExpansionEntry[] {
    return expansionStore.get("ledger");
  },
  setExpansionLedger(ledger: ExpansionEntry[]): void {
    expansionStore.set("ledger", ledger);
  },
  getExpansionPrefs(): ExpansionPrefs {
    return expansionStore.get("prefs");
  },
  setExpansionPrefs(prefs: ExpansionPrefs): void {
    expansionStore.set("prefs", prefs);
  },
  getRecentlyPlayed(): TrackInfo[] {
    return store.get("recentlyPlayed");
  },
  setRecentlyPlayed(history: TrackInfo[]): void {
    store.set("recentlyPlayed", history);
  },
  isPluginEnabled(id: string): boolean {
    return !store.get("disabledPlugins").includes(id);
  },
  setPluginEnabled(id: string, enabled: boolean): void {
    const set = new Set(store.get("disabledPlugins"));
    if (enabled) set.delete(id);
    else set.add(id);
    store.set("disabledPlugins", [...set]);
  },
  getPluginSource(id: string): PluginSource | undefined {
    return store.get("pluginSources")[id];
  },
  setPluginSource(id: string, src: PluginSource | null): void {
    const all = { ...store.get("pluginSources") };
    if (src) all[id] = src;
    else delete all[id];
    store.set("pluginSources", all);
  },
  getLastfmConfig(): LastfmConfig {
    return store.get("lastfm") ?? DEFAULT_LASTFM_CONFIG;
  },
  setLastfmConfig(patch: Partial<LastfmConfig>): void {
    store.set("lastfm", { ...store.get("lastfm"), ...patch });
  },
  getLastfmData<T>(key: string): T | null {
    const v = lastfmStore.get(key);
    return v !== undefined ? (v as T) : null;
  },
  setLastfmData(key: string, value: unknown): void {
    lastfmStore.set(key, value);
  },
};
