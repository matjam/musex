# Spec 1 — Foundation + Playback Core + Plex Connection

**Date:** 2026-06-08 (revised same day: gapless in scope, prior-art-first dependency strategy)
**Status:** Draft for review
**Scope:** First vertical slice of musex — a Spotify-like music player streaming from Plex.

---

## 1. Goal

Stand up the monorepo skeleton and the first working vertical slice: sign in to Plex, pick a music library, browse it, and play audio **gaplessly** with real transport controls. This slice exists to force the core's two ports — a *browsable catalog* and a *playback session* — to be designed against a real feature rather than in the abstract. Everything later (search, external metadata, AI discovery, Lidarr, mobile, CarPlay) hangs off the foundation laid here.

## 2. Product context (the larger vision, for orientation only)

musex aims to replicate the Spotify experience on top of a user's own Plex library, with external music databases for discovery, an AI discovery feature driven by the user's own inference API key, and Lidarr integration to acquire newly discovered music. **None of that is in this spec.** It is recorded here only so the foundation is built with those seams in mind.

Planned future specs (each its own spec → plan → implementation cycle):

1. **This spec** — Foundation + Playback Core + Plex Connection
2. App shell & library UI (full browse/search UX, playlists)
3. External metadata & search (MusicBrainz / Last.fm / ListenBrainz)
4. AI discovery (LLM recommendations via user's API key)
5. Lidarr integration (acquire discovered music)

## 3. Dependency strategy: prior art first

**We use mature, maintained libraries for the hard sub-problems and wrap them behind our own ports. We do not roll our own where good prior art exists.** Hexagonal architecture makes this clean: each third-party library lives inside one adapter, behind an interface the core owns, so a library can be swapped without touching the core.

Where prior art is used in this slice:

| Concern | Library (candidate — final pick + version confirmed at planning) | Wrapped behind |
| --- | --- | --- |
| Plex API (auth, browse, stream URLs) | `@ctrl/plex` or `@lukehagar/plexjs` | `PlexGateway` |
| Gapless playback | `Gapless-5` (`@regosen/gapless-5`) | `PlaybackEngine` |
| Transcode (HLS) playback | `hls.js` | `PlaybackEngine` |
| Secure token storage | Electron `safeStorage` (Keychain) | `TokenStore` |
| App state persistence | `electron-store` | (persistence adapter) |

The Plex PIN/OAuth flow may be a thin piece of our own code if the chosen client doesn't cover it; everything else (server/library/browse/stream URLs) comes from the client.

## 4. Scope

### In scope (slice 1)
- Plex sign-in via the plex.tv PIN/OAuth polling flow + secure token storage
- Server/library discovery and selection (one active music library at a time; picker if several)
- Browse the active library: artists → albums → tracks
- Playback engine: play/pause/next/previous/seek, a play queue, continuous playback
- **Gapless playback** between consecutive tracks (see §9)
- A minimal but real **Now Playing** view and a basic app shell (library nav + browse + persistent Now Playing bar)
- Streaming: direct-play when Chromium can decode the format; Plex transcode fallback otherwise

### Out of scope (deferred to later specs)
Playlists, search, external metadata, AI discovery, Lidarr, offline/caching, crossfade (as distinct from gapless), lyrics, scrobbling, multi-library merged views, mobile/CarPlay/Android Auto (architecture only — no implementation).

## 5. Stack & tooling

- **Desktop runtime:** Electron + React (TypeScript throughout).
- **Mobile (future, not now):** React Native sharing the same `@musex/core`; gapless on mobile comes from `react-native-track-player`'s native support. Car integrations (CarPlay / Android Auto) are native adapters over the core's catalog + playback session. Electron is the desktop shell only.
- **Monorepo:** pnpm workspaces.
- **Renderer build:** Vite. **Packaging:** electron-builder.
- Exact dependency versions are verified with `npm view` when the implementation plan is written, never pinned from memory.

## 6. Architecture (hexagonal)

A pure, platform-agnostic **core** in the middle; Electron's two processes hold the adapters around it.

```
EXTERNAL:  plex.tv (auth)        Plex Media Server (metadata + audio)
                 ▲ HTTPS from Node (no browser CORS)   ▲ HTTP audio stream

MAIN PROCESS (Node) — "data plane"        RENDERER (Chromium) — "playback + UI plane"
  • PlexGateway adapter (wraps TS client)   • React UI (browse, Now Playing)
  • TokenStore adapter (Keychain)    ⇄IPC⇄  • PlaybackEngine adapter (Gapless-5 / hls.js)
  • Stream proxy (localhost, range)         • hosts the PlaybackSession (core)
  • persistence (electron-store)
  • typed IPC bridge

                 ▲ both import ▲

@musex/core — pure TypeScript, zero platform deps
  • Models: Server, Library, Artist, Album, Track, Queue
  • Use-cases: signIn, listLibraries, browse, buildQueue, transport control
  • PlaybackSession: pure state machine (queue + transport + next-track lookahead)
  • Ports (interfaces): PlexGateway, TokenStore, PlaybackEngine
```

**Why this split:**
- Plex servers frequently send no CORS headers, so all Plex HTTP must run in **main** (Node) — which is also where the TS Plex client and the OS keychain live.
- Audio playback must run in **renderer** (it needs Chromium's Web Audio / `<audio>` / MediaSource).
- The session *logic* stays pure in `core`; only audio *output* is a renderer adapter. Swapping in `react-native-track-player` later is a new adapter, not a rewrite.

### Packages
- `@musex/core` — domain models, use-cases, `PlaybackSession`, port interfaces. No Node, no DOM, no Electron imports.
- `@musex/desktop` — Electron app. `main/` (adapters + IPC + stream proxy) and `renderer/` (React UI + audio adapter). Depends on `@musex/core`.

## 7. Domain model (core)

- **Server** — id, name, connection URIs (local/remote), access token scope.
- **Library** — id (section key), serverId, title, type (music only here).
- **Artist** — id, name, thumb.
- **Album** — id, artistId, title, year, thumb.
- **Track** — id, albumId, artistName, title, duration, trackNumber, and a `MediaInfo` (container, audioCodec, bitrate, part reference used to build a stream URL).
- **Queue** — ordered list of Track ids + current index. Built from a browse selection (e.g. "play this album from track 3").

Models are plain data. Mapping from the Plex client's types into these models lives in the `PlexGateway` adapter, not in the models.

## 8. Ports (interfaces, defined in core)

```ts
interface PlexGateway {
  createPin(): Promise<{ id: string; code: string; authUrl: string }>;
  pollPin(id: string): Promise<{ authToken: string | null }>;
  listServers(token: string): Promise<Server[]>;
  listMusicLibraries(server: Server, token: string): Promise<Library[]>;
  listArtists(lib: Library, token: string): Promise<Artist[]>;
  listAlbums(artistId: string, token: string): Promise<Album[]>;
  listTracks(albumId: string, token: string): Promise<Track[]>;
  resolveStreamUrl(track: Track, token: string): Promise<{ url: string; kind: 'direct' | 'hls' }>;
}

interface TokenStore {
  save(token: string): Promise<void>;
  load(): Promise<string | null>;
  clear(): Promise<void>;
}

interface PlaybackEngine {
  load(ref: StreamRef): Promise<void>;
  preload(ref: StreamRef): Promise<void>; // next track, for gapless
  play(): void; pause(): void; seek(seconds: number): void; setVolume(v: number): void;
  onPosition(cb: (seconds: number) => void): void;
  onAdvanced(cb: () => void): void;  // engine gaplessly auto-advanced to the preloaded next track
  onEnded(cb: () => void): void;     // playback fully stopped (end of content / nothing buffered)
  onError(cb: (err: Error) => void): void;
}
```

> Verified against Gapless-5 (docs-research, 2026-06-08): the engine fires `onnext` on auto-advance → mapped to `onAdvanced` (session bumps its cursor, no reload); `onfinishedall` → `onEnded`. Manual skips go through `load()` (teardown + reload; a tiny gap is acceptable). This resolves the gapless-contract question raised in core review.

The `preload` method is what makes gapless possible: the session hands the engine the *next* track ahead of time so the engine (Gapless-5) can have it buffered and ready to start seamlessly.

## 9. Gapless playback, streaming & the stream proxy

**Approach (prior art, not custom):** the `PlaybackEngine` desktop adapter wraps **Gapless-5**, which solves the two web-audio shortcomings — HTML5 `<audio>` clips track tails (gaps) and Web Audio can't play until fully loaded — by starting on HTML5 audio and handing off to a fully-loaded Web Audio buffer, prefetching the next track. We drive it via `load`/`preload`.

- **Gapless applies to direct-play** (the common case: mp3/flac/aac, which Chromium decodes). Codec capability detection at the gateway/core boundary chooses direct vs transcode; unknown/edge cases default to transcode.
- **Transcoded tracks are best-effort, not gapless.** The transcode fallback emits HLS (`/music/:/transcode/universal/start.m3u8`), played via `hls.js`, which doesn't fit Gapless-5's full-buffer model. Transcode only fires for rare formats (ALAC/DSD/APE), so this is an acceptable slice-1 limitation.
- **Memory note:** Gapless-5's Web Audio path holds the decoded current + next track in memory. Fine for songs; very long tracks (hour-long mixes) get large. If that ever bites, the `PlaybackEngine` port lets us swap in a streaming WebCodecs engine later with no core changes.

**Token handling — proxy through main via a custom protocol** (updated from a localhost HTTP server after docs research; `protocol.handle` is simpler and safer). The renderer never receives the long-lived Plex token. Main:
- registers a privileged scheme (`musex-stream`) with `{ standard, secure, supportFetchAPI, stream: true }` synchronously before `app.whenReady`,
- `protocol.handle('musex-stream', handler)` where the handler maps the URL to the real Plex URL, injects `X-Plex-Token`, forwards the incoming `Range` header, and returns `net.fetch(...)`'s streaming response (206 partial content supported natively).

The renderer's audio engine plays `musex-stream://…` URLs only — no token, no open TCP port. Trade-off vs a localhost server: none meaningful; `protocol.handle` + `net.fetch` gives range support for free and keeps the credential entirely in main.

## 10. PlaybackSession state machine (core, pure)

State: `{ queue, currentIndex, status: 'idle'|'loading'|'playing'|'paused'|'ended'|'error', positionSec, durationSec, volume }`.

Commands: `loadQueue`, `playIndex`, `play`, `pause`, `next`, `previous`, `seek`, `setVolume`; event-driven `trackEnded` (→ advance or stop at end of queue), `engineError` (→ `error`, surfaced to UI).

**Lookahead for gapless:** whenever the current track or index changes, the session computes the *next* track and calls `engine.preload(...)` so the engine is ready to transition seamlessly. The session holds no audio I/O — it commands a `PlaybackEngine` and consumes its events. This is the single most-tested unit in the slice.

## 11. Persistence

- **Token:** Keychain via Electron `safeStorage` (through `TokenStore`).
- **App state:** selected serverId + libraryId, last queue + position, volume — via `electron-store` under the app's `userData` dir. Restored on launch so the app reopens where it left off.

## 12. Error handling

Per house rules: no silently swallowed errors.
- **Auth:** PIN expiry, user denial, poll timeout → clear, actionable UI state; never an empty catch.
- **Discovery:** no reachable server connection → explicit "can't reach your server" with retry; don't hang.
- **Streaming:** transcode-needed but transcode fails, or proxy/range error → surface on the track, skip-or-stop per session policy, log with context.
- **Token invalid/expired (401):** drop to signed-out state and re-trigger sign-in rather than looping.
- Financial-retry rule is N/A here (no paid operations in this slice).

## 13. Testing strategy (TDD)

- **Core is the test target.** `PlaybackSession` and all use-cases are tested against **fake ports** (`FakePlexGateway`, `FakeTokenStore`, `FakePlaybackEngine`). Fakes let us assert queue advancement, transport transitions, **gapless lookahead (`preload` called for the next track at the right time)**, error propagation, and direct-vs-transcode selection — all deterministically, without real audio.
- **Adapter tests:** the stream proxy gets focused tests for range-request correctness (the riskiest adapter). The Gapless-5 wrapper gets a thin adapter test; we trust the library itself rather than re-testing it.
- **One opt-in integration smoke test** against a real Plex server, env-gated (`MUSEX_PLEX_E2E=1` + a real token), not run in normal CI.
- Local bar = CI bar: tests + lint + typecheck + format-check all run before any push.

## 14. Open questions / assumptions

- **Confirmed:** the user has a working Plex server with a music library to test against.
- **Confirmed:** "one active library, switchable" is the right slice-1 model (merged multi-library view deferred).
- **To confirm at planning:** final pick between `@ctrl/plex` and `@lukehagar/plexjs` (coverage of the PIN flow, server discovery, stream-URL building), and Gapless-5's current version/maintenance — both verified via `npm view`, not memory.

---

## Appendix — verified mechanics (sources)

- PIN/OAuth polling flow: `plex.tv/api/v2/pins` + `app.plex.tv/auth`, poll until `authToken` populated.
- Server discovery: `plex.tv/api/v2/resources`.
- Library/browse: `{server}/library/sections`, drill-down via `/library/metadata/{id}/children`.
- Streaming: direct file via `/library/parts/{id}/file`; transcode via `/music/:/transcode/universal/start.m3u8` (HLS).
- Chromium-native audio codecs: mp3, aac/m4a, flac, opus/vorbis, wav (others → transcode).
- Gapless in a web/Electron stack: HTML5 `<audio>` clips tails; Web Audio needs full decode. Gapless-5 resolves this with an HTML5→Web Audio hybrid + prefetch.
- Prior-art libraries: `@ctrl/plex`, `@lukehagar/plexjs` (Plex); `@regosen/gapless-5` (gapless); `hls.js` (HLS).
