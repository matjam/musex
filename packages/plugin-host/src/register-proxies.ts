/**
 * registerHubProxies — pure, transport-agnostic wiring of a guest plugin's
 * registrations into a ProviderHub.
 *
 * Given a registration snapshot (`BridgeRegState`) and a single `callGuest`
 * channel (which invokes a registered guest provider method and returns its
 * JSON-decoded result), this builds provider proxies and registers them into
 * the hub. It has NO knowledge of how `callGuest` reaches the guest — desktop
 * drives it through an in-process QuickJS context; mobile through a WebView
 * postMessage transport. Both call this identically.
 *
 * This is the logic that previously lived inside the bridge's
 * `registerHubEntries`; the bridge now delegates here.
 */

import type {
  AcquirableAlbum,
  AcquisitionProvider,
  AcquisitionStatusItem,
  ArtistInfo,
  ExternalArtistResult,
  PluginEvents,
  RecommendContext,
  RecommendedTrack,
  Section,
  SectionContext,
  SectionProvider,
  SimilarItem,
  SimilarProvider,
  TrackAction,
  TrackDetailProvider,
  TrackInfo,
  TrackRecommender,
} from "@musex/plugin-api";
import type { ProviderHub } from "./provider-hub.js";
import type { BridgeRegState } from "./types.js";

/** Channel to invoke a registered guest provider method by registry path. */
export type CallGuest = (path: string, method: string, ...args: unknown[]) => Promise<unknown>;

/**
 * Build provider proxies from `regState` (calling into the guest via
 * `callGuest`) and register them into `hub`. Each hub disposable is forwarded
 * to `trackDisposable` so the caller can tear them down on deactivation.
 *
 * Settings actions are NOT hub registrations — they were already wired up by
 * the host before this is called (the bridge installs them via onSettingsAction
 * in its own registerHubEntries shim), so they are intentionally not handled
 * here. Event handlers, however, ARE hub subscriptions and are wired here.
 */
export function registerHubProxies(
  hub: ProviderHub,
  pluginId: string,
  regState: BridgeRegState,
  callGuest: CallGuest,
  trackDisposable: (d: { dispose(): void }) => void,
): void {
  // ── Proxy builders (each captures callGuest) ──────────────────────────────

  function makeAcquisitionProxy(optMethods: Set<string>): AcquisitionProvider {
    const proxy: AcquisitionProvider = {
      id: pluginId,
      async lookupArtistAlbums(artistName) {
        return callGuest("acquisition", "lookupArtistAlbums", artistName) as Promise<
          AcquirableAlbum[]
        >;
      },
      async acquireAlbum(providerRef) {
        await callGuest("acquisition", "acquireAlbum", providerRef);
      },
      async status() {
        return callGuest("acquisition", "status") as Promise<AcquisitionStatusItem[]>;
      },
    };
    // Only include optional methods if the guest provider actually defined them.
    if (optMethods.has("searchArtists")) {
      proxy.searchArtists = async (term) => {
        return callGuest("acquisition", "searchArtists", term) as Promise<ExternalArtistResult[]>;
      };
    }
    if (optMethods.has("acquireArtist")) {
      proxy.acquireArtist = async (providerRef) => {
        await callGuest("acquisition", "acquireArtist", providerRef);
      };
    }
    if (optMethods.has("cancelAlbum")) {
      proxy.cancelAlbum = async (providerRef) => {
        await callGuest("acquisition", "cancelAlbum", providerRef);
      };
    }
    if (optMethods.has("watchNewReleases")) {
      proxy.watchNewReleases = async (artistName, enabled) => {
        await callGuest("acquisition", "watchNewReleases", artistName, enabled);
      };
    }
    if (optMethods.has("isWatchingNewReleases")) {
      proxy.isWatchingNewReleases = async (artistName) => {
        return callGuest("acquisition", "isWatchingNewReleases", artistName) as Promise<boolean>;
      };
    }
    if (optMethods.has("listWatchedArtists")) {
      proxy.listWatchedArtists = async () => {
        return callGuest("acquisition", "listWatchedArtists") as Promise<string[]>;
      };
    }
    if (optMethods.has("listMonitoredArtists")) {
      proxy.listMonitoredArtists = async () => {
        return callGuest("acquisition", "listMonitoredArtists") as Promise<string[]>;
      };
    }
    return proxy;
  }

  function makeRecommenderProxy(): TrackRecommender {
    return {
      id: pluginId,
      async recommend(context: RecommendContext) {
        return callGuest("recommender", "recommend", context) as Promise<RecommendedTrack[]>;
      },
    };
  }

  function makeSimilarProxy(simId: string): SimilarProvider {
    return {
      id: simId,
      async similarArtists(artistName) {
        return callGuest(`similar:${simId}`, "similarArtists", artistName) as Promise<
          SimilarItem[]
        >;
      },
      async similarTracks(seed) {
        return callGuest(`similar:${simId}`, "similarTracks", seed) as Promise<SimilarItem[]>;
      },
      async topAlbums(artistName) {
        return callGuest(`similar:${simId}`, "topAlbums", artistName) as Promise<
          { title: string }[]
        >;
      },
      async artistInfo(artistName) {
        return callGuest(
          `similar:${simId}`,
          "artistInfo",
          artistName,
        ) as Promise<ArtistInfo | null>;
      },
    };
  }

  function makeSectionProxy(secId: string): SectionProvider {
    return {
      id: secId,
      async getSections(secCtx: SectionContext) {
        return callGuest(`sections:${secId}`, "getSections", secCtx) as Promise<Section[]>;
      },
    };
  }

  function makeTrackActionProxy(actionId: string): TrackAction {
    const meta = regState.trackActionMeta[actionId];
    const action: TrackAction = {
      id: actionId,
      label: meta?.label ?? actionId,
      async onInvoke(track: TrackInfo) {
        await callGuest(`trackAction:${actionId}`, "onInvoke", track);
      },
    };
    if (meta?.icon !== undefined) action.icon = meta.icon;
    return action;
  }

  function makeTrackDetailProxy(detailId: string): TrackDetailProvider {
    return {
      id: detailId,
      async getDetail(track: TrackInfo) {
        return callGuest(`trackDetail:${detailId}`, "getDetail", track) as Promise<{
          title: string;
          rows: { label: string; value: string }[];
        } | null>;
      },
    };
  }

  // ── Register into the hub ──────────────────────────────────────────────────

  if (regState.acquisition) {
    trackDisposable(
      hub.registerAcquisitionProvider(
        pluginId,
        makeAcquisitionProxy(new Set(regState.acquisitionMethods)),
      ),
    );
  }

  if (regState.recommender) {
    trackDisposable(hub.registerTrackRecommender(pluginId, makeRecommenderProxy()));
  }

  for (const simId of regState.similar) {
    trackDisposable(hub.registerSimilarProvider(pluginId, makeSimilarProxy(simId)));
  }

  for (const [secId, target] of Object.entries(regState.sections)) {
    trackDisposable(
      hub.contributeSections(pluginId, target as "discover" | "home", makeSectionProxy(secId)),
    );
  }

  for (const actionId of regState.trackActions) {
    trackDisposable(hub.contributeTrackAction(pluginId, makeTrackActionProxy(actionId)));
  }

  for (const detailId of regState.trackDetail) {
    trackDisposable(hub.contributeTrackDetail(pluginId, makeTrackDetailProxy(detailId)));
  }

  // Event handlers: hub events the guest registered for. Dispatch back into the
  // guest through the same callGuest channel via the reserved "__emit" path.
  for (const event of regState.eventHandlers) {
    const typedEvent = event as keyof PluginEvents;
    trackDisposable(
      hub.onEvent(pluginId, typedEvent, (payload) => {
        // Fire and forget — emit to the guest asynchronously.
        void callGuest("__emit", event, payload).catch((err) => {
          console.error(`[plugin:${pluginId}] __emit error:`, err);
        });
      }),
    );
  }
}
