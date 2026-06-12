import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Library, Pin, Track } from "@musex/core";
import { isHttpUrl, TasteProfile } from "@musex/core";
import type { TrackInfo } from "@musex/plugin-api";
import { app, safeStorage, shell } from "electron";
import { buildAf, replaygainMode } from "../logic/audio-filters.js";
import type { PluginNotification } from "../shared/ipc-contract.js";
import { CachingPlexGateway } from "./adapters/caching-plex-gateway.js";
import { LibraryWatcher } from "./adapters/library-watcher.js";
import { ListCacheStore } from "./adapters/list-cache-store.js";
import { MediaCache } from "./adapters/media-cache.js";
import { MpvController } from "./adapters/mpv-controller.js";
import { resolveMpvPaths } from "./adapters/mpv-paths.js";
import { persistence } from "./adapters/persistence.js";
import { PlexapiGateway } from "./adapters/plex-gateway.js";
import { StreamProxy } from "./adapters/stream-proxy.js";
import { SafeStorageTokenStore } from "./adapters/token-store.js";
import { ExpansionCoordinator } from "./expansion/coordinator.js";
import { CORE_PLUGINS } from "./plugins/core-plugins.js";
import { PlaybackMonitor } from "./plugins/playback-monitor.js";
import { PluginHost } from "./plugins/plugin-host.js";

const ART_CACHE_MAX_BYTES = 1 * 1024 ** 3; // 1 GiB
/** Taste profile writes are debounced: one persist ~5s after the last mutation. */
const TASTE_SAVE_DEBOUNCE_MS = 5_000;

// electron-vite bundles all main files into packages/desktop/out/main/index.js,
// so __dirname here is packages/desktop/out/main/ → repo root is 4 levels up.
const __dirname = fileURLToPath(new URL(".", import.meta.url));

export class Runtime {
  private readonly realGateway = new PlexapiGateway({
    get: (id) => persistence.getServerUrl(id),
    set: (id, url) => persistence.setServerUrl(id, url),
    delete: (id) => persistence.deleteServerUrl(id),
  });
  readonly listCache = new ListCacheStore(path.join(app.getPath("userData"), "list-cache"));
  readonly gateway = new CachingPlexGateway(this.realGateway, this.listCache);
  readonly tokenStore = new SafeStorageTokenStore();
  readonly proxy = new StreamProxy();
  readonly cache = new MediaCache(path.join(app.getPath("userData"), "media-cache"));
  readonly artCache = new MediaCache(path.join(app.getPath("userData"), "art-cache"));
  /** Constructed in init() — resolveMpvPaths needs `app` ready and throws if
   *  mpv isn't vendored. Not start()ed here: the controller spawns mpv lazily
   *  on the first load, keeping app startup fast. */
  mpv!: MpvController;
  /** Constructed + loaded in init() — needs `app` ready (userData paths) and
   *  safeStorage for plugin secrets. */
  plugins!: PluginHost;
  expansion!: ExpansionCoordinator;
  libraryWatcher!: LibraryWatcher;
  /** Set by main/index per window (same pattern as pluginNotifySink). */
  private libraryChangedSink: ((lib: Library) => void) | null = null;
  /** Constructed in init() — drives the plugin events pipeline (trackStarted/
   *  paused/resumed/trackEnded/scrobble) + the recently-played history. */
  playbackMonitor!: PlaybackMonitor;
  /** Persisted listening profile (loaded in init()); fed by the playback
   *  monitor and the rate IPC; read by plugins via library.topArtists. */
  readonly tasteProfile = new TasteProfile();
  token: string | null = null;
  libraries: Library[] = [];

  private tasteSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingPin: Pin | null = null;
  private readonly registeredServers = new Set<string>();
  /** Set by main/index per window (like mpv's sink); plugins notify through it. */
  private pluginNotifySink: ((p: PluginNotification) => void) | null = null;

  setPluginNotifySink(sink: ((p: PluginNotification) => void) | null): void {
    this.pluginNotifySink = sink;
  }

  setLibraryChangedSink(sink: ((lib: Library) => void) | null): void {
    this.libraryChangedSink = sink;
  }

  async init(): Promise<void> {
    this.mpv = new MpvController(resolveMpvPaths());
    // Seed the controller's cached audio config from persisted prefs — mpv
    // isn't running yet, so this only sets what the next spawn will apply.
    const audioPrefs = persistence.getAudioPrefs();
    await this.mpv.applyAudioConfig({
      af: buildAf(audioPrefs),
      replaygain: replaygainMode(audioPrefs),
    });
    await this.cache.init();
    await this.listCache.init();
    this.proxy.configureCache(this.cache, () => ({
      enabled: persistence.getCacheEnabled(),
      maxBytes: persistence.getCacheMaxBytes(),
    }));
    await this.artCache.init();
    this.proxy.setArtCache(this.artCache, ART_CACHE_MAX_BYTES);
    await this.proxy.start();

    const tasteState = persistence.getTasteState();
    if (tasteState) this.tasteProfile.load(tasteState);

    // Playback monitor: emits into the plugin host's event registry (lazily —
    // this.plugins is assigned just below, before any playback can happen).
    this.playbackMonitor = new PlaybackMonitor({
      emit: (event, payload) => this.plugins.emitEvent(event, payload),
      loadHistory: () => persistence.getRecentlyPlayed(),
      saveHistory: (h) => persistence.setRecentlyPlayed(h),
      recordPlay: (track, kind) => {
        this.tasteProfile.recordPlay(track, kind);
        this.saveTasteProfileSoon();
      },
    });

    // Plugin host: core plugins (lastfm, lidarr) are statically bundled —
    // no filesystem scan for them. Only userData/plugins is scanned for
    // user-installed plugins; core plugin ids win on collision.
    this.plugins = new PluginHost({
      corePlugins: CORE_PLUGINS,
      scanDirs: [path.join(app.getPath("userData"), "plugins")],
      dataDir: path.join(app.getPath("userData"), "plugin-data"),
      secretsDir: path.join(app.getPath("userData"), "plugin-secrets"),
      encrypt: async (s) => {
        if (!safeStorage.isEncryptionAvailable()) {
          throw new Error("OS secure storage is unavailable; cannot store plugin secret");
        }
        return (await safeStorage.encryptStringAsync(s)).toString("base64");
      },
      decrypt: async (s) => {
        const { result } = await safeStorage.decryptStringAsync(Buffer.from(s, "base64"));
        return result;
      },
      isEnabled: (id) => persistence.isPluginEnabled(id),
      setEnabled: (id, v) => persistence.setPluginEnabled(id, v),
      notifySink: (p) => this.pluginNotifySink?.(p),
      openExternal: (url) => {
        if (isHttpUrl(url)) {
          void shell.openExternal(url);
        } else {
          console.error(`[plugins] blocked openExternal for non-http(s) URL: ${url}`);
        }
      },
      // Read-only library access for plugins, mapped down to the plugin-api
      // shapes (never core Track — no ids/URLs/tokens cross into plugin land
      // except the search ids needed for matching).
      library: {
        search: async (query) => {
          // Not signed in / no library selected yet: plugins may search at any
          // time (e.g. on activate), so return empty rather than throwing.
          const lib = this.libraries[0];
          if (!lib || !this.token) return { artists: [], albums: [], tracks: [] };
          const r = await this.gateway.search(lib, query, this.token);
          return {
            artists: r.artists.map((a) => ({ id: a.id, name: a.name })),
            // Core Album carries no artist name (only artistId) — empty string
            // by contract until a need justifies the extra lookup.
            albums: r.albums.map((a) => ({ id: a.id, title: a.title, artistName: "" })),
            tracks: r.tracks.map(toPluginTrackInfo),
          };
        },
        recentlyPlayed: async (limit) => this.playbackMonitor.history(limit),
        topArtists: async (limit) => this.tasteProfile.topArtists(limit),
      },
    });
    await this.plugins.loadAll();

    // Taste expansion: host-owned coordinator over the plugin providers
    // (similar/lastfm + acquisition/lidarr). Pure planning lives in
    // @musex/core's taste-expansion; this just wires its inputs.
    this.expansion = new ExpansionCoordinator({
      host: this.plugins,
      getLibrary: () => this.libraries[0] ?? null,
      getToken: () => this.token,
      listArtists: (lib, token) => this.gateway.listArtists(lib, token),
      listAlbums: (lib, artistId, token) => this.gateway.listAlbums(lib, artistId, token),
      topArtists: () => this.tasteProfile.topArtists(),
      trackStats: () => this.tasteProfile.trackStats(),
    });
    this.expansion.start();

    this.libraryWatcher = new LibraryWatcher({
      getToken: () => this.token,
      endpoint: (serverId, token) => this.gateway.endpoint(serverId, token),
      listMusicLibraries: (serverId, serverName, token) =>
        this.gateway.listMusicLibraries({ id: serverId, name: serverName, connections: [] }, token),
      onChange: async (fresh) => {
        // Whole-store evict is deliberate: Plex doesn't reliably bump nested
        // updatedAt (e.g. an artist's when an album lands), so nested
        // validators can't be trusted after a change. The cache refills lazily.
        await this.listCache.clear();
        persistence.setLibrary(fresh);
        this.libraries = this.libraries.map((l) => (l.id === fresh.id ? fresh : l));
        this.libraryChangedSink?.(fresh);
      },
    });
  }

  async restore(): Promise<void> {
    this.token = await this.tokenStore.load();
    this.libraryWatcher.setLibrary(persistence.getLibrary());
  }

  /** Debounced taste-profile persist: collapses bursts of plays/ratings into
   *  one write to the listening-profile store. */
  saveTasteProfileSoon(): void {
    if (this.tasteSaveTimer) clearTimeout(this.tasteSaveTimer);
    this.tasteSaveTimer = setTimeout(() => {
      this.tasteSaveTimer = null;
      persistence.setTasteState(this.tasteProfile.serialize());
    }, TASTE_SAVE_DEBOUNCE_MS);
  }

  async signInStart(): Promise<{ code: string; authUrl: string }> {
    this.pendingPin = await this.gateway.createPin();
    const url = this.pendingPin.authUrl;
    if (url.startsWith("https://app.plex.tv/") || url.startsWith("https://plex.tv/")) {
      void shell.openExternal(url);
    }
    return { code: this.pendingPin.code, authUrl: url };
  }

  async signInPoll(): Promise<{ status: "pending" | "ok" | "error"; message?: string }> {
    if (!this.pendingPin) return { status: "error", message: "no sign-in in progress" };
    const { authToken } = await this.gateway.pollPin(this.pendingPin.id);
    if (!authToken) return { status: "pending" };
    this.token = authToken;
    await this.tokenStore.save(authToken);
    this.pendingPin = null;
    return { status: "ok" };
  }

  requireToken(): string {
    if (!this.token) throw new Error("not signed in");
    return this.token;
  }

  /** Register the stream proxy endpoint for a server on first use.
   *  Uses the cached gateway connection — no extra network round-trip after first browse. */
  async ensureProxyEndpoint(serverId: string): Promise<void> {
    if (this.registeredServers.has(serverId)) return;
    const ep = await this.gateway.endpoint(serverId, this.requireToken());
    this.proxy.registerServer(serverId, ep);
    this.registeredServers.add(serverId);
  }

  findLibrary(libraryId: string): Library {
    const lib = this.libraries.find((l) => l.id === libraryId);
    if (!lib) throw new Error(`unknown library ${libraryId}`);
    return lib;
  }
}

/** Strip a core Track down to the plugin-facing TrackInfo (the renderer's
 *  toTrackInfo equivalent for main): no ids, URLs, or thumbs. */
function toPluginTrackInfo(t: Track): TrackInfo {
  return {
    title: t.title,
    artistName: t.artistName,
    albumTitle: t.albumTitle,
    durationMs: t.durationMs,
    trackNumber: t.trackNumber,
  };
}
