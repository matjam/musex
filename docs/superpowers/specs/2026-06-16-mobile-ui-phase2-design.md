# Mobile UI Phase 2 — Design

**Date:** 2026-06-16
**Status:** Approved in conversation (visual-companion mockups; user: "spec it out and build it — I'll give feedback after we test")

Phase 2 of the iOS app: turn the bare Phase 1 browse-and-play proof into a real
music-app UI — album art, tab navigation, a fullscreen Now Playing with an
inline queue, **background audio**, and a fix for the **overlapping-tracks bug**.
Builds on `packages/mobile` (Expo SDK 56). No desktop changes.

## Decided UI (from the visual companion)

- **Nav shell:** bottom **Tab bar** — `Library` + `Settings` — with a persistent
  **mini-player** above the tabs that expands to a **fullscreen Now Playing**
  modal. (Search/Home tabs deferred.)
- **Now Playing:** layout "C" + controls "A" — art, title/artist, seek scrubber,
  classic transport (prev / big play-pause / next) + shuffle/repeat row, and the
  **queue ("Up Next") inline on the same page**.
- **Album art (presentation "B"):** artists = rows w/ circular art; **albums =
  2-column cover grid**; tracks = rows under a large album-art header.
- **Queue interactions v1:** tap-to-jump + swipe-to-remove. **Drag-reorder
  deferred** (needs a draggable-list dep).

## Architecture & components (all in `packages/mobile`)

### Navigation (expo-router)
- `app/(tabs)/_layout.tsx` — `Tabs` with `library` + `settings` (lucide tab
  icons). Auth gate (`app/index.tsx`) still redirects signed-out → `/sign-in`.
- `app/(tabs)/library/` — the drill-down moves under the Library tab:
  `index.tsx` (artists) → `albums.tsx` → `tracks.tsx`, each with a header toolbar.
- `app/(tabs)/settings.tsx` — minimal: account (sign out → clear token), server
  + library name, app version. (Mobile has no sign-out today.)
- `app/now-playing.tsx` — fullscreen route, `presentation: "modal"` (or a custom
  expanding transition); dismiss via ▾ / swipe-down.
- The **mini-player** renders in the `(tabs)` layout (above the tab bar) so it
  persists across tabs and opens `/now-playing` on tap.

### Album art
- Pure helper `logic/art-url.ts`: `artUrl(serverBaseUrl, thumb, token)` →
  `{base}{thumb}?X-Plex-Token=<enc>` (returns null when `thumb` absent). Mirrors
  `stream-ref.ts`. Unit-tested.
- `ui/AlbumArt.tsx` — wraps `expo-image` with a neutral placeholder + rounded
  corners (circular variant for artists). `serverBaseUrl` from
  `gateway.baseUrlFor(serverId)`, token from the store (same plumbing playback
  already uses). **Add `expo-image`** (`expo install expo-image`).

### Now Playing + queue
- Reads the store's `PlaybackState` (`queue`, `status`, `positionSec`,
  `durationSec`). Controls call existing `PlaybackSession` methods:
  `play`/`pause`, `next`/`previous`, `seek`, `setShuffle`/`cycleRepeat`,
  `jumpTo(index)` (tap Up Next), `removeAt(index)` (swipe). Up Next = the queue
  tail (`queue.tracks` after `queue.index`), each row with small art + title;
  current track highlighted.
- Scrubber: a slider bound to `positionSec`/`durationSec`; on release →
  `session.seek(sec)`. (Add `@react-native-community/slider` or use a simple
  Pressable track; **slider lib** via `expo install`.)

### Background audio + lock screen
- Engine `init()` → `setAudioModeAsync({ playsInSilentMode: true,
  shouldPlayInBackground: true })`. The `UIBackgroundModes: ["audio"]`
  entitlement is already in `app.json`.
- Lock-screen / Control Center Now-Playing info: drive expo-audio's now-playing
  metadata (title/artist/art) so background controls work. Verify what SDK 56's
  `expo-audio` exposes for this; if it needs more than the engine provides,
  feed metadata from the playback monitor / on `load()`. (If SDK 56 lacks a
  clean API, lock-screen controls drop to a follow-up — background *playback*
  itself is the must-have here.)

### Bug fix — overlapping tracks
Playing a second track doesn't stop the first → two streams. Diagnose via
systematic-debugging; the leading hypothesis is `ExpoAudioEngine.teardownPlayer()`
calling `player.remove()` without first stopping the old AVPlayer (or `remove()`
not halting playback synchronously). Fix = **pause the old player before
remove**, and confirm a single stream after a rapid second selection. Reproduce
first, then fix, then verify (don't just patch blindly).

## State / data flow
- The store already hosts ONE `PlaybackSession` + the gateway + token. Expose a
  small `controls` surface (or use `session` directly) for the Now Playing
  screen. Art needs `serverBaseUrl` (`gateway.baseUrlFor(serverId)`) + token —
  already available in the store.
- `Track.thumb`/`Album.thumb`/`Artist.thumb` are Plex paths (parsed already);
  `artUrl` turns them into loadable URLs.

## Testing
- **Unit:** `art-url.ts` (pure) — path → URL, null thumb, token encoding.
- **Bug:** reproduce overlapping audio (env-gated engine smoke or manual), fix,
  verify single stream.
- **Manual (on device + simulator):** tabs, album grid, art rendering, Now
  Playing transport + seek + shuffle/repeat, queue tap/swipe, background audio
  (switch apps → keeps playing), lock-screen controls.
- `pnpm check` green at every step (typecheck + biome + vitest).

## Out of scope
Drag-to-reorder the queue, Search/Home tabs, desktop changes, offline/caching,
discovery/taste UI.

## Done when
Album art renders throughout; tab nav + fullscreen Now Playing + inline queue
work; audio keeps playing when the app is backgrounded; selecting a second track
stops the first (single stream); `pnpm check` green.
