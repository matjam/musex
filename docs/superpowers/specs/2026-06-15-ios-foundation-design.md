# Phase 1: iOS Foundation — Design

**Date:** 2026-06-15
**Status:** Approved (user: "seems comprehensive — spec it and build it out")

Phase 1 of the iOS port (mobile roadmap; Phase 0 — the core refactor — shipped
in #26). This is the **mobile equivalent of desktop's "Spec 1 — Foundation +
Playback Core + Plex Connection":** a running iOS app that proves the pure
`@musex/core` and its four ports work unchanged on a React Native surface.

## Decided stack

| Decision | Choice | Why |
|---|---|---|
| RN framework | **Expo SDK 55 + dev client** | First-party native modules, EAS Build, config plugins; New Architecture is always-on in SDK 55. Dev client (not Expo Go) so background-audio entitlements / Keychain / native config work while keeping the managed workflow. |
| Audio engine | **`expo-audio`** | First-party, MIT, New-Architecture, background + lock-screen capable. `react-native-track-player` V5 went commercial (`@rntp/player`, paid for commercial use) — a license conflict for an MIT project; V4 is frozen. Our `PlaybackSession` already owns the queue, so we only need a thin engine. |
| Codec strategy | **Direct-play + HLS transcode fallback** | Direct-play codecs AVPlayer supports (aac/mp3/alac/flac/pcm/aiff/wav); fall back to Plex HLS transcode only for what it can't (Opus/OGG/WavPack/…). Reverses desktop's "never transcode" invariant — unavoidable on iOS, where AVPlayer's codec set is narrower than mpv/ffmpeg's. |
| Platform scope | **iOS-first, cross-platform-capable** | Build and test iOS now; every choice (Expo, `expo-audio`, RN) is Android-capable so Android is a cheap later phase. No Android testing burden in Phase 1. |

## Goal — what Phase 1 proves

A running iOS app (Expo dev client, on the **Simulator**) that:

1. Signs into Plex via the PIN flow (`plex.tv` link + code, poll for token).
2. Discovers servers and music libraries.
3. Browses **Artists → Albums → Tracks** live from PMS.
4. Plays a track list as a real **queue** (play/pause/next/prev/seek, auto-advance
   on track end) through `expo-audio`, driven by the core `PlaybackSession`.
5. Stores the Plex token in the iOS **Keychain**.

It exists to validate that the platform-agnostic core + the four ports are
genuinely portable — **not** to be visually polished (that's Phase 2).

## Architecture

A new workspace package **`packages/mobile`** (`@musex/mobile`), an Expo SDK 55
app, joins the existing pnpm workspace. It is a thin adapter over `@musex/core`,
exactly as `packages/desktop` is. Core is consumed **as TS source**
(`@musex/core` → `./src/index.ts`), compiled by Metro — the same
"consumer-compiles-the-source" model desktop uses with electron-vite.

### Tooling

- **Metro monorepo config:** `watchFolders` → repo root; resolver set so
  `@musex/core` resolves to its source and pnpm's hoisted `node_modules` is
  found. (Expo ships first-class monorepo Metro support.)
- **Hermes polyfills for core's globals.** `packages/core/src/globals.d.ts`
  declares exactly what core touches at runtime: `URL` (four members) and
  `structuredClone`. Hermes needs `react-native-url-polyfill` for `URL`;
  `structuredClone` is verified at scaffold and polyfilled if absent. This is
  the one place core's "RN polyfill manifest" comment becomes real work — set
  up once, imported at the app entry before any core code runs.
- `pnpm`'s existing `nodeLinker: hoisted` is compatible with Metro.
- No change to `@musex/core`: it stays zero-dependency and pure. If the
  scaffold reveals core accidentally touches a global not in `globals.d.ts`,
  that is a core purity bug to fix in core, not to paper over in mobile.

### The four port adapters

All live in `packages/mobile` (e.g. `src/adapters/`). None import into core.

- **`TokenStore`** → `expo-secure-store` (iOS Keychain). `save`/`load`/`clear`.

- **`PlexGateway`** → a **hand-rolled** REST adapter over RN `fetch`. Native
  iOS networking has **no CORS restriction**, so it calls PMS directly (the
  reason desktop needed Node — Plex's missing CORS headers — does not apply on
  mobile). `@ctrl/plex` is **not** reused: it carries Node-oriented deps that
  do not run cleanly in Hermes, and the gateway surface we need is small.
  Phase 1 implements only:
  - `createPin()` / `pollPin(id)` — the `plex.tv/api/v2/pins` flow desktop
    hand-rolls, with header `X-Plex-Client-Identifier` (a stable per-install id).
  - `listServers(token)` — `plex.tv` resources, mapped to `Server` with
    `connections`. Connection selection mirrors desktop's preference order
    (local → remote → relay) with a cheap reachability probe + timeout.
  - `listMusicLibraries(server, token)`, `listArtists`, `listAlbums`,
    `listTracks`.
  - 401 from PMS / plex.tv → throw `PlexAuthError` (drop to signed-out; never
    loop).
  - **`@musex/plex` extraction is explicitly deferred** — it would mean
    refactoring working desktop code, out of Phase 1 scope. Mobile owns its own
    focused gateway for now; if a third surface ever needs it, revisit.

- **`StreamResolver`** → returns a `StreamRef`:
  - If `track.media.audioCodec` ∈ the AVPlayer-supported set
    (`aac`, `mp3`, `alac`, `flac`, `pcm`, `aiff`, `wav`) → **direct**:
    `{ kind: "direct", url: "<server.baseUrl><track.media.partKey>?X-Plex-Token=<token>" }`.
  - Otherwise → **hls**: the Plex universal transcode URL
    (`/audio/:/transcode/universal/start.m3u8?path=<enc(/library/metadata/{id})>&mediaIndex=0&partIndex=0&protocol=hls&fastSeek=1&copyts=1&offset=0&X-Plex-Platform=Chrome&X-Plex-Client-Identifier=<id>&X-Plex-Token=<token>`),
    matching the shape desktop documented.
  - **No localhost stream proxy.** Single-process app: the token belongs in the
    app and is sent directly to PMS over HTTPS. (The desktop proxy existed only
    to keep the token out of the Electron *renderer*.)
  - The supported-codec set and URL construction live in a **pure, unit-tested**
    module so the decision is testable without a device.

- **`PlaybackEngine`** → an `expo-audio` adapter mapping the core port:
  - `load(ref)` — create/replace the player **prepared and paused** at 0
    (matches the port contract: `load` prepares, caller calls `play`).
  - `play()` / `pause()` / `seek(s)` / `setVolume(v)`.
  - `onPosition(cb)` — `expo-audio` status subscription, throttled (~250ms, as
    desktop throttles mpv time-pos).
  - `onEnded(cb)` — fires on `didJustFinish`.
  - `onError(cb)` — playback/load failures → `Error`.
  - `preload(ref)` is a **no-op in Phase 1** and **true gapless is deferred**:
    `expo-audio` does not expose reliable gapless preloading. Advance (manual
    and automatic) goes through `load()` — a small inter-track gap is acceptable
    for the foundation and the gapless contract is proven in a later phase.

### Playback wiring

The app hosts the core `PlaybackSession` and drives it exactly as the desktop
renderer does: `buildQueue(...)` → feed the session → the session calls the
`expo-audio` engine through the `PlaybackEngine` port. The engine's `onEnded`
→ `session.next()` for auto-advance. This is the central proof that the state
machine is platform-agnostic.

### UI surface

`expo-router` (file-based routing, first-party). Minimal and functional —
**visual design is deferred to Phase 2** (where the brainstorming visual
companion comes in). Screens:

- **Sign-in** — render the Plex link + code, poll, persist the token.
- **Server / library picker** — auto-skip when there is exactly one of each.
- **Artists** (`FlatList`) → **Albums** → **Tracks**. List virtualization
  tuning is Phase 2; plain `FlatList` is sufficient now.
- **Mini player bar** — art, title, play/pause, next/prev, seek scrubber.

**State:** a small app-local store (React context + reducer) holding `library`,
the current navigation/selection, and the `PlaybackSession`. This is **not** a
port of desktop's renderer reducer (that one is wired to Electron IPC). Reuse
core; write thin mobile state.

## Testing

- **Core:** unchanged; existing suite runs as-is.
- **`PlexGateway`:** unit-tested against a **fake `fetch`** with fixture
  XML/JSON — pin flow, server/library/artist/album/track parsing, connection
  selection, `401 → PlexAuthError`.
- **`StreamResolver`:** pure unit tests on the codec → direct/transcode decision
  and URL construction.
- **`expo-audio` engine:** an **env-gated smoke test** (needs a JS runtime/app),
  mirroring the project's mpv/Plex `MUSEX_*_E2E` convention — not in normal CI.
- **Local bar = CI bar:** biome + `tsc` + vitest extended to the new package.
  The Expo native build itself stays out of the ubuntu CI (built via EAS / local
  prebuild), consistent with how the desktop packaging is CI-gated separately.

## Build / run

- **Simulator-first.** A dev client for the iOS Simulator needs **no paid Apple
  Developer account** — audio plays in the Simulator, covering all of Phase 1.
- Dev client built via `expo prebuild` + local run, or EAS Build free tier.
- `app.json` config plugins declare `expo-audio` and lay **groundwork only** for
  `UIBackgroundModes: ["audio"]` (the background path itself is Phase 4).
- The **$99 Apple Developer account becomes necessary at Phase 4**
  (background audio / on-device testing), not now.

## Assumptions & risks

1. **Hermes `structuredClone`** may need a polyfill — verified during scaffold;
   low risk, isolated to the entry polyfill module.
2. **`expo-audio` gapless** is limited → gapless deferred (above). Risk contained
   by routing all advances through `load()`.
3. **HLS transcode URL** parameters need live validation against a real PMS;
   desktop's documented shape is the starting point and the env-gated smoke test
   exercises it.
4. **iOS AVPlayer codec list** is taken from Apple's docs; the transcode fallback
   is the safety net for anything mislabeled or unexpectedly rejected.

## Out of scope (later phases)

List/media caching, the library-watcher websocket, discovery/taste/genres/mixes/
home/search/playlists UI, plugins, CarPlay, **background audio + lock-screen
Now-Playing**, **true gapless**, Android testing, and the shared `@musex/plex`
extraction. Phase 1 fetches live from Plex every time.
