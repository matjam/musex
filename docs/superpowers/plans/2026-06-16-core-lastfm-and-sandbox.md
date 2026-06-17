# Core Last.fm + Third-Party QuickJS Sandbox + ProviderHub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Bake last.fm into core as a first-party in-process provider, run third-party plugins in a QuickJS sandbox (API v2, RPC), and decouple the provider registry from the plugin host so both share one registry.

**Architecture:** Extract the registry + origin-agnostic fan-out into a Runtime-owned **ProviderHub**. Last.fm registers on it in-process (trusted); third-party plugins register across a **QuickJS bridge** (sync context + `newPromise` driver, per the spike). The plugin API becomes RPC-shaped (`ctx.net.fetch`), `apiVersion → 2`.

**Tech Stack:** Electron main, `quickjs-emscripten`, `@musex/plugin-api`, vitest. **Spec:** `docs/superpowers/specs/2026-06-16-core-lastfm-and-sandbox-design.md`. **Branch:** `feature/core-lastfm-and-sandbox`. **No migration code** (single-user — break freely).

**Authoritative source code to PORT (don't re-derive):**
- QuickJS bridge/driver/preamble/`__invoke`/`__emit`: the working spike harness — read via `git show spike/quickjs-sandbox:spike/quickjs/harness.mjs` and `git show spike/quickjs-sandbox:spike/quickjs/FINDINGS.md`.
- Last.fm logic: `plugins/lastfm/src/{index.ts,client.ts,signing.ts}` (move into core).
- The provider fan-out consumers + registry: currently in `packages/desktop/src/main/plugins/plugin-host.ts` + `plugin-context.ts` (move into the hub).

---

## Cluster 1 — ProviderHub (decouple registry + fan-out from PluginHost)

**Goal:** a Runtime-owned `ProviderHub` owning the registry + the fan-out methods, with a first-party registration API. Behavior-preserving.

**Files:**
- Create: `packages/desktop/src/main/providers/provider-hub.ts` + `provider-hub.test.ts`
- Modify: `plugin-context.ts` (registry types stay; `buildPluginContext` takes a hub and registers via it), `plugin-host.ts` (drop the registry + fan-out; take `hub` as a dep; register plugin contributions into the hub), `runtime.ts` (create the hub; pass to PluginHost), `ipc.ts` (provider fan-out handlers call `rt.providers.*`).

- [ ] **Step 1 — Move the registry + register helper into the hub.** Create `ProviderHub` holding the `PluginRegistry` (from `plugin-context.ts`) + the `register<T>()` helper (verbatim from `plugin-context.ts`). Expose a **first-party registration API** mirroring the plugin one but keyed by a caller-supplied id (default reserved ids like `"core:lastfm"`): `registerSimilarProvider(id, p)`, `registerTrackRecommender(id, r)`, `registerAcquisitionProvider(id, p)`, `contributeSections(id, target, p)`, `contributeTrackAction(id, a)`, `contributeTrackDetail(id, p)`, `onEvent(id, event, handler)` — each returns a `Disposable`.

- [ ] **Step 2 — Move the fan-out consumers into the hub** verbatim from `plugin-host.ts`: `getSimilar`, `recommendTracks`, `getSections`, `getTrackDetails`, the acquisition lookup/`acquisitionStatus`/acquire/cancel/watch methods, and `dispatchEvent(event, payload)` (fans out to `eventSubscribers`). Keep the timeout/isolation behavior (`withTimeout`, per-provider try/catch, merge/dedupe/caps) identical. They read `this.registry.*` exactly as before.

- [ ] **Step 3 — Rewire `buildPluginContext`** to take the `ProviderHub` instead of a bare registry: its `ui.contributeSections`/`registerSimilarProvider`/`registerAcquisitionProvider`/etc. + `events.on` now call `hub.register*(manifest.id, …)`. (This keeps the plugin path working through the hub.)

- [ ] **Step 4 — PluginHost** drops `readonly registry` + the fan-out methods; takes `hub: ProviderHub` in `PluginHostDeps`; `activateCorePlugin`/`activatePlugin` pass `this.deps.hub` to `buildPluginContext`. Disposal still works (the hub's `register` returns disposables tracked per plugin).

- [ ] **Step 5 — Runtime** creates `this.providers = new ProviderHub(...)` and passes it to `new PluginHost({ hub: this.providers, … })`. Expose `rt.providers`.

- [ ] **Step 6 — IPC** — the provider fan-out handlers (`getSections`/`getSimilar`/`recommendTracks`/`acquisitionStatus`/`getTrackDetails`/acquire/etc.) call `rt.providers.*` instead of `rt.plugins.*`. (Plugin-management IPC — list/setEnabled/reload/install/settings — stays on `rt.plugins`.) The playback monitor that emitted `scrobble`/`trackStarted`/`trackRated` to plugins now calls `rt.providers.dispatchEvent(...)`.

- [ ] **Step 7 — Tests + check.** Port the existing PluginHost provider tests (similar/recommend/sections/acquisition/track-detail timeout+isolation+merge) to `provider-hub.test.ts` against the hub directly. Add a first-party-registration test (register a provider via the in-process API → it shows up in `getSimilar`). `pnpm --filter @musex/desktop test`, biome, tsc (both configs) clean.

- [ ] **Step 8 — Commit:** `refactor(desktop): extract ProviderHub (registry + fan-out) from PluginHost`.

---

## Cluster 2 — API v2 (RPC-shaped `@musex/plugin-api`)

**Files:** Modify `packages/plugin-api/src/index.ts`; `packages/desktop/src/main/plugins/plugin-host.ts` (`HOST_API_VERSION = 2`); `docs/plugins.md`.

- [ ] **Step 1 — `HOST_API_VERSION = 2`** in `plugin-host.ts` (and the manifest-validation reason strings already reference it).

- [ ] **Step 2 — Replace `ctx.fetch` + `ctx.net`** in `PluginContext`. Remove `fetch: typeof fetch` and the `net?: { client(...) }` field. Add:

```typescript
/** HTTP via the host. The plugin gets a serializable response, never a live
 *  Response/fetch (those can't cross the sandbox boundary). `init.allowSelfSigned`
 *  routes through the host's TLS-relaxed transport. */
net: {
  fetch(url: string, init?: NetFetchInit): Promise<NetFetchResponse>;
};
```

```typescript
export interface NetFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  allowSelfSigned?: boolean;
}
export interface NetFetchResponse {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  body: string; // text; binary bodies are out of scope for v2
}
```

Keep `storage`/`secrets`/`log`/`events`/`library`/`ui`/`register*`/settings unchanged in spelling. Update the `apiVersion` doc comment to 2.

- [ ] **Step 3 — Host `net.fetch` impl** (in `buildPluginContext` deps): a function that calls the existing `createNetClient({allowSelfSigned})` (from `main/plugins/net-client.ts`) then returns `{ok,status,headers:Object.fromEntries(res.headers),body:await res.text()}`. (Same TLS code SP1 added, now behind the RPC shape; for the in-process path it's a direct call, for the sandbox path the bridge wraps it.)

- [ ] **Step 4 — `docs/plugins.md`** — update to v2: `ctx.net.fetch` (the new shape + `allowSelfSigned` in init), note `ctx.fetch`/`ctx.net.client` are gone, document the sandbox model (plugins run in QuickJS; pure ES + host preamble; bundle target `es2022`/`platform:neutral`), and `apiVersion` is now 2.

- [ ] **Step 5 — Check + commit.** `pnpm --filter @musex/plugin-api typecheck`; biome; commit `feat(plugin-api): v2 RPC ctx.net.fetch (apiVersion 2)`. (lastfm/lidarr still reference the old API at this step — they're fixed in clusters 4/5; desktop may not fully typecheck until then, so this cluster's gate is plugin-api typecheck only; the full `pnpm check` gate is at the end.)

---

## Cluster 3 — QuickJS sandbox runtime (port the spike harness)

**Goal:** third-party plugins load + run in QuickJS over the v2 bridge, registering providers into the ProviderHub via `__invoke`.

**Files:**
- Add dep: `quickjs-emscripten` to `packages/desktop` (the spike used `0.32.0`; `npm view quickjs-emscripten version` and pin latest stable).
- Create: `main/plugins/sandbox/quickjs-host.ts` (context lifecycle + the `newPromise` settled-driver + preamble), `sandbox/bridge.ts` (builds the v2 `ctx` as guest objects → host capabilities; the `__invoke`/`__emit` protocol; provider registration that adds ProviderHub entries calling guest methods), `sandbox/index.ts` (a `loadSandboxedPlugin(dir, manifest, deps) → { dispose() }`). Tests: `sandbox/quickjs-host.test.ts`, `sandbox/bridge.test.ts`.
- Modify: `plugin-host.ts` `activatePlugin` to load user plugins via the sandbox instead of `import()`.

- [ ] **Step 1 — Read the reference.** `git show spike/quickjs-sandbox:spike/quickjs/harness.mjs` and `…/FINDINGS.md`. The harness is the working implementation of: sync `QuickJSContext`, the `newPromise` driver (host capability returns a guest Promise settled from host async — **do NOT use the asyncify context**), the host preamble (`setTimeout/clearTimeout/setInterval`, `URL`/`URLSearchParams`, `console`, `structuredClone`), loading an ESM bundle via `evalCode(code, name, {type:"module"})`, and the `__invoke`(host→guest provider method)/`__emit`(host→guest event) shims, with `Scope`/`using` handle discipline. Port it into the typed production modules below.

- [ ] **Step 2 — `quickjs-host.ts`** (TDD): a `SandboxContext` class wrapping a sync `QuickJSContext` with: `installPreamble()`, `loadModule(code, name): exports handle`, `callGuest(fnHandle, args): Promise<unknown>` (drives the guest Promise to settlement via the `settled` callback), and `dispose()`. Test: a tiny module that `await`s two host calls in sequence resolves correctly (the spike's key regression — proves the driver), and dispose leaks no handles.

- [ ] **Step 3 — `bridge.ts`** (TDD): given a `SandboxContext` + host deps (`netFetch`, `storage`, `secrets`, `log`, `library`, `ui`, and the `ProviderHub` + plugin id), build the guest `ctx` object (v2 shape) and wire registration: when the guest calls `ctx.registerAcquisitionProvider(obj)` (etc.), store the guest object handle and `hub.registerAcquisitionProvider(pluginId, hostProxy)` where `hostProxy.lookupArtistAlbums(name)` marshals args → `__invoke` the guest method → await → marshal the JSON result back. `events` → keep a guest emitter the host calls via `__emit`; `ctx.net.fetch` → calls host `netFetch` and resolves the guest promise with `{ok,status,headers,body}`. Tests: a guest plugin calls `ctx.net.fetch` (fake host fetch) and gets the response; a guest-registered provider is invoked through the hub and returns data; `events` deliver.

- [ ] **Step 4 — `index.ts` `loadSandboxedPlugin`** reads `<dir>/<entry>`, creates a `SandboxContext`, installs preamble, loads the module, builds the bridge, calls the guest `activate(ctx)`, and returns `{ dispose }` (disposes the context + the hub registrations). Settings: the guest `registerSettings`/`onSettingsAction` route through the same plugin-settings storage the host already has (the schema is data; the action handler is a guest fn called via `__invoke`).

- [ ] **Step 5 — PluginHost** `activatePlugin` (user plugins) calls `loadSandboxedPlugin(...)` instead of `import()`; store the returned `dispose` for deactivation. (Core plugins are gone after cluster 4; the static `loadCore` path can stay but `CORE_PLUGINS = []`.)

- [ ] **Step 6 — Tests + check.** Sandbox unit/integration green; `pnpm --filter @musex/desktop test`; biome; tsc. Commit `feat(desktop): QuickJS sandbox runtime for third-party plugins (v2 bridge)`.

---

## Cluster 4 — Last.fm baked into core

**Goal:** last.fm is a first-party service on the ProviderHub; config in app Settings; removed from the plugin system.

**Files:**
- Create: `main/lastfm/{service.ts, client.ts, signing.ts}` (client.ts + signing.ts moved from `plugins/lastfm/src/`), `main/lastfm/service.test.ts`.
- Modify: `runtime.ts` (start the service), `persistence.ts` (lastfm config fields), `ipc.ts` (`musex:lastfm:*`), `ipc-contract.ts` + preload (lastfm config API), `renderer/.../SettingsView.tsx` (a "Last.fm" category), `electron.vite.config.ts` (drop the lastfm exclude), `packages/desktop/package.json` (drop the dep).
- Delete: `git rm -r plugins/lastfm`; `core-plugins.ts` → `CORE_PLUGINS = []` (keep the file/type for the empty list).

- [ ] **Step 1 — Move client + signing** into `main/lastfm/` unchanged (they're pure — `node:crypto` signing is fine in main).

- [ ] **Step 2 — `LastfmService`** (port `plugins/lastfm/src/index.ts`'s `activate` logic): `start(hub: ProviderHub, deps: { netFetch, getConfig, setConfig, secrets, notify, openExternal, log })` registers the same contributions **on the hub** (`registerSimilarProvider`/`registerTrackRecommender`/`contributeSections("discover")`/`contributeTrackDetail`/`contributeTrackAction("Love on Last.fm")`) and subscribes to `trackStarted`/`scrobble`/`trackRated` via `hub.onEvent("core:lastfm", …)`. Replace `ctx.storage`/`ctx.secrets` with the app-settings deps; replace `ctx.fetch` with `deps.netFetch` (or a direct fetch wrapper — it's in core, so a plain fetch is fine, but use the same `{ok,status,body}` discipline). Replace `ctx.ui.notify`/`openExternal` with deps.

- [ ] **Step 3 — Config** in `persistence.ts`: add `lastfm: { apiKey, scrobbling, loveOnRating, username, connection }` to `PersistedState` defaults + getters/setters; `apiSecret`/`sessionKey` via `secureStore`. IPC `musex:lastfm:getConfig/setConfig/connect` in `ipc.ts` (the "Connect" token poll moves into the service). Preload + ipc-contract DTOs.

- [ ] **Step 4 — Settings pane:** a "Last.fm" category in `SettingsView.tsx` (API key text + Connect button + status + scrobbling + love-on-rating toggles), replacing the old `plugin:lastfm` pane. Use the existing settings-row/btn/toggle styling.

- [ ] **Step 5 — Remove the plugin:** `git rm -r plugins/lastfm`; `core-plugins.ts` → `export const CORE_PLUGINS: readonly CorePlugin[] = []`; drop `@musex/plugin-lastfm` from `electron.vite.config.ts` exclude + `packages/desktop/package.json`; `pnpm install`; `pnpm gen:licenses`.

- [ ] **Step 6 — Runtime** calls `new LastfmService().start(this.providers, {…})` after the hub is built.

- [ ] **Step 7 — Tests + check.** Port the lastfm plugin's tests to `service.test.ts` (providers against a fake fetch). `pnpm --filter @musex/desktop test`; biome; tsc both configs. Commit `feat(desktop): bake Last.fm into core (first-party provider on the hub)`.

---

## Cluster 5 — lidarr at apiVersion 2 (musex-plugins, separate repo)

**Repo:** `~/src/musex-plugins`. **Files:** `plugins/lidarr/src/{index.ts,transport.ts,client.ts}`, `plugins/lidarr/plugin.json`, `vendor/plugin-api/index.ts`, `plugins.json`.

- [ ] **Step 1 — Re-vendor the v2 API types** — copy musex's updated `packages/plugin-api/src/index.ts` → `vendor/plugin-api/index.ts` (header notes the new source commit + apiVersion 2).
- [ ] **Step 2 — lidarr to `ctx.net.fetch`** — replace `httpFnFrom(ctx.net?.client(...) ?? ctx.fetch)` with calls to `ctx.net.fetch(url, { ...init, allowSelfSigned })`; the client's `HttpFn` adapts `ctx.net.fetch`'s `{ok,status,body}` (drop `transport.ts`'s fetch-shape dependence). `plugin.json` `apiVersion: 2`, version `0.2.0`.
- [ ] **Step 3 — Build target** — esbuild `target:"es2022"`, `platform:"neutral"`, no node builtins (already node-free). Verify `index.mjs` runs the v2 shape.
- [ ] **Step 4 — Tests + release** — `pnpm test`/`typecheck`/`build` green; `plugins.json` → lidarr `version 0.2.0`, `tag lidarr-v0.2.0`, `asset lidarr-0.2.0.zip`; commit + tag `lidarr-v0.2.0` (the release workflow publishes it; or cut manually like v0.1.0). **Controller note:** this is a separate repo — the controller runs/verifies it after the musex side is green.

---

## Cluster 6 — Full check, docs, PR

- [ ] `pnpm check` green (the WHOLE repo now compiles against v2: ProviderHub + sandbox + core lastfm + no plugins). Fix repo-wide biome.
- [ ] `CLAUDE.md` — rewrite the plugin-architecture bullet: ProviderHub (registry + fan-out, Runtime-owned, 3 registration paths); last.fm is first-party core (not a plugin); third-party plugins run in the QuickJS sandbox (sync+newPromise, preamble, bridge, `__invoke`/`__emit`, `Scope`/`using`); `apiVersion 2` RPC `ctx.net.fetch`; `CORE_PLUGINS = []`; lidarr at v0.2.0. Note the spike branch as the QuickJS reference.
- [ ] Commit docs; push; open PR `feat: core Last.fm + third-party QuickJS plugin sandbox (apiVersion 2)`. Body: links spec/roadmap, the re-architecture summary, the breaking v2 + no-migration note (reconnect Last.fm; install lidarr v0.2.0), and the manual desktop verification (Last.fm connect/scrobble/similar/radio from the new pane; install lidarr v0.2.0 → runs sandboxed → External Artist/Downloads work; an old v1 plugin shows incompatible).

---

## Self-review (controller)
- **Spec coverage:** ProviderHub (C1), API v2 (C2), sandbox (C3), core lastfm (C4), lidarr v2 (C5), docs/PR (C6). ✓
- **Ordering rationale:** C1 first (behavior-preserving, unblocks both paths); C2 before C3/C4 (they target v2); C3 before C4 only loosely (independent — C4 doesn't need the sandbox); C5 after the musex side is green; full `pnpm check` gate at C6 (intermediate clusters may not fully compile until lastfm/lidarr move to v2 — gate each on its filtered tests + the relevant typecheck, full check at the end).
- **Port-not-inline:** C3 (spike harness) + C4 (lastfm code) + the C1 fan-out are MOVES of real, tested code — the plan gives exact sources + transformations + the new contracts (ProviderHub API, v2 `net.fetch`, bridge protocol) in full. Not placeholders.
- **Risk:** biggest piece; build cluster-by-cluster, keep filtered checks green, full check at C6. Handle discipline (`Scope`/`using`) in C3 is the sharpest edge — test teardown explicitly.
