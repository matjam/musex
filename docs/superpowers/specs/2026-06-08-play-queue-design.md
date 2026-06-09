# Play Queue + Shuffle + Repeat — Design

**Date:** 2026-06-08
**Status:** Draft for review.

## Goal

Give playback a real, manageable **play queue**: queue a song / album / artist; see what's coming (Now playing + the next tracks); **reorder** (drag), **remove**, and **clear**; plus **shuffle** (true random, restores original order when turned off) and **repeat** (none / all / one). Controls live in the Now Playing bar; the queue is a right-side drawer.

## Decisions (confirmed)

- **Queue UI:** a **right-side drawer**, toggled by a "Queue" button in the Now Playing bar; overlays the right of the content, stays open while browsing.
- **Controls in the transport row** (Spotify order): `🔀 shuffle · ⏮ prev · ▶/⏸ · ⏭ next · 🔁 repeat`. Shuffle/repeat are NOT in the drawer.
- **Shuffle:** randomizes the upcoming tracks (current keeps playing); turning it **off restores the original order** from the current track onward.
- **Repeat cycle:** Off → All → One → Off (icon reflects mode; repeat-one shows a "1").
- **Reorder:** drag-and-drop within the drawer.
- **Enqueue actions:** "Play next" (insert right after the current track) and "Add to queue" (append to the end), available for a **song**, an **album**, and an **artist**.

## Architecture

The queue is core domain state — it lives in `@musex/core`'s `PlaybackSession` (already owns `Queue` + gapless lookahead). This slice extends that state machine; the renderer adds the drawer, the transport buttons, and the enqueue surfaces. No new ports. The session stays the most-tested unit (against `FakePlaybackEngine`).

### Core model (`@musex/core`)

`RepeatMode = "none" | "all" | "one"`. Extend `Queue`:
```ts
export interface Queue {
  tracks: Track[];
  index: number;
  shuffle: boolean;
  repeat: RepeatMode;
}
```
Queue operations work by **index** (duplicates allowed — the same track can be queued twice). `buildQueue(tracks, startIndex)` defaults `shuffle:false, repeat:"none"`. Shuffle-restore needs the pre-shuffle order: the session keeps a **private** `unshuffled: Track[] | null` (transient, not part of `PlaybackState`).

### `PlaybackSession` — new/changed methods

- `loadQueue(queue)` — unchanged; this is **"play now"** (replace queue, play from its index). `player.playTracks` keeps using it.
- `enqueueNext(tracks: Track[])` — insert after the current index. If the queue is empty/idle, behaves like play-now.
- `enqueueEnd(tracks: Track[])` — append to the end. If empty/idle, play-now.
- `removeAt(index)` — remove that entry; if it's before the current, decrement `index`; if it **is** the current, advance to the next (or stop if none); keep `unshuffled` in sync.
- `move(from, to)` — reorder; keep `index` pointing at the same playing track.
- `clearQueue()` — remove everything **after** the current track (current keeps playing; nothing queued). 
- `setShuffle(on)`:
  - **on:** snapshot `unshuffled = [...tracks]`; Fisher-Yates–shuffle the slice **after** `index`; current stays put; `queue.shuffle = true`.
  - **off:** restore `tracks` from `unshuffled` (reconciled with any adds/removes that happened while shuffled — added tracks kept, removed tracks dropped), set `index` to the current track's position in the restored order; clear `unshuffled`; `queue.shuffle = false`.
  - Manual `enqueue*/removeAt` while shuffled also update `unshuffled` (append/remove) so restore stays valid. Manual `move` reorders only the visible (shuffled) list, not `unshuffled`.
- `setRepeat(mode)` / `cycleRepeat()` — Off → All → One → Off.

### Shuffle/repeat × gapless lookahead

`preloadNext`, `handleAdvanced` (gapless auto-advance), `handleEnded` (true end), and manual `next`/`previous` must respect repeat:
- **next track** = `repeat === "one"` ? current : (`index+1 < len` ? `index+1` : (`repeat === "all"` ? `0` : none)).
- `preloadNext` preloads that computed next (repeat-one → re-preload current for a gapless loop; repeat-all on the last track → preload track 0).
- `handleEnded` with no next → `repeat==="one"` replays current; `repeat==="all"` → `playIndex(0)`; else `status:"ended"`.
- `handleAdvanced` advances to the computed next index (stays on the same index for repeat-one).
- **Manual `next`** overrides repeat-one (goes to the real next track); at the end with repeat-all it wraps to 0; with repeat-none at the end it stops. `previous` is symmetric (wraps to last under repeat-all). Order under shuffle = the already-shuffled `tracks` order (no special handling — shuffle already baked the order in).

This logic is the heart of the slice and is **TDD'd against `FakePlaybackEngine`**: assert next-track computation for all repeat modes, end/advance behavior, shuffle preserves current + randomizes the rest + restores on off, enqueue-next/end placement, remove/move index bookkeeping, and that the right track is preloaded for gapless in each mode.

### Renderer

**Now Playing bar (`NowPlayingBar.tsx`):** add to the transport cluster — a **shuffle** toggle (left of prev; green/active when on), a **repeat** button (right of next; three visual states, repeat-one shows a "1"), and a **Queue** button (toggles the drawer; lucide icons throughout). Wire to new player API.

**Queue drawer (`QueueDrawer.tsx`, new):** a right-side overlay panel (animate in/out). Header: "Queue" + **Clear**. Sections: **Now playing** (the current track), **Next up** (the upcoming tracks). Each upcoming row: drag handle, art, title/artist, remove (✕); click a row to jump to it (`playIndex`). **Drag-and-drop** reorder via HTML5 DnD (dragstart stores index → drop computes target → `move(from,to)`); no new dependency. Shows the upcoming list scrollably (the next several visible; for very large queues render a bounded window — reuse `VirtualTrackList` if needed, though DnD + virtualization interaction is a known tension; the plan picks the simplest correct approach, e.g. render up to ~100 upcoming rows with a "+N more" note since reordering far down is rare).

**Player store (`state/player.tsx`):** expose `enqueueNext`, `enqueueEnd`, `removeFromQueue`, `moveInQueue`, `clearQueue`, `toggleShuffle`, `cycleRepeat`, `jumpTo(index)`, and the drawer open/close state (or keep drawer state local to the app shell).

**Enqueue surfaces:**
- **Track context menu** (`TrackContextMenu`): add **Play next** and **Add to queue** (the items deferred in the playlists slice). Available wherever the menu appears (album, search, playlist, tracks).
- **Album detail / Albums:** "Add to queue" / "Play next" actions (a small menu or buttons) that enqueue the album's tracks.
- **Artist:** "Add to queue" / "Play next" that enqueue **all of the artist's tracks**. Needs the artist's full track list — fetch via the existing album→tracks (flatten the artist's albums) or a dedicated gateway method `listArtistTracks`; the plan decides (a section search filtered by artist is the cheapest if supported). This is a deliberate action, so a brief load is acceptable.

## Out of scope

- Persisting the queue across restarts (the queue is session state; revisit later).
- Crossfade, gapless across a repeat-one boundary beyond what the engine already supports, "smart"/radio auto-queue, history/"previously played" view.
- Queue virtualization+DnD for pathologically huge queues (bounded-window render is fine for v1).

## Testability

- **Core `PlaybackSession`** is the primary target (Vitest + `FakePlaybackEngine`): repeat-mode next computation, end/advance, shuffle (randomize-rest / keep-current / restore-on-off), enqueue placement, remove/move index math, preload-correct-track per mode. Determinism: inject the RNG (e.g. a `shuffle` strategy or seeded function) so shuffle is testable.
- Renderer (drawer, DnD, transport buttons, enqueue menu items) verified manually; pure helpers unit-tested. `pnpm check` is the bar.

## Affected files (preview)

- Core: `models/index.ts` (`RepeatMode`, `Queue` fields), `usecases/build-queue.ts` (defaults), `playback/playback-session.ts` (the bulk: queue ops + shuffle + repeat + lookahead), `testing/fakes.ts` if needed, new/expanded `playback-session.test.ts`. Inject RNG for shuffle.
- Renderer: `state/player.tsx` (new API), `ui/NowPlayingBar.tsx` (shuffle/repeat/queue buttons), new `ui/QueueDrawer.tsx`, `ui/TrackContextMenu.tsx` (Play next / Add to queue), `ui/views/AlbumDetailView.tsx` + `ArtistDetailView.tsx` (enqueue actions), `ui/theme.css`, app shell for drawer open state.
- Main (only if artist-tracks needs it): a `listArtistTracks` gateway/IPC method.
