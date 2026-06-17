# Core Last.fm + Third-Party QuickJS Sandbox + Provider Registry Decoupling — Design

**Date:** 2026-06-16
**Status:** Approved-in-conversation as ONE combined piece (user: "they're one piece"). This is the SP4 re-architecture; iOS sandbox is a later follow-up (needs its own native-QuickJS spike).
**Branch:** `feature/core-lastfm-and-sandbox` (one musex PR) + a coordinated `musex-plugins` lidarr re-release at apiVersion 2.
**Spike:** `spike/quickjs-sandbox` branch — `spike/quickjs/FINDINGS.md` (the QuickJS mechanics this builds on).

## The reframe

Last.fm is **central** to discovery/taste/radio, so it becomes a **first-party, in-process, trusted** feature — NOT a plugin, NOT sandboxed. **Third-party** plugins (lidarr + future) run **sandboxed** in QuickJS. Both contribute through the **same provider contracts** (`SimilarProvider`/`TrackRecommender`/`AcquisitionProvider`/sections/track-detail/track-action) via **one shared registry** — consumers don't care where a provider lives. The plugin API stays as the contract for third-party "music database / acquisition" providers; only its *transport* changes (RPC, since a sandbox boundary can't pass live functions).

Three registration paths into one registry:
1. **In-process first-party** (last.fm) — registers directly, trusted, zero bridge.
2. **Sandboxed third-party** (lidarr) — registers across the QuickJS bridge; its provider methods are called via `__invoke`.
3. (the old full-trust `import()` path is **removed** — no more trusted-but-unsandboxed third-party code.)

## Component 1 — ProviderHub (decouple registry + fan-out from PluginHost)

Today `PluginRegistry` (`main/plugins/plugin-context.ts`) is standalone but PluginHost owns it AND the fan-out consumers (`getSimilar`/`recommendTracks`/`getSections`/`lookupAlbums`/`acquisitionStatus`/`getTrackDetails`/event dispatch). Extract these into a standalone **`ProviderHub`** (`main/providers/provider-hub.ts`) that the **Runtime** owns:
- Holds the registry + the `register()` helper (returns a `Disposable`).
- The fan-out/consumer methods move here verbatim (timeouts/isolation unchanged).
- `dispatchEvent(event, payload)` fans out to `eventSubscribers`.
- A **first-party registration API** (`hub.registerSimilarProvider(p)`, `registerTrackRecommender`, `registerAcquisition`, `contributeSections/TrackAction/TrackDetail`, `onEvent`) used by core last.fm — same shape `buildPluginContext` uses, minus the `pluginId` (use a reserved `"core:lastfm"` id).
- PluginHost takes the hub as a dep and registers plugins' contributions into it (instead of owning the registry). IPC handlers call `rt.providers.*` instead of `rt.plugins.*` for provider fan-out. (`rt.plugins.*` keeps the plugin-management surface: list/setEnabled/reload/install/settings.)

This is a refactor with **no behavior change** for the Similar panel / radio / Discover / acquisition — same registry, same consumers, new owner.

## Component 2 — Last.fm baked into core

Move `plugins/lastfm/src/*` (client.ts + signing.ts + the activate logic) into a first-party **`main/lastfm/`** service:
- `LastfmService.start(hub, deps)` registers the same providers/handlers it does today — `registerSimilarProvider` (similarArtists/Tracks/topAlbums/artistInfo), `registerTrackRecommender`, `contributeSections("discover")`, `contributeTrackDetail`, `contributeTrackAction("Love on Last.fm")` — directly into the ProviderHub, and subscribes to `trackStarted`/`scrobble`/`trackRated` via `hub.onEvent`.
- **Config → app Settings** (not plugin storage): new electron-store fields `lastfm: { apiKey, scrobbling, loveOnRating, username, connection }` + secrets (`apiSecret`, `sessionKey`) via the existing `secureStore`. New IPC `musex:lastfm:getConfig/setConfig/connect` (the "Connect" PKCE-ish token flow moves here). Renderer gets a **"Last.fm" settings category** (replacing the old `plugin:lastfm` pane) — API key field, Connect button + status, scrobbling + love-on-rating toggles.
- **No migration** (single-user, pre-1.0 — break freely): last.fm config starts fresh in the new Settings pane (re-enter the API key + reconnect). The old `userData/plugin-{data,secrets}/lastfm.json` files are just orphaned — no compat code.
- Remove last.fm from the plugin system: drop from `core-plugins.ts` (now empty → `CORE_PLUGINS = []`), `electron.vite.config.ts` exclude, desktop `package.json` dep; `git rm -r plugins/lastfm`. `node:crypto` signing is fine in core.

## Component 3 — QuickJS sandbox runtime (third-party plugins)

Replace PluginHost's `activatePlugin` dynamic `import()` with a **QuickJS sandbox** (`main/plugins/sandbox/`), per the spike:
- **`quickjs-emscripten`**, a **sync** `QuickJSContext` + a **`newPromise`-based promise driver** (NOT asyncify — asyncify corrupts the WASM heap on a plugin's 2nd sequential `await`; the spike proved the sync+newPromise model handles arbitrary sequential awaits). Use a `settled`-callback driver (not polling).
- **Preamble** injected by the host (the plugin gets pure ES only): `setTimeout/clearTimeout/setInterval`, `URL`/`URLSearchParams`, `console`, `structuredClone`.
- **Bridge** = the v2 capability API as guest objects whose methods call host capabilities and return guest Promises settled from host async work. `ctx.net.fetch`, `ctx.storage`, `ctx.secrets`, `ctx.log`, `ctx.library`, `ctx.ui.*`, `ctx.register*`.
- **Provider registration from the sandbox:** when a plugin calls `ctx.registerAcquisitionProvider(obj)`, the host stores a handle to the guest object and registers a ProviderHub provider whose methods marshal args in → call the guest method via `__invoke` → await the guest Promise → marshal the JSON result back. Same for similar/recommender/section/track-detail/track-action. `events` → host pushes via `__emit`. `Disposable` → host-owned stub.
- **Handle-lifetime discipline:** wrap all QuickJS handle use in `Scope`/`using` — a single leaked handle aborts on teardown (spike finding). One context per plugin; dispose on disable/reload/uninstall.
- Strict bundle expectations: plugins are ESM (`evalCode(code, name, {type:"module"})` runs esbuild `format:esm` as-is — no IIFE needed). The plugin build retargets to `es2022`/`platform:neutral`/no-node-builtins (musex-plugins change).
- v1 limitations (documented): no binary fetch bodies (text/JSON only); iOS not covered (native QuickJS = follow-up).

## Component 4 — API v2 (`@musex/plugin-api`, RPC-shaped)

- **`apiVersion → 2`** (breaking; `HOST_API_VERSION = 2`). v1 plugins list as "incompatible".
- **`ctx.net.fetch(url, init?) → { ok, status, headers, body }`** (plain object; `body` is text) **replaces** `ctx.fetch` and `ctx.net.client()`. TLS relaxation is an `init` flag (`init.allowSelfSigned`). (The host still owns the Node TLS code — SP1's `net-client.ts` — now invoked behind the RPC.)
- `events.on` semantics unchanged in spelling (host pushes payloads); contribution providers/`AcquisitionProvider`/`SimilarProvider`/`TrackRecommender` keep their interfaces (args/returns already JSON-serializable) — only transported via the bridge for sandboxed plugins. `Disposable` keeps its shape (host-backed).
- Docs (`docs/plugins.md`) updated for v2 + the sandbox model + the RPC fetch + the build target.

## Component 5 — lidarr at apiVersion 2 (musex-plugins, coordinated)

In `~/src/musex-plugins`: bump lidarr to use `ctx.net.fetch` (drop the `httpFnFrom(ctx.net.client...)` shim → call `ctx.net.fetch` directly; TLS via the init flag), `apiVersion: 2`, build target `es2022`/`platform:neutral`, re-release `lidarr-v0.2.0`, update `plugins.json`. (Its own repo PR/commit + release.) musex's installer already gates on apiVersion, so a v2 host installs the v2 lidarr.

## Migration / compatibility
- **Last.fm:** no migration — reconnect in the new Settings → Last.fm pane (single-user, break freely).
- **Third-party plugins:** must be apiVersion 2 + sandbox-compatible. lidarr re-released at v2; any v1 user-installed plugin shows "incompatible" until updated.
- No bundled plugins remain in musex after this (CORE_PLUGINS = []).

## Testing
- **ProviderHub:** unit tests for register/dispose + each fan-out (timeout/isolation/merge) — port the existing PluginHost provider tests to the hub.
- **Sandbox:** unit/integration tests using `quickjs-emscripten` — load a tiny test plugin, exercise the bridge both directions (a bridged `net.fetch` against a fake; a registered provider called via `__invoke`), checksum/handle-teardown safety. The spike harness is the reference.
- **Last.fm service:** unit-test the providers against a fake fetch (port the lastfm plugin's tests).
- **API v2 + lidarr:** plugin-api typecheck; lidarr tests in musex-plugins green at v2.
- `pnpm check` green throughout; full check before push.
- **Manual (user, desktop):** Last.fm connect + scrobble + similar/radio still work from the new Settings pane; install lidarr v0.2.0 from the repo → runs sandboxed → External Artist/Downloads work; a deliberately-incompatible/old plugin shows "incompatible".

## Decomposition (one PR, internal clusters, in order)
1. **ProviderHub** — extract registry + fan-out from PluginHost; Runtime owns it; PluginHost + IPC re-pointed. (No behavior change; lastfm still a core plugin at this step.)
2. **API v2** — `@musex/plugin-api` RPC revision + `HOST_API_VERSION = 2` + docs.
3. **QuickJS sandbox** — the runtime + bridge; PluginHost loads user plugins via the sandbox instead of `import()`.
4. **Last.fm → core** — `main/lastfm/` service on the hub + app-settings config + Settings pane + migration; remove the lastfm plugin (CORE_PLUGINS = []).
5. **musex-plugins** — lidarr → v2 + `ctx.net.fetch`, re-release `lidarr-v0.2.0`.
6. Full check, CLAUDE.md, PR.

## Risks
- Largest, riskiest piece: changes plugin execution, moves a central feature, breaks the API, spans two repos. Mitigated by building in the verified clusters above (each keeps `pnpm check` green) and the spike having de-risked the QuickJS mechanics.
- QuickJS handle leaks abort on teardown — enforce `Scope`/`using` everywhere; test teardown explicitly.
- The ProviderHub extraction must be behavior-preserving — port the existing provider tests first.

## Out of scope
- iOS sandbox (native QuickJS) — separate follow-up + its own spike.
- A formal `MetadataProvider` beyond today's `SimilarProvider` (the existing surface covers "browse a music DB over an API"; generalize later if needed).
- Binary fetch bodies in the sandbox v1.
