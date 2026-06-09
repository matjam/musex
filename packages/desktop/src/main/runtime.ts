import path from "node:path";
import type { Library, Pin } from "@musex/core";
import { app, shell } from "electron";
import { CachingPlexGateway } from "./adapters/caching-plex-gateway.js";
import { ListCacheStore } from "./adapters/list-cache-store.js";
import { MediaCache } from "./adapters/media-cache.js";
import { persistence } from "./adapters/persistence.js";
import { PlexapiGateway } from "./adapters/plex-gateway.js";
import { StreamProxy } from "./adapters/stream-proxy.js";
import { SafeStorageTokenStore } from "./adapters/token-store.js";

const ART_CACHE_MAX_BYTES = 1 * 1024 ** 3; // 1 GiB

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
  token: string | null = null;
  libraries: Library[] = [];

  private pendingPin: Pin | null = null;
  private readonly registeredServers = new Set<string>();

  async init(): Promise<void> {
    await this.cache.init();
    await this.listCache.init();
    this.proxy.configureCache(this.cache, () => ({
      enabled: persistence.getCacheEnabled(),
      maxBytes: persistence.getCacheMaxBytes(),
    }));
    await this.artCache.init();
    this.proxy.setArtCache(this.artCache, ART_CACHE_MAX_BYTES);
    await this.proxy.start();
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
