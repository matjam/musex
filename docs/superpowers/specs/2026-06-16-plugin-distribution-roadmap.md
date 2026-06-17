# Plugin Distribution & Sandboxing — Roadmap (4 pieces)

**Date:** 2026-06-16
**Status:** Decomposition approved in conversation. Each piece below gets its own spec/plan → PR → merge → integration check, in order.

## Vision

Plugins are **third-party, GitHub-distributed** add-ons. A user pastes a GitHub repo URL into musex, musex reads a **manifest** of available plugins from that repo, and the user installs + configures the ones they want. The first such plugin is **Lidarr** (a "source"/acquisition provider), which moves out of the musex tree into a dedicated **`git@github.com:matjam/musex-plugins.git`** repo. musex itself ships with **no Lidarr** and no plugin-specific code — only the generic plugin API + host. Eventually plugins run on **iOS too, sandboxed**, so a source plugin like Lidarr works on mobile.

Today (verified): the desktop **user-plugin loader already works** — `PluginHost` scans `userData/plugins/<id>/`, validates `plugin.json`, dynamic-`import()`s the `entry` (`index.mjs`), calls `activate(ctx)`. What's missing is *getting plugins there* (install is a manual folder drop) and *distribution* (Lidarr is currently a **core** plugin compiled into the app). Lidarr is pure `@musex/plugin-api` except it imports `node:http`/`node:https` for self-signed TLS — the one API gap.

## The four pieces (build order 1 → 2 → 3 → 4)

### SP1 — Plugin API: capability-complete + documented  *(musex repo)*
**Goal:** a source plugin needs only `@musex/plugin-api` — no Node imports — and the API is fully documented.
- Add a kernel **HTTP capability** `ctx.net` (a `fetch`-shaped client factory with TLS options, e.g. `allowSelfSigned`) so plugins never import `node:http`. The host owns the Node/undici TLS code.
- Refactor in-repo Lidarr to use `ctx.net` and delete its `node:http`/`node:https` transport (proving the capability). Lidarr stays a **core** plugin for now.
- Write the full **plugin API reference** in `docs/plugins.md` — close the ~14 known doc gaps (topArtists, trackRated event, AcquisitionProvider method signatures, providerRef JSON contract, watch-release semantics, listMonitoredArtists caching, settings field rendering, section/similar timeout+isolation, artist matching, image-URL rules, icon allowlist, apiVersion enforcement, event-handler error isolation).
- **Done when:** Lidarr imports only `@musex/plugin-api`; `pnpm check` green; docs cover the whole surface. No behavior change for users.

### SP2 — `musex-plugins` repo + distribution format  *(new repo)*
**Goal:** a published GitHub repo that builds plugins into installable bundles and a manifest the install client can read.
- New repo `matjam/musex-plugins`. Move Lidarr there (its code is unchanged after SP1). Depends on `@musex/plugin-api` (published or vendored types).
- **Build:** each plugin → a `{ plugin.json, index.mjs }` bundle (esbuild, ESM, externalizing only Node built-ins that the host provides).
- **Repo manifest:** a top-level `plugins.json` (committed on the default branch) listing available plugins: `{ id, name, description, latest version, apiVersion, … }`. This is what the install client fetches first.
- **Releases:** each GitHub release **publishes each plugin's bundle** as release assets (e.g. `lidarr-<version>.zip` containing `plugin.json` + `index.mjs`, plus a `<asset>.sha256`). The manifest points install at the right release asset per plugin/version.
- **Done when:** the repo builds Lidarr to a bundle, a release publishes it, and `plugins.json` describes it. (musex still bundles Lidarr at this stage — nothing user-facing breaks yet.)
- **Defines the install contract** consumed by SP3.

### SP3 — In-app install from a GitHub repo URL + remove bundled Lidarr  *(musex repo)*
**Goal:** users install/update/remove plugins from a GitHub repo URL; musex no longer ships Lidarr.
- Settings → Plugins: **"Add from GitHub"** → paste repo URL → fetch `plugins.json` → list available plugins → **install** (download the release asset, verify checksum, unzip into `userData/plugins/<id>/`) → loads via the existing user-plugin path → configure. Plus update (newer version) and uninstall.
- **Remove Lidarr as a core plugin** from musex (`core-plugins.ts`, `electron.vite.config.ts` exclude, desktop `package.json` dep) and scrub Lidarr-specific naming from app/docs (generic acquisition-provider UI stays).
- **Security:** installing remote JS = full-trust on desktop. A clear trust-on-install confirmation + **release-asset checksum verification**; pin to a release (not arbitrary repo contents). Documented decision.
- **Done when:** a fresh musex has no Lidarr; pasting the `musex-plugins` repo URL installs + configures Lidarr; update/uninstall work; `pnpm check` green.

### SP4 — Unified sandboxed plugin runtime (desktop + iOS)  *(the next major piece; revises the model)*
**Decision (2026-06-16):** full-trust, main-process execution is **interim**. We need a sandbox for iOS anyway, so plugins get sandboxed on **both** surfaces with **one consistent plugin-facing API**. SP3 ships the GitHub installer on the interim full-trust model (with checksum/zip-slip/apiVersion guards + a trust confirmation); SP4 then replaces the execution model underneath it.
- **Engine: QuickJS everywhere** (chosen, spike-to-confirm) — `quickjs-emscripten` (WASM) embedded in the Electron host; native QuickJS via an RN module on iOS. Same engine semantics, same bridge, different binding per platform. (Alternative considered: per-platform isolates — Node worker/vm + JSC — same API, two engines; rejected for consistency.)
- **Capability bridge / RPC:** a plugin is plain ESM touching only `@musex/plugin-api`, runs in a QuickJS isolate with **zero ambient host access**; every `ctx.*` call is marshalled to the host (async RPC), and contribution points (AcquisitionProvider methods, event handlers) are host-calls-into-sandbox. Same API surface on every platform.
- **API revision (consequence):** the kernel must become **serializable/RPC-shaped**. SP1's `ctx.fetch` and `ctx.net.client(opts): typeof fetch` hand the plugin **live host functions** that can't cross an isolate boundary → they become RPC (e.g. `ctx.net.fetch(url, init) → {status, headers, body}`). This is a deliberate revision of the SP1 API once the sandbox lands; `apiVersion` bumps when it does.
- **Order:** a focused **research spike first** (QuickJS-WASM running lidarr inside an Electron isolate over the bridge — perf + effort), then desktop sandbox runtime + the RPC API revision (re-point the installer into it), then iOS (native QuickJS, same bridge). Its own spec(s) after the spike.

## Cross-cutting decisions
- **`apiVersion`** stays `1`; the `ctx.net` addition is an *optional* field (back-compatible). Bumping only on a breaking change.
- **Distribution contract** (manifest + release-asset shape + checksum) is defined in SP2 and consumed in SP3 — they must agree; SP3 is built against SP2's published format.
- **Security/trust** — full-trust execution is **interim**. SP3 ships GitHub install on it with integrity guards (checksum + zip-slip + apiVersion) + an explicit trust confirmation; **SP4 sandboxes execution** (QuickJS, both platforms) so the trust gate gets much lighter. Don't over-invest in full-trust UX in SP3 — it's a stepping stone.
- **Lidarr removal timing:** SP2 makes Lidarr available externally while musex still bundles it; SP3 removes the bundled copy once install works — so users never lose Lidarr.

## Workflow
Each piece: branch off latest `main` → spec (where design decisions warrant) → detailed plan → subagent-driven build with `pnpm check` green → **draft→ready PR** → **user merges** → pull `main` → verify the next piece integrates → repeat. SP2 is a separate repo (its own PRs there).
