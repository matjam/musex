/**
 * `@musex/plugin-host/sandbox` — the quickjs-backed sandbox runtime.
 *
 * This subpath depends on `quickjs-emscripten`. The package ROOT export
 * (`@musex/plugin-host`) stays quickjs-free (ProviderHub + registerHubProxies +
 * shared types only).
 */

export type { BridgeDeps, BridgeRegState, BridgeResult, PluginNotification } from "./bridge.js";
export { installBridge } from "./bridge.js";
export type { SandboxDeps } from "./loader.js";
export { loadSandboxedPlugin } from "./loader.js";
export { fromGuest, SandboxContext, toGuest } from "./quickjs-host.js";
