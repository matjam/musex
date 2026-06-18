# Mobile Plugin System (Phase D1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the production iOS plugin system on the spike-validated WebView+`quickjs-emscripten` architecture, by extracting a shared `@musex/plugin-host` package (consumed by desktop + the mobile WebView harness) and building the mobile sandbox host, transport, host capabilities, GitHub install flow, and Settings → Plugins UI.

**Architecture:** A new `@musex/plugin-host` package holds the platform-agnostic `ProviderHub` + the pure `registerHubProxies` (root, no quickjs) and the quickjs `SandboxContext`/`installBridge`/`loadSandboxedPlugin` (`/sandbox` subpath). Desktop re-points to consume it with **no behavior change**. Mobile runs the package's sandbox **inside a hidden `react-native-webview`** (esbuild harness + singlefile WASM QuickJS, one QuickJS context per plugin); a **bidirectional postMessage transport** carries provider `__invoke`s (RN→WebView) and host-capability calls / registration / events (WebView→RN). The `ProviderHub` lives RN-side; host caps (storage/secrets/net/library/ui) are RN-injected. Install reuses the promoted `plugin-source` logic + RN adapters (expo-file-system, fetch, js-sha256, fflate).

**Tech Stack:** TypeScript 6 (`verbatimModuleSyntax`), pnpm workspaces, Expo SDK 56 / RN 0.85 / Hermes, `react-native-webview` 13.16.1, `quickjs-emscripten-core` + `@jitl/quickjs-singlefile-browser-release-sync` 0.32.0 (WASM inlined, **sync** variant), `fflate`, `js-sha256`, esbuild (harness build-only), vitest 4, biome 2.

## Global Constraints

- **Sync QuickJS + `newPromise` driver ONLY** — never asyncify/`newAsyncContext` (corrupts the WASM heap on the 2nd sequential awaited host call; spike-verified). Mobile uses `newQuickJSWASMModuleFromVariant(singlefileVariant)` (desktop keeps `getQuickJS()`).
- **`@musex/plugin-host` contains NO Node/Electron/RN imports** — host caps, the quickjs module, and (mobile) the transport are injected. Root export is pure (no quickjs); `/sandbox` subpath depends on `quickjs-emscripten`.
- **Core/package purity:** `import type` for types (`verbatimModuleSyntax`); core has no DOM/node lib. TS source exports (`"exports": { ".": "./src/index.ts", "./sandbox": "./src/sandbox/index.ts" }`); consumers bundle.
- **`HOST_API_VERSION = 2`** — installed plugins must declare `apiVersion: 2`; reject otherwise.
- **Install safety:** verify sha256 (abort on mismatch); fflate unzip with a **zip-slip whitelist** (only `plugin.json` + the manifest `entry`, via `isSafeEntryName`); `isSafePluginId` (`^[a-z0-9-]+$`) + path-containment guard on install AND remove.
- **Every QuickJS handle must be disposed** or context teardown aborts.
- **Verification bar:** full `pnpm check` (= `pnpm -r typecheck && biome check . && pnpm -r test`, with desktop running TWO tsc passes) green before every commit; **the controller re-runs `pnpm check` before any push** (subagent self-reports can be wrong). `git add -A` always.
- **Native deps → dev-client rebuild** (`react-native-webview`); CI stays JS-only. The WebView/WASM runtime is **on-device-verified** (the PoC proved the mechanics); CI tests the pure logic only.
- **No emoji in UI; lucide-react-native icons.**

---

## File structure

**New package `packages/plugin-host/`:**
- `package.json`, `tsconfig.json`, `vitest.config.ts`
- `src/index.ts` — root export: `ProviderHub`, `registerHubProxies`, shared types (`BridgeRegState`, registry types).
- `src/provider-hub.ts` (+ `.test.ts`) — moved from desktop `main/providers/`.
- `src/register-proxies.ts` (+ `.test.ts`) — **new** pure `registerHubProxies(...)` extracted from the bridge's `registerHubEntries`.
- `src/sandbox/index.ts` — sandbox subpath export: `SandboxContext`, `installBridge`, `toGuest`/`fromGuest`, `loadSandboxedPlugin`.
- `src/sandbox/quickjs-host.ts`, `bridge.ts`, `loader.ts` (+ tests) — moved from desktop `main/plugins/sandbox/` (`index.ts` → `loader.ts`).

**Desktop (modified):** delete `main/providers/` + `main/plugins/sandbox/`; repoint `plugin-host.ts`, `plugin-context.ts`, any importers to `@musex/plugin-host`(`/sandbox`); `plugin-installer.ts` + `plugin-context.ts`/bridge use `registerHubProxies` from the package. `src/logic/plugin-source.ts` → `@musex/core` (repoint). `electron.vite.config.ts` `externalizeDepsPlugin.exclude` += `@musex/plugin-host`. `package.json` dep.

**Core (modified):** `src/logic/plugin-source.ts` (+ test) promoted; barrel export.

**Mobile new (`packages/mobile/src/plugins/`):**
- `harness/harness.ts` + `harness/build-harness.mjs` + `harness/harness-bundle.ts` (committed esbuild output).
- `webview-transport.ts` (+ test) — RN-side postMessage RPC.
- `host-capabilities.ts` (+ test) — RN host-cap impls.
- `sandbox-host.ts` — RN WebView owner + transport driver (component + controller).
- `plugin-store.ts` (+ test) — expo-file-system plugin dir.
- `plugin-index.ts` (+ test) — async-storage installed list + sources.
- `plugin-installer.ts` (+ test) — RN install (fetch/sha256/fflate/whitelist/gate/write).
- `plugin-manager.ts` (+ test) — orchestration (scan/activate/register/reload/enable).

**Mobile UI:** `app/(tabs)/settings/plugins.tsx`; register in `settings/_layout.tsx`; link row in `settings/index.tsx`. Store wiring in `src/state/store.tsx`.

---

## Batch 1 — `@musex/plugin-host` package + desktop refactor (keystone; keep desktop green)

### Task 1: Scaffold `@musex/plugin-host` package

**Files:** Create `packages/plugin-host/{package.json,tsconfig.json,vitest.config.ts,src/index.ts}`; Modify `packages/desktop/package.json` (dep), `packages/desktop/electron.vite.config.ts` (exclude).

**Interfaces produced:** package `@musex/plugin-host` resolvable with `"exports": { ".": "./src/index.ts", "./sandbox": "./src/sandbox/index.ts" }`.

- [ ] **Step 1:** `package.json`: name `@musex/plugin-host`, `"type":"module"`, exports map above, deps `{"@musex/core":"workspace:*","@musex/plugin-api":"workspace:*","quickjs-emscripten":"0.32.0"}` (desktop's variant; mobile bundles its own singlefile variant in the harness, not via this dep), devDeps mirror core (typescript, vitest, @biomejs/biome via workspace), scripts `{"typecheck":"tsc --noEmit","test":"vitest run"}`.
- [ ] **Step 2:** `tsconfig.json` extends `../../tsconfig.base.json`; `vitest.config.ts` with `passWithNoTests:true` (until tests move in).
- [ ] **Step 3:** `src/index.ts` placeholder `export {};`.
- [ ] **Step 4:** desktop `package.json` deps += `"@musex/plugin-host":"workspace:*"`; `electron.vite.config.ts` add `@musex/plugin-host` to BOTH main+preload `externalizeDepsPlugin({ exclude: [...] })` lists.
- [ ] **Step 5:** `pnpm install` (links the workspace package). Run `pnpm --filter @musex/plugin-host typecheck` → clean.
- [ ] **Step 6:** Commit `chore: scaffold @musex/plugin-host package`.

### Task 2: Move `ProviderHub` into the package

**Files:** Create `packages/plugin-host/src/provider-hub.ts` + `provider-hub.test.ts` (moved from desktop `main/providers/`); Modify `src/index.ts` (export); Delete `packages/desktop/src/main/providers/`; Modify every desktop importer of `../providers/provider-hub.js`.

**Interfaces produced:** `export { ProviderHub } from "@musex/plugin-host"` + all registry types (per grounding §1).

- [ ] **Step 1:** `git mv` `provider-hub.ts` + `.test.ts` into `packages/plugin-host/src/`. It imports `@musex/core` (`KEY_SEPARATOR`, `mergeDiscography`) + `@musex/plugin-api` types — both are package deps; no path changes needed beyond confirming the imports resolve.
- [ ] **Step 2:** `src/index.ts`: `export * from "./provider-hub.js";`.
- [ ] **Step 3:** grep desktop for `providers/provider-hub` importers (`runtime.ts`, `plugin-host.ts`, `plugin-context.ts`, lastfm, expansion coordinator, ipc) → repoint to `import { ProviderHub } from "@musex/plugin-host"`.
- [ ] **Step 4:** `rm -rf packages/desktop/src/main/providers/`.
- [ ] **Step 5:** `pnpm --filter @musex/plugin-host test` (the moved hub test passes in the package) + `pnpm check` (desktop typecheck ×2 + tests green).
- [ ] **Step 6:** Commit `refactor: move ProviderHub to @musex/plugin-host`.

### Task 3: Extract `registerHubProxies` (pure) + move the sandbox into the package

**Files:** Create `packages/plugin-host/src/register-proxies.ts` (+ test), `src/sandbox/{quickjs-host,bridge,loader,index}.ts` (+ tests, moved); Modify `src/index.ts`; Delete `packages/desktop/src/main/plugins/sandbox/`; Modify desktop `plugin-host.ts`/`plugin-context.ts`/importers.

**Interfaces produced (exact):**
- `@musex/plugin-host`: `registerHubProxies(hub: ProviderHub, pluginId: string, regState: BridgeRegState, callGuest: (path: string, method: string, ...args: unknown[]) => Promise<unknown>, trackDisposable: (d: { dispose(): void }) => void): void` — builds transport/in-process-agnostic provider proxies from `regState` and registers them into `hub` (the logic currently inside the bridge's `registerHubEntries`).
- `@musex/plugin-host/sandbox`: `SandboxContext` (per grounding §2), `installBridge(sc, deps): BridgeResult` (per §3; `BridgeResult.registerHubEntries()` now delegates to `registerHubProxies`), `loadSandboxedPlugin(deps): Promise<{dispose()}>` (per §4 — keep desktop's Node `readFile`/`join` here; mobile does NOT use this loader), `toGuest`/`fromGuest`.

- [ ] **Step 1:** `git mv` `sandbox/quickjs-host.ts`(+test), `sandbox/bridge.ts`(+test) into `packages/plugin-host/src/sandbox/`; `git mv sandbox/index.ts` → `src/sandbox/loader.ts`. Create `src/sandbox/index.ts` re-exporting `{ SandboxContext, toGuest, fromGuest }` from quickjs-host, `{ installBridge }` + types from bridge, `{ loadSandboxedPlugin }` from loader.
- [ ] **Step 2:** **Extract** the proxy-building block from `bridge.ts`'s `registerHubEntries` into `src/register-proxies.ts` as the pure `registerHubProxies(...)` above (it reads `regState` + calls `callGuest` to build proxy methods, then `hub.registerTracked`/`hub.contribute*`/`hub.register*`). Refactor `bridge.ts` `registerHubEntries()` to `registerHubProxies(deps.hub, deps.pluginId, this.regState(), this.callGuest, deps.trackDisposable)` — **identical behavior**.
- [ ] **Step 3:** `src/index.ts`: `export * from "./register-proxies.js";` (+ re-export the shared `BridgeRegState` type from sandbox/bridge via a type-only path so the root stays quickjs-free — put `BridgeRegState` in a `src/types.ts` imported by both, exported from root).
- [ ] **Step 4:** `loader.ts` imports: it referenced `../plugin-host.js` (`PluginHostDeps`) and `../plugin-store.js` (`PluginStorage`/`PluginSecrets`) and `createNetClient`. Break these desktop couplings: change `SandboxDeps` to inline the structural types it needs (storage/secrets/library/hub/notifySink/openExternal/registerSettings/onSettingsAction/trackDisposable + a `netFetch` injected by the caller) so `loader.ts` depends only on `@musex/plugin-api` + `./bridge.js` + `./quickjs-host.js`. Desktop's `plugin-host.ts` passes `netFetch` (built from `createNetClient`) into `loadSandboxedPlugin` instead of the loader importing it.
- [ ] **Step 5:** Repoint desktop importers of `plugins/sandbox/*` → `@musex/plugin-host/sandbox`; `plugin-context.ts` / bridge consumers of registration → `registerHubProxies` from `@musex/plugin-host` where applicable. `rm -rf packages/desktop/src/main/plugins/sandbox/`.
- [ ] **Step 6:** `pnpm --filter @musex/plugin-host test` (moved bridge + quickjs-host tests + the new register-proxies test pass) + `pnpm check` (desktop green — this is the keystone; desktop's plugin-host.test.ts must still pass).
- [ ] **Step 7:** Commit `refactor: move sandbox + extract registerHubProxies into @musex/plugin-host`.

### Task 4: Promote `plugin-source` to `@musex/core`

**Files:** Create `packages/core/src/logic/plugin-source.ts` (+ test, moved from desktop `src/logic/`); Modify core barrel; Modify desktop importers + `plugin-installer.ts`.

**Interfaces produced:** `@musex/core` re-exports `parseRepoUrl`, `manifestRawUrls`, `releaseAssetUrl`, `parsePluginsManifest`, `parseSha256File`, `isSafeEntryName`, `isSafePluginId`, `RepoRef`, `ManifestEntry`, `RepoManifest` (per grounding §7).

- [ ] **Step 1:** `git mv` desktop `src/logic/plugin-source.ts`(+test) → `packages/core/src/logic/`. Confirm it has no Node/DOM deps (pure string/regex) — it does.
- [ ] **Step 2:** Add to core barrel (`packages/core/src/index.ts`).
- [ ] **Step 3:** Repoint desktop `plugin-installer.ts` + the renderer/IPC importers from `../logic/plugin-source.js` → `@musex/core`.
- [ ] **Step 4:** `pnpm check` green (core test runs the moved test; desktop green).
- [ ] **Step 5:** Commit `refactor: promote plugin-source logic to @musex/core`.

---

## Batch 2 — Mobile sandbox runtime

### Task 5: Mobile deps

**Files:** Modify `packages/mobile/package.json`.

- [ ] **Step 1:** `pnpm --filter @musex/mobile exec expo install react-native-webview` (SDK-56 pin, 13.16.1).
- [ ] **Step 2:** `pnpm --filter @musex/mobile add @musex/plugin-host@workspace:* fflate js-sha256` (runtime: hub + register-proxies from the package RN-side; fflate+js-sha256 for install).
- [ ] **Step 3:** `pnpm --filter @musex/mobile add -D quickjs-emscripten-core @jitl/quickjs-singlefile-browser-release-sync esbuild` (harness build-only).
- [ ] **Step 4:** `pnpm check` green (no usage yet; just resolves). Commit `chore(mobile): add plugin-system deps`.

### Task 6: WebView harness + bundle

**Files:** Create `packages/mobile/src/plugins/harness/{harness.ts,build-harness.mjs,harness-bundle.ts}`; Modify `tsconfig.json` + `vitest.config.ts` (exclude `**/harness/harness.ts` + `build-harness.mjs` — they target the WebView/Node, not Hermes; `harness-bundle.ts` is a plain string export and stays included; biome-ignore the generated bundle).

**Interfaces produced:** `export const HARNESS_JS: string` (the self-contained IIFE). The harness postMessage protocol (RN↔WebView):
- inbound `{type:"load", id, pluginId, manifest, code}` → create context, installBridge (host caps = transport-backed `asyncFn`s tagged with pluginId), set module loader to return `code`, eval import, `activate(ctx)`, reply `{type:"loaded", id, regState}` or `{type:"loaded", id, error}`.
- inbound `{type:"invoke", id, pluginId, path, method, args}` → `bridge.callGuest(path, method, ...args)` → reply `{type:"invokeResult", id, result}`/`{error}`.
- inbound `{type:"emit", pluginId, event, payload}` → guest `__emit`.
- inbound `{type:"dispose", pluginId}` → dispose that context.
- outbound `{type:"hostCall", id, pluginId, name, args}` (a `ctx` host-cap) → RN replies `{type:"hostReply", id, value}`/`{error}`.
- outbound `{type:"log", pluginId, message}` (console/ctx.log surfacing).

- [ ] **Step 1:** Write `harness.ts`: import `newQuickJSWASMModuleFromVariant` from `quickjs-emscripten-core` + the default `variant` from `@jitl/quickjs-singlefile-browser-release-sync`; `import { SandboxContext, installBridge } from "@musex/plugin-host/sandbox"`. **Adapt `SandboxContext.create()` to accept an injected module** (mobile passes `await newQuickJSWASMModuleFromVariant(variant)`; desktop default still `getQuickJS()`) — add an optional `create(mod?)` param in Task 3's quickjs-host (back-compatible). Hold a `Map<pluginId,{sc,bridge}>`. Wire `installBridge` deps so each host cap = `(...args) => postHostCall(pluginId, name, args)` (returns a JS promise resolved by the matching `hostReply`); `hub` is a NO-OP stub here (registration happens RN-side via regState — the WebView never touches a hub), `registerSettings`/`onSettingsAction`/`notifySink`/`openExternal` also post outbound. Use `window.ReactNativeWebView.postMessage(JSON.stringify(...))` + a `message` listener; correlate hostCall replies by id.
- [ ] **Step 2:** Write `build-harness.mjs` (esbuild: `bundle`, `format:"iife"`, `platform:"browser"`, `minify`, entry `harness.ts`) → write `harness-bundle.ts` = `export const HARNESS_JS = ${JSON.stringify(bundledString)};`. Add mobile script `"build:plugin-harness":"node src/plugins/harness/build-harness.mjs"`.
- [ ] **Step 3:** Run `pnpm --filter @musex/mobile run build:plugin-harness`; verify the bundle contains the inlined WASM (emscripten base64 + `WebAssembly.instantiate`, no external `.wasm`) and is non-trivial (~hundreds of KB). Commit the generated `harness-bundle.ts`.
- [ ] **Step 4:** Exclude `harness.ts`+`build-harness.mjs` from tsconfig/vitest; biome-ignore `harness-bundle.ts`. `pnpm check` green. Commit `feat(mobile): WebView plugin sandbox harness`.

### Task 7: RN-side transport (`webview-transport.ts`)

**Files:** Create `packages/mobile/src/plugins/webview-transport.ts` + `webview-transport.test.ts`.

**Interfaces produced (exact):**
```ts
export interface TransportChannel { post(msg: string): void; }  // wraps webviewRef.injectJavaScript / postMessage
export class WebViewTransport {
  constructor(channel: TransportChannel, opts?: { timeoutMs?: number });
  onMessage(raw: string): void;                  // feed react-native-webview onMessage
  setHostCallHandler(fn: (pluginId: string, name: string, args: unknown[]) => Promise<unknown>): void;
  load(pluginId: string, manifest: PluginManifest, code: string): Promise<BridgeRegState>;
  invoke(pluginId: string, path: string, method: string, args: unknown[]): Promise<unknown>;
  emit(pluginId: string, event: string, payload: unknown): void;
  dispose(pluginId: string): void;
  reset(): void;                                  // reject all in-flight (WebView remount)
}
```
Correlation via an incrementing id + a `Map<id, {resolve,reject,timer}>`; `load`/`invoke` are request/reply; outbound `hostCall` routes to the host-call handler and posts `hostReply`.

- [ ] **Step 1:** Write failing tests with a fake `TransportChannel` (captures posted JSON): (a) `invoke` resolves when a matching `invokeResult` is fed to `onMessage`; (b) `invoke` rejects on `{error}`; (c) `invoke` rejects after `timeoutMs`; (d) a `hostCall` inbound calls the host-call handler and posts a correlated `hostReply` with its resolved value; (e) `reset()` rejects all in-flight.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3:** Implement `WebViewTransport`.
- [ ] **Step 4:** Run → pass. `pnpm --filter @musex/mobile test`.
- [ ] **Step 5:** Commit `feat(mobile): WebView plugin transport (RPC + correlation)`.

### Task 8: RN host capabilities (`host-capabilities.ts`)

**Files:** Create `packages/mobile/src/plugins/host-capabilities.ts` + test.

**Interfaces produced:**
```ts
export interface HostCapDeps {
  storageGet/Set, secretsGet/Set,  // async-storage + secure-store, namespaced per pluginId
  netFetch: (url, init?) => Promise<NetFetchResponse>,  // RN fetch; allowSelfSigned ignored (v1)
  library: { search, recentlyPlayed, topArtists },      // gateway + taste snapshot
  notify, openExternal,
}
export function makeHostCallHandler(deps: HostCapDeps): (pluginId: string, name: string, args: unknown[]) => Promise<unknown>;
```
`name` ∈ {`storageGet`,`storageSet`,`secretsGet`,`secretsSet`,`netFetch`,`librarySearch`,`libraryRecentlyPlayed`,`libraryTopArtists`,`notify`,`openExternal`,`log`,`registerSettings`} — dispatch to the matching dep; storage/secrets namespaced by `pluginId`.

- [ ] **Step 1:** Failing tests with fakes: storageSet then storageGet round-trips namespaced; `netFetch` maps a fetch `Response` → `{ok,status,headers,body}`; `librarySearch` shapes the gateway result into `LibrarySearchResult`; `libraryTopArtists` returns taste `topArtists`; unknown `name` rejects.
- [ ] **Step 2:** Run → fail.
- [ ] **Step 3:** Implement (`@react-native-async-storage/async-storage`, `expo-secure-store`, RN `fetch`, the gateway/taste passed in). `notify`→a toast callback dep; `openExternal`→`Linking.openURL` (http/https only).
- [ ] **Step 4:** Run → pass.
- [ ] **Step 5:** Commit `feat(mobile): RN plugin host capabilities`.

### Task 9: SandboxHost (`sandbox-host.ts`)

**Files:** Create `packages/mobile/src/plugins/sandbox-host.ts` (a React component owning the hidden `WebView` + the `WebViewTransport`, exposed via a ref/controller).

**Interfaces produced:**
```ts
export interface SandboxController {
  load(pluginId, manifest, code): Promise<BridgeRegState>;
  invoke(pluginId, path, method, args): Promise<unknown>;
  emit(pluginId, event, payload): void;
  dispose(pluginId): void;
  ready: Promise<void>;
}
export function SandboxHostView(props: { hostCallHandler; onController(c: SandboxController): void; onReady(): void }): JSX.Element;
```
Renders a 0-size hidden `WebView source={{html: `<!doctype html>…<script>${HARNESS_JS}</script>`}}` `originWhitelist={["*"]}` `javaScriptEnabled`; `onMessage` → `transport.onMessage`; a key-bump remount on crash → `transport.reset()` + re-`load` enabled plugins (PoC re-init). The controller wraps the transport.

- [ ] **Step 1:** Build it from the recovered PoC reference (grounding §14) — the proven WebView+transport+singlefile-quickjs pattern. (On-device-only; no unit test for the WebView itself — the transport/host-caps are tested in Tasks 7–8.)
- [ ] **Step 2:** `pnpm check` green (typecheck + biome; the component compiles). Commit `feat(mobile): WebView sandbox host`.

---

## Batch 3 — Plugin install + manager

### Task 10: plugin-store + plugin-index

**Files:** Create `packages/mobile/src/plugins/{plugin-store.ts,plugin-index.ts}` + tests.

**Interfaces produced:**
```ts
// plugin-store.ts (expo-file-system documentDirectory/plugins/<id>/)
export class PluginFileStore {
  pluginDir(id: string): string;
  writePlugin(id: string, files: Record<string, Uint8Array>): Promise<void>;  // isSafePluginId + containment guard
  readEntry(id: string, entry: string): Promise<string>;  // utf-8 module code
  removePlugin(id: string): Promise<void>;                 // guard
  list(): Promise<string[]>;                               // installed ids
}
// plugin-index.ts (async-storage musex.plugin-index + musex.plugin-sources)
export interface InstalledPlugin { id:string; manifest:PluginManifest; enabled:boolean; source:PluginSource }
export class PluginIndex {
  load(): Promise<void>; all(): InstalledPlugin[];
  upsert(p: InstalledPlugin): Promise<void>; remove(id:string): Promise<void>;
  setEnabled(id:string, v:boolean): Promise<void>; isEnabled(id:string): boolean;
}
```

- [ ] **Step 1:** Failing tests with a fake filesystem (inject the expo-file-system ops behind a small interface) + fake async-storage: writePlugin rejects unsafe id; readEntry returns written code; index round-trips + setEnabled persists.
- [ ] **Step 2–4:** Implement against SDK-56 `expo-file-system` (`File`/`Directory`/`Paths` — `.write(bytes)`, `.text()`, `.delete()`, `.moveSync`) behind the injected interface; async-storage for the index. Run → pass.
- [ ] **Step 5:** Commit `feat(mobile): plugin file store + installed index`.

### Task 11: plugin-installer

**Files:** Create `packages/mobile/src/plugins/plugin-installer.ts` + test.

**Interfaces produced:**
```ts
export interface MobileInstallerDeps {
  fetch: typeof fetch; store: PluginFileStore; index: PluginIndex; sha256: (b: Uint8Array)=>string; reload: ()=>Promise<void>;
}
export class MobilePluginInstaller {
  fetchManifest(repoUrl: string): Promise<FetchManifestResult>;
  install(repoUrl: string, id: string): Promise<void>;   // mirror desktop §8, RN I/O
  uninstall(id: string): Promise<void>;
}
```

- [ ] **Step 1:** Failing tests (fake fetch + fake store/index, `js-sha256`): install fetches manifest (main→master fallback), finds the id, **rejects on apiVersion≠2**, downloads asset+`.sha256`, **rejects on sha mismatch**, `fflate.unzipSync`, **extracts only whitelisted `plugin.json`+entry** (rejects zip-slip names via `isSafeEntryName`), writes via store, upserts index, calls reload. uninstall removes + reload.
- [ ] **Step 2–4:** Implement using promoted `@musex/core` `plugin-source` helpers + `fflate.unzipSync` + injected `js-sha256`. Run → pass.
- [ ] **Step 5:** Commit `feat(mobile): plugin installer (GitHub, sha256, zip-slip-safe)`.

### Task 12: plugin-manager

**Files:** Create `packages/mobile/src/plugins/plugin-manager.ts` + test.

**Interfaces produced:**
```ts
export interface PluginManagerDeps { index: PluginIndex; store: PluginFileStore; sandbox: SandboxController; hub: ProviderHub; trackDisposable?: (...)=>void }
export class PluginManager {
  loadAll(): Promise<void>;   // for each enabled installed plugin: read entry → sandbox.load → registerHubProxies(hub, id, regState, (p,m,...a)=>sandbox.invoke(id,p,m,a), track)
  reloadAll(): Promise<void>; // dispose all sandbox contexts + hub registrations, re-load
  setEnabled(id, v): Promise<void>;
  list(): { id; name; version; enabled; status: "active"|"error"|"disabled"; error?; registered: BridgeRegState | null }[];
  emitEvent<K>(event, payload): void;   // hub.dispatchEvent + sandbox.emit to each active plugin's handlers
}
```

- [ ] **Step 1:** Failing tests against a **fake `SandboxController`** (records load/invoke, returns a scripted `regState`) + the **real `ProviderHub`** from `@musex/plugin-host`: `loadAll` activates enabled plugins → the hub reports the provider registered (e.g. `hub.acquisitionAvailable()` true when regState.acquisition); a hub fan-out call (`hub.lookupArtistAlbums`) round-trips to `sandbox.invoke`; a plugin whose `sandbox.load` throws → status "error", others unaffected; `setEnabled(false)` disposes its registrations; `reloadAll` re-activates.
- [ ] **Step 2–4:** Implement using `registerHubProxies` from `@musex/plugin-host` (the proxy `callGuest` = `(p,m,...a)=>sandbox.invoke(id,p,m,a)`). Run → pass.
- [ ] **Step 5:** Commit `feat(mobile): plugin manager (activate + register into hub)`.

---

## Batch 4 — Store wiring + UI

### Task 13: Store wiring

**Files:** Modify `packages/mobile/src/state/store.tsx` (+ render `SandboxHostView` in the provider tree).

**Interfaces produced (Store additions):**
```ts
hub: ProviderHub;
plugins: { list(): ReturnType<PluginManager["list"]>; install(repoUrl:string,id:string):Promise<void>; fetchManifest(repoUrl:string):Promise<FetchManifestResult>; uninstall(id:string):Promise<void>; setEnabled(id:string,v:boolean):Promise<void>; reload():Promise<void> };
```

- [ ] **Step 1:** Construct `ProviderHub`, `PluginIndex`, `PluginFileStore`, `MobilePluginInstaller`, `PluginManager`; render `<SandboxHostView hostCallHandler={makeHostCallHandler({...gateway+taste+toast+linking})} onController={...} onReady={...}/>` hidden in the provider; on ready + index loaded → `pluginManager.loadAll()`.
- [ ] **Step 2:** In the `session.subscribe` loop (where taste/scrobble already fire), also `pluginManager.emitEvent(...)` for `trackStarted`/`trackEnded`/`paused`/`resumed`/`scrobble`; on rating, `trackRated`. (Reuse the existing PlayMonitor classification.)
- [ ] **Step 3:** Expose the `plugins` facade + `hub` on the Store.
- [ ] **Step 4:** `pnpm check` green. Commit `feat(mobile): wire plugin manager + hub into the store`.

### Task 14: Settings → Plugins UI

**Files:** Create `packages/mobile/app/(tabs)/settings/plugins.tsx`; Modify `settings/_layout.tsx` (Stack.Screen) + `settings/index.tsx` (link row).

- [ ] **Step 1:** `plugins.tsx`: installed list (name/version + enable `Switch` + status + a registered-providers summary from `BridgeRegState`), **"Add from GitHub"** (a `TextInput` repo URL → `plugins.fetchManifest` → pick/confirm → `plugins.install`; a `window.confirm`-style full-access warning before install), per-row Remove, a Reload button. Offline-guarded (install/fetch need network). lucide-react-native icons, no emoji. Follow the existing Settings screen patterns (Row, SectionHeader).
- [ ] **Step 2:** Register the screen + add a link row in `settings/index.tsx` ("Plugins").
- [ ] **Step 3:** `pnpm check` green. Commit `feat(mobile): Settings → Plugins management UI`.

---

## Batch 5 — Verification, review, docs

### Task 15: Full verification + adversarial review + docs

- [ ] **Step 1:** Controller re-runs full `pnpm check` (core + plugin-host + desktop ×2 + mobile + biome + all tests) → exit 0; record tallies.
- [ ] **Step 2:** Dispatch an adversarial code-review subagent over the whole diff (focus: the keystone desktop refactor preserved behavior; handle-disposal in the harness; transport correlation/timeout/leak on remount; install zip-slip/sha/apiVersion/path-traversal guards; no swallowed errors; offline guards; purity of `@musex/plugin-host`). Fix confirmed findings.
- [ ] **Step 3:** Update root `CLAUDE.md` with a Phase D1 arc bullet (the `@musex/plugin-host` extraction; the mobile WebView sandbox + transport + per-plugin context; install flow; deferred consuming features; the singlefile-sync-variant + harness-bundle pattern; dev-client rebuild). Update `app.json` only if a config plugin is needed (react-native-webview autolinks — likely none).
- [ ] **Step 4:** Commit; controller re-runs `pnpm check`; push; update PR #59 description with final state + on-device test steps.

---

## Testing summary

- **`@musex/plugin-host`:** moved `provider-hub`/`bridge`/`quickjs-host` tests + new `register-proxies` test.
- **Core:** moved `plugin-source` test.
- **Mobile (pure/unit):** `webview-transport`, `host-capabilities`, `plugin-store`, `plugin-index`, `plugin-installer`, `plugin-manager` (vs the real hub + a fake SandboxController).
- **On-device (user):** dev-client rebuild → Settings → Plugins → Add `https://github.com/matjam/musex-plugins` → install `lidarr` → it activates (status active) + registers an acquisition provider; the harness WASM init + host-cap round-trips work. (CI cannot exercise the WebView.)

## Risks

- **Keystone (Task 3):** breaking `loader.ts`'s desktop couplings while keeping desktop's `plugin-host.test.ts` green — verify desktop tests after each repoint.
- **`SandboxContext.create(mod?)`** must stay back-compatible for desktop (`getQuickJS()` default) while accepting the mobile singlefile module.
- **Harness bundle size / WASM inlining** — verify the singlefile variant actually inlines (no external `.wasm`); the PoC proved it does.
- **Transport leaks on WebView remount** — `reset()` must reject in-flight + re-`load` enabled plugins.
