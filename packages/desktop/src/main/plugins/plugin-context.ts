import type {
  Disposable,
  LibrarySearchResult,
  PluginContext,
  PluginEvents,
  PluginManifest,
  SettingField,
  SettingsActionResult,
  TrackInfo,
} from "@musex/plugin-api";
import type { PluginNotification } from "../../shared/ipc-contract.js";
import type { ProviderHub } from "../providers/provider-hub.js";
import { createNetClient } from "./net-client.js";
import type { PluginSecrets, PluginStorage } from "./plugin-store.js";

// Re-export registry types from provider-hub so callers that import them from
// here continue to work without needing to change their imports.
export type {
  PluginEventSubscriber,
  PluginRegistry,
  RegisteredAcquisitionProvider,
  RegisteredSectionProvider,
  RegisteredSimilarProvider,
  RegisteredTrackAction,
  RegisteredTrackDetailProvider,
  RegisteredTrackRecommender,
} from "../providers/provider-hub.js";
export { createPluginRegistry } from "../providers/provider-hub.js";

/** Everything a plugin's context needs from the host, injected so the ctx
 *  builder stays pure and testable (no Electron imports anywhere here). */
export interface PluginContextDeps {
  storage: PluginStorage;
  secrets: PluginSecrets;
  notifySink: (payload: PluginNotification) => void;
  openExternal: (url: string) => void;
  library: {
    search(query: string): Promise<LibrarySearchResult>;
    recentlyPlayed(limit?: number): Promise<TrackInfo[]>;
    topArtists(limit?: number): Promise<{ name: string; score: number }[]>;
  };
  registerSettings: (schema: SettingField[]) => void;
  onSettingsAction: (key: string, handler: () => Promise<SettingsActionResult>) => void;
}

export function buildPluginContext(
  manifest: PluginManifest,
  deps: PluginContextDeps,
  hub: ProviderHub,
  trackDisposable: (d: Disposable) => void,
): PluginContext {
  const prefix = `[plugin:${manifest.id}]`;
  return {
    manifest,
    log: (msg, ...args) => console.log(prefix, msg, ...args),
    storage: deps.storage,
    secrets: deps.secrets,
    fetch: globalThis.fetch,
    net: { client: (opts) => createNetClient(opts) },
    events: {
      on<K extends keyof PluginEvents>(event: K, handler: (payload: PluginEvents[K]) => void) {
        return hub.registerTracked(
          hub.registry.eventSubscribers,
          {
            pluginId: manifest.id,
            event,
            // Safe: the emitter always dispatches the payload matching the stored event key.
            handler: handler as (payload: PluginEvents[keyof PluginEvents]) => void,
          },
          trackDisposable,
        );
      },
    },
    library: {
      search: (query) => deps.library.search(query),
      recentlyPlayed: (limit) => deps.library.recentlyPlayed(limit),
      topArtists: (limit) => deps.library.topArtists(limit),
    },
    ui: {
      notify(message, level = "info") {
        deps.notifySink({ pluginId: manifest.id, message, level });
      },
      openExternal(url) {
        deps.openExternal(url);
      },
      contributeSections(target, provider) {
        return hub.registerTracked(
          hub.registry.sectionProviders,
          { pluginId: manifest.id, target, provider },
          trackDisposable,
        );
      },
      contributeTrackAction(action) {
        return hub.registerTracked(
          hub.registry.trackActions,
          { pluginId: manifest.id, action },
          trackDisposable,
        );
      },
      contributeTrackDetail(provider) {
        return hub.registerTracked(
          hub.registry.trackDetailProviders,
          { pluginId: manifest.id, provider },
          trackDisposable,
        );
      },
      registerSimilarProvider(provider) {
        return hub.registerTracked(
          hub.registry.similarProviders,
          { pluginId: manifest.id, provider },
          trackDisposable,
        );
      },
    },
    registerTrackRecommender(recommender) {
      return hub.registerTracked(
        hub.registry.trackRecommenders,
        { pluginId: manifest.id, recommender },
        trackDisposable,
      );
    },
    registerAcquisitionProvider(provider) {
      return hub.registerTracked(
        hub.registry.acquisitionProviders,
        { pluginId: manifest.id, provider },
        trackDisposable,
      );
    },
    registerSettings: (schema) => deps.registerSettings(schema),
    onSettingsAction: (key, handler) => deps.onSettingsAction(key, handler),
  };
}
