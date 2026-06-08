# Spec 1 — Foundation + Playback Core + Plex Connection

**Date:** 2026-06-08
**Status:** Draft for review
**Scope:** First vertical slice of musex — a Spotify-like music player streaming from Plex.

---

## 1. Goal

Stand up the monorepo skeleton and the first working vertical slice: sign in to Plex, pick a music library, browse it, and play audio with real transport controls. This slice exists to force the core's two ports — a *browsable catalog* and a *playback session* — to be designed against a real feature rather than in the abstract. Everything later (search, external metadata, AI discovery, Lidarr, mobile, CarPlay) hangs off the foundation laid here.

## 2. Product context (the larger vision, for orientation only)

musex aims to replicate the Spotify experience on top of a user's own Plex library, with external music databases for discovery, an AI discovery feature driven by the user's own inference API key, and Lidarr integration to acquire newly discovered music. **None of that is in this spec.** It is recorded here only so the foundation is built with those seams in mind.

Planned future specs (each its own spec → plan → implementation cycle):

1. **This spec** — Foundation + Playback Core + Plex Connection
2. App shell & library UI (full browse/search UX, playlists)
3. External metadata & search (MusicBrainz / Last.fm / ListenBrainz)
4. AI discovery (LLM recommendations via user's API key)
5. Lidarr integration (acquire discovered music)

## 3. Scope

### In scope (slice 1)
- Plex sign-in via the plex.tv PIN/OAuth polling flow + secure token storage
- Server/library discovery and selection (one active music library at a time; picker if several)
- Browse the active library: artists → albums → tracks
- Playback engine: play/pause/next/previous/seek, a play queue, and continuous playback
- A minimal but real **Now Playing** view and a basic app shell (library nav + browse + persistent Now Playing bar)
- Streaming: direct-play when Chromium can decode the format; Plex transcode fallback otherwise

### Out of scope (deferred to later specs)
Playlists, search, external metadata, AI discovery, Lidarr, offline/caching, gapless/crossfade, lyrics, scrobbling, multi-library merged views, mobile/CarPlay/Android Auto (architecture only — no implementation).

## 4. Stack & tooling

- **Desktop runtime:** Electron + React (TypeScript throughout).
- **Mobile (future, not now):** React Native sharing the same `@musex/core`; car integrations (CarPlay / Android Auto) are native adapters over the core's catalog + playback session. Electron is the desktop shell only.
- **Monorepo:** pnpm workspaces.
- **Renderer build:** Vite. **Packaging:** electron-builder.
- **Audio:** HTML5 `<audio>` for direct-play; `hls.js` (MediaSource) for the transcode fallback.
- Exact dependency versions are verified with `npm view` when the implementation plan is written, never pinned from memory.

## 5. Architecture (hexagonal)

A pure, platform-agnostic **core** in the middle; Electron's two processes hold the adapters around it.

```
EXTERNAL:  plex.tv (auth)        Plex Media Server (metadata + audio)
                 ▲ HTTPS from Node (no browser CORS)   ▲ HTTP audio stream

MAIN PROCESS (Node) — "data plane"        RENDERER (Chromium) — "playback + UI plane"
  • PlexGateway adapter (http)              • React UI (browse, Now Playing)
  • TokenStore adapter (Keychain)    ⇄IPC⇄  • PlaybackEngine adapter (HTML5 <audio> / hls.js)
  • Stream proxy (localhost, range)         • hosts the PlaybackSession (core)
  • typed IPC bridge

                 ▲ both import ▲

@musex/core — pure TypeScript, zero platform deps
  • Models: Server, Library, Artist, Album, Track, Queue
  • Use-cases: signIn, listLibraries, browse, buildQueue, transport control
  • PlaybackSession: pure state machine (queue + transport, no audio I/O)
  • Ports (interfaces): PlexGateway, TokenStore, PlaybackEngine
```

**Why this split:**
- Plex servers frequently send no CORS headers, so all Plex HTTP must run in **main** (Node), which also owns the OS keychain.
- Audio playback must run in **renderer** (it needs Chromium's `<audio>` / MediaSource).
- The session *logic* stays pure in `core`; only audio *output* is a renderer adapter. Swapping in `react-native-track-player` later is a new adapter, not a rewrite.

### Packages
- `@musex/core` — domain models, use-cases, `PlaybackSession`, port interfaces. No Node, no DOM, no Electron imports.
- `@musex/desktop` — Electron app. `main/` (adapters + IPC + stream proxy) and `renderer/` (React UI + audio adapter). Depends on `@musex/core`.

## 6. Domain model (core)

- **Server** — id, name, list of connection URIs (local/remote), access token scope.
- **Library** — id (section key), serverId, title, type (music only here).
- **Artist** — id, name, thumb.
- **Album** — id, artistId, title, year, thumb.
- **Track** — id, albumId, artistName, title, duration, trackNumber, and a `MediaInfo` (container, audioCodec, bitrate, the part reference used to build a stream URL).
- **Queue** — ordered list of Track ids + current index. Built from a browse selection (e.g. "play this album from track 3").

Models are plain data. Mapping from Plex's wire format lives in the `PlexGateway` adapter, not in the models.

## 7. Ports (interfaces, defined in core)

```ts
interface PlexGateway {
  // Auth
  createPin(): Promise<{ id: string; code: string; authUrl: string }>;
  pollPin(id: string): Promise<{ authToken: string | null }>;
  // Discovery
  listServers(token: string): Promise<Server[]>;
  listMusicLibraries(server: Server, token: string): Promise<Library[]>;
  // Browse
  listArtists(lib: Library, token: string): Promise<Artist[]>;
  listAlbums(artistId: string, token: string): Promise<Album[]>;
  listTracks(albumId: string, token: string): Promise<Track[]>;
  // Streaming
  resolveStreamUrl(track: Track, token: string): Promise<{ url: string; kind: 'direct' | 'hls' }>;
}

interface TokenStore {
  save(token: string): Promise<void>;
  load(): Promise<string | null>;
  clear(): Promise<void>;
}

interface PlaybackEngine {
  load(url: string, kind: 'direct' | 'hls'): Promise<void>;
  play(): void; pause(): void; seek(seconds: number): void; setVolume(v: number): void;
  // events surfaced back to PlaybackSession:
  onPosition(cb: (seconds: number) => void): void;
  onEnded(cb: () => void): void;
  onError(cb: (err: Error) => void): void;
}
```

Exact Plex request parameters (section/type codes, `/library/metadata/{id}/children` drill-down, transcode query params) are confirmed against the target server during implementation; the port contract above is what core depends on.

## 8. Key flows

### 8.1 Sign in (one-time) — runs in main
1. POST `plex.tv/api/v2/pins?strong=true` with a persistent `X-Plex-Client-Identifier` → `{ id, code }`.
2. Open `app.plex.tv/auth#?clientID=…&code=…` in the user's default browser; they approve.
3. Poll `GET plex.tv/api/v2/pins/{id}` until `authToken` is non-null (bounded timeout, e.g. up to ~30 min, with a visible "waiting for approval" state and a cancel).
4. Persist the token via `TokenStore` (Keychain).

### 8.2 Discover & browse
5. `GET plex.tv/api/v2/resources` → servers + connection URIs; pick the first reachable connection (prefer local, fall back to remote).
6. `GET {server}/library/sections` → keep music libraries. One active library; picker if several.
7. Core use-cases drive browse (artists → albums → tracks); renderer renders lists via IPC.

### 8.3 Play
8. Core builds a `Queue` from the selection; `PlaybackSession` sets the current track.
9. Core asks the gateway to resolve a stream URL:
   - **Direct-play** if the track's codec is in Chromium's supported set (`mp3`, `aac`/`m4a`, `flac`, `opus`/`vorbis`, `wav`) → `kind: 'direct'`.
   - **Transcode fallback** otherwise → Plex universal transcoder HLS (`/music/:/transcode/universal/start.m3u8`) → `kind: 'hls'` (played via `hls.js`).
10. Renderer's audio adapter reports `position` / `ended` → core advances the queue → loop.

## 9. Streaming, token handling & the stream proxy

**Decision: proxy audio through main.** The renderer never receives the long-lived Plex token. Main runs a tiny localhost HTTP server that:
- exposes `http://127.0.0.1:{port}/stream/{trackId}` (and an HLS variant for the transcode path),
- adds `X-Plex-Token` server-side and forwards to Plex,
- **supports HTTP range requests** (required for seeking) and streams the response through.

The renderer's `<audio src>` points only at the localhost proxy URL. Trade-off accepted: a real component to build and test (range handling, backpressure, cleanup) in exchange for keeping the credential entirely in the Node side.

**Codec capability detection** lives in the gateway/core boundary: inspect the track's `MediaInfo.audioCodec`/container against the Chromium-supported set to choose direct vs transcode. Unknown/edge cases default to transcode (always plays).

## 10. PlaybackSession state machine (core, pure)

State: `{ queue, currentIndex, status: 'idle'|'loading'|'playing'|'paused'|'ended'|'error', positionSec, durationSec, volume }`.

Transitions (commands): `loadQueue`, `playIndex`, `play`, `pause`, `next`, `previous`, `seek`, `setVolume`, and event-driven `trackEnded` (→ advance or stop at end of queue), `engineError` (→ `error` status, surfaced to UI).

The session holds no audio I/O — it commands a `PlaybackEngine` and consumes its events. This is the single most-tested unit in the slice.

## 11. Persistence

- **Token:** Keychain via Electron `safeStorage` (through `TokenStore`).
- **App state:** selected serverId + libraryId, last queue + position, volume — in a small JSON store under the app's `userData` dir. Restored on launch so the app reopens where it left off.

## 12. Error handling

Per house rules: no silently swallowed errors. Concretely:
- **Auth:** PIN expiry, user denial, poll timeout → clear, actionable UI state; never an empty catch.
- **Discovery:** no reachable server connection → explicit "can't reach your server" with retry; don't hang.
- **Streaming:** transcode-needed but transcode fails, or proxy/range error → surface on the track, skip-or-stop per session policy, log with context.
- **Token invalid/expired (401):** drop to signed-out state and re-trigger sign-in rather than looping.
- Financial-retry rule is N/A here (no paid operations in this slice).

## 13. Testing strategy (TDD)

- **Core is the test target.** `PlaybackSession` and all use-cases are tested against **fake ports** (`FakePlexGateway`, `FakeTokenStore`, `FakePlaybackEngine`). Fakes let us assert queue advancement, transport transitions, error propagation, and direct-vs-transcode selection deterministically.
- **Adapter tests:** the stream proxy gets focused tests for range-request correctness (the riskiest adapter).
- **One opt-in integration smoke test** against a real Plex server, env-gated (`MUSEX_PLEX_E2E=1` + a real token), not run in normal CI.
- Local bar = CI bar: tests + lint + typecheck + format-check all run before any push.

## 14. Open questions / assumptions to confirm

- **Assumption:** you have a Plex server with a music library to test against (needed for the opt-in smoke test). If not, we rely solely on fakes for slice 1.
- **Assumption:** "one active library, switchable" is the right slice-1 model (vs a merged multi-library view, which is deferred).
- **Deferred but seam-aware:** gapless playback will eventually want Web Audio rather than a bare `<audio>` element; the `PlaybackEngine` port is designed so that's a future adapter swap, not a redesign.

---

## Appendix — verified Plex mechanics (sources)

- PIN/OAuth polling flow: `plex.tv/api/v2/pins` + `app.plex.tv/auth`, poll until `authToken` populated.
- Server discovery: `plex.tv/api/v2/resources`.
- Library/browse: `{server}/library/sections`, drill-down via `/library/metadata/{id}/children`.
- Streaming: direct file via `/library/parts/{id}/file`; transcode via `/music/:/transcode/universal/start.m3u8` (HLS).
- Chromium-native audio codecs: mp3, aac/m4a, flac, opus/vorbis, wav (others → transcode).
