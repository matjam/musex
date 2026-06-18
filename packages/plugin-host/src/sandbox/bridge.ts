/**
 * QuickJS bridge — builds the guest `ctx` (v2 PluginContext shape) from host
 * dependencies. This is the security boundary: plugins get ONLY the preamble
 * globals + the bridged ctx. No Node, no import(), no Electron.
 *
 * Protocol (ported from spike/quickjs-sandbox harness.mjs):
 *   - Host capabilities are installed on globalThis.__host as named functions.
 *   - Async host fns return a guest Promise settled from real host async work.
 *   - The guest ctx, registry, __invoke (host→guest) and __emit (host→guest
 *     events) are installed via guest evalCode so no host handles reference
 *     guest functions directly.
 *   - __invoke(path, method, argsJson) — the host calls a registered guest
 *     provider method; returns a guest Promise resolving to a JSON string.
 *   - __emit(event, payloadJson) — the host dispatches an event to the guest.
 */

import type {
  LibrarySearchResult,
  NetFetchInit,
  NetFetchResponse,
  PluginManifest,
  SettingField,
  SettingsActionResult,
  TrackInfo,
} from "@musex/plugin-api";
import type { ProviderHub } from "../provider-hub.js";
import { registerHubProxies } from "../register-proxies.js";
import type { BridgeRegState } from "../types.js";
import type { SandboxContext } from "./quickjs-host.js";
import { fromGuest, toGuest } from "./quickjs-host.js";

/** Structural shape of the host toast payload (mirrors desktop's
 *  ipc-contract PluginNotification; inlined so the package stays free of any
 *  desktop import). */
export interface PluginNotification {
  pluginId: string;
  message: string;
  level: "info" | "error";
}

export interface BridgeDeps {
  manifest: PluginManifest;
  pluginId: string;
  netFetch: (url: string, init?: NetFetchInit) => Promise<NetFetchResponse>;
  storage: {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, v: T): Promise<void>;
  };
  secrets: {
    get(key: string): Promise<string | null>;
    set(key: string, v: string | null): Promise<void>;
  };
  library: {
    search(query: string): Promise<LibrarySearchResult>;
    recentlyPlayed(limit?: number): Promise<TrackInfo[]>;
    topArtists(limit?: number): Promise<{ name: string; score: number }[]>;
  };
  notifySink: (payload: PluginNotification) => void;
  openExternal: (url: string) => void;
  hub: ProviderHub;
  registerSettings: (schema: SettingField[]) => void;
  onSettingsAction: (key: string, handler: () => Promise<SettingsActionResult>) => void;
  /** Disposables accumulated by hub registrations (for cleanup on dispose). */
  trackDisposable: (d: { dispose(): void }) => void;
}

export interface BridgeResult {
  dispose(): void;
  /** Call after activate() to register hub entries for what the guest registered. */
  registerHubEntries(): void;
  /** Low-level: invoke a guest registry entry and return the JSON result. */
  callGuest(path: string, method: string, ...args: unknown[]): Promise<unknown>;
  /** Current registration state snapshot. */
  regState(): BridgeRegState;
}

export type { BridgeRegState } from "../types.js";

/**
 * installBridge sets up the guest-visible `ctx` object and the __invoke /
 * __emit shims. Returns a BridgeResult whose dispose() cleans up host-side
 * handles and hub registrations.
 */
export function installBridge(sc: SandboxContext, deps: BridgeDeps): BridgeResult {
  const ctx = sc.context;
  const disposables: { dispose(): void }[] = [];

  // ── Install __hostLog so console shim routes through it ─────────────────
  ctx
    .newFunction("__hostLog", (msgHandle) => {
      const msg = fromGuest(ctx, msgHandle);
      console.log(`[plugin:${deps.pluginId}]`, msg);
      return ctx.undefined;
    })
    .consume((fn) => ctx.setProp(ctx.global, "__hostLog", fn));

  // ── Build __host object on globalThis ────────────────────────────────────
  const hostObj = ctx.newObject();
  disposables.push(hostObj);

  /** Register an async host function that returns a guest Promise settled from
   *  the real host async operation. */
  function asyncFn(name: string, impl: (...args: unknown[]) => Promise<unknown>) {
    const fn = ctx.newFunction(name, (...argHandles) => {
      const args = argHandles.map((h) => fromGuest(ctx, h));
      const promise = ctx.newPromise();
      Promise.resolve()
        .then(() => impl(...args))
        .then(
          (out) => {
            const h = toGuest(ctx, out);
            promise.resolve(h);
            h.dispose();
          },
          (err) => {
            const h = toGuest(ctx, { message: (err as Error)?.message ?? String(err) });
            promise.reject(h);
            h.dispose();
          },
        )
        .finally(() => {
          promise.settled.then(() => ctx.runtime.executePendingJobs());
        });
      return promise.handle;
    });
    disposables.push(fn);
    fn.consume((f) => ctx.setProp(hostObj, name, f));
  }

  /** Register a sync host function (fire-and-forget: log, notify, etc.). */
  function syncFn(name: string, impl: (...args: unknown[]) => void) {
    const fn = ctx.newFunction(name, (...argHandles) => {
      impl(...argHandles.map((h) => fromGuest(ctx, h)));
      return ctx.undefined;
    });
    disposables.push(fn);
    fn.consume((f) => ctx.setProp(hostObj, name, f));
  }

  // Core capabilities
  syncFn("log", (msg, ...args) => {
    console.log(`[plugin:${deps.pluginId}]`, msg, ...args);
  });
  asyncFn("storageGet", (key) => deps.storage.get(key as string));
  asyncFn("storageSet", (key, v) => deps.storage.set(key as string, v));
  asyncFn("secretsGet", (key) => deps.secrets.get(key as string));
  asyncFn("secretsSet", (key, v) => deps.secrets.set(key as string, v as string | null));
  asyncFn("netFetch", (url, init) =>
    deps.netFetch(url as string, init as NetFetchInit | undefined),
  );
  asyncFn("librarySearch", (q) => deps.library.search(q as string));
  asyncFn("libraryRecentlyPlayed", (limit) =>
    deps.library.recentlyPlayed(limit as number | undefined),
  );
  asyncFn("libraryTopArtists", (limit) => deps.library.topArtists(limit as number | undefined));
  syncFn("notify", (message, level) => {
    deps.notifySink({
      pluginId: deps.pluginId,
      message: message as string,
      level: (level as "info" | "error") ?? "info",
    });
  });
  syncFn("openExternal", (url) => {
    const u = url as string;
    if (u.startsWith("http://") || u.startsWith("https://")) {
      deps.openExternal(u);
    }
  });
  syncFn("registerSettings", (schema) => {
    deps.registerSettings(schema as SettingField[]);
  });

  ctx.setProp(ctx.global, "__host", hostObj);
  const manifest = toGuest(ctx, deps.manifest);
  ctx.setProp(ctx.global, "__manifest", manifest);
  manifest.dispose();

  // ── Guest preamble: ctx, __registry, __invoke, __emit ───────────────────
  ctx
    .unwrapResult(
      ctx.evalCode(`
      const H = globalThis.__host;

      // Registry keyed by kind:
      //   acquisition: the single AcquisitionProvider object (or null)
      //   recommender: the single TrackRecommender object (or null)
      //   similar: { [id]: provider }
      //   sections: { [id]: { target, provider } }
      //   trackActions: { [id]: action }
      //   trackDetail: { [id]: provider }
      //   settingsActions: { [key]: handler }
      //   eventHandlers: { [event]: [handler, ...] }
      globalThis.__registry = {
        acquisition: null,
        recommender: null,
        similar: {},
        sections: {},
        trackActions: {},
        trackDetail: {},
        settingsActions: {},
        eventHandlers: {},
      };

      const disp = () => ({ dispose() {} });

      globalThis.ctx = {
        manifest: globalThis.__manifest,

        log: (msg, ...args) => H.log(msg, ...args),

        storage: {
          get: (k) => H.storageGet(k),
          set: (k, v) => H.storageSet(k, v),
        },

        secrets: {
          get: (k) => H.secretsGet(k),
          set: (k, v) => H.secretsSet(k, v),
        },

        // v2 RPC-shaped fetch: returns { ok, status, headers, body }
        net: {
          fetch: (url, init) => H.netFetch(url, init),
        },

        events: {
          on: (event, handler) => {
            if (!__registry.eventHandlers[event]) __registry.eventHandlers[event] = [];
            __registry.eventHandlers[event].push(handler);
            return disp();
          },
        },

        library: {
          search: (q) => H.librarySearch(q),
          recentlyPlayed: (limit) => H.libraryRecentlyPlayed(limit),
          topArtists: (limit) => H.libraryTopArtists(limit),
        },

        ui: {
          notify: (m, level) => H.notify(m, level),
          openExternal: (u) => H.openExternal(u),
          contributeSections: (target, provider) => {
            __registry.sections[provider.id] = { target, provider };
            return disp();
          },
          contributeTrackAction: (action) => {
            __registry.trackActions[action.id] = action;
            return disp();
          },
          contributeTrackDetail: (provider) => {
            __registry.trackDetail[provider.id] = provider;
            return disp();
          },
          registerSimilarProvider: (provider) => {
            __registry.similar[provider.id] = provider;
            return disp();
          },
        },

        registerTrackRecommender: (recommender) => {
          __registry.recommender = recommender;
          return disp();
        },

        registerAcquisitionProvider: (provider) => {
          __registry.acquisition = provider;
          return disp();
        },

        registerSettings: (schema) => H.registerSettings(schema),

        onSettingsAction: (key, handler) => {
          __registry.settingsActions[key] = handler;
        },
      };

      // host->guest invoke:
      //   path = "acquisition" | "recommender" | "similar:<id>"
      //          | "trackAction:<id>" | "trackDetail:<id>"
      //          | "sections:<id>" | "settingsAction"
      // Returns a guest Promise resolving to a JSON string of the result.
      globalThis.__invoke = (path, method, argsJson) => {
        const args = JSON.parse(argsJson);
        let obj;
        if (path === "acquisition") {
          obj = __registry.acquisition;
        } else if (path === "recommender") {
          obj = __registry.recommender;
        } else if (path.startsWith("similar:")) {
          obj = __registry.similar[path.slice(8)];
        } else if (path.startsWith("trackAction:")) {
          obj = __registry.trackActions[path.slice(12)];
        } else if (path.startsWith("trackDetail:")) {
          obj = __registry.trackDetail[path.slice(12)];
        } else if (path.startsWith("sections:")) {
          obj = __registry.sections[path.slice(9)]?.provider;
        } else if (path === "settingsAction") {
          obj = __registry.settingsActions;
          const call = obj?.[method]?.();
          return Promise.resolve(call).then((r) => JSON.stringify(r === undefined ? null : r));
        } else if (path === "__emit") {
          // Reserved path: host->guest event dispatch routed through callGuest.
          // method = event name; args[0] = the (already-parsed) payload.
          globalThis.__emit(method, JSON.stringify(args[0]));
          return Promise.resolve(JSON.stringify(null));
        }
        if (!obj) return Promise.resolve(JSON.stringify(null));
        const method_fn = obj[method];
        if (typeof method_fn !== "function") return Promise.resolve(JSON.stringify(null));
        const call = method_fn.apply(obj, args);
        return Promise.resolve(call).then((r) => JSON.stringify(r === undefined ? null : r));
      };

      // host->guest event dispatch
      globalThis.__emit = (event, payloadJson) => {
        const payload = JSON.parse(payloadJson);
        const handlers = __registry.eventHandlers[event];
        if (!handlers) return;
        for (const h of handlers) {
          try { h(payload); } catch (_e) {}
        }
      };

      // Registry state snapshot — used by host to decide what to register.
      // sections: { [id]: target } so the host knows which target to use.
      globalThis.__regState = () => {
        // Detect which optional acquisition methods the guest provider defines.
        const optionalAcqMethods = ["acquireArtist","cancelAlbum","watchNewReleases",
          "isWatchingNewReleases","listWatchedArtists","listMonitoredArtists","searchArtists"];
        const acq = __registry.acquisition;
        const acquisitionMethods = acq
          ? optionalAcqMethods.filter((m) => typeof acq[m] === "function")
          : [];
        return JSON.stringify({
          acquisition: acq !== null,
          acquisitionMethods,
          recommender: __registry.recommender !== null,
          settingsActions: Object.keys(__registry.settingsActions),
          similar: Object.keys(__registry.similar),
          sections: Object.fromEntries(
            Object.entries(__registry.sections).map(([id, v]) => [id, v.target])
          ),
          trackActions: Object.keys(__registry.trackActions),
          trackActionMeta: Object.fromEntries(
            Object.entries(__registry.trackActions).map(([id, a]) => {
              const meta = { label: a.label };
              if (a.icon !== undefined) meta.icon = a.icon;
              return [id, meta];
            })
          ),
          trackDetail: Object.keys(__registry.trackDetail),
          eventHandlers: Object.keys(__registry.eventHandlers),
        });
      };
    `),
    )
    .dispose();

  // ── Internal helpers ─────────────────────────────────────────────────────

  /** Get current registration state from guest. */
  function currentRegState(): BridgeRegState {
    const result = ctx.unwrapResult(ctx.evalCode("__regState()"));
    const s = ctx.getString(result);
    result.dispose();
    return JSON.parse(s) as BridgeRegState;
  }

  /** Call a registered guest provider via __invoke and parse the JSON result. */
  async function callGuest(path: string, method: string, ...args: unknown[]): Promise<unknown> {
    const argsJson = JSON.stringify(args);
    const code = `__invoke(${JSON.stringify(path)}, ${JSON.stringify(method)}, ${JSON.stringify(argsJson)})`;
    const jsonOut = await sc.evalSettle(code);
    return JSON.parse(jsonOut as string);
  }

  // ── Hub registration ──────────────────────────────────────────────────────

  const hubDisposables: { dispose(): void }[] = [];

  /** Called after activate() to register hub entries for what the guest
   *  registered. The provider proxies + event subscriptions are built by the
   *  shared, transport-agnostic registerHubProxies (driven by callGuest).
   *  Settings actions are host-specific (they call deps.onSettingsAction, not
   *  the hub) and are wired up here directly. */
  function registerHubEntries(): void {
    const state = currentRegState();

    registerHubProxies(deps.hub, deps.pluginId, state, callGuest, (d) => hubDisposables.push(d));

    // Settings actions — wired through the host's onSettingsAction sink, not
    // the hub, so they stay outside registerHubProxies.
    for (const key of state.settingsActions) {
      deps.onSettingsAction(key, async () => {
        return callGuest("settingsAction", key) as Promise<SettingsActionResult>;
      });
    }
  }

  return {
    registerHubEntries,
    callGuest,
    regState: currentRegState,
    dispose() {
      for (const d of hubDisposables) {
        try {
          d.dispose();
        } catch {}
      }
      for (const d of disposables) {
        try {
          d.dispose();
        } catch {}
      }
    },
  };
}
