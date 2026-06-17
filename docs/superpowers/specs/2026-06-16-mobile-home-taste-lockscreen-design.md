# Mobile Home + Taste Subsystem + Lock-Screen Track Commands — Design

**Date:** 2026-06-16
**Status:** Approved in conversation (visual-companion Home layout = "A · Rails"; user: "looks good — plan it and build it")
**Branch / PR:** `feature/mobile-home-taste-lockscreen` (single PR off `main`, post-#42)

Three related additions to the Expo iOS app (`packages/mobile`), shipped together:

1. **Lock-screen next/previous** — a small native module (expo-audio exposes no JS callback for it).
2. **Home tab + playlists** — a new first tab with taste-driven mixes and Plex/smart playlists (Layout A · rails).
3. **Taste subsystem** — records plays on-device and feeds the Home mixes.

Pieces 2 and 3 are intertwined (Home renders the taste mixes); Piece 1 is independent. All in one PR.

## Verified facts (checked against the real code, not assumed)

- **Top Rated needs no mobile rating UI.** `computeSmartPlaylist("top-rated", tracks, …)` filters/sorts on `Track.userRating` (Plex 0–10 scale, `LOVED_RATING = 8`). The core `Track` model carries `userRating?: number`, and the mobile parser (`plex-parse.ts:60`) already maps `num(m.userRating)`. So Top Rated works from Plex ratings (shared across devices) the moment the view calls it. **No `rateItem`/`getUserRating` and no star UI in this PR.**
- **expo-audio 56.0.12 exposes NO JS callback for lock-screen next/previous.** Its `addListener` accepts only `playbackStatusUpdate` / `audioSampleUpdate`. The native layer wires play/pause and skip-forward/back (the latter are hardwired to a 10s *seek*, not track change). There is no `nextTrackCommand`/`previousTrackCommand` handler at all → a custom native module is required.
- **Core gives us the taste logic, pure and re-exported from `@musex/core`:** `TasteProfile` (`recordPlay(t, kind)`, `recordTrackRating`, `topArtists`, `trackStats`, `serialize`/`load`), `computeSmartPlaylist("top-rated"|"heavy-rotation"|"rediscover", tracks, stats, artistScores, nowMs)`, `composeForYou(ForYouInput)`, `smartMixThumbs`, `smartMixEmpty`, `smartTrackKey`, `SMART_TITLES`, `SMART_DESCRIPTIONS`, `KEY_SEPARATOR`.
- **`composeForYou` wants similar-artist results** (`similarOwned`) which on desktop come from the Last.fm plugin. Mobile has no plugin system → **For You is seeds-only on mobile** (`similarOwned: []`): under-played tracks from the user's own top artists. Still distinct from Heavy Rotation (most-played).
- **Mobile's taste profile is local and separate from desktop's** (no sync). A fresh install starts empty and fills as the user listens on the phone. Top Rated is the exception (it reads Plex ratings, available immediately).
- **Persistence:** neither AsyncStorage nor expo-file-system is installed. We add **`@react-native-async-storage/async-storage`** for the JSON profile (a single key-value blob; *not* SecureStore — the profile isn't secret). Mirrors desktop's load-once + 5s-debounced-save lifecycle.

## `recordPlay` API note

The core signature is `recordPlay(t: { title: string; artistName: string }, kind: "full" | "skip" | "partial"): void`. Desktop classifies `kind` via its scrobble gate: `"full"` when scrobbled, else `"skip"` when `playedSec < 60 && playedSec < 0.25 * durationSec`, else `"partial"`. Mobile has no scrobble plugin, so we add a pure core helper that decides `"full"` without one (played ≥ `min(240s, 0.5 * durationSec)`), and otherwise the same skip/partial split.

---

## Piece 1 — Lock-screen next/previous (native module)

### Native module
`packages/mobile/modules/lock-screen-commands/` — a **local Expo module** (committed source; autolinked by `expo prebuild`). iOS Swift (`ios/LockScreenCommandsModule.swift`):

```swift
import ExpoModulesCore
import MediaPlayer

public class LockScreenCommandsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LockScreenCommands")
    Events("onNext", "onPrevious")
    OnStartObserving {
      let cc = MPRemoteCommandCenter.shared()
      cc.nextTrackCommand.isEnabled = true
      cc.nextTrackCommand.addTarget { [weak self] _ in self?.sendEvent("onNext"); return .success }
      cc.previousTrackCommand.isEnabled = true
      cc.previousTrackCommand.addTarget { [weak self] _ in self?.sendEvent("onPrevious"); return .success }
    }
    OnStopObserving {
      let cc = MPRemoteCommandCenter.shared()
      cc.nextTrackCommand.removeTarget(nil)
      cc.previousTrackCommand.removeTarget(nil)
    }
  }
}
```

- Adds only the two *track* commands; expo-audio keeps owning play/pause/seek + now-playing metadata (different command objects → no conflict).
- Android: a no-op stub implementation so the JS API resolves cross-platform (we're iOS-only now).
- `expo-module.config.json` declares the iOS module class; the generated JS entry exports it.

### JS adapter
`packages/mobile/src/adapters/lock-screen-commands.ts`:

```ts
export interface RemoteCommandHandlers { onNext: () => void; onPrevious: () => void }
export function subscribeRemoteCommands(h: RemoteCommandHandlers): () => void
```

Loads the native module inside a `try/catch` (`requireNativeModule`/the generated module). If it's absent (Expo Go, unit tests, pre-prebuild) it returns a **no-op unsubscribe** and never throws. Otherwise it wires `addListener("onNext"/"onPrevious")` and returns a function that removes both listeners.

### Wiring
In `store.tsx`, alongside the existing `session.subscribe` effect, call `subscribeRemoteCommands({ onNext: () => session.next(), onPrevious: () => session.previous() })` once and clean up on unmount.

### Build/verify
Needs a dev-client rebuild (`expo prebuild` + `expo run:ios`) — our existing flow. CI stays JS-only (the module isn't compiled there). On-device verification by the user: lock-screen next/prev advance the queue.

---

## Piece 2 — Home tab + playlists (Layout A · rails)

### Navigation
- `app/(tabs)/_layout.tsx`: add **Home as the FIRST `TabTrigger`** (`name="home" href="/(tabs)/home"`, lucide `Home` icon), before Library.
- New nested stack `app/(tabs)/home/_layout.tsx` (mirrors `library/_layout.tsx`).

### Screens
- **`home/index.tsx`** — vertical scroll of three horizontal rails (Layout A):
  - **Made for you** — one card per non-empty mix (For You · Top Rated · Heavy Rotation · Rediscover). Card = 2×2 `Collage` of `smartMixThumbs(...)` + title. **Empty mixes are hidden** via `smartMixEmpty(...)`. Tap → `home/mix?kind=<kind>`.
  - **Your playlists** — cards from `gateway.listPlaylists(...)`; thumb (or `Collage` fallback when absent) + title. Tap → `home/playlist?id=<id>&serverId=<sid>`.
  - **Recently played** — top N tracks by `lastPlayedMs` from the taste snapshot, joined to library tracks (`listAllTracks`) by `smartTrackKey` for art + playability. Tap a card → play that track. Hidden when the profile is empty.
  - Data is assembled on screen focus (`useFocusEffect`): fetch `listAllTracks` + `listArtists` once, read `taste.snapshot()`, compute the mixes/recently-played. A loading state covers the first fetch; failures show an inline empty/error state (never crash).
- **`home/mix.tsx`** (`?kind=`) — computes the mix's tracks:
  - `"top-rated" | "heavy-rotation" | "rediscover"` → `computeSmartPlaylist(kind, listAllTracks, stats, topArtists, nowMs)`.
  - `"for-you"` → `composeForYou(buildForYouInput(...))` with `similarOwned: []`.
  - Renders title + the reusable `TrackList` (rows + ActionBar).
- **`home/playlist.tsx`** (`?id=&serverId=`) — `gateway.listPlaylistTracks(id, serverId, token)` → `TrackList`.

### Components
- **`src/ui/Collage.tsx`** — up to four `thumb` plexPaths → a 2×2 grid of `AlbumArt` (baked via `artUrl(base, thumb, token)`), graceful fallback for <4 / missing art. Used by mix cards, playlist-card fallbacks, recently-played.
- **`src/ui/TrackList.tsx`** — a titled track list: `ActionBar` header (Play/Shuffle/Add over the list's tracks) + single-column rows (art + title + `album · artist`, tap plays from that index via `session.loadQueue(buildQueue(tracks, i))`). **Refactor `library/tracks.tsx` to use it** (DRY).
- **`src/ui/RailCard.tsx`** (or inline in `home/index.tsx`) — a fixed-width vertical card (square art/Collage + label + optional sublabel) for the rails.

### Gateway (`src/adapters/plex-gateway.ts` + parser)
Implement the stubbed methods:
- **`listPlaylists(library, token)`** → `GET {base}/playlists?playlistType=audio` → `parsePlaylists` (→ `Playlist[]`: `id`, `serverId`, `title`, `trackCount` from `leafCount`, `durationMs?` from `duration`, `thumb?` from `composite`/`thumb`, `updatedAt?`).
- **`listPlaylistTracks(playlistId, serverId, token)`** → `GET {base}/playlists/{playlistId}/items` → reuse `parseTracks`, attaching `playlistItemId` (`playlistItemID`) to satisfy the `PlaylistTrack` shape.
- New parser `parsePlaylists` in `src/logic/plex-parse.ts`; fake-fetch unit tests for both methods (fixtures with `Metadata`, `leafCount`, `composite`).
- The other playlist-mutation stubs (`createPlaylist`/`addToPlaylist`/`removeFromPlaylist`/`renamePlaylist`/`deletePlaylist`) stay stubbed — not in scope.

---

## Piece 3 — Taste subsystem

### Core (pure, tested) — `packages/core/src/logic/play-tracker.ts`
- `classifyPlay(playedSec: number, durationSec: number): "full" | "skip" | "partial"` — `"full"` when `playedSec >= min(SCROBBLE_ABS_SEC=240, SCROBBLE_FRACTION=0.5 * durationSec)`; else `"skip"` when `playedSec < SKIP_MAX_SEC=60 && playedSec < SKIP_MAX_FRACTION=0.25 * durationSec`; else `"partial"`.
- `class PlayTracker` — folds playback updates into effective listening seconds, ignoring seeks:
  - `start(durationSec: number): void` — begin a new track (resets accumulator).
  - `update(positionSec: number, playing: boolean): void` — add `delta = positionSec - lastPos` to the accumulator **only when** `playing` and `0 <= delta <= MAX_CONTINUOUS_DELTA=2` (a larger jump = a seek: advance the cursor, don't credit it); always store `lastPos`.
  - `playedSec(): number` and `finish(): "full" | "skip" | "partial"` (= `classifyPlay(playedSec, durationSec)`).
  - Exported from the `@musex/core` barrel. Unit tests: full/skip/partial boundaries; seek ignored; pause stops accrual.

### Mobile adapters
- **`src/adapters/taste-persistence.ts`** — `loadTasteState(): Promise<TasteState | null>` / `saveTasteState(s: TasteState): Promise<void>` over `AsyncStorage` (`"musex.listening-profile"` key, JSON). Read errors → `null` (start fresh, log; never crash). Round-trip test with a mocked AsyncStorage (in-factory Map, like the existing secure-store test).
- **`src/taste/taste-service.ts`** — holds a `new TasteProfile()`; `init()` loads persisted state via `taste-persistence`; `recordPlay(t, kind)` mutates + schedules a **5s debounced** `saveTasteState(profile.serialize())`; `snapshot(): { topArtists, trackStats, nowMs }` reads the profile. `nowMs` via `Date.now()` (the adapter layer; core stays clock-injected).

### Play monitor — `src/taste/play-monitor.ts`
A function `attachPlayMonitor(session, taste): () => void` that subscribes to the session and:
- on track change (new `queue.tracks[index].id` ≠ last): `finish()` the previous tracker (if any) → `taste.recordPlay({title, artistName}, kind)`; then `tracker.start(newDurationSec)`.
- on each update while the same track plays: `tracker.update(positionSec, status === "playing")`.
- on stop/queue-clear: finish the current tracker.

Wired in `store.tsx`. To avoid two subscriptions racing the existing `setNowPlaying` one, the monitor either (a) hangs off the same `session.subscribe` callback, or (b) takes its own subscription — both are fine since `PlaybackSession.subscribe` supports multiple listeners; the plan picks one and documents it.

### Store exposure
`store.tsx` constructs the `TasteService` (and `await taste.init()` during bootstrap), attaches the play monitor, attaches `subscribeRemoteCommands`, and exposes `taste` on the store context so Home can call `taste.snapshot()`.

---

## Architecture

Hexagonal, matching the rest of the app: all decision logic (`PlayTracker`, `classifyPlay`, the smart-mix/for-you computations) is pure in `@musex/core`; mobile provides thin adapters (`taste-persistence` over AsyncStorage, `lock-screen-commands` over the native module) and view code. Nothing platform-specific leaks into core.

## Error handling
- Gateway network failures → screen empty/error states, no crash.
- Taste persistence read failure → empty profile, logged.
- Play monitor → wrapped so it can never break playback.
- Lock-screen module absent → no-op subscribe.
- No empty `catch {}`: every catch logs or recovers.

## Testing
- **Core unit:** `play-tracker.ts` (classifyPlay boundaries; PlayTracker seek/pause/accrual).
- **Mobile unit:** `listPlaylists`/`listPlaylistTracks` against fake `fetch`; `taste-persistence` round-trip (mocked AsyncStorage); any pure mapping helper (`buildForYouInput`, recently-played join) if extracted.
- Existing 26 mobile tests + all core/desktop tests stay green. `passWithNoTests` unaffected.
- **`pnpm check` (typecheck + biome + vitest) green throughout — the controller re-runs it before every push** (subagent self-reports can be wrong).
- **Manual (device, user):** Home tab first; rails render with collage art; empty mixes hidden; tapping a mix/playlist opens a track list with a working ActionBar; mixes populate as you listen; lock-screen next/prev advance the queue after a dev-client rebuild.

## Out of scope
- Star-rating UI + `rateItem`/`getUserRating` (Top Rated works from Plex ratings).
- Similar-artist expansion for For You (no plugin system on mobile).
- Playlist mutation (create/add/remove/rename/delete).
- Profile sync between mobile and desktop.
- Android lock-screen commands (iOS-only; Android stub is no-op).
- All-Tracks pagination (pre-existing; Home reuses the same full `listAllTracks`).

## Done when
Home is the first tab and shows the rails (taste mixes + playlists + recently-played) with collage art; mixes compute from the on-device taste profile that fills as you listen; playlists load and play; lock-screen next/previous advance the queue on device; `pnpm check` is green and the existing tests pass.
