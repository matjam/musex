/**
 * WebView plugin harness — runs INSIDE a hidden react-native-webview (full
 * WebKit, NOT Hermes), bundled to a self-contained IIFE by `build-harness.mjs`
 * (esbuild, browser/iife/minify) with the singlefile QuickJS WASM inlined.
 *
 * It owns one QuickJS `SandboxContext` per plugin and bridges host capabilities
 * (storage/secrets/net/library/ui) back to React Native over `postMessage`.
 * The `ProviderHub` lives RN-side — the WebView never touches a hub; provider
 * registration is reported back via the `regState` returned from `load`, and
 * RN builds the hub proxies (`registerHubProxies`) from it.
 *
 * postMessage protocol (RN <-> WebView):
 *   inbound  {type:"load",    id, pluginId, manifest, code}
 *            {type:"invoke",  id, pluginId, path, method, args}
 *            {type:"emit",        pluginId, event, payload}
 *            {type:"dispose",     pluginId}
 *   outbound {type:"loaded",      id, regState}            (load success)
 *            {type:"loaded",      id, error}               (load failure)
 *            {type:"invokeResult",id, result}              (invoke success)
 *            {type:"invokeResult",id, error}               (invoke failure)
 *            {type:"hostCall",    id, pluginId, name, args}(a ctx host-cap)
 *            {type:"log",         pluginId, message}
 *   RN replies to hostCall with {type:"hostReply", id, value} / {error}.
 *
 * CRITICAL: SandboxContext (Batch 1) uses the SYNC QuickJS + newPromise driver
 * and `settlePromise` yields to the host loop via `setImmediate`, which WebKit
 * does not provide — we polyfill it below before anything else runs.
 */

import singlefileVariant from "@jitl/quickjs-singlefile-browser-release-sync";
import type {
  LibrarySearchResult,
  NetFetchInit,
  NetFetchResponse,
  PluginManifest,
  SettingsActionResult,
  TrackInfo,
} from "@musex/plugin-api";
import type { BridgeDeps, BridgeRegState } from "@musex/plugin-host/sandbox";
import { installBridge, SandboxContext } from "@musex/plugin-host/sandbox";
import { newQuickJSWASMModuleFromVariant } from "quickjs-emscripten-core";

// ── setImmediate polyfill (WebKit lacks it; settlePromise depends on it) ─────
// A 0ms setTimeout is a correct stand-in for yielding to the host event loop.
declare global {
  interface Window {
    ReactNativeWebView?: { postMessage(msg: string): void };
  }
}
const g = globalThis as { setImmediate?: (cb: () => void) => unknown };
if (typeof g.setImmediate !== "function") {
  g.setImmediate = (cb: () => void) => setTimeout(cb, 0);
}

type LoadedPlugin = {
  sc: SandboxContext;
  bridge: ReturnType<typeof installBridge>;
};

const plugins = new Map<string, LoadedPlugin>();

// QuickJS module is instantiated lazily, once, and shared across plugins.
let modulePromise: ReturnType<typeof newQuickJSWASMModuleFromVariant> | null = null;
function quickjsModule() {
  if (!modulePromise) {
    modulePromise = newQuickJSWASMModuleFromVariant(singlefileVariant);
  }
  return modulePromise;
}

// ── Outbound messaging ───────────────────────────────────────────────────────
function post(msg: unknown): void {
  const rn = window.ReactNativeWebView;
  if (rn) rn.postMessage(JSON.stringify(msg));
}

function hostLog(pluginId: string, message: string): void {
  post({ type: "log", pluginId, message });
}

// ── Host-call correlation (WebView -> RN -> WebView) ─────────────────────────
let hostCallSeq = 0;
const pendingHostCalls = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: Error) => void }
>();

/** Issue a host capability call to RN and return a promise resolved by the
 *  matching `hostReply`. This is what every bridged ctx host-cap maps to. */
function postHostCall(pluginId: string, name: string, args: unknown[]): Promise<unknown> {
  const id = ++hostCallSeq;
  return new Promise<unknown>((resolve, reject) => {
    pendingHostCalls.set(id, { resolve, reject });
    post({ type: "hostCall", id, pluginId, name, args });
  });
}

// ── A no-op hub stub: registration is reported RN-side via regState ──────────
// installBridge requires a `hub` dep, but in the WebView no hub exists — RN owns
// it. registerHubEntries (which would touch the hub) is NEVER called here; we
// read regState() directly instead. The stub satisfies the type without doing
// anything.
const noopHub = new Proxy(
  {},
  {
    get() {
      return () => ({ dispose() {} });
    },
  },
) as never;

// ── Build the bridge deps: every host cap posts outbound to RN ───────────────
// Typed against BridgeDeps so a structural drift vs @musex/plugin-host/sandbox
// is a compile error (this is the security boundary). See tsconfig.harness.json.
function makeBridgeDeps(pluginId: string, manifest: PluginManifest): BridgeDeps {
  return {
    manifest,
    pluginId,
    netFetch: (url: string, init?: NetFetchInit) =>
      postHostCall(pluginId, "netFetch", [url, init]) as Promise<NetFetchResponse>,
    storage: {
      get: <T>(key: string) => postHostCall(pluginId, "storageGet", [key]) as Promise<T | null>,
      set: <T>(key: string, v: T) =>
        postHostCall(pluginId, "storageSet", [key, v]) as Promise<void>,
    },
    secrets: {
      get: (key: string) => postHostCall(pluginId, "secretsGet", [key]) as Promise<string | null>,
      set: (key: string, v: string | null) =>
        postHostCall(pluginId, "secretsSet", [key, v]) as Promise<void>,
    },
    library: {
      search: (query: string) =>
        postHostCall(pluginId, "librarySearch", [query]) as Promise<LibrarySearchResult>,
      recentlyPlayed: (limit?: number) =>
        postHostCall(pluginId, "libraryRecentlyPlayed", [limit]) as Promise<TrackInfo[]>,
      topArtists: (limit?: number) =>
        postHostCall(pluginId, "libraryTopArtists", [limit]) as Promise<
          { name: string; score: number }[]
        >,
    },
    notifySink: (payload) => {
      // Fire-and-forget to RN.
      void postHostCall(pluginId, "notify", [payload]);
    },
    openExternal: (url: string) => {
      void postHostCall(pluginId, "openExternal", [url]);
    },
    hub: noopHub,
    registerSettings: (schema) => {
      void postHostCall(pluginId, "registerSettings", [schema]);
    },
    onSettingsAction: (_key: string, _handler: () => Promise<SettingsActionResult>) => {
      // Settings actions are driven RN-side from regState via invoke(); the
      // WebView does not retain the handler closure.
    },
    trackDisposable: (_d: { dispose(): void }) => {
      // The WebView holds no hub registrations to track.
    },
  };
}

// ── Inbound handlers ─────────────────────────────────────────────────────────
async function handleLoad(
  id: number,
  pluginId: string,
  manifest: PluginManifest,
  code: string,
): Promise<void> {
  try {
    if (plugins.has(pluginId)) {
      // Replace any prior instance.
      disposePlugin(pluginId);
    }
    const mod = await quickjsModule();
    const sc = await SandboxContext.create(mod);
    sc.installPreamble();
    const bridge = installBridge(sc, makeBridgeDeps(pluginId, manifest));

    const entryName = manifest.entry;
    sc.runtime_.setModuleLoader((name: string) => {
      if (name === entryName) return code;
      throw new Error(`[sandbox] module not found: ${name}`);
    });

    const modResult = sc.context.evalCode(
      `import * as __mod from ${JSON.stringify(entryName)}; globalThis.__sandboxModule = __mod;`,
      "__musex_entry__.mjs",
      { type: "module" },
    );
    const modPh = sc.context.unwrapResult(modResult);
    await sc.settlePromise(modPh);
    modPh.dispose();

    await sc.evalSettle("__sandboxModule.activate(globalThis.ctx)");

    const regState: BridgeRegState = bridge.regState();
    plugins.set(pluginId, { sc, bridge });
    post({ type: "loaded", id, regState });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    hostLog(pluginId, `load failed: ${message}`);
    post({ type: "loaded", id, error: message });
  }
}

async function handleInvoke(
  id: number,
  pluginId: string,
  path: string,
  method: string,
  args: unknown[],
): Promise<void> {
  try {
    const entry = plugins.get(pluginId);
    if (!entry) throw new Error(`plugin not loaded: ${pluginId}`);
    const result = await entry.bridge.callGuest(path, method, ...args);
    post({ type: "invokeResult", id, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ type: "invokeResult", id, error: message });
  }
}

function handleEmit(pluginId: string, event: string, payload: unknown): void {
  const entry = plugins.get(pluginId);
  if (!entry) return;
  // Route through the reserved "__emit" path so the guest's __emit dispatcher
  // fires the registered event handlers. Fire-and-forget.
  void entry.bridge.callGuest("__emit", event, payload).catch((err) => {
    hostLog(pluginId, `emit error: ${err instanceof Error ? err.message : String(err)}`);
  });
}

function disposePlugin(pluginId: string): void {
  const entry = plugins.get(pluginId);
  if (!entry) return;
  plugins.delete(pluginId);
  try {
    entry.bridge.dispose();
  } catch {
    // ignore — tearing down
  }
  try {
    entry.sc.dispose();
  } catch {
    // ignore — tearing down
  }
}

function handleHostReply(id: number, value: unknown, error?: string): void {
  const pending = pendingHostCalls.get(id);
  if (!pending) return;
  pendingHostCalls.delete(id);
  if (error !== undefined) pending.reject(new Error(error));
  else pending.resolve(value);
}

// ── Message dispatch ─────────────────────────────────────────────────────────
type InboundMessage =
  | { type: "load"; id: number; pluginId: string; manifest: PluginManifest; code: string }
  | { type: "invoke"; id: number; pluginId: string; path: string; method: string; args: unknown[] }
  | { type: "emit"; pluginId: string; event: string; payload: unknown }
  | { type: "dispose"; pluginId: string }
  | { type: "hostReply"; id: number; value?: unknown; error?: string };

function onMessage(raw: string): void {
  let msg: InboundMessage;
  try {
    msg = JSON.parse(raw) as InboundMessage;
  } catch {
    return;
  }
  switch (msg.type) {
    case "load":
      void handleLoad(msg.id, msg.pluginId, msg.manifest, msg.code);
      break;
    case "invoke":
      void handleInvoke(msg.id, msg.pluginId, msg.path, msg.method, msg.args);
      break;
    case "emit":
      handleEmit(msg.pluginId, msg.event, msg.payload);
      break;
    case "dispose":
      disposePlugin(msg.pluginId);
      break;
    case "hostReply":
      handleHostReply(msg.id, msg.value, msg.error);
      break;
  }
}

// react-native-webview delivers RN->WebView messages via window "message" events
// (injectJavaScript posts a string). Listen on both window and document for
// platform robustness.
window.addEventListener("message", (e: MessageEvent) => onMessage(String(e.data)));
document.addEventListener("message", (e) => onMessage(String((e as MessageEvent).data)));

// Signal RN that the harness is initialized and listening. The RN side buffers
// any outbound posts until this arrives, so no load/invoke is lost on cold boot.
post({ type: "ready" });
