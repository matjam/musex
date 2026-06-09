# Playback State Persistence + Always-Visible Transport Bar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Persist the playback context (queue, current index, position-in-track, shuffle, repeat) across app restarts and restore it **paused at the saved position** on launch; make the bottom transport bar always visible, with transport controls greyed/disabled when nothing is queued.

**Architecture:** The renderer-hosted `PlaybackSession` (core) gains a `restore()` method. The renderer's `WebPlaybackEngine.load()` becomes *prepare-only* (no auto-play; `playIndex` already calls `play()` after), so restore can load → seek → stay paused with no audio blip. Persistence lives in `main` (electron-store) split across **two files**: a big `playback-queue` (tracks, written only on list change) and a tiny `playback-cursor` (index/position/shuffle/repeat, written throttled). `Track.thumb` is a baked proxy URL embedding the per-launch secret, so the IPC boundary normalizes thumbs to their raw Plex path on save and re-bakes them with the current secret on load.

**Tech Stack:** Electron main (electron-store), React 19 renderer, core TS (no Node/DOM), TS 6, Biome 2.

**Conventions:** core has NO Node/DOM/console; `import type`; main/shared use `.js` import suffixes, renderer no suffix; lucide-only icons; `noUncheckedIndexedAccess`. `git add -A`; commit to `main`; push each commit; each task ends GREEN on `pnpm check` (typecheck both packages + tests + Biome).

**Verified facts:**
- `PlaybackSession.playIndex` (core) calls `engine.load(ref)` then `engine.play()` — so making `load()` prepare-only does not change normal playback.
- `WebPlaybackEngine.load()` currently calls `this.current.play()`; `loadHls()` ends with `void this.current.play()`. The gapless swap in `handleCurrentEnded()` calls `current.play()` directly (independent of `load`).
- `Track.thumb` is `http://127.0.0.1:<port>/<secret>/<serverId><plexPath>` (baked by `StreamProxy.artUrl`/`mediaUrl`). Stream URLs are NOT stored on the Track — they're re-resolved per play, so they survive restart fine.
- `persistence.ts` uses `new Store<PersistedState>({ defaults })`. electron-store supports multiple instances via `{ name }` → separate JSON files.
- `rt.ensureProxyEndpoint(serverId)` registers a server's proxy endpoint (needed so the proxy can fetch art/audio for that server).
- Core `Queue = { tracks: Track[]; index: number; shuffle: boolean; repeat: RepeatMode }`. `RepeatMode = "none" | "all" | "one"`.

---

### Task 1: Core — `PlaybackSession.restore()` + port doc

**Files:**
- Modify: `packages/core/src/playback/playback-session.ts`
- Modify: `packages/core/src/ports/playback-engine.ts` (doc only)
- Test: `packages/core/src/playback/playback-session.test.ts`

- [ ] **Step 1: Document the prepare-only `load` contract.** In `ports/playback-engine.ts`, update the `load` doc comment to state: `load()` prepares the track but does NOT start playback; the caller invokes `play()` to start. (`preload` buffers the next track; `play`/`pause` control playback.)

- [ ] **Step 2: Write failing tests** in `playback-session.test.ts` using `FakePlaybackEngine`, `FakeStreamResolver`, `makeTrack`, `buildQueue`:

```ts
it("restore() loads the current track paused at the saved position, no autoplay", async () => {
  const engine = new FakePlaybackEngine();
  const resolver = new FakeStreamResolver();
  const session = new PlaybackSession(engine, resolver);
  const tracks = [makeTrack("a"), makeTrack("b"), makeTrack("c")];
  const queue = { tracks, index: 1, shuffle: false, repeat: "none" as const };

  await session.restore(queue, 42);

  const s = session.getState();
  expect(s.status).toBe("paused");
  expect(s.queue?.index).toBe(1);
  expect(s.positionSec).toBe(42);
  expect(engine.loaded.at(-1)?.url).toBe("fake://stream/b");
  expect(engine.seekCalls).toContain(42);
  expect(engine.playCalls).toBe(0); // never auto-plays
  expect(engine.preloaded.at(-1)?.url).toBe("fake://stream/c"); // preloads next
});

it("restore() clamps an out-of-bounds index", async () => {
  const engine = new FakePlaybackEngine();
  const session = new PlaybackSession(engine, new FakeStreamResolver());
  const tracks = [makeTrack("a"), makeTrack("b")];
  await session.restore({ tracks, index: 99, shuffle: false, repeat: "none" }, 0);
  expect(session.getState().queue?.index).toBe(1);
  expect(engine.loaded.at(-1)?.url).toBe("fake://stream/b");
});

it("restore() is a no-op for an empty queue", async () => {
  const engine = new FakePlaybackEngine();
  const session = new PlaybackSession(engine, new FakeStreamResolver());
  await session.restore({ tracks: [], index: 0, shuffle: false, repeat: "none" }, 0);
  expect(session.getState().queue).toBeNull();
  expect(engine.loaded).toHaveLength(0);
});
```

Run: `pnpm --filter @musex/core test` → FAIL (restore not defined).

- [ ] **Step 3: Implement `restore`** in `PlaybackSession` (place after `loadQueue`):

```ts
/** Restore a previously-persisted queue, paused at `positionSec`, without
 *  auto-playing (load() is prepare-only). Loads the current track, seeks to the
 *  saved position, leaves status "paused", and preloads the next track.
 *  We do not persist the pre-shuffle order, so a restored shuffled queue treats
 *  its current order as the base (unshuffled = null). */
async restore(queue: Queue, positionSec: number): Promise<void> {
  if (queue.tracks.length === 0) return;
  const index = Math.min(Math.max(queue.index, 0), queue.tracks.length - 1);
  const track = queue.tracks[index];
  if (!track) return;
  this.unshuffled = null;
  const token = ++this.loadToken;
  this.preloadedIndex = null;
  this.patch({
    queue: { ...queue, index },
    status: "paused",
    positionSec,
    durationSec: track.durationMs / 1000,
    error: null,
  });
  const ref = await this.resolver.resolve(track);
  if (token !== this.loadToken) return;
  await this.engine.load(ref);
  if (token !== this.loadToken) return;
  this.engine.seek(positionSec);
  this.patch({ status: "paused", positionSec });
  await this.preloadNext();
}
```

- [ ] **Step 4:** Run `pnpm --filter @musex/core test` → PASS. Then `pnpm check` → GREEN.

- [ ] **Step 5: Commit** `feat(core): PlaybackSession.restore() — resume a saved queue paused at position` + push.

---

### Task 2: Desktop engine — `load()` prepare-only + robust seek

**Files:**
- Modify: `packages/desktop/src/renderer/src/audio/playback-engine.ts`

> No unit test (the engine wraps real HTML5 `<audio>`); correctness is verified by `pnpm check` + manual playback. **Do not change the gapless swap logic in `handleCurrentEnded` — it must keep calling `current.play()` directly.**

- [ ] **Step 1: Make `load()` prepare-only.** In the `direct` branch, REMOVE `void this.current.play();` (keep `teardownHls()`, `this.mode = "direct"`, `this.clearNext()`, `this.current.src = ref.url`). In `loadHls()`, REMOVE the trailing `void this.current.play();`. Playback is started by `PlaybackSession.playIndex` calling `engine.play()` after `load()`.

- [ ] **Step 2: Add a pending-seek field** near the other fields: `private pendingSeek: number | null = null;`

- [ ] **Step 3: Robust seek** — replace `seek()`:

```ts
seek(seconds: number): void {
  const el = this.current;
  // HAVE_METADATA (1) is the minimum readyState at which currentTime sticks.
  if (el.readyState >= 1) {
    el.currentTime = seconds;
    this.pendingSeek = null;
  } else {
    this.pendingSeek = seconds; // applied on loadedmetadata (see wire())
  }
}
```

- [ ] **Step 4: Apply pending seek on metadata.** In `wire(el)`, add a listener:

```ts
el.addEventListener("loadedmetadata", () => {
  if (el === this.current && this.pendingSeek != null) {
    el.currentTime = this.pendingSeek;
    this.pendingSeek = null;
  }
});
```

Also clear a stale pending seek when a fresh track is loaded: in `load()` (both branches, e.g. right after `this.mode = ...`) set `this.pendingSeek = null;` before setting the new src — EXCEPT restore's `seek()` runs after `load()` returns, so ordering is: `load()` clears pendingSeek, then `playIndex`/`restore` may `seek()` which re-sets it. That's correct.

- [ ] **Step 5:** `pnpm check` → GREEN. Commit `refactor(audio): load() is prepare-only; seek() survives not-yet-loaded media` + push.

---

### Task 3: Main — two-file persistence + art-path parse helper

**Files:**
- Create: `packages/desktop/src/logic/proxy-url.ts`
- Create: `packages/desktop/src/logic/proxy-url.test.ts`
- Modify: `packages/desktop/src/main/adapters/persistence.ts`

- [ ] **Step 1: Pure parse helper + test.** `proxy-url.ts`:

```ts
/** Reverse of StreamProxy.mediaUrl: parse a baked proxy URL
 *  `http://127.0.0.1:<port>/<secret>/<serverId><plexPath>` back to its parts.
 *  Works regardless of which (now-stale) secret/port baked it — it only splits
 *  the path. Returns null if the string isn't a recognizable proxy URL. */
export function parseProxyPath(bakedUrl: string): { serverId: string; plexPath: string } | null {
  let u: URL;
  try {
    u = new URL(bakedUrl);
  } catch {
    return null;
  }
  const segs = u.pathname.replace(/^\//, "").split("/"); // [secret, serverId, ...plexPath]
  if (segs.length < 3) return null;
  const serverId = segs[1];
  if (!serverId) return null;
  const plexPath = `/${segs.slice(2).join("/")}${u.search}`;
  return { serverId, plexPath };
}
```

`proxy-url.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseProxyPath } from "./proxy-url";

describe("parseProxyPath", () => {
  it("parses serverId + plexPath from a baked proxy URL", () => {
    const url = "http://127.0.0.1:51626/deadbeef/srv-1/library/metadata/979/thumb/123";
    expect(parseProxyPath(url)).toEqual({
      serverId: "srv-1",
      plexPath: "/library/metadata/979/thumb/123",
    });
  });
  it("preserves a query string", () => {
    const url = "http://127.0.0.1:9/sec/srv/library/parts/4/file.flac?x=1";
    expect(parseProxyPath(url)).toEqual({ serverId: "srv", plexPath: "/library/parts/4/file.flac?x=1" });
  });
  it("returns null for non-proxy / malformed strings", () => {
    expect(parseProxyPath("/library/metadata/1/thumb/2")).toBeNull();
    expect(parseProxyPath("http://127.0.0.1:9/onlysecret")).toBeNull();
  });
});
```

- [ ] **Step 2: Persistence stores.** In `persistence.ts`, add (after the existing `store`):

```ts
import type { Queue, RepeatMode, Track } from "@musex/core";
// ...
export interface PlaybackCursor {
  index: number;
  positionSec: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

// The big track list lives in its own file so frequent cursor writes never
// rewrite it. Tracks are stored with RAW thumbs (the IPC layer normalizes), so
// no per-launch secret is persisted.
const queueStore = new Store<{ tracks: Track[] | null }>({
  name: "playback-queue",
  defaults: { tracks: null },
});
const cursorStore = new Store<{ cursor: PlaybackCursor | null }>({
  name: "playback-cursor",
  defaults: { cursor: null },
});
```

Add to the `persistence` object:

```ts
  getPlaybackQueue(): Track[] | null {
    return queueStore.get("tracks") ?? null;
  },
  setPlaybackQueue(tracks: Track[]): void {
    queueStore.set("tracks", tracks);
  },
  getPlaybackCursor(): PlaybackCursor | null {
    return cursorStore.get("cursor") ?? null;
  },
  setPlaybackCursor(cursor: PlaybackCursor): void {
    cursorStore.set("cursor", cursor);
  },
```

- [ ] **Step 3:** `pnpm check` → GREEN. Commit `feat(main): persist playback queue + cursor in separate stores; add parseProxyPath` + push.

---

### Task 4: IPC — contract, preload, main handlers (normalize/re-bake)

**Files:**
- Modify: `packages/desktop/src/shared/ipc-contract.ts`
- Modify: `packages/desktop/src/preload/index.ts`
- Modify: `packages/desktop/src/main/ipc.ts`

- [ ] **Step 1: Contract.** Add to `IPC`:
```ts
  savePlaybackQueue: "musex:playback:saveQueue", // (tracks: Track[]) -> void
  savePlaybackCursor: "musex:playback:saveCursor", // (cursor: PlaybackCursor) -> void
  loadPlayback: "musex:playback:load", // -> LoadPlaybackResult | null
```
Add types + import `Queue`, `RepeatMode` from `@musex/core`:
```ts
export type PlaybackCursorDto = {
  index: number;
  positionSec: number;
  shuffle: boolean;
  repeat: RepeatMode;
};
export type LoadPlaybackResult = { queue: Queue; positionSec: number } | null;
```
Add to `MusexApi`:
```ts
  savePlaybackQueue(tracks: Track[]): Promise<void>;
  savePlaybackCursor(cursor: PlaybackCursorDto): Promise<void>;
  loadPlayback(): Promise<LoadPlaybackResult>;
```

- [ ] **Step 2: Preload.** Add to the `api` object:
```ts
  savePlaybackQueue: (tracks) => ipcRenderer.invoke(IPC.savePlaybackQueue, tracks),
  savePlaybackCursor: (cursor) => ipcRenderer.invoke(IPC.savePlaybackCursor, cursor),
  loadPlayback: () => ipcRenderer.invoke(IPC.loadPlayback),
```

- [ ] **Step 3: Main handlers** in `main/ipc.ts`. Import `parseProxyPath` from `../logic/proxy-url.js`, the persistence module, and types. Add:

```ts
  // Persist the queue with thumbs normalized to raw Plex paths (no per-launch
  // secret on disk).
  ipcMain.handle(IPC.savePlaybackQueue, (_e, tracks: Track[]) => {
    const normalized = tracks.map((t) => {
      if (!t.thumb) return t;
      const parsed = parseProxyPath(t.thumb);
      return parsed ? { ...t, thumb: parsed.plexPath } : t;
    });
    persistence.setPlaybackQueue(normalized);
  });

  ipcMain.handle(IPC.savePlaybackCursor, (_e, cursor: PlaybackCursorDto) => {
    persistence.setPlaybackCursor(cursor);
  });

  // Re-bake thumbs with the CURRENT secret/port and ensure the proxy endpoint(s)
  // for the restored server(s), so restored art + the eventual play both work.
  ipcMain.handle(IPC.loadPlayback, async (): Promise<LoadPlaybackResult> => {
    const tracks = persistence.getPlaybackQueue();
    const cursor = persistence.getPlaybackCursor();
    if (!tracks || tracks.length === 0 || !cursor) return null;

    const servers = new Set(tracks.map((t) => t.serverId));
    for (const serverId of servers) {
      try {
        await rt.ensureProxyEndpoint(serverId);
      } catch {
        // best-effort: art/play for an unreachable server degrade, not crash
      }
    }
    const rebaked = tracks.map((t) =>
      t.thumb ? { ...t, thumb: rt.proxy.artUrl(t.serverId, t.thumb) } : t,
    );
    const index = Math.min(Math.max(cursor.index, 0), rebaked.length - 1);
    const queue: Queue = {
      tracks: rebaked,
      index,
      shuffle: cursor.shuffle,
      repeat: cursor.repeat,
    };
    return { queue, positionSec: cursor.positionSec };
  });
```

Confirm the import names used elsewhere in the file: `persistence` (from `./adapters/persistence.js`), `rt` (runtime), `Track`/`Queue` type imports. Match the file's existing import style.

- [ ] **Step 4:** `pnpm check` → GREEN. Commit `feat(ipc): save/load playback state; normalize+re-bake art thumbs at the boundary` + push.

---

### Task 5: Renderer — restore on mount + persist on change; remove debug logs

**Files:**
- Modify: `packages/desktop/src/renderer/src/state/player.tsx`

- [ ] **Step 1: Remove leftover debug logs.** Delete the `console.log("[musex-debug] api.playTracks …")`, `… api.next`, `… api.previous`, `… api.jumpTo …` lines (restore those handlers to their simple one-line `void session.x()` forms).

- [ ] **Step 2: Restore on mount.** Add (alongside the existing volume-init effect). Import `Track`, `RepeatMode` types as needed.

```ts
  // Refs let the save effects skip re-persisting the just-restored state.
  const savedTracksRef = useRef<Track[] | null>(null);
  const savedCursorRef = useRef<{ index: number; shuffle: boolean; repeat: RepeatMode } | null>(null);
  const restoredRef = useRef(false);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    void (async () => {
      const saved = await window.musex.loadPlayback();
      if (!saved) return;
      savedTracksRef.current = saved.queue.tracks;
      savedCursorRef.current = {
        index: saved.queue.index,
        shuffle: saved.queue.shuffle,
        repeat: saved.queue.repeat,
      };
      await session.restore(saved.queue, saved.positionSec);
    })();
  }, [session]);
```

- [ ] **Step 3: Persist the track list when it changes** (reference compare — index-only changes reuse the same array):

```ts
  useEffect(() => {
    const q = state.queue;
    if (!q) return;
    if (q.tracks !== savedTracksRef.current) {
      savedTracksRef.current = q.tracks;
      void window.musex.savePlaybackQueue(q.tracks);
    }
  }, [state.queue]);
```

- [ ] **Step 4: Persist the cursor** — immediately on index/shuffle/repeat change, throttled (~5s) for position-only ticks:

```ts
  const lastCursorSaveRef = useRef(0);
  useEffect(() => {
    const q = state.queue;
    if (!q) return;
    const prev = savedCursorRef.current;
    const cursorChanged =
      prev == null || q.index !== prev.index || q.shuffle !== prev.shuffle || q.repeat !== prev.repeat;
    const now = performance.now();
    if (!cursorChanged && now - lastCursorSaveRef.current < 5000) return;
    savedCursorRef.current = { index: q.index, shuffle: q.shuffle, repeat: q.repeat };
    lastCursorSaveRef.current = now;
    void window.musex.savePlaybackCursor({
      index: q.index,
      positionSec: state.positionSec,
      shuffle: q.shuffle,
      repeat: q.repeat,
    });
  }, [state.queue, state.positionSec]);
```

- [ ] **Step 5:** `pnpm check` → GREEN. Commit `feat(renderer): restore playback on launch; persist queue + cursor on change` + push.

---

### Task 6: UI — always-visible transport bar, greyed when empty

**Files:**
- Modify: `packages/desktop/src/renderer/src/ui/NowPlayingBar.tsx`
- Modify: `packages/desktop/src/renderer/src/ui/theme.css`

- [ ] **Step 1: Always render the bar.** Remove the two early `return <div className="now-playing-bar now-playing-bar--empty" />` blocks. Compute:
```ts
  const track = state.queue ? state.queue.tracks[state.queue.index] : undefined;
  const hasTrack = track !== undefined;
```
Derive `positionMs`/`durationMs`/`progress`/`metaSub`/`shuffle`/`repeat`/`isPlaying` defensively when `!hasTrack` (e.g. `const shuffle = state.queue?.shuffle ?? false;`, `const repeat = state.queue?.repeat ?? "none";`, title/sub blank). The seek handlers already guard on `state.durationSec <= 0`.

- [ ] **Step 2: Disable transport when empty.** Add `disabled={!hasTrack}` to the shuffle, previous, play/pause, next, repeat, and queue buttons. For the seek bar, when `!hasTrack` set `tabIndex={-1}` and `aria-disabled` and skip the click/key handlers (or gate them on `hasTrack`). Keep the volume `<input>` and volume button **enabled** (volume is a real setting independent of a track). Render `<AlbumArt thumb={track?.thumb} className="np-art" />` and `{track?.title ?? ""}` / `{hasTrack ? metaSub : ""}`.

- [ ] **Step 3: CSS** in `theme.css` — add disabled styling consistent with the theme (greyed, no pointer). Example (match existing token vars / colors):
```css
.np-btn:disabled,
.np-playpause:disabled {
  opacity: 0.35;
  cursor: default;
  pointer-events: none;
}
.np-seek-bar[aria-disabled="true"] {
  opacity: 0.4;
  pointer-events: none;
}
```
Keep the existing `.now-playing-bar` layout. The `.now-playing-bar--empty` rule may be left or removed (no longer used). **Do not put `*/` inside any CSS comment** (project gotcha).

- [ ] **Step 4:** `pnpm check` → GREEN. Commit `feat(ui): transport bar always visible; controls greyed when nothing is queued` + push.

---

### Task 7: Verification

- [ ] **Step 1:** `pnpm check` — full green.
- [ ] **Step 2 (manual smoke, dev):**
  1. Play a track from an album / All Songs; let it run a few seconds; toggle shuffle and/or repeat.
  2. `Cmd+Q`, relaunch (`pnpm --filter @musex/desktop dev`). The same track shows in the bar, **paused**, at ~the saved position; shuffle/repeat reflect what you set; pressing play resumes from there; next/prev traverse the restored queue; album art shows (re-baked, not broken).
  3. Launch with no prior session (or first run): the bar is visible with transport **greyed/disabled**; volume still works.
  4. No `[musex-debug]` lines remain in the console.
- [ ] **Step 3:** Update `CLAUDE.md` — (a) replace the stale gapless-5 engine notes with the raw-HTML5 `<audio>` engine (prepare-only `load`, two-element near-gapless, watchdog removed); (b) note `@ctrl/plex` v6 has NO `getStreamURL`; (c) note playback persistence (two stores, thumb normalize/re-bake, restore-paused). Commit + push.

---

## Self-Review

- **Coverage:** persist queue (T3/T4/T5) + cursor incl. position/shuffle/repeat (T4/T5); restore paused at position (T1 core, T5 wiring); engine prepare-only + robust seek so restore doesn't blip and the position sticks (T2); always-visible greyed bar (T6). Thumb-secret staleness handled by normalize-on-save / re-bake-on-load (T3 helper, T4 boundary).
- **Consistency:** reuses electron-store (separate `name`d files), `ensureProxyEndpoint` (as prefetch does), the existing `getVolume`/`setVolume` IPC shape, lucide icons, `import type`. Cursor index clamped in both core (`restore`) and main (`loadPlayback`).
- **Risks:** (1) `load()` prepare-only could regress playback if any caller relied on auto-play — verified only `playIndex` calls `load` and it calls `play()` after; the gapless swap is untouched. Manual smoke (T7) re-confirms playback. (2) Two-file desync (queue saved, cursor not) → index clamp + tolerant restore. (3) Large queue write cost → queue file written only on list-change (reference compare); position writes hit only the tiny cursor file (throttled). (4) Restored art needs the endpoint registered → `loadPlayback` ensures it best-effort.
- **Not persisted (by design):** pre-shuffle original order (would double size); playing/paused status (always restore paused — UX + Chromium autoplay policy).
