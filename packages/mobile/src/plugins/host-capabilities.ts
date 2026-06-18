/**
 * RN host capabilities — the implementations behind the WebView harness's
 * `hostCall` messages. `makeHostCallHandler(deps)` returns the function the
 * WebViewTransport routes inbound `hostCall`s to; it dispatches by capability
 * name to the injected deps.
 *
 * Storage and secrets are namespaced PER PLUGIN so two plugins can't read each
 * other's keys. The actual byte stores (async-storage / expo-secure-store) are
 * injected as primitive get/set fns so this module stays pure + unit-testable.
 */

import type {
  LibrarySearchResult,
  NetFetchInit,
  NetFetchResponse,
  SettingField,
  TrackInfo,
} from "@musex/plugin-api";
import type { PluginNotification } from "@musex/plugin-host/sandbox";

export interface HostCapDeps {
  /** Raw key/value store (async-storage). Keys are already namespaced by the
   *  handler; these see the full namespaced key. */
  storageGet: (key: string) => Promise<string | null>;
  storageSet: (key: string, value: string | null) => Promise<void>;
  /** Raw secret store (expo-secure-store), namespaced by the handler. */
  secretsGet: (key: string) => Promise<string | null>;
  secretsSet: (key: string, value: string | null) => Promise<void>;
  /** RN fetch -> NetFetchResponse. allowSelfSigned is ignored (v1; RN fetch
   *  can't relax TLS). */
  netFetch: (url: string, init?: NetFetchInit) => Promise<NetFetchResponse>;
  library: {
    search: (query: string) => Promise<LibrarySearchResult>;
    recentlyPlayed: (limit?: number) => Promise<TrackInfo[]>;
    topArtists: (limit?: number) => Promise<{ name: string; score: number }[]>;
  };
  notify: (payload: PluginNotification) => void;
  openExternal: (url: string) => void;
  log: (pluginId: string, message: unknown, args: unknown[]) => void;
  /** Declarative settings schema a plugin registered. */
  registerSettings: (pluginId: string, schema: SettingField[]) => void;
}

const STORAGE_PREFIX = "musex.plugin-storage";
const SECRETS_PREFIX = "musex.plugin-secret";

/** Namespace a plugin's storage key so plugins can't collide or read across. */
function storageKey(pluginId: string, key: string): string {
  return `${STORAGE_PREFIX}:${pluginId}:${key}`;
}
function secretKey(pluginId: string, key: string): string {
  return `${SECRETS_PREFIX}:${pluginId}:${key}`;
}

export function makeHostCallHandler(
  deps: HostCapDeps,
): (pluginId: string, name: string, args: unknown[]) => Promise<unknown> {
  return async (pluginId, name, args) => {
    switch (name) {
      case "storageGet": {
        const raw = await deps.storageGet(storageKey(pluginId, args[0] as string));
        return raw === null ? null : JSON.parse(raw);
      }
      case "storageSet": {
        const value = args[1];
        await deps.storageSet(
          storageKey(pluginId, args[0] as string),
          value === undefined ? null : JSON.stringify(value),
        );
        return null;
      }
      case "secretsGet":
        return deps.secretsGet(secretKey(pluginId, args[0] as string));
      case "secretsSet":
        await deps.secretsSet(secretKey(pluginId, args[0] as string), args[1] as string | null);
        return null;
      case "netFetch":
        return deps.netFetch(args[0] as string, args[1] as NetFetchInit | undefined);
      case "librarySearch":
        return deps.library.search(args[0] as string);
      case "libraryRecentlyPlayed":
        return deps.library.recentlyPlayed(args[0] as number | undefined);
      case "libraryTopArtists":
        return deps.library.topArtists(args[0] as number | undefined);
      case "notify": {
        const p = (args[0] ?? {}) as Partial<PluginNotification>;
        deps.notify({
          pluginId,
          message: String(p.message ?? ""),
          level: p.level === "error" ? "error" : "info",
        });
        return null;
      }
      case "openExternal": {
        const url = args[0] as string;
        if (typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"))) {
          deps.openExternal(url);
        }
        return null;
      }
      case "log":
        deps.log(pluginId, args[0], args.slice(1));
        return null;
      case "registerSettings":
        deps.registerSettings(pluginId, (args[0] as SettingField[]) ?? []);
        return null;
      default:
        throw new Error(`unknown host capability: ${name}`);
    }
  };
}
