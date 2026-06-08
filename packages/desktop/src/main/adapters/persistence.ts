import { randomUUID } from "node:crypto";
import type { Library } from "@musex/core";
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
};
