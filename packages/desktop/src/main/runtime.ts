import type { Library, Pin } from "@musex/core";
import { shell } from "electron";
import { PlexapiGateway } from "./adapters/plex-gateway.js";
import { StreamProxy } from "./adapters/stream-proxy.js";
import { SafeStorageTokenStore } from "./adapters/token-store.js";

export class Runtime {
  readonly gateway = new PlexapiGateway();
  readonly tokenStore = new SafeStorageTokenStore();
  readonly proxy = new StreamProxy();
  token: string | null = null;
  libraries: Library[] = [];

  private pendingPin: Pin | null = null;
  private readonly registeredServers = new Set<string>();

  async init(): Promise<void> {
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
