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
- **Always verify dependency versions with `npm view <pkg> version` before pinning** — never from memory.

## Conventions

- **TDD.** Core is the primary test target, exercised against fake ports (`FakePlexGateway`, `FakeTokenStore`, `FakePlaybackEngine`). One opt-in integration smoke test against a real Plex server, env-gated (`MUSEX_PLEX_E2E=1`); not in normal CI.
- **Local bar = CI bar:** run tests + lint + typecheck + format-check before every push.
- No silently swallowed errors (empty `catch {}` is a bug). 401 from Plex → drop to signed-out and re-auth, don't loop.

## Delivery

Built as a sequence of specs, each its own spec → plan → implementation cycle. Specs live in `docs/superpowers/specs/`. Current: **Spec 1 — Foundation + Playback Core + Plex Connection.**
