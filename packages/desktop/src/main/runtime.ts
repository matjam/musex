import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DownloadJob, Library, Pin, Track } from "@musex/core";
import { dedupeJobs, isHttpUrl, reconcileRecords, TasteProfile } from "@musex/core";
import type { TrackInfo } from "@musex/plugin-api";
import { app, shell } from "electron";
import { buildAf, replaygainMode } from "../logic/audio-filters.js";
import { cacheKey } from "../logic/cache.js";
import type { PluginNotification } from "../shared/ipc-contract.js";
import { CachingPlexGateway } from "./adapters/caching-plex-gateway.js";
import { ConnectivityMonitor } from "./adapters/connectivity-monitor.js";
import { DownloadIndex } from "./adapters/download-index.js";
import { DownloadStore } from "./adapters/download-store.js";
import { LibraryWatcher } from "./adapters/library-watcher.js";
import { ListCacheStore } from "./adapters/list-cache-store.js";
import { MediaCache } from "./adapters/media-cache.js";
import { MpvController } from "./adapters/mpv-controller.js";
import { resolveMpvPaths } from "./adapters/mpv-paths.js";
import { getClientId, persistence } from "./adapters/persistence.js";
import { PlexapiGateway } from "./adapters/plex-gateway.js";
import {
  isSecureStorageAvailable,
  secureDecrypt,
  secureEncrypt,
} from "./adapters/secure-store-host.js";
import { StreamProxy } from "./adapters/stream-proxy.js";
import { SafeStorageTokenStore } from "./adapters/token-store.js";
import { DownloadManager, type DownloadProgressEvent } from "./download/download-manager.js";
import { ExpansionCoordinator } from "./expansion/coordinator.js";
import { LastfmService } from "./lastfm/service.js";
import { CORE_PLUGINS } from "./plugins/core-plugins.js";
import { PlaybackMonitor } from "./plugins/playback-monitor.js";
import { PluginHost } from "./plugins/plugin-host.js";
import { PluginInstaller } from "./plugins/plugin-installer.js";
import { ProviderHub } from "./providers/provider-hub.js";

const ART_CACHE_MAX_BYTES = 1 * 1024 ** 3; // 1 GiB
/** Taste profile writes are debounced: one persist ~5s after the last mutation. */
const TASTE_SAVE_DEBOUNCE_MS = 5_000;
/** How often the connectivity recovery probe pings the current server. Kept
 *  modest so a downed server is noticed quickly but the probe itself is cheap. */
const CONNECTIVITY_PROBE_INTERVAL_MS = 20_000;
/** Per-probe ceiling so an unreachable host can't hang the probe past the
 *  interval (an aborted probe counts as a failure → drives offline promptly). */
const CONNECTIVITY_PROBE_TIMEOUT_MS = 8_000;

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
  /** Debounced reachability state machine. Gateway calls feed it success/
   *  failure; a periodic probe (started in init()) recovers it automatically.
   *  A PlexAuthError never counts as offline (the monitor excludes it). */
  readonly connectivityMonitor = new ConnectivityMonitor();
  readonly proxy = new StreamProxy();
  readonly cache = new MediaCache(path.join(app.getPath("userData"), "media-cache"));
  readonly artCache = new MediaCache(path.join(app.getPath("userData"), "art-cache"));
  /** Pinned on-disk store for offline downloads (never evicts). Served by the
   *  proxy before the LRU media cache. */
  readonly downloadStore = new DownloadStore(path.join(app.getPath("userData"), "downloads"));
  /** In-memory index of download records, persisted via electron-store.
   *  Constructed in init() once the on-disk store has been reconciled. */
  downloadIndex!: DownloadIndex;
  /** Sequential download worker. Constructed in init(). */
  downloadManager!: DownloadManager;
  /** Constructed in init() — resolveMpvPaths needs `app` ready and throws if
   *  mpv can't be found. Null when mpv is unavailable (Linux with no system mpv,
   *  or unsupported platform); playback IPC handlers surface mpvUnavailableReason. */
  mpv: MpvController | null = null;
  /** Human-readable reason set when mpv construction fails; null when mpv is available. */
  mpvUnavailableReason: string | null = null;
  /** Runtime-owned provider registry + fan-out. Created in init() before the
   *  PluginHost so it's ready for first-party registrations (e.g. core:lastfm
   *  in a later cluster) and passed into PluginHost as a dep. */
  providers!: ProviderHub;
  /** The baked-in Last.fm first-party service (non-plugin). */
  lastfmService: LastfmService | null = null;
  /** Constructed + loaded in init() — needs `app` ready (userData paths) and
   *  safeStorage for plugin secrets. */
  plugins!: PluginHost;
  pluginInstaller!: PluginInstaller;
  expansion!: ExpansionCoordinator;
  libraryWatcher!: LibraryWatcher;
  /** Set by main/index per window (same pattern as pluginNotifySink). */
  private libraryChangedSink: ((lib: Library) => void) | null = null;
  /** Set by main/index per window; download progress transitions flow through it. */
  private downloadProgressSink: ((e: DownloadProgressEvent) => void) | null = null;
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
  /** Set by main/index per window; connectivity flips flow through it. */
  private connectivitySink: ((online: boolean) => void) | null = null;

  setPluginNotifySink(sink: ((p: PluginNotification) => void) | null): void {
    this.pluginNotifySink = sink;
  }

  setConnectivitySink(sink: ((online: boolean) => void) | null): void {
    this.connectivitySink = sink;
  }

  /** Push a system notification through the same toast channel as plugin notifications. */
  pushNotification(n: PluginNotification): void {
    this.pluginNotifySink?.(n);
  }

  setLibraryChangedSink(sink: ((lib: Library) => void) | null): void {
    this.libraryChangedSink = sink;
  }

  setDownloadProgressSink(sink: ((e: DownloadProgressEvent) => void) | null): void {
    this.downloadProgressSink = sink;
  }

  async init(): Promise<void> {
    try {
      this.mpv = new MpvController(resolveMpvPaths());
    } catch (err) {
      this.mpvUnavailableReason = err instanceof Error ? err.message : String(err);
      console.error("[musex mpv]", this.mpvUnavailableReason);
    }
    // Seed the controller's cached audio config from persisted prefs — mpv
    // isn't running yet, so this only sets what the next spawn will apply.
    const audioPrefs = persistence.getAudioPrefs();
    if (this.mpv) {
      await this.mpv.applyAudioConfig({
        af: buildAf(audioPrefs),
        replaygain: replaygainMode(audioPrefs),
      });
    }
    await this.cache.init();
    await this.listCache.init();
    this.proxy.configureCache(this.cache, () => ({
      enabled: persistence.getCacheEnabled(),
      maxBytes: persistence.getCacheMaxBytes(),
    }));
    await this.artCache.init();
    this.proxy.setArtCache(this.artCache, ART_CACHE_MAX_BYTES);
    await this.proxy.start();

    // Offline downloads: the on-disk store is served by the proxy before the LRU
    // cache and upstream. Reconcile persisted records against what's actually on
    // disk (a 'downloaded' record whose file vanished → 'missing'), persist the
    // reconciled list, then build the index + the sequential download worker.
    await this.downloadStore.init();
    this.proxy.configureDownloads(this.downloadStore);
    // Drop 0-byte files before reconciling: they are broken "downloaded" entries
    // (e.g. from a truncated/failed transcode) that would otherwise survive as
    // false-green badges and crash mpv. Delete them so reconcileRecords sees them
    // as absent (→ "missing"), clearing the bad state.
    const { nonEmpty, empty } = await this.downloadStore.presentNonEmptyKeys();
    for (const key of empty) {
      try {
        await this.downloadStore.remove(key);
      } catch (err) {
        console.error("[musex downloads] failed to remove 0-byte file:", key, err);
      }
    }
    const reconciled = reconcileRecords(persistence.getDownloadRecords(), new Set(nonEmpty));
    persistence.setDownloadRecords(reconciled);
    this.downloadIndex = new DownloadIndex(reconciled, (all) =>
      persistence.setDownloadRecords(all),
    );
    this.downloadManager = new DownloadManager({
      store: this.downloadStore,
      index: this.downloadIndex,
      fetch: globalThis.fetch,
      // The manager needs {baseUrl, token}; the gateway's endpoint() returns
      // exactly that. Close over the live token (downloads require sign-in).
      endpoint: (serverId) => this.gateway.endpoint(serverId, this.requireToken()),
      clientId: getClientId(),
      getQuality: () => persistence.getStorageQuality(),
      onProgress: (e) => this.downloadProgressSink?.(e),
    });

    const tasteState = persistence.getTasteState();
    if (tasteState) this.tasteProfile.load(tasteState);

    // Playback monitor: emits into the provider hub's event registry (lazily —
    // this.providers is already assigned above, before any playback can happen).
    this.playbackMonitor = new PlaybackMonitor({
      emit: (event, payload) => this.providers.dispatchEvent(event, payload),
      loadHistory: () => persistence.getRecentlyPlayed(),
      saveHistory: (h) => persistence.setRecentlyPlayed(h),
      recordPlay: (track, kind) => {
        this.tasteProfile.recordPlay(track, kind);
        this.saveTasteProfileSoon();
      },
    });

    // Warn once at startup when the OS keyring is unavailable — the token and
    // plugin secrets fall back to tagged plaintext in that case (see secure-store.ts).
    if (!isSecureStorageAvailable()) {
      console.warn(
        "[musex] OS secure storage unavailable — Plex token and plugin secrets stored as plaintext. Install gnome-keyring or kwallet to enable encryption.",
      );
    }

    // Provider hub: Runtime-owned registry + fan-out, shared between
    // first-party (core:lastfm) and plugin registrations.
    this.providers = new ProviderHub();

    // Last.fm first-party service: registers directly on the hub (no plugin sandbox).
    this.lastfmService = new LastfmService();
    this.lastfmService.start(this.providers, {
      getConfig: async () => {
        const cfg = persistence.getLastfmConfig();
        return {
          apiKey: cfg.apiKey,
          apiSecret: (await this.lastfmSecretGet("apiSecret")) ?? "",
          sessionKey: await this.lastfmSecretGet("sessionKey"),
          username: cfg.username,
          scrobbling: cfg.scrobbling,
          loveOnRating: cfg.loveOnRating,
          connection: cfg.connection,
        };
      },
      setConfig: async (patch) => {
        if (patch.sessionKey !== undefined && patch.sessionKey !== null)
          await this.lastfmSecretSet("sessionKey", patch.sessionKey);
        const { sessionKey: _sk, apiKey, apiSecret: _sec, ...rest } = patch;
        if (apiKey !== undefined) persistence.setLastfmConfig({ apiKey });
        if (Object.keys(rest).length > 0) persistence.setLastfmConfig(rest);
      },
      openExternal: (url) => {
        if (isHttpUrl(url)) void shell.openExternal(url);
        else console.error("[lastfm] blocked openExternal for non-http(s) URL:", url);
      },
      notify: (message, level) => {
        this.pluginNotifySink?.({ pluginId: "core:lastfm", message, level: level ?? "info" });
      },
      log: (...args) => console.log("[lastfm]", ...args),
      storageGet: async (key) => persistence.getLastfmData(key),
      storageSet: async (key, value) => persistence.setLastfmData(key, value),
    });

    // Plugin host: no statically bundled core plugins —
    // no filesystem scan for it. Only userData/plugins is scanned for
    // user-installed plugins (e.g. acquisition plugins); core plugin ids win on collision.
    this.plugins = new PluginHost({
      hub: this.providers,
      corePlugins: CORE_PLUGINS,
      scanDirs: [path.join(app.getPath("userData"), "plugins")],
      dataDir: path.join(app.getPath("userData"), "plugin-data"),
      secretsDir: path.join(app.getPath("userData"), "plugin-secrets"),
      encrypt: async (s) => (await secureEncrypt(s)).toString("base64"),
      decrypt: async (s) => (await secureDecrypt(Buffer.from(s, "base64"))).value ?? "",
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

    this.pluginInstaller = new PluginInstaller({
      fetch: globalThis.fetch,
      pluginsDir: path.join(app.getPath("userData"), "plugins"),
      reload: () => this.plugins.reloadAll(),
      getSource: (id) => persistence.getPluginSource(id),
      setSource: (id, src) => persistence.setPluginSource(id, src),
    });

    // Taste expansion: host-owned coordinator over the plugin providers
    // (similar via lastfm + acquisition via an installed acquisition plugin).
    // Pure planning lives in @musex/core's taste-expansion; this wires its inputs.
    this.expansion = new ExpansionCoordinator({
      host: this.providers,
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

    // Connectivity: gateway calls feed the monitor success/failure (see
    // ensureProxyEndpoint); a periodic probe recovers it automatically. Flips
    // are pushed to the renderer through the per-window sink.
    this.connectivityMonitor.onChange((online) => this.connectivitySink?.(online));
    this.connectivityMonitor.start(() => this.probeReachability(), CONNECTIVITY_PROBE_INTERVAL_MS);
  }

  /** Recovery probe for the connectivity monitor. Resolves when the current
   *  server answers (or returns an auth error — that's the sign-in flow's
   *  problem, not an outage), rejects when it's genuinely unreachable.
   *
   *  When signed out / no server is known yet, it resolves as a NO-OP: "not
   *  signed in" must never flip the app to offline. A PlexAuthError thrown by
   *  endpoint() is allowed to propagate — the monitor's noteFailure excludes
   *  it from the offline counter. */
  private async probeReachability(): Promise<void> {
    const token = this.token;
    const serverId = this.libraries[0]?.serverId;
    if (!token || !serverId) return; // signed out → no-op, never flap offline
    // endpoint() reuses the cached connection (cheap); the real reachability
    // test is the fetch against the server root, mirroring the gateway's own
    // cold-probe query and the download manager's token-injected URL.
    const ep = await this.gateway.endpoint(serverId, token);
    const url = `${ep.baseUrl}/?X-Plex-Token=${encodeURIComponent(ep.token)}`;
    // Bound the probe: an unreachable host (dropped packets, not a refused
    // connection) would otherwise hang for the OS TCP timeout (~75s) — far past
    // the 20s probe interval — delaying offline detection and stacking probes.
    // An AbortError on timeout rejects → noteFailure (it's not a PlexAuthError,
    // so it counts toward going offline).
    const res = await globalThis.fetch(url, {
      signal: AbortSignal.timeout(CONNECTIVITY_PROBE_TIMEOUT_MS),
    });
    // 401/403 = reachable-but-unauthorized: the server answered, so it is NOT
    // an outage. Any other non-ok status (5xx, etc.) means the server is in
    // trouble → treat as unreachable.
    if (res.ok || res.status === 401 || res.status === 403) return;
    throw new Error(`Plex server probe returned HTTP ${res.status}`);
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
    let ep: { baseUrl: string; token: string };
    try {
      ep = await this.gateway.endpoint(serverId, this.requireToken());
    } catch (err) {
      // Feed the connectivity monitor (a PlexAuthError is excluded inside
      // noteFailure), then re-throw UNCHANGED so existing handling is intact.
      this.connectivityMonitor.noteFailure(err);
      throw err;
    }
    this.connectivityMonitor.noteSuccess();
    this.proxy.registerServer(serverId, ep);
    this.registeredServers.add(serverId);
  }

  findLibrary(libraryId: string): Library {
    const lib = this.libraries.find((l) => l.id === libraryId);
    if (!lib) throw new Error(`unknown library ${libraryId}`);
    return lib;
  }

  /** Queue a set of tracks for offline download. The download key is keyed
   *  IDENTICALLY to what the stream proxy computes when the track streams
   *  (`cacheKey(serverId, media.partKey)`) — that's what makes the proxy serve
   *  the downloaded file first. Already-present/queued keys are dropped. */
  async enqueueDownloads(tracks: Track[]): Promise<void> {
    const jobs: DownloadJob[] = tracks.map((track) => ({
      key: cacheKey(track.serverId, track.media.partKey),
      serverId: track.serverId,
      plexPath: track.media.partKey,
      trackId: track.id,
      meta: {
        title: track.title,
        artistName: track.artistName,
        albumTitle: track.albumTitle,
        durationMs: track.durationMs,
        thumb: track.thumb,
        trackNumber: track.trackNumber,
        albumId: track.albumId,
        artistId: track.artistId,
        // Full media info so the record can be rebuilt into a playable Track
        // offline (partKey == plexPath, so it isn't duplicated here).
        container: track.media.container,
        audioCodec: track.media.audioCodec,
        partId: track.media.partId,
        bitrate: track.media.bitrate,
      },
    }));
    const fresh = dedupeJobs(jobs, new Set(this.downloadIndex.list().map((r) => r.key)));
    await this.downloadManager.enqueue(fresh);
  }

  // ── Last.fm secret helpers (base64 safeStorage blobs in plugin-secrets dir) ─

  private readonly lastfmSecretsCache = new Map<string, string | null>();

  async lastfmSecretGet(key: string): Promise<string | null> {
    if (this.lastfmSecretsCache.has(key)) return this.lastfmSecretsCache.get(key) ?? null;
    // Reuse the same encrypted path as the plugin system would: plugin-secrets/lastfm/<key>
    const { readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { app } = await import("electron");
    const filePath = join(app.getPath("userData"), "plugin-secrets", "lastfm", key);
    try {
      const buf = await readFile(filePath);
      const { value } = await secureDecrypt(buf);
      this.lastfmSecretsCache.set(key, value);
      return value;
    } catch {
      this.lastfmSecretsCache.set(key, null);
      return null;
    }
  }

  async lastfmSecretSet(key: string, value: string): Promise<void> {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { app } = await import("electron");
    const dir = join(app.getPath("userData"), "plugin-secrets", "lastfm");
    await mkdir(dir, { recursive: true });
    const buf = await secureEncrypt(value);
    await writeFile(join(dir, key), buf);
    this.lastfmSecretsCache.set(key, value);
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
