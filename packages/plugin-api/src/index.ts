/**
 * @musex/plugin-api — the complete type surface for musex plugins (API v1).
 *
 * Types only; no runtime code. Plugins are full-trust ESM modules loaded in
 * the Electron main process. A plugin directory contains a `plugin.json`
 * manifest plus a single bundled ESM entry exporting:
 *
 *   export function activate(ctx: PluginContext): void | Promise<void>
 *   export function deactivate(): void | Promise<void>   // optional
 */

/** The `plugin.json` manifest sitting next to the plugin's ESM entry. */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: number;
  entry: string;
  description?: string;
}

/** Returned by every registration; disposing removes the registration. */
export type Disposable = { dispose(): void };

/** The only shape of track data plugins ever see — no ids, URLs, or tokens. */
export type TrackInfo = {
  title: string;
  artistName: string;
  albumTitle?: string;
  durationMs: number;
  trackNumber?: number;
};

export interface PluginEvents {
  trackStarted: { track: TrackInfo; startedAtEpochSec: number };
  trackEnded: { track: TrackInfo; playedSec: number };
  paused: { track: TrackInfo };
  resumed: { track: TrackInfo };
  /** Curated: fires once per play-through when the host's scrobble gate passes
   *  (last.fm thresholds). Subscribers scrobble; that's all "being a
   *  scrobbler" means. */
  scrobble: { track: TrackInfo; startedAtEpochSec: number };
  /** Fired when the user rates (or clears the rating of) a TRACK in the app.
   *  `rating10` is the Plex 0–10 scale (stars × 2); null = rating cleared.
   *  Artist ratings do NOT fire this event. */
  trackRated: { track: TrackInfo; rating10: number | null };
}

export type LibrarySearchResult = {
  artists: { id: string; name: string }[];
  albums: { id: string; title: string; artistName: string }[];
  tracks: TrackInfo[];
};

export interface SectionContext {
  recentArtists: string[];
  recentTracks: { title: string; artist: string }[];
}

export interface Section {
  /** e.g. "Because you listened to Lamb" */
  title: string;
  items: { name: string; artistName?: string; imageUrl?: string; externalUrl?: string }[];
}

export interface SectionProvider {
  id: string;
  getSections(ctx: SectionContext): Promise<Section[]>;
}

export interface TrackAction {
  id: string;
  /** e.g. "Love on Last.fm" */
  label: string;
  /** lucide icon name; the host resolves it. */
  icon?: string;
  onInvoke(track: TrackInfo): Promise<void>;
}

export interface TrackDetailProvider {
  id: string;
  /** Key-value rows / short text for the selected track's panel (playcount, tags, …). */
  getDetail(
    track: TrackInfo,
  ): Promise<{ title: string; rows: { label: string; value: string }[] } | null>;
}

export type SettingField =
  | { kind: "text" | "password"; key: string; label: string; help?: string }
  | { kind: "toggle"; key: string; label: string; help?: string }
  /** Button → onSettingsAction handler. */
  | { kind: "action"; key: string; label: string; help?: string }
  /** Read-only line the plugin updates via its storage. */
  | { kind: "status"; key: string };

export type SettingsActionResult = { ok: boolean; message?: string };

export interface PluginContext {
  manifest: PluginManifest;
  /** Prefixed console logging. */
  log: (msg: string, ...args: unknown[]) => void;
  storage: {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, v: T): Promise<void>;
  };
  /** safeStorage-encrypted at rest. `set(key, null)` deletes. */
  secrets: {
    get(key: string): Promise<string | null>;
    set(key: string, v: string | null): Promise<void>;
  };
  /** Convenience; full trust anyway. */
  fetch: typeof fetch;

  /** Events (generalizes "Scrobbler"): playback lifecycle + curated domain events. */
  events: {
    on<K extends keyof PluginEvents>(
      event: K,
      handler: (payload: PluginEvents[K]) => void,
    ): Disposable;
  };

  /** Read-only library access (matching, taste profiles, dedupe — any plugin). */
  library: {
    search(query: string): Promise<LibrarySearchResult>;
    /** Host-tracked history. */
    recentlyPlayed(limit?: number): Promise<TrackInfo[]>;
  };

  /** UI (data-only; the host renders everything). */
  ui: {
    /** Toast in the renderer. */
    notify(message: string, level?: "info" | "error"): void;
    /** Open an http(s) URL in the system browser (plugins cannot import electron). */
    openExternal(url: string): void;
    contributeSections(target: "discover" | "home", provider: SectionProvider): Disposable;
    /** Context menu + detail panel. */
    contributeTrackAction(action: TrackAction): Disposable;
    /** Slide-out panel section. */
    contributeTrackDetail(provider: TrackDetailProvider): Disposable;
  };

  /** Declarative settings; the host renders the form. */
  registerSettings(schema: SettingField[]): void;
  /** e.g. a "Connect" button's handler. */
  onSettingsAction(key: string, handler: () => Promise<SettingsActionResult>): void;
}
