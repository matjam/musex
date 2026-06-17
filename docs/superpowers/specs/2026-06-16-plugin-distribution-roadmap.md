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

### SP4 — Sandboxed iOS plugin runtime  *(mobile; research-heavy, deferred)*
**Goal:** source plugins (like Lidarr) run on iOS, sandboxed.
- Mobile has **no plugin host today**, and RN/Hermes has no built-in isolate for untrusted code. This needs a **research spike** before design: candidate runtimes — QuickJS via a native module (e.g. `react-native-quickjs`), a WASM/component-model approach (Extism), or a restricted-realm JS sandbox — plus a **capability bridge** exposing only the kernel (`fetch`/`net`, `storage`, `secrets`, `log`, the contribution points) into the sandbox.
- Depends on SP1 (capability-based API; no Node) and SP2/SP3 (distribution). Likely splits into "runtime spike" → "mobile plugin host" → "install on mobile."
- **Its own deep brainstorm after a spike** — not designed in this roadmap.

## Cross-cutting decisions
- **`apiVersion`** stays `1`; the `ctx.net` addition is an *optional* field (back-compatible). Bumping only on a breaking change.
- **Distribution contract** (manifest + release-asset shape + checksum) is defined in SP2 and consumed in SP3 — they must agree; SP3 is built against SP2's published format.
- **Security/trust** is decided in SP3 (trust-on-install + checksum + release pinning). Desktop user plugins are already full-trust; GitHub install widens the supply-chain surface, hence integrity verification.
- **Lidarr removal timing:** SP2 makes Lidarr available externally while musex still bundles it; SP3 removes the bundled copy once install works — so users never lose Lidarr.

## Workflow
Each piece: branch off latest `main` → spec (where design decisions warrant) → detailed plan → subagent-driven build with `pnpm check` green → **draft→ready PR** → **user merges** → pull `main` → verify the next piece integrates → repeat. SP2 is a separate repo (its own PRs there).
