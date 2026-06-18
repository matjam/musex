# Mobile Feature Parity — Phase B: last.fm Design

**Date:** 2026-06-17
**Status:** Approved (design); proceeding to plan + build per user delegation
**Context:** Second mobile parity phase. Brings last.fm to mobile as a first-party **core** service (not a plugin — mirrors the desktop SP4 decision). Unlocks scrobbling, love-on-rating, similar artists, artist bio (completing the Phase A artist page), and Radio mode. Builds on Phase A (PR #53, merged). No native QuickJS / plugin sandbox needed — last.fm is pure `fetch` + MD5.

## Goal

Port the desktop last.fm capability to mobile, reusing the desktop's pure protocol code (promoted to `@musex/core`), and wire it into the mobile UI: a Last.fm settings/connect pane, background scrobbling, love-on-rating, a Similar-artists rail + bio on the artist page, and Radio mode.

## Architecture

**Core promotion (the deferred SP1 piece):**
- `packages/core/src/logic/lastfm-protocol.ts` — port desktop `main/lastfm/signing.ts` (`sign(params, secret)`) + `client.ts` (`LastfmClient`, `LastfmError`, `isLastfmError`). The signature's MD5 currently uses `node:crypto`; replace with a **`Hasher` port** — `export type Hasher = (input: string) => string` (returns md5 hex) — injected into `sign`/`LastfmClient`. Core stays zero-dependency; the host supplies MD5.
- `packages/core/src/ports/` — add the `Hasher` port type (or co-locate in lastfm-protocol).
- `packages/core/src/logic/radio.ts` — pure radio coordination: given seed recommendations + an "already-queued/recently-played" exclude set, produce the ordered list of candidate tracks to resolve; decide when to stop (N consecutive empty top-ups). Pure + tested. (Library resolution itself is done by the caller via the gateway.)
- Desktop `main/lastfm/signing.ts`+`client.ts` are replaced by imports of the core versions (desktop supplies a `node:crypto` Hasher); desktop `service.ts` otherwise unchanged. This keeps one protocol implementation.

**Mobile `LastfmService` (`packages/mobile/src/lastfm/lastfm-service.ts`):** the platform adapter. Holds config + credentials; constructs a core `LastfmClient` with an injected **pure-JS MD5** `Hasher` (no native dep) and `fetch`. Exposes: `connect()`/`disconnect()`, `getConfig()`/`setConfig()`, `updateNowPlaying(track)`, `scrobble(track, startedAtMs)`, `love(track)`/`unlove(track)`, `similarArtists(name)`, `artistInfo(name)`, `recommend(seed)`. Persists config via async-storage (`musex.lastfm`) and `apiSecret`/`sessionKey` via expo-secure-store. Registered in the store next to `gateway`/`taste`/`session`.

## Auth (matches desktop — user supplies key + secret)

New **Last.fm settings screen** in the settings stack (`app/(tabs)/settings/lastfm.tsx`, linked from `settings/index.tsx`):
- API key + API secret inputs (secret is a password field; persisted to secure-store).
- **Connect** button → `auth.getToken` → open `https://www.last.fm/api/auth/?api_key=…&token=…` via `expo-web-browser` → on return, `auth.getSession(token)` → store `sessionKey` + `username`; show "Connected as <user>".
- **Disconnect** → clear sessionKey/username.
- **Scrobbling** toggle, **Love on rating** toggle.
- Connection status row.

Config shape (mirrors desktop): `{ apiKey, scrobbling, loveOnRating, username, connection }` in async-storage; `apiSecret` + `sessionKey` in secure-store.

## Scrobbling

Reuse the existing `PlayMonitor` plumbing (already feeds `TasteService`):
- On current-track change (the store's `session.subscribe` loop already sees it), call `lastfm.updateNowPlaying(track)`.
- When `PlayMonitor` reports a completed **full play** (its existing threshold — played ≥ min(240s, half) — closely matches last.fm's "≥half or ≥4 min" rule), call `lastfm.scrobble(track, startedAtMs)`.
- Both gated by `scrobbling === true` && connected (has sessionKey). No-op otherwise. No new UI; no separate scrobble-gate module (PlayMonitor's classification is the gate).

## Love on rating

Extend the existing rating flow (StarRating → `gateway.rateItem` → `taste.recordTrackRating`): also, when `loveOnRating === true` && connected, rate ≥ 4★ → `lastfm.love(track)`, rate < 4★ (or clear) → `lastfm.unlove(track)`. Hooked wherever rating is applied (action sheet + Now-Playing). No new UI.

## Similar artists (artist page)

`lastfm.similarArtists(name)` → names → **resolve owned** against the library (match by name via `gateway.search` / cached artists) → a horizontal **Similar artists** rail on the artist page (`library/albums.tsx`, layout B). Each tile is circular; tap → that artist's page (`library/albums?artistId=` for owned). Unowned similar artists are shown but non-navigable for now (federated/external is Phase D).

## Artist bio

`lastfm.artistInfo(name)` → bio HTML-stripped → an **"About"** section at the bottom of the artist page (layout B), truncated with a "more" expand.

## Radio mode

- **Start:** a **Start radio** row in the `TrackActionSheet` (seed = track) and a **Radio** button on the artist page (seed = artist). Sets the session into radio mode with the seed.
- **Coordinate:** core `radio.ts` + `lastfm.recommend(seed)` (artist/track getSimilar) → resolve each against the library (gateway) → playable `Track[]` → append to the queue. Top up to ~10 ahead when up-next < 5; exclude the last ~50 played; auto-stop after 2 consecutive empty top-ups or when a different album/playlist is started.
- **Show/stop:** a green **Radio · <seed>** pill on Now-Playing with a ✕ to stop (stopping leaves the current queue, just halts top-ups). Up-next radio entries are marked.
- Radio state lives in the store (seed + active flag + exclude set), driven off `session.subscribe`.

## Settings pane

`app/(tabs)/settings/lastfm.tsx` as above; `settings/index.tsx` gets a "Last.fm" row linking to it (showing connection status). Store exposes `lastfm` + `getLastfmConfig`/`setLastfmConfig`/`connectLastfm`/`disconnectLastfm`.

## Core changes (complete list)

1. `logic/lastfm-protocol.ts` (+ test) — `sign`, `LastfmClient`, `LastfmError`, `isLastfmError`, the `Hasher` type; barrel export.
2. `logic/radio.ts` (+ test) — pure radio coordination/stop logic; barrel export.
3. Desktop `main/lastfm/signing.ts`+`client.ts` re-pointed to the core protocol (desktop provides a `node:crypto` Hasher) — no behavior change; desktop tests stay green.

## Mobile additions

- `src/lastfm/lastfm-service.ts` (+ a pure-JS `md5.ts` Hasher, or expo-crypto if it offers sync MD5 — prefer pure-JS, no native dep) + tests (fake fetch + fake/real Hasher).
- Store wiring: construct + expose `LastfmService`; forward track-change → `updateNowPlaying`, completed full play → `scrobble`, rating → `love`/`unlove`; own radio mode state + top-up loop.
- `app/(tabs)/settings/lastfm.tsx` + a link row in `settings/index.tsx`.
- Artist page (`library/albums.tsx`): Similar rail + About/bio (gated on connected; absent/empty if not).
- `TrackActionSheet`: "Start radio" row. Artist page: "Radio" button.
- Now-Playing: Radio pill + ✕ stop; up-next radio markers.

## Dependencies

- `expo-web-browser` (auth) — native module → **dev-client rebuild** required.
- MD5 — pure-JS implementation (vendored small function), no native dep.

## Testing

- **Core:** `lastfm-protocol` signing vectors (the desktop test vectors transfer — sorted name+value concat + secret, md5 hex) + response parsing; `radio.ts` coordination (top-up trigger, exclude, stop conditions). Pure unit tests.
- **Mobile:** `LastfmService` with fake `fetch` + injected `Hasher` (assert request params/signatures for connect/scrobble/love/getSimilar/getInfo; parse responses). The md5 Hasher unit-tested against a known vector.
- **Verification bar:** full `pnpm check` green before every commit; controller re-runs before push.
- **On-device acceptance (user):** Connect succeeds; scrobbles appear on last.fm; love toggles on rating; Similar rail + bio render on the artist page; Radio fills + tops up + stops. Requires a dev-client rebuild (expo-web-browser native dep).

## Non-goals / deferred

- Federated/external search, acquisition, taste expansion (Phase D — plugin/provider system).
- A standalone "Similar" main view (folded into the artist page) and a track-detail panel.
- Multi-account last.fm; offline scrobble queue (scrobble best-effort while online).

## Success criteria

- last.fm protocol lives in core (with a `Hasher` port); desktop consumes the core version with no behavior change; both desktop + mobile share one implementation.
- Mobile: connect via the settings pane; background scrobbling + now-playing; love-on-rating; Similar-artists rail + bio on the artist page; Radio mode (start/show/stop + auto-extend).
- All new core + service logic unit-tested; `pnpm check` green.
