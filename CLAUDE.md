# musex — Project Instructions

A macOS (Electron) music player that streams from Plex, with planned external-metadata search, AI-driven discovery (user-supplied inference API key), and Lidarr integration to acquire discovered music. Spotify-like experience over the user's own Plex library. Mobile (React Native) + CarPlay/Android Auto are future targets sharing the same core.

## Git workflow (OVERRIDES global CLAUDE.md)

- **Remote:** `git@github.com:matjam/musex.git`
- **Commit directly to `main`. No feature branches for this project.**
- Push after every commit (`git add -A` always — never selective staging).

## Architecture (decided 2026-06-08 — see `docs/superpowers/specs/`)

- **Hexagonal / ports & adapters.** A pure, platform-agnostic `@musex/core` (domain models, use-cases, `PlaybackSession` state machine, port interfaces — **no Node, no DOM, no Electron imports**) sits in the middle. Every surface (Electron desktop, future React Native, CarPlay, Android Auto) is a thin adapter over the core.
- **Electron process split:** `main` is the "data plane" (Plex HTTP — Node avoids Plex's missing CORS headers — Keychain token storage, localhost stream proxy, typed IPC). `renderer` is the "playback + UI plane" (React UI + HTML5 `<audio>`/`hls.js` audio adapter; hosts the core `PlaybackSession`).
- **Streaming:** direct-play when Chromium can decode the codec; Plex universal-transcoder HLS fallback (`hls.js`) otherwise. Audio is **proxied through main** so the Plex token never reaches the renderer (proxy must support HTTP range requests for seeking).

## Stack & tooling

- Electron + React, **TypeScript throughout**. pnpm workspaces monorepo (`@musex/core`, `@musex/desktop`). Vite for the renderer, electron-builder for packaging.
- **Verify versions with `npm view <pkg> version` and prefer the latest stable; read the current official docs (context7 / vendor site) for the installed major version before configuring any tool** — never from memory/training data. Config and APIs change across major versions and silently break. When you hold a version back from latest, write down why. Record what you learn in **Tooling — verified current usage** below.

## Tooling — verified current usage (read the docs for the installed major; do NOT trust training data)

Config changes across major versions. Before configuring a tool/framework, read its current docs for the installed major and capture the correct usage here.

Verified 2026-06-08:
- **pnpm 11** — dependency build scripts are gated; allowlist them in `pnpm-workspace.yaml` under `allowBuilds:` (e.g. `allowBuilds:\n  esbuild: true`). pnpm 11 **removed** the old `package.json` `pnpm.onlyBuiltDependencies` field — do not use it. pnpm is installed in user space at `~/Library/pnpm` with a wrapper at `~/.local/bin/pnpm` (corepack can't symlink into `/usr/local/bin` in this environment).
- **TypeScript 6** — shared `tsconfig.base.json`: `moduleResolution: "Bundler"`, `verbatimModuleSyntax: true` (so use `import type` / `export type` for types), `noUncheckedIndexedAccess: true`, `noEmit: true`. Internal packages export TS **source** (`"exports": { ".": "./src/index.ts" }`); each consumer's bundler compiles it — no build emit in `@musex/core`.
- **Vitest 4** — needs `vite` as a peer; we pin **vite 7** (not 8) because `electron-vite@5` peers to `vite ^5 || ^6 || ^7`. Use `passWithNoTests: true` while a package has no tests.
- **Biome 2** — one tool for lint+format. Keys: `files.includes` (glob array), `formatter`, `linter.rules.recommended`, `assist.actions.source.organizeImports`. `biome check --write .` fixes; `biome check .` verifies. Biome ignores `_`-prefixed unused params.
- **Pin baseline (latest verified 2026-06-08):** electron 42.3.3, electron-builder 26.15.2, electron-vite 5.0.0, react/react-dom 19.2.7, typescript 6.0.3, vite 7.x, vitest 4.1.8, @biomejs/biome 2.4.16, @types/node 25.9.2, @ctrl/plex 6.0.0, @regosen/gapless-5 1.6.2, hls.js 1.6.16, electron-store 11.0.2.
### Electron stack — verified for Plan B (docs-researched 2026-06-08)
- **electron-vite 5 layout:** `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/{index.html, src/}`. In `electron.vite.config.ts`, add `externalizeDepsPlugin({ exclude: ['@musex/core'] })` to `main` and `preload` plugins (the workspace core ships `.ts` source so it must be bundled, not externalized); keep everything else (incl. `electron-store`) external. Renderer uses `@vitejs/plugin-react`. Main builds as **ESM** (`format: 'es'`); **preload must be CJS** (sandboxed preloads cannot be ESM). Dev renderer URL comes from `process.env.ELECTRON_RENDERER_URL`. Scripts: `electron-vite dev|build|preview`, then `electron-builder`.
- **ESM main:** no `__dirname` → `fileURLToPath(import.meta.url)`. `protocol.registerSchemesAsPrivileged([...])` must run synchronously at top level **before** `app.whenReady`.
- **Secure IPC:** preload `contextBridge.exposeInMainWorld` wrapping *specific* `ipcRenderer.invoke` channels (never expose a generic `invoke`); `ipcMain.handle` in main; validate all inputs. `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- **safeStorage:** use async `encryptStringAsync`/`decryptStringAsync` (handle `shouldReEncrypt`); only after `app.whenReady`; persist the returned Buffer to `app.getPath('userData')` (safeStorage does not persist).
- **Audio stream proxy — `protocol.handle`, NOT a localhost http server.** Register a privileged scheme `musex-stream` (`{ standard, secure, supportFetchAPI, stream: true }`); handler uses `net.fetch` to forward to Plex, injects `X-Plex-Token`, forwards the `Range` header (206 native). Renderer plays `musex-stream://…` — no token, no open port. (Supersedes the localhost-proxy idea in the spec.)
- **electron-store 11:** ESM-only (`import Store from 'electron-store'`); keep external (needs the Electron runtime; do not bundle).
- **electron-builder 26 + pnpm:** needs a flat `node_modules` — set `node-linker=hoisted` (or `shamefully-hoist=true`) in `.npmrc`; add `electron` to pnpm `allowBuilds` in `pnpm-workspace.yaml` (postinstall downloads the binary). mac target dmg+zip; `files: ["out/**/*"]`; `appId`.
- **@ctrl/plex 6** (ESM, runs in main): pin login via `MyPlexAccount.getWebLogin()` → `{ uri, id, code }` then `webLoginCheck()` (polls internally). Our core's port splits createPin/pollPin, so the adapter maps `createPin → getWebLogin` and **hand-rolls `pollPin` as a single `GET https://plex.tv/api/v2/pins/{id}?code=…`** (so core keeps control of the poll loop/timeout). **Override `BASE_HEADERS['X-Plex-Client-Identifier']` with a stable persisted UUID** (default is MAC-derived). Discovery: `new MyPlexAccount({ token }).connect()` → `.resources()` / `.resource(name).connect()` → `PlexServer` (`.baseurl`, per-server token `resource.accessToken`). Browse: `server.library()` → `library.section<MusicSection>('Music')` → `searchArtists()`, `artist.albums()`, `album.tracks()`; Track fields: `ratingKey`, `title`, `thumb` (full URL w/ token), `index`, `duration` (ms), `parentTitle` (album), `grandparentTitle` (artist), `media[]`. Stream URLs: direct `server.url(part.key, { includeToken: true })` where `part = track.media[0].parts[0]`; transcode `track.getStreamURL({ protocol: 'hls' })`.
- **gapless-5 1.6 + hls.js 1.6 (renderer):** gapless-5 owns a playlist; events: `onnext(from, to)` (fires on auto-advance AND manual `next()`), `onfinishedall()` (true end), `ontimeupdate(ms, index)` (**milliseconds**), `onerror`. `setPosition` is in **ms**. Feed it current+next (2-track window) for gapless; route manual skips through our `load()` (teardown+reload — a small gap is fine and avoids double-advance from `onnext`). `kind:'hls'` tracks use hls.js (`attachMedia(audioEl)` + `loadSource` + `MANIFEST_PARSED`/`ERROR` + `destroy()`), which breaks the gapless chain (expected — transcode is the rare path). **`PlaybackEngine` port gains `onAdvanced(cb)`** ← gapless-5 `onnext`; `onEnded` ← `onfinishedall`.

## Conventions

- **Prior art first — don't roll our own.** Use mature, maintained libraries for hard sub-problems (Plex API, gapless playback, HLS, secure storage, etc.) and wrap each behind a core-owned port so it can be swapped. Candidates so far: `@ctrl/plex` / `@lukehagar/plexjs` (Plex), `@regosen/gapless-5` (gapless), `hls.js` (HLS), Electron `safeStorage` (token), `electron-store` (state).
- **TDD.** Core is the primary test target, exercised against fake ports (`FakePlexGateway`, `FakeTokenStore`, `FakePlaybackEngine`). One opt-in integration smoke test against a real Plex server, env-gated (`MUSEX_PLEX_E2E=1`); not in normal CI.
- **Local bar = CI bar:** run tests + lint + typecheck + format-check before every push.
- No silently swallowed errors (empty `catch {}` is a bug). 401 from Plex → drop to signed-out and re-auth, don't loop.

## Delivery

Built as a sequence of specs, each its own spec → plan → implementation cycle. Specs live in `docs/superpowers/specs/`. Current: **Spec 1 — Foundation + Playback Core + Plex Connection.**
