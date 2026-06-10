import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Library, Pin } from "@musex/core";
import { app, safeStorage, shell } from "electron";
import type { PluginNotification } from "../shared/ipc-contract.js";
import { CachingPlexGateway } from "./adapters/caching-plex-gateway.js";
import { ListCacheStore } from "./adapters/list-cache-store.js";
import { MediaCache } from "./adapters/media-cache.js";
import { MpvController } from "./adapters/mpv-controller.js";
import { resolveMpvPaths } from "./adapters/mpv-paths.js";
import { persistence } from "./adapters/persistence.js";
import { PlexapiGateway } from "./adapters/plex-gateway.js";
import { StreamProxy } from "./adapters/stream-proxy.js";
import { SafeStorageTokenStore } from "./adapters/token-store.js";
import { PluginHost } from "./plugins/plugin-host.js";

const ART_CACHE_MAX_BYTES = 1 * 1024 ** 3; // 1 GiB

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
  token: string | null = null;
  libraries: Library[] = [];

  private pendingPin: Pin | null = null;
  private readonly registeredServers = new Set<string>();
  /** Set by main/index per window (like mpv's sink); plugins notify through it. */
  private pluginNotifySink: ((p: PluginNotification) => void) | null = null;

  setPluginNotifySink(sink: ((p: PluginNotification) => void) | null): void {
    this.pluginNotifySink = sink;
  }

  async init(): Promise<void> {
    this.mpv = new MpvController(resolveMpvPaths());
    await this.cache.init();
    await this.listCache.init();
    this.proxy.configureCache(this.cache, () => ({
      enabled: persistence.getCacheEnabled(),
      maxBytes: persistence.getCacheMaxBytes(),
    }));
    await this.artCache.init();
    this.proxy.setArtCache(this.artCache, ART_CACHE_MAX_BYTES);
    await this.proxy.start();

    // Plugin host: userData/plugins always; in dev also <repo>/plugins (the
    // scan helper handles the <name>/dist/plugin.json build-output layout).
    const scanDirs = [path.join(app.getPath("userData"), "plugins")];
    if (!app.isPackaged) scanDirs.push(path.join(__dirname, "../../../../plugins"));
    this.plugins = new PluginHost({
      scanDirs,
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
        if (url.startsWith("https://") || url.startsWith("http://")) {
          void shell.openExternal(url);
        } else {
          console.error(`[plugins] blocked openExternal for non-http(s) URL: ${url}`);
        }
      },
      // v1 stubs — Task 2 (events pipeline) swaps in real implementations
      // backed by the gateway + the playback monitor's history.
      library: {
        search: async () => ({ artists: [], albums: [], tracks: [] }),
        recentlyPlayed: async () => [],
      },
    });
    await this.plugins.loadAll();
  }

  async restore(): Promise<void> {
    this.token = await this.tokenStore.load();
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
