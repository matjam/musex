# Spike: iOS Plugin Sandbox (Phase D feasibility)

**Date:** 2026-06-18
**Question:** Can musex run **untrusted third-party plugins** sandboxed on iOS (Expo SDK 56 / RN 0.85 / Hermes / New Arch), the way desktop does via `quickjs-emscripten`? If so, how — and how much desktop code is reusable?
**Verdict:** **Yes — viable, via `quickjs-emscripten` (WASM QuickJS) inside a hidden `react-native-webview`, bridged by postMessage.** It's the only approach that is both a real security boundary AND a match for the desktop sandbox, and it reuses the desktop sandbox host/bridge nearly verbatim. A small on-device PoC should de-risk three unknowns before committing to the full Phase D build.

## The constraint

Desktop sandboxes plugins with QuickJS compiled to **WASM** (`quickjs-emscripten`). On iOS:
- **Hermes has no WASM** — it can't instantiate a `WebAssembly` module, so the desktop sandbox can't run in-process on the phone.
- **iOS forbids JIT / W^X memory** in ordinary app processes (blocks most fast native WASM runtimes too). The one system-blessed exception is **WebKit / WKWebView** (`com.apple.security.cs.allow-jit`) — the only place full-speed WASM + JIT runs on iOS.
- The sandbox runs **untrusted third-party code**, so the bar is a genuine *security* boundary (no access to the Plex token, filesystem, or network except via the bridged `ctx`) — not merely a separate JS heap.

## Options evaluated (evidence-based)

| Approach | Viable on iOS/Expo 56? | Maintenance | Isolation | Desktop reuse |
|---|---|---|---|---|
| **Native QuickJS RN binding** (`react-native-quickjs`) | No — engine swap, ejects Hermes, no New Arch | Dead (npm 0.0.2, 2023-06) | engine swap, not a 2nd isolate | low |
| QuickJS-NG / Nitro / "modern" bindings | No — don't exist | 404 on npm | — | — |
| **WebView + WASM** (`quickjs-emscripten` in hidden `react-native-webview`) | **Yes — best fit** | both active (quickjs-emscripten 0.32.0 2026-02; react-native-webview 13.16.1 2026-02) | **strongest** — QuickJS-in-WASM **+** WebView process/origin sandbox | **highest** |
| `react-native-worklets` `createWorkletRuntime` | runs, but same-process | active | **insufficient** — heap isolation only, explicitly not a security boundary | low |
| `margelo/react-native-runtimes` | early (GitHub-only) | early | **explicitly NOT a security sandbox** (trusted offload only) | low |
| separate JSC `JSContext` / native WASM (`react-native-webassembly`) | no maintained sandbox path; JIT-disabled when embedded | abandoned | heap-only / N/A | none |

Native Hermes-runtime isolation (worklets, react-native-runtimes) gives a separate heap but **shares the process** — fine for *trusted* heavy-work offload, useless for *untrusted* plugins. Keep on the shelf only if the trust model is ever relaxed to first-party-only.

## Recommended architecture

A **hidden `react-native-webview`** hosts an HTML harness that runs `quickjs-emscripten` + the (reused) desktop `quickjs-host` + `bridge`. The **RN side** runs the existing `ProviderHub` + the host capabilities (storage/secrets/net/library/ui). The RN↔WebView **postMessage RPC** replaces the desktop in-process bridge.

Why this composes so well: the desktop bridge is **already async IPC** (renderer↔main), with `__invoke`/`__emit` **JSON-marshalled** message shapes. Those shapes map directly onto `postMessage`/`onMessage`/`injectJavaScript`. And the desktop sandbox deliberately uses a **sync `QuickJSContext` + `newPromise` driver** ("do NOT use asyncify — it corrupts the WASM heap on the 2nd sequential await"); that sync model is *inside* the WebView, unaffected by the async RN boundary.

### Reuse map (from the desktop-requirements analysis)

- **Reusable nearly as-is** (runs inside the WebView harness): `quickjs-host.ts` (sync context + `settlePromise` polling: `getPromiseState` → `executePendingJobs` → yield), `bridge.ts` (JSON marshalling, `__invoke`/`__emit`, host preamble: `setTimeout`/`URL`/`URLSearchParams`/`console`/`structuredClone`, provider-registration → proxies, handle/`dispose` discipline), and the `@musex/plugin-api` v2 types.
- **Reusable as-is** (RN side): `ProviderHub` (pure registry + fan-out).
- **New / rewritten for iOS:**
  - the **RN↔WebView RPC transport** (replaces desktop's in-process call path; correlate request/response over the single message channel),
  - **host capabilities** RN-side: `storage` (async-storage), `secrets` (expo-secure-store / Keychain), `net.fetch` (RN `fetch`; `allowSelfSigned` needs a native TLS path), `library.*` (the app's `@musex/core`), `ui.notify`/`openExternal`,
  - delivering the **WASM blob** into the WebView (inlined `ArrayBuffer` → `WebAssembly.instantiate`).
- Note: the Hermes polyfills (`structuredClone`, `URL`) do **not** apply inside the WebView — it's full WebKit — so the harness preamble is its own thing.

## Top 3 unknowns a PoC must resolve

1. **WASM-in-WebView on a real device.** Confirm `WebAssembly.instantiate` of the `quickjs-emscripten` blob succeeds inside `react-native-webview` on a physical iPhone (inline the `.wasm` as a base64 `ArrayBuffer` — WKWebView blocks cross-origin `file://` WASM `fetch`). Measure init time.
2. **Sync QuickJS driver across an async, string-only bridge.** Prove a plugin doing two sequential `await ctx.net.fetch(...)` calls round-trips correctly through postMessage without the heap-corruption failure mode, and define the request/response correlation + backpressure over one channel.
3. **WebView lifecycle / background / perf.** A hidden WebView is suspended in the background and can be reclaimed under memory pressure — so provider work (scrobble/recommend) may stall when backgrounded. Measure cold-start (mount + WASM init + `activate`), steady-state per-`__invoke` overhead, and define re-init + re-register on teardown (mirroring desktop `reloadAll`). Confirm `react-native-webview` New-Arch interop on RN 0.85 / Expo 56 (install via `expo install`).

## Scope notes

- The WebView sandbox is **iOS-focused**; a single WebView harness could also serve Android (avoiding a third sandbox impl) — flag for the Phase D design.
- This unblocks **all** of Phase D's deferred features (third-party plugins, Lidarr acquisition, taste expansion, federated/external search) — they all ride the same sandbox + `ProviderHub` once the harness exists.

## Proposed next step

A thin **PoC** (hidden WebView + inlined quickjs-emscripten + a 2-sequential-`await` round-trip + a teardown/re-init cycle) to resolve the three unknowns on-device. If green, brainstorm the full Phase D design (sandbox host + RN host caps + the plugin install/UI surface) from the PoC's findings. If a blocker surfaces (e.g. background suspension makes scrobble providers impractical), reassess scope before building.
