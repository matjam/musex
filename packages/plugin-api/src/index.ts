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
  /** Host taste profile: artists by decayed affinity, best first (may be
   *  empty until the user has listened/rated enough). */
  topArtists: { name: string; score: number }[];
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

/** What the host knows when it asks recommenders for radio suggestions. */
export interface RecommendContext {
  seedTracks: { title: string; artist: string }[];
  seedArtists: string[];
  /** Already queued / recently played — do not re-suggest. */
  exclude: { title: string; artist: string }[];
  count: number;
}

/** title absent = artist-level suggestion (host picks tracks by that artist). */
export type RecommendedTrack = { artistName: string; title?: string };

/** Suggests tracks for the host's radio mode. Plugins only SUGGEST — the host
 *  resolves suggestions against the user's library and owns the queue. */
export interface TrackRecommender {
  id: string;
  recommend(ctx: RecommendContext): Promise<RecommendedTrack[]>;
}

/** One tile in the Similar side panel. `artistName` is set for similar TRACKS
 *  (the song's artist); similar artists carry only `name`. */
export type SimilarItem = {
  name: string;
  artistName?: string;
  imageUrl?: string;
  externalUrl?: string;
  /** Similarity 0..1 when the source scores it (last.fm match). Taste
   *  expansion uses this; the Similar panel ignores it. */
  match?: number;
};

/** Powers the Similar side panel (artist pages → similar artists; track detail
 *  → similar songs) and host-side taste expansion. Implement whichever
 *  methods the source supports. */
export interface SimilarProvider {
  id: string;
  similarArtists?(artistName: string): Promise<SimilarItem[]>;
  similarTracks?(seed: { title: string; artist: string }): Promise<SimilarItem[]>;
  /** OPTIONAL: an artist's most popular albums, best first (taste expansion
   *  uses the top entry as the "start here" album for a new artist). */
  topAlbums?(artistName: string): Promise<{ title: string }[]>;
}

/** Where an album sits in the acquisition pipeline. Providers report
 *  everything except "owned" — the HOST adds "owned" by cross-checking lookup
 *  results against the user's Plex library. */
export type AcquisitionState =
  | "owned"
  | "downloaded"
  | "downloading"
  | "requested"
  | "available"
  | "unavailable";

/** One album in an artist's acquirable discography. */
export interface AcquirableAlbum {
  title: string;
  artistName: string;
  year?: number;
  imageUrl?: string;
  /** Opaque — pass back to acquireAlbum. */
  providerRef: string;
  /** Host adds "owned" by library cross-check. */
  state: Exclude<AcquisitionState, "owned">;
  /** e.g. "7/12 tracks", "no release found" */
  detail?: string;
}

/** One row in the Downloads status view. */
export interface AcquisitionStatusItem {
  title: string;
  artistName: string;
  state: AcquisitionState;
  /** 0..1 */
  progress?: number;
  detail?: string;
}

/** One artist from an acquisition provider's external (MusicBrainz-backed)
 *  search — federated into the app's search view. */
export interface ExternalArtistResult {
  name: string;
  /** Opaque — pass back to acquireArtist. */
  providerRef: string;
  imageUrl?: string;
  externalUrl?: string;
  /** e.g. "UK trip-hop duo" — disambiguates same-named artists. */
  disambiguation?: string;
  /** Already fully monitored in the provider. */
  monitored?: boolean;
}

/** Acquires music via an external service (e.g. Lidarr): discography lookup,
 *  album acquisition, and download status. */
export interface AcquisitionProvider {
  id: string;
  /** [] = artist unknown to the provider. */
  lookupArtistAlbums(artistName: string): Promise<AcquirableAlbum[]>;
  acquireAlbum(providerRef: string): Promise<void>;
  status(): Promise<AcquisitionStatusItem[]>;
  /** OPTIONAL: external artist search (federated into the app's search view). */
  searchArtists?(term: string): Promise<ExternalArtistResult[]>;
  /** OPTIONAL: monitor EVERYTHING by the artist + kick off a search. */
  acquireArtist?(providerRef: string): Promise<void>;
  /** OPTIONAL: stop pursuing a previously acquired album (unmonitor; never
   *  deletes files). Taste expansion calls this on abandon / "Not for me". */
  cancelAlbum?(providerRef: string): Promise<void>;
  /** OPTIONAL: watch an artist so FUTURE releases are fetched automatically.
   *  Enabling must not monitor the artist's existing albums; disabling must
   *  not unmonitor albums monitored separately. */
  watchNewReleases?(artistName: string, enabled: boolean): Promise<void>;
  /** OPTIONAL: is this artist currently watched for new releases? */
  isWatchingNewReleases?(artistName: string): Promise<boolean>;
  /** OPTIONAL: names of all artists watched for new releases. */
  listWatchedArtists?(): Promise<string[]>;
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
    /** Host taste profile: artists by decayed affinity score, best first. */
    topArtists(limit?: number): Promise<{ name: string; score: number }[]>;
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
    /** Similar side panel (similar artists / similar songs). */
    registerSimilarProvider(provider: SimilarProvider): Disposable;
  };

  /** Radio: suggest tracks when the host's auto-extending queue runs low. */
  registerTrackRecommender(recommender: TrackRecommender): Disposable;

  /** Acquisition (e.g. Lidarr): discography lookup + album acquisition.
   *  Top-level (not under ui) — it's a service, not a UI contribution. */
  registerAcquisitionProvider(provider: AcquisitionProvider): Disposable;

  /** Declarative settings; the host renders the form. */
  registerSettings(schema: SettingField[]): void;
  /** e.g. a "Connect" button's handler. */
  onSettingsAction(key: string, handler: () => Promise<SettingsActionResult>): void;
}
