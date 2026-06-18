# Mobile Plugin System (Phase D1) Design

**Date:** 2026-06-18
**Status:** ⚠️ PARTIALLY SHELVED (2026-06-18). The mobile app is targeting the **App Store**, and Guideline 2.5.2 forbids downloading third-party code that adds app features — so the **mobile WebView sandbox + GitHub plugin install (this spec's headline feature) cannot ship to the App Store** and was shelved. Only the **`@musex/plugin-host` package extraction + `plugin-source`→core promotion** shipped (a desktop-serving refactor; desktop self-distributes and keeps its full third-party-plugin system). The built-but-shelved mobile sandbox/transport/host-caps/install/UI is preserved at git tag **`shelved/mobile-plugin-sandbox`** (recoverable for a future sideload/dual-build path). **Mobile plugins go first-party / compiled-in instead** (last.fm already is, from Phase B / PR #55); any future mobile provider is a first-party service, not a downloaded plugin. Lidarr/acquisition stays desktop-only (also a Guideline 5.x content risk on the App Store). The original design below is kept as the record of what was designed + built before the App Store constraint forced the pivot.
**Context:** The feasibility spike (`docs/superpowers/spikes/2026-06-18-ios-plugin-sandbox-spike.md`) + an on-device PoC proved that `quickjs-emscripten` (WASM QuickJS) runs sandboxed inside a hidden `react-native-webview`, and that the desktop's sync-QuickJS + `newPromise` driver survives an async RN↔WebView postMessage bridge (two sequential `await`s round-tripped; teardown/re-init worked). This phase builds the **production** mobile plugin system on that validated architecture, **extracting the platform-agnostic sandbox into a shared `@musex/plugin-host` package** consumed by both desktop and the mobile WebView harness.

## Goal

A user can install a real third-party plugin from GitHub (e.g. `lidarr` from `matjam/musex-plugins`) on iOS; it activates **sandboxed** in a QuickJS context inside a hidden WebView, with the full v2 `ctx` (net/storage/secrets/library/events/ui + provider registration), and registers its providers into a RN-side `ProviderHub`. Plugin management (list / Add-from-GitHub / enable-disable / remove) lives in Settings → Plugins. **D1 is the foundation only** — the features that *consume* the registered providers (Lidarr acquisition UI, taste expansion, federated search) are deferred to their own sub-phases.

## Architecture

### New shared package `@musex/plugin-host`

Extract the platform-agnostic sandbox from desktop into a new workspace package (`packages/plugin-host`, `@musex/plugin-host`), split by dependency so each surface imports only what it can run:

- **`@musex/plugin-host` (root export) — `ProviderHub`** (from desktop `main/providers/provider-hub.ts`, 721 lines, pure: registry + fan-out, zero quickjs/Node deps). Imported **RN-side** on mobile and in **`main`** on desktop.
- **`@musex/plugin-host/sandbox` (subpath export)** — the quickjs-dependent core (from desktop `main/plugins/sandbox/{quickjs-host,bridge,index}.ts`): `SandboxContext` (sync context + `settlePromise` driver), `installBridge` (preamble + `__invoke`/`__emit` + JSON marshalling + provider proxies + v2-`ctx` wiring), `loadSandboxedPlugin` (orchestration). Depends on `quickjs-emscripten`. Runs in **`main`** on desktop (Node WASM) and is **esbuild-bundled into the mobile WebView harness** (singlefile WASM variant). **Host capabilities, the quickjs module instance, and (mobile) the transport are injected** — the package contains no Node/Electron/RN imports.
- Tests move with the code (the package owns `provider-hub.test.ts`, `bridge.test.ts`, `quickjs-host.test.ts`).
- TS source export (like `@musex/core`): `"exports": { ".": "./src/index.ts", "./sandbox": "./src/sandbox/index.ts" }`; consumers bundle it.

### Desktop refactor (mechanical, no behavior change)

`main/providers/provider-hub.ts` and `main/plugins/sandbox/*` are **deleted from desktop and imported from `@musex/plugin-host`** instead. `main/plugins/plugin-host.ts` (orchestration: scan `userData/plugins`), `plugin-context.ts` (builds the Node-host `ctx` capabilities), `net-client.ts`, `plugin-store.ts`, `plugin-installer.ts`, `core-plugins.ts` **stay desktop-specific** (they're the Node host). `@musex/plugin-host` is added to desktop's `externalizeDepsPlugin.exclude` (bundled, like `@musex/core`). Desktop's existing sandbox tests now live in the package; `plugin-host.test.ts`/`plugin-installer.test.ts` stay desktop. **All desktop tests stay green.**

### Mobile sandbox host (`packages/mobile/src/plugins/`)

- **`SandboxHost`** (RN) — owns one hidden `react-native-webview`; mounts the **harness** (an HTML doc embedding an esbuild bundle of `@musex/plugin-host/sandbox` + the singlefile QuickJS variant, WASM inlined — the PoC pattern). Manages **one QuickJS context per plugin** (isolation between plugins, shared WASM module — matches desktop's per-context model). Lifecycle: mount → per-plugin `load(code)` → `activate` → register; `reloadAll` on change; teardown re-inits (PoC-proven).
- **Transport** (`webview-transport.ts`) — bidirectional postMessage RPC with request/response correlation (incrementing id): **RN→WebView** for provider-method `__invoke`s; **WebView→RN** for host-capability calls, provider registration (`__regState`), and events (`__emit`). All JSON-marshalled. (The PoC validated the sync-driver-over-async-bridge round-trip.)
- **RN-side `ProviderHub`** (from `@musex/plugin-host`) — a plugin's registrations cross WebView→RN as **hub proxies** whose methods send `__invoke` over the transport and await the reply (the same proxy shapes desktop builds in-process; here they're transport-backed).
- **Plugin code delivery** — the harness bundle is static; `SandboxHost` reads an installed plugin's `index.mjs` from `expo-file-system` and posts it into the WebView to be `activate(ctx)`'d in a fresh context (the harness `setModuleLoader` returns the posted code).

### Mobile host capabilities (RN, injected over the transport)

Each WebView `ctx` method posts `{hostCap, name, args, id}` to RN; RN executes and replies:
- `storage` — async-storage, namespaced per plugin (`musex.plugin.<id>.<key>`).
- `secrets` — expo-secure-store, per plugin.
- `net.fetch(url, init) → {ok,status,headers,body}` — RN `fetch`. **`allowSelfSigned` is a documented v1 limitation** (standard TLS only; a native TLS path is a later pass).
- `library.search` / `recentlyPlayed` / `topArtists` — via `@musex/core` (gateway + `TasteService`).
- `ui.notify` (toast), `ui.openExternal` (`Linking`, http/https only).
- `events.on` — the store forwards `trackStarted`/`trackEnded`/`paused`/`resumed`/`scrobble`/`trackRated` to the hub → `__emit` into the WebView.

### Plugin install / management (`packages/mobile/src/plugins/` + Settings)

- **Promote `plugin-source.ts`** (desktop `src/logic/plugin-source.ts`, pure: repo-URL parse, manifest shape, `isSafePluginId` `^[a-z0-9-]+$`) into **`@musex/core`** (shared; desktop re-points). 
- **Mobile installer** — RN adapters mirroring desktop SP3: parse repo URL → fetch manifest (raw `main`→`master`) → download the release asset `.zip` + `.sha256` → **verify sha256 (abort on mismatch)** → **`fflate` unzip with the zip-slip WHITELIST** (only `plugin.json` + the manifest `entry`, plain filenames) → **apiVersion-2 gate** → write to `expo-file-system` `documentDirectory/plugins/<id>/` (`isSafePluginId` + containment guard on install AND remove). sha256 via a pure-JS lib (`js-sha256`). Sources persisted in async-storage (`musex.plugin-sources`).
- **UI** — a **Settings → Plugins** screen (`app/(tabs)/settings/plugins.tsx`): installed list with enable/disable toggles + a registered-provider summary, **"Add from GitHub"** (paste repo URL → fetch manifest → install), remove, reload-all. Trust = a `window.confirm`-style full-access gate before install (the sandbox is the real protection). Mirrors desktop's Settings → Plugins.

## Components / files (high level)

- **`packages/plugin-host/`** (new): `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts` (ProviderHub), `src/sandbox/{quickjs-host,bridge,index}.ts` + tests (moved from desktop).
- **Desktop (modified):** delete `main/providers/` + `main/plugins/sandbox/`; repoint `plugin-host.ts`/`plugin-context.ts`/imports to `@musex/plugin-host`(`/sandbox`); `electron.vite.config.ts` exclude; `package.json` dep. `src/logic/plugin-source.ts` → re-point to `@musex/core`.
- **Core (modified):** add `logic/plugin-source.ts` (promoted) + barrel.
- **Mobile (new, `src/plugins/`):** `sandbox-host.ts`, `webview-transport.ts`, `harness/harness.ts` + `harness/build-harness.mjs` + committed `harness-bundle.ts` (esbuild of `@musex/plugin-host/sandbox` + singlefile quickjs), `host-capabilities.ts`, `plugin-store.ts` (expo-file-system dir), `plugin-index.ts` (async-storage installed list), `plugin-installer.ts` (RN install), `plugin-manager.ts` (orchestration: scan/activate/reload + own the RN ProviderHub + SandboxHost).
- **Mobile (new UI):** `app/(tabs)/settings/plugins.tsx` + `settings/_layout` registration + `settings/index` link row.
- **Mobile store:** construct the `PluginManager` + `ProviderHub`; forward playback/rating events to the hub; expose plugin list/install/remove/enable.
- **Deps (mobile):** `react-native-webview` (re-add — PoC's was dropped), `quickjs-emscripten-core` + `@jitl/quickjs-singlefile-browser-release-sync` + `esbuild` (harness build-only), `fflate`, `js-sha256`.

## Data flow

1. **Install:** Settings → Add-from-GitHub → installer (manifest → download → sha256 → unzip-whitelist → apiVersion gate → write `documentDirectory/plugins/<id>/`) → PluginManager.reload.
2. **Activate:** PluginManager reads `index.mjs` → `SandboxHost.load(id, code)` → WebView creates a context, `installBridge` with a transport-backed `ctx`, evals the module, `activate(ctx)`, posts `__regState` → RN builds hub proxies → registers into the RN `ProviderHub`.
3. **Invoke (later, by a consuming feature):** a feature calls a hub provider → proxy → transport `__invoke(path, method, args)` → WebView runs the guest method (its `ctx` host-cap calls round-trip back to RN) → result returns over the transport.
4. **Events:** store playback/rating → hub → transport `__emit` → guest `events.on` handlers.

## Error handling

- Plugin activation throw → `SandboxHost` reports it; the plugin is marked failed (not registered), surfaced in the UI; other plugins unaffected.
- Transport: request timeouts (a plugin method that never replies) reject the proxy call; the consuming feature handles it (the hub fan-out already tolerates a provider erroring).
- WebView teardown/reclaim (iOS backgrounding): on remount, re-init + re-`load`/`activate` all enabled plugins (PoC-proven re-init). Provider calls while the WebView is down reject gracefully.
- Install: sha256 mismatch / bad apiVersion / zip-slip / unsafe id → abort with a clear error, write nothing.

## Testing

- **`@musex/plugin-host`:** the moved `provider-hub` / `bridge` / `quickjs-host` tests run in the package (desktop's coverage preserved, now shared).
- **Core:** `plugin-source` tests (promoted).
- **Mobile (pure/unit):** `webview-transport` (correlation, timeout, marshalling — fake postMessage), `plugin-installer` (fake fetch + fake fs: manifest→sha256→unzip-whitelist→apiVersion gate; abort paths), `plugin-index`/`plugin-store` (fake async-storage/fs), `plugin-manager` (activate/reload/register against a fake SandboxHost + the real hub). The `SandboxHost` + harness (the actual WebView/WASM) are **on-device-verified** (the PoC graduated here).
- **Verification bar:** full `pnpm check` (core + desktop ×2 tsc + mobile + the new plugin-host package + biome + all tests) green before every commit; the controller re-runs before push.
- **On-device acceptance (user):** install `lidarr` from `matjam/musex-plugins` → it activates without error → Settings → Plugins shows it registered an acquisition provider; the host caps work (the plugin can `net.fetch`). Requires a dev-client rebuild (`react-native-webview` native).

## Non-goals / deferred

- The **consuming features**: Lidarr acquisition UI, taste expansion, federated/external search — each its own sub-phase (they read the registered providers).
- `allowSelfSigned` TLS for `ctx.net.fetch` on mobile (standard TLS only in v1).
- iOS background-execution robustness for provider work (WebView is suspended in the background; acceptable for v1 — providers run foregrounded).
- Plugin settings UI (declarative `registerSettings` schema rendering) beyond what's needed to install/activate — can ride a later pass; v1 surfaces enable/disable + registered providers.
- Android (the WebView harness could serve it later; iOS-first).

## Success criteria

- `@musex/plugin-host` exists (ProviderHub + sandbox subpath); desktop consumes it with **no behavior change** (desktop tests green); `plugin-source` is in `@musex/core`.
- Mobile: install a real plugin from GitHub (verified sha256 + zip-slip-safe + apiVersion-2), it activates sandboxed in a per-plugin QuickJS context inside the WebView with the full v2 `ctx`, and registers its providers into the RN `ProviderHub`; Settings → Plugins manages it.
- All pure/unit logic tested; `pnpm check` green across all packages; the new mobile deps are present (dev-client rebuild noted).
