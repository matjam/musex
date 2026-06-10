import type {
  Disposable,
  LibrarySearchResult,
  PluginContext,
  PluginEvents,
  PluginManifest,
  SectionProvider,
  SettingField,
  SettingsActionResult,
  SimilarProvider,
  TrackAction,
  TrackDetailProvider,
  TrackInfo,
  TrackRecommender,
} from "@musex/plugin-api";
import type { PluginNotification } from "../../shared/ipc-contract.js";
import type { PluginSecrets, PluginStorage } from "./plugin-store.js";

export interface PluginEventSubscriber {
  pluginId: string;
  event: keyof PluginEvents;
  handler: (payload: PluginEvents[keyof PluginEvents]) => void;
}
export interface RegisteredSectionProvider {
  pluginId: string;
  target: "discover" | "home";
  provider: SectionProvider;
}
export interface RegisteredTrackAction {
  pluginId: string;
  action: TrackAction;
}
export interface RegisteredTrackDetailProvider {
  pluginId: string;
  provider: TrackDetailProvider;
}
export interface RegisteredTrackRecommender {
  pluginId: string;
  recommender: TrackRecommender;
}
export interface RegisteredSimilarProvider {
  pluginId: string;
  provider: SimilarProvider;
}

/** Registrations from all active plugins. Stored now; consumed by the events
 *  pipeline (Task 2) and the sections/actions/detail surfaces (Task 4). */
export interface PluginRegistry {
  eventSubscribers: PluginEventSubscriber[];
  sectionProviders: RegisteredSectionProvider[];
  trackActions: RegisteredTrackAction[];
  trackDetailProviders: RegisteredTrackDetailProvider[];
  trackRecommenders: RegisteredTrackRecommender[];
  similarProviders: RegisteredSimilarProvider[];
}

export function createPluginRegistry(): PluginRegistry {
  return {
    eventSubscribers: [],
    sectionProviders: [],
    trackActions: [],
    trackDetailProviders: [],
    trackRecommenders: [],
    similarProviders: [],
  };
}

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

/** Push `entry` into a registry list, returning (and tracking) a Disposable
 *  that removes it again. */
function register<T>(list: T[], entry: T, track: (d: Disposable) => void): Disposable {
  list.push(entry);
  const d: Disposable = {
    dispose() {
      const i = list.indexOf(entry);
      if (i !== -1) list.splice(i, 1);
    },
  };
  track(d);
  return d;
}

export function buildPluginContext(
  manifest: PluginManifest,
  deps: PluginContextDeps,
  registry: PluginRegistry,
  trackDisposable: (d: Disposable) => void,
): PluginContext {
  const prefix = `[plugin:${manifest.id}]`;
  return {
    manifest,
    log: (msg, ...args) => console.log(prefix, msg, ...args),
    storage: deps.storage,
    secrets: deps.secrets,
    fetch: globalThis.fetch,
    events: {
      on(event, handler) {
        const subscriber: PluginEventSubscriber = {
          pluginId: manifest.id,
          event,
          // Safe: the emitter (Task 2) always dispatches the payload matching
          // the subscriber's stored event key.
          handler: handler as (payload: PluginEvents[keyof PluginEvents]) => void,
        };
        return register(registry.eventSubscribers, subscriber, trackDisposable);
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
        return register(
          registry.sectionProviders,
          { pluginId: manifest.id, target, provider },
          trackDisposable,
        );
      },
      contributeTrackAction(action) {
        return register(registry.trackActions, { pluginId: manifest.id, action }, trackDisposable);
      },
      contributeTrackDetail(provider) {
        return register(
          registry.trackDetailProviders,
          { pluginId: manifest.id, provider },
          trackDisposable,
        );
      },
      registerSimilarProvider(provider) {
        return register(
          registry.similarProviders,
          { pluginId: manifest.id, provider },
          trackDisposable,
        );
      },
    },
    registerTrackRecommender(recommender) {
      return register(
        registry.trackRecommenders,
        { pluginId: manifest.id, recommender },
        trackDisposable,
      );
    },
    registerSettings: (schema) => deps.registerSettings(schema),
    onSettingsAction: (key, handler) => deps.onSettingsAction(key, handler),
  };
}
