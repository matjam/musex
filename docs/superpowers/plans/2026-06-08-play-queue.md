# Play Queue + Shuffle + Repeat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** A manageable play queue (queue song/album/artist; reorder, remove, clear; see what's next) + shuffle (true random, restores order on off) + repeat (none/all/one). Controls in the transport row (lucide icons); queue in a right-side drawer.

**Architecture:** The queue is core state — extend `PlaybackSession` (queue ops + shuffle + repeat + repeat-aware gapless lookahead), with the RNG injected so shuffle is deterministically testable. Renderer adds lucide transport controls (shuffle/repeat/queue + upgrades existing emoji glyphs), a `QueueDrawer` (HTML5 drag-reorder, remove, clear), and Play-next/Add-to-queue enqueue surfaces.

**Tech Stack:** TS 6, React 19, Vitest 4, Biome 2, `lucide-react` 1.x, `@ctrl/plex` 6.

**Spec:** `docs/superpowers/specs/2026-06-08-play-queue-design.md`.

**Conventions:** core/main `.js` imports; test/renderer no extension; `import type`; Biome; `noUncheckedIndexedAccess`. **Icons: lucide-react only, no emoji** (per CLAUDE.md). `git add -A`; commit to `main`; push each commit; each task ends GREEN on `pnpm check`. `Math.random` is fine in normal runtime code (the ban is workflow-scripts-only).

---

### Task 1: Core — `RepeatMode` + `Queue` fields + buildQueue defaults

**Files:** `packages/core/src/models/index.ts`, `usecases/build-queue.ts` (+ its test), `index.ts`

- [ ] **Step 1:** add `export type RepeatMode = "none" | "all" | "one";` and extend `Queue`:
```ts
export interface Queue {
  tracks: Track[];
  index: number;
  shuffle: boolean;
  repeat: RepeatMode;
}
```
- [ ] **Step 2:** `buildQueue(tracks, startIndex)` returns `{ tracks, index: startIndex, shuffle: false, repeat: "none" }`. Update its test for the new fields. Export `RepeatMode` from the barrel.
- [ ] **Step 3:** Fix any now-failing readers (TS will flag `Queue` literals missing fields — e.g. tests/fakes). `pnpm --filter @musex/core test && tsc --noEmit` green; desktop may have `Queue`-literal sites to fix too — run `pnpm check` and fix any `Queue` object literals to include the new fields. Commit `feat(core): RepeatMode + Queue shuffle/repeat fields` + push.

---

### Task 2: Core — PlaybackSession queue ops + shuffle + repeat (TDD)

**Files:** `packages/core/src/playback/playback-session.ts`, `playback/playback-session.test.ts`

This is the heart. Inject the shuffle strategy for determinism; implement the queue ops + repeat-aware lookahead; drive it with the test suite below (write tests first, then implement to green).

- [ ] **Step 1 (constructor RNG injection):** add an optional third constructor arg:
```ts
constructor(
  private readonly engine: PlaybackEngine,
  private readonly resolver: StreamResolver,
  private readonly shuffleRest: <T>(items: T[]) => T[] = fisherYates,
) { ... }
```
where `fisherYates<T>(a: T[]): T[]` is a module-local pure shuffle using `Math.random` (returns a new array). Tests pass a deterministic strategy (e.g. `reverse`, or a fixed permutation) to assert behavior.

- [ ] **Step 2 (next-index helper):**
```ts
/** Index to play after `index`, per repeat mode; null = nothing next (stop). */
private computeNext(q: Queue): number | null {
  if (q.repeat === "one") return q.index;
  if (q.index + 1 < q.tracks.length) return q.index + 1;
  return q.repeat === "all" ? 0 : null;
}
```

- [ ] **Step 3 (queue ops):** implement (all `patch` the queue + keep the private `unshuffled: Track[] | null` in sync; emit state):
  - `enqueueNext(tracks: Track[])` — empty/idle → `loadQueue(buildQueue(tracks, 0))`; else splice into `queue.tracks` at `index+1` (and into `unshuffled` after the current track's position). Re-`preloadNext()` (the next track may have changed).
  - `enqueueEnd(tracks: Track[])` — empty/idle → play-now; else append to `tracks` (+ `unshuffled`). Re-`preloadNext()` if it was the only upcoming.
  - `removeAt(i)` — remove `tracks[i]` (+ from `unshuffled`); if `i < index` → `index--`; if `i === index` → removing the current track: load the next (`computeNext` style: play `tracks[i]` which is now the former-next, or stop if none); else just patch. Re-`preloadNext()`.
  - `move(from, to)` — array-move in `tracks`; recompute `index` so it still points at the same playing track. Re-`preloadNext()`.
  - `clearQueue()` — `tracks = tracks.slice(0, index + 1)` (keep current + history; drop upcoming); mirror in `unshuffled`. Clears the preloaded next.
  - `setShuffle(on)` — **on:** `unshuffled = [...tracks]`; `tracks = [...tracks.slice(0, index+1), ...this.shuffleRest(tracks.slice(index+1))]`; patch `shuffle:true`; re-preload. **off:** if `unshuffled`, rebuild `tracks` = `unshuffled` filtered to still-present tracks (by identity), set `index` to the current track's position there; `unshuffled=null`; patch `shuffle:false`; re-preload.
  - `cycleRepeat()` — none→all→one→none; `setRepeat(mode)`; patch; re-preload (next may change).
  - `jumpTo(index)` — `playIndex(index)` (used by clicking a queue row).

- [ ] **Step 4 (repeat-aware lookahead):** update `preloadNext`, `handleEnded`, `handleAdvanced`, `next`, `previous` to use `computeNext`:
  - `preloadNext`: preload `computeNext(queue)`'s track (null → nothing). For repeat-one, that's the current track again (gapless loop).
  - `handleEnded`: `const n = computeNext(queue)`; `n === null` → `status:"ended"`; else `playIndex(n)`.
  - `handleAdvanced`: advance to `computeNext`; for repeat-one keep `index` and just reset position/duration; else set `index = n`. Then `preloadNext`.
  - `next()` (manual): repeat-one is overridden — go to real next: `index+1 < len ? index+1 : (repeat==="all" ? 0 : ended)`. `previous()`: `index-1 >= 0 ? index-1 : (repeat==="all" ? len-1 : 0)`.

- [ ] **Step 5 (write the test suite first — `playback-session.test.ts`):** extend the existing tests. Cover (using `FakePlaybackEngine` + a fake resolver + a deterministic `shuffleRest` e.g. `(a) => [...a].reverse()`):
  - repeat none: ends at last; `computeNext` null at end.
  - repeat all: last → wraps to 0 (on ended AND on manual next).
  - repeat one: ended replays current (index unchanged); manual next still advances.
  - `preloadNext` preloads the correct track for each repeat mode (assert via FakePlaybackEngine recording `preload`), incl. repeat-one preloads current, repeat-all-on-last preloads index 0.
  - `enqueueNext` inserts after current; `enqueueEnd` appends; both on an empty queue start playback.
  - `removeAt` before/at/after current updates index + current correctly.
  - `move` keeps the playing track as `index`.
  - `clearQueue` drops upcoming, keeps current playing.
  - `setShuffle(true)` keeps current at `index`, reverses (deterministic) the rest; `setShuffle(false)` restores original order + correct index; round-trips after an `enqueueEnd` in between (added track survives restore).
  Write these RED first, then implement Steps 1–4 to GREEN.

- [ ] **Step 6:** `pnpm check` green (this is mostly core; ensure desktop still compiles — `player.tsx` will still call existing methods). Commit `feat(core): queue ops + shuffle + repeat in PlaybackSession (TDD)` + push.

---

### Task 3: Renderer — player API + lucide transport controls (shuffle/repeat/queue)

**Files:** `state/player.tsx`, `ui/NowPlayingBar.tsx`, `ui/theme.css`

- [ ] **Step 1 (player store):** in `state/player.tsx`, expose the new session methods + drawer state:
```ts
  enqueueNext(tracks: Track[]): void;
  enqueueEnd(tracks: Track[]): void;
  removeFromQueue(index: number): void;
  moveInQueue(from: number, to: number): void;
  clearQueue(): void;
  toggleShuffle(): void;   // session.setShuffle(!state.queue?.shuffle)
  cycleRepeat(): void;
  jumpTo(index: number): void;
```
(each `void session.x(...)`). Drawer open/close can live in the app shell or here; pick one (the plan uses local shell state — see Task 4).

- [ ] **Step 2 (lucide transport):** in `NowPlayingBar.tsx`, replace the emoji glyphs with lucide icons and add shuffle/repeat/queue:
  - transport cluster: `<Shuffle>` (active class when `queue.shuffle`), `<SkipBack>`, `<Play>`/`<Pause>`, `<SkipForward>`, repeat button = `queue.repeat === "one" ? <Repeat1> : <Repeat>` (dimmed when `"none"`, accent when `all`/`one`).
  - right side: a **Queue** button (`<ListMusic>` or `<ListOrdered>`) that toggles the drawer; keep the volume control but swap `🔊` for `<Volume2>`/`<VolumeX>`.
  - Wire onClick to `togglePlay/next/previous/toggleShuffle/cycleRepeat` + the drawer toggle. Active/dim styling via classes (e.g. `.np-btn.active { color: var(--green) }`).
- [ ] **Step 3 (theme):** add `.np-btn.active`/dim states + any sizing for the new buttons. Keep the bar layout balanced.
- [ ] **Step 4:** `pnpm check` green. Commit `feat(queue): lucide transport icons + shuffle/repeat/queue controls` + push.

---

### Task 4: Renderer — QueueDrawer (list + DnD reorder + remove + clear)

**Files:** new `ui/QueueDrawer.tsx`, `ui/App.tsx` or shell (mount the drawer + open state), `ui/theme.css`

- [ ] **Step 1 (drawer state):** hold `queueOpen` boolean in the signed-in app tree (e.g. in `App.tsx`'s `Inner`, or a small context); the Now Playing bar's Queue button toggles it. Render `<QueueDrawer open={queueOpen} onClose=... />` alongside `Shell`/`NowPlayingBar`.
- [ ] **Step 2 (QueueDrawer):** a right-side overlay panel (slide-in; `position:fixed` right, full height above the now-playing bar). Reads `usePlayer()`. Header: "Queue" + **Clear** (`clearQueue`). **Now playing**: `queue.tracks[queue.index]`. **Next up**: `queue.tracks.slice(index+1)` — each row: drag handle, art, title/artist, remove (✕ → `removeFromQueue(actualIndex)`), click row → `jumpTo(actualIndex)`. Compute `actualIndex = index + 1 + i`. For very large queues, render at most ~100 upcoming rows + a "+N more" line (DnD + virtualization don't mix; reordering far down is rare).
- [ ] **Step 3 (HTML5 drag-reorder):** rows are `draggable`; `onDragStart` stores the dragged actualIndex (e.g. in a ref); `onDragOver` (preventDefault) shows a drop indicator; `onDrop` computes the target actualIndex → `moveInQueue(from, to)`. Keep it accessible-ish (the drag handle is the affordance). Use stable React keys (`${track.id}-${actualIndex}`).
- [ ] **Step 4 (theme):** `.queue-drawer` (fixed, right, width ~320px, `var(--panel)`, slide transition, above the now-playing bar), `.queue-row`, drag-over indicator, handle, remove button — all lucide icons (`GripVertical` handle, `X` remove). No emoji.
- [ ] **Step 5:** `pnpm check` green. Manual: drawer opens, shows now-playing + upcoming, drag reorders, remove works, clear empties upcoming. Commit `feat(queue): right-side QueueDrawer with drag reorder + remove + clear` + push.

---

### Task 5: Renderer (+ maybe main) — enqueue surfaces (Play next / Add to queue)

**Files:** `ui/TrackContextMenu.tsx`, `ui/views/AlbumDetailView.tsx`, `ui/views/ArtistDetailView.tsx`, possibly `plex-gateway.ts`/IPC for artist tracks

- [ ] **Step 1 (track context menu):** add **Play next** (`enqueueNext([track])`) and **Add to queue** (`enqueueEnd([track])`) items to `TrackContextMenu` (above or below "Add to playlist"; with lucide icons, e.g. `ListPlus`/`ListEnd` or `CornerUpRight`). These appear wherever the menu is used (album/search/playlist/tracks).
- [ ] **Step 2 (album enqueue):** in `AlbumDetailView`, add "Play next" / "Add to queue" actions (a small `⋯`/`MoreHorizontal` menu next to the play button) that enqueue the album's loaded tracks (`enqueueNext(tracks)` / `enqueueEnd(tracks)`).
- [ ] **Step 3 (artist enqueue):** in `ArtistDetailView`, add the same actions for **all the artist's tracks**. Implement an artist-tracks fetch:
  - **Verify the cheapest path via context7/types:** a section search filtered by artist (`searchTracks` with an artist filter) vs flattening the artist's albums→tracks. Prefer the filtered search if `@ctrl/plex` supports it cleanly; else flatten (fetch `listAlbums(artist)` then each album's `listTracks`, concatenate).
  - Add a gateway method `listArtistTracks(library, artistId, token): Promise<Track[]>` (+ decorator passthrough or cache, + IPC channel + preload + handler with art baking) OR do the flatten in the renderer using existing IPC calls. Pick the simpler correct option; document it. (A deliberate "queue artist" action tolerates a brief load.)
- [ ] **Step 4:** `pnpm check` green. Commit `feat(queue): Play next / Add to queue for tracks, albums, artists` + push.

---

### Task 6: Verification

- [ ] **Step 1:** `pnpm check` — full green.
- [ ] **Step 2 (manual smoke, dev):**
  1. Transport row shows lucide icons (no emoji), incl. shuffle + repeat + queue.
  2. Play an album → Queue drawer shows Now playing + upcoming; the next tracks are listed.
  3. **Play next / Add to queue** from a track ⋯, an album, and an artist → drawer reflects the additions in the right spot.
  4. **Drag-reorder** a queue row; **remove** a row; **Clear** empties upcoming (current keeps playing).
  5. **Shuffle** on → upcoming randomizes, current keeps playing; off → original order restored.
  6. **Repeat** cycles Off → All → One: All loops the queue at the end; One loops the current track; icon reflects mode. Gapless still works across normal advances.
  7. Click a drawer row → jumps to it.
- [ ] **Step 3:** note any non-obvious detail in `CLAUDE.md` (e.g. the artist-tracks approach) if useful for future sessions.

---

## Self-Review

- **Coverage:** queue ops (enqueue next/end, remove, move, clear, jump) — T2/T3/T4; shuffle (random + restore) — T2; repeat (none/all/one + lookahead) — T2; drawer w/ DnD — T4; transport controls in lucide — T3; enqueue song/album/artist — T5. RNG injected for deterministic shuffle tests — T2.
- **Type consistency:** `RepeatMode`/`Queue` fields flow core→player→UI; `computeNext` centralizes next-index logic used by preload/end/advance; player API names match across store/NowPlayingBar/QueueDrawer/menus.
- **Risks (verify at impl):** shuffle restore reconciliation with mid-shuffle edits (covered by a T2 test); repeat-one × gapless preload (T2 test asserts preload target); artist-tracks fetch path (T5 context7 check); DnD + large queues (bounded-window render). Existing `Queue` object literals across the codebase must gain the new fields (T1 Step 3).
