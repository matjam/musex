# Desktop Renderer Implementation Plan (Slice 1, Plan C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Build the `@musex/desktop` **renderer** — the React UI (sign-in, library browse: artists → albums → tracks, persistent Now Playing bar) and the **Gapless-5 / hls.js `PlaybackEngine` adapter** — wired to the core `PlaybackSession` and the IPC backend from Plan B, delivering real **gapless playback** of the user's Plex library. This completes slice 1.

**Architecture:** The renderer hosts the one piece of core that must live there — `PlaybackSession` — wired to a renderer `PlaybackEngine` adapter (Gapless-5 for direct-play, hls.js for transcode) and an **IPC-backed `StreamResolver`** (`window.musex.resolveStream`). All catalog/auth data comes from main via `window.musex.*` (Plan B). React state: a `PlayerProvider` owns the session and exposes its state via `useSyncExternalStore`; an `AppProvider` owns auth + active library + browse navigation.

**Tech Stack:** React 19, `@regosen/gapless-5` ^1.6, `hls.js` ^1.6 (bundled into the renderer by Vite). Visuals follow the three approved mockups (sign-in; album-detail/track-list; Now Playing bar) under `.superpowers/brainstorm/`.

**Conventions (`CLAUDE.md`):** commit directly to `main`; `git add -A`; push after every commit; `pnpm check` green before push; TDD for pure logic; no silently swallowed errors. Verify dep versions (`npm view`) before install.

**Reality of this plan:** most of the renderer is React + audio that can't be meaningfully unit-tested without a DOM + real audio, so it is verified by **manual end-to-end testing on the running app** (the user runs `electron-vite dev`). Pure logic (duration formatting, the engine's queue-window bookkeeping where extractable) is TDD'd. The **audio engine (C2) is the intricate, bug-prone part** — expect to iterate it on the running app.

---

## File Structure (under `packages/desktop/src/renderer/src/`)

```
util/format.ts                 # formatDuration(ms) -> "m:ss"  (+ .test.ts)
audio/ipc-stream-resolver.ts   # StreamResolver via window.musex.resolveStream
audio/playback-engine.ts       # PlaybackEngine: Gapless-5 (direct) + hls.js (transcode)
state/player.tsx               # PlayerProvider + usePlayer/usePlaybackState (owns PlaybackSession)
state/app.tsx                  # AppProvider + useApp (auth, active library, browse nav)
ui/theme.css                   # design tokens + shared classes from the mockups
ui/SignIn.tsx                  # sign-in screen (mockup 1)
ui/Shell.tsx                   # sidebar + content frame
ui/NowPlayingBar.tsx           # bottom transport bar (mockup 2/3)
ui/views/AlbumsView.tsx        # album grid (approved shell mockup)
ui/views/ArtistsView.tsx       # artists list
ui/views/AlbumDetailView.tsx   # album header + track list (mockup 2)
App.tsx                        # auth gate -> Shell(view) + NowPlayingBar
main.tsx                       # mounts <App/> (replaces the Plan B stub)
```

---

## Task C1: Pure helpers — duration format + IPC StreamResolver

**Files:** `util/format.ts`(+test), `audio/ipc-stream-resolver.ts`.

- [ ] **Step 1: Failing test `util/format.test.ts`**
```ts
import { describe, expect, it } from "vitest";
import { formatDuration } from "./format";

describe("formatDuration", () => {
  it("formats ms as m:ss", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(9000)).toBe("0:09");
    expect(formatDuration(75000)).toBe("1:15");
    expect(formatDuration(254000)).toBe("4:14");
  });
  it("handles hours as h:mm:ss", () => {
    expect(formatDuration(3_661_000)).toBe("1:01:01");
  });
  it("clamps negatives/NaN to 0:00", () => {
    expect(formatDuration(-5)).toBe("0:00");
    expect(formatDuration(Number.NaN)).toBe("0:00");
  });
});
```
> The desktop `vitest.config.ts` includes `src/logic`/`src/shared`. Add `src/renderer/src/util` to its `include` globs so this test runs (e.g. add `"src/renderer/src/**/*.test.ts"`), but keep `environment: "node"` — `formatDuration` is pure. (UI components are NOT unit-tested.)

- [ ] **Step 2:** `pnpm --filter @musex/desktop test` → FAIL.

- [ ] **Step 3: Implement `util/format.ts`**
```ts
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}
```

- [ ] **Step 4:** `pnpm --filter @musex/desktop test` → PASS.

- [ ] **Step 5: `audio/ipc-stream-resolver.ts`** — core `StreamResolver` over IPC:
```ts
import type { StreamResolver, StreamRef, Track } from "@musex/core";

/** Resolves a track to a musex-stream:// URL by asking main (which holds the token). */
export class IpcStreamResolver implements StreamResolver {
  async resolve(track: Track): Promise<StreamRef> {
    return window.musex.resolveStream(track);
  }
}
```

- [ ] **Step 6: Commit.**
```bash
git add -A && git commit -m "renderer: duration format util (tested) + IPC StreamResolver"
git push origin main
```

---

## Task C2: PlaybackEngine adapter (Gapless-5 + hls.js) — the audio engine

**Files:** `audio/playback-engine.ts`.

This implements the core `PlaybackEngine` port. **Direct** tracks play through Gapless-5 (true gapless via a current+next window); **hls** (transcode) tracks play through an `HTMLAudioElement` + hls.js (no gapless — expected). The session drives it via `load`/`preload`/transport and consumes `onPosition`/`onAdvanced`/`onEnded`/`onError`.

- [ ] **Step 1: Implement `audio/playback-engine.ts`**
```ts
import Gapless5 from "@regosen/gapless-5";
import Hls from "hls.js";
import type { PlaybackEngine, StreamRef } from "@musex/core";

type Cb0 = () => void;

export class WebPlaybackEngine implements PlaybackEngine {
  private gapless: Gapless5 | null = null;
  private audio: HTMLAudioElement | null = null;
  private hls: Hls | null = null;
  private mode: "direct" | "hls" | null = null;

  private positionCb: (s: number) => void = () => {};
  private advancedCb: Cb0 = () => {};
  private endedCb: Cb0 = () => {};
  private errorCb: (e: Error) => void = () => {};
  private volume = 1;

  // --- core PlaybackEngine ---

  async load(ref: StreamRef): Promise<void> {
    if (ref.kind === "direct") {
      this.teardownHls();
      const g = this.ensureGapless();
      g.removeAllTracks();
      g.addTrack(ref.url);
      g.gotoTrack(0, true); // play from start
      this.mode = "direct";
    } else {
      this.teardownGaplessPlayback();
      await this.loadHls(ref.url);
      this.mode = "hls";
    }
  }

  async preload(ref: StreamRef): Promise<void> {
    // Gapless only applies to direct tracks queued behind a direct current track.
    if (ref.kind === "direct" && this.mode === "direct" && this.gapless) {
      this.gapless.addTrack(ref.url); // buffered ahead; loadLimit bounds memory
    }
    // For hls next-tracks there is no gapless preload; the session's onEnded
    // fallback will load() the next track when the current one finishes.
  }

  play(): void {
    if (this.mode === "hls") void this.audio?.play();
    else this.gapless?.play();
  }
  pause(): void {
    if (this.mode === "hls") this.audio?.pause();
    else this.gapless?.pause();
  }
  seek(seconds: number): void {
    if (this.mode === "hls") {
      if (this.audio) this.audio.currentTime = seconds;
    } else {
      this.gapless?.setPosition(seconds * 1000); // gapless-5 uses ms
    }
  }
  setVolume(v: number): void {
    this.volume = v;
    this.gapless?.setVolume(v);
    if (this.audio) this.audio.volume = v;
  }

  onPosition(cb: (s: number) => void): void {
    this.positionCb = cb;
  }
  onAdvanced(cb: Cb0): void {
    this.advancedCb = cb;
  }
  onEnded(cb: Cb0): void {
    this.endedCb = cb;
  }
  onError(cb: (e: Error) => void): void {
    this.errorCb = cb;
  }

  // --- gapless-5 wiring ---

  private ensureGapless(): Gapless5 {
    if (this.gapless) return this.gapless;
    const g = new Gapless5({ useWebAudio: true, useHTML5Audio: true, loadLimit: 3, volume: this.volume });
    // ms -> seconds for the session
    g.ontimeupdate = (ms: number) => this.positionCb(ms / 1000);
    // onnext fires on gapless auto-advance into the preloaded track -> tell the session
    g.onnext = () => this.advancedCb();
    // onfinishedall fires only at the true end of the gapless list
    g.onfinishedall = () => this.endedCb();
    g.onerror = (_path: string, err?: Error | string) =>
      this.errorCb(err instanceof Error ? err : new Error(String(err ?? "audio error")));
    this.gapless = g;
    return g;
  }

  // --- hls.js wiring ---

  private async loadHls(url: string): Promise<void> {
    const audio = this.ensureAudio();
    const hls = new Hls({ enableWorker: true });
    this.hls = hls;
    await new Promise<void>((resolve, reject) => {
      hls.on(Hls.Events.MANIFEST_PARSED, () => resolve());
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) reject(new Error(`hls: ${data.details}`));
      });
      hls.attachMedia(audio);
      hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(url));
    }).catch((e: Error) => this.errorCb(e));
    void audio.play();
  }

  private ensureAudio(): HTMLAudioElement {
    if (this.audio) return this.audio;
    const a = new Audio();
    a.volume = this.volume;
    a.addEventListener("timeupdate", () => this.positionCb(a.currentTime));
    a.addEventListener("ended", () => this.endedCb());
    a.addEventListener("error", () => this.errorCb(new Error("audio element error")));
    this.audio = a;
    return a;
  }

  private teardownHls(): void {
    this.hls?.destroy();
    this.hls = null;
    this.audio?.pause();
  }
  private teardownGaplessPlayback(): void {
    this.gapless?.stop();
  }
}
```
> **Window/seek note:** during continuous gapless playback the Gapless-5 list grows by one per auto-advance, but `loadLimit: 3` bounds how many are *buffered* in memory; any manual skip goes through `load()` which `removeAllTracks()` and resets the list, so growth is bounded in practice. The session's index and Gapless-5's index both advance by one on each `onnext`/`onAdvanced`, staying in sync for `seek`/position.

- [ ] **Step 2: Typecheck.** `pnpm --filter @musex/desktop typecheck`. Adjust any Gapless-5/hls.js type names to the installed `.d.ts` (e.g. exact callback property names `ontimeupdate`/`onnext`/`onfinishedall`/`onerror` — verified in research but confirm against `@regosen/gapless-5`'s `types/gapless5.d.ts`). If a name differs, follow the installed types and report it.

- [ ] **Step 3: Commit.**
```bash
git add -A && git commit -m "renderer: Gapless-5 + hls.js PlaybackEngine adapter"
git push origin main
```
> No unit test: this needs real audio + DOM. It is validated in C6's manual end-to-end (play a track, hear a gapless transition between two album tracks, seek, volume).

---

## Task C3: State — PlayerProvider + AppProvider

**Files:** `state/player.tsx`, `state/app.tsx`.

- [ ] **Step 1: `state/player.tsx`** — owns the core `PlaybackSession` (engine + resolver), exposes its state to React:
```tsx
import { PlaybackSession, type PlaybackState, buildQueue, type Track } from "@musex/core";
import { createContext, useContext, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import { WebPlaybackEngine } from "../audio/playback-engine";
import { IpcStreamResolver } from "../audio/ipc-stream-resolver";

interface PlayerApi {
  state: PlaybackState;
  playAlbum(tracks: Track[], startIndex: number): void;
  togglePlay(): void;
  next(): void;
  previous(): void;
  seek(sec: number): void;
  setVolume(v: number): void;
}

const Ctx = createContext<PlayerApi | null>(null);

export function PlayerProvider({ children }: { children: ReactNode }) {
  const session = useMemo(() => new PlaybackSession(new WebPlaybackEngine(), new IpcStreamResolver()), []);
  const stateRef = useRef(session.getState());

  const subscribe = (cb: () => void) =>
    session.subscribe((s) => {
      stateRef.current = s;
      cb();
    });
  const state = useSyncExternalStore(subscribe, () => stateRef.current);

  const api: PlayerApi = {
    state,
    playAlbum: (tracks, startIndex) => void session.loadQueue(buildQueue(tracks, startIndex)),
    togglePlay: () => (state.status === "playing" ? session.pause() : session.play()),
    next: () => void session.next(),
    previous: () => void session.previous(),
    seek: (sec) => session.seek(sec),
    setVolume: (v) => session.setVolume(v),
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function usePlayer(): PlayerApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlayer must be used within PlayerProvider");
  return v;
}
```
> Persist volume: on `setVolume`, also call `window.musex.setVolume(v)`; initialize from `window.musex.getVolume()` on mount (a `useEffect`). Keep it simple — wire this in if straightforward, else defer to a later spec.

- [ ] **Step 2: `state/app.tsx`** — auth + active library + browse navigation (a small reducer):
```tsx
import type { Album, Artist, Library } from "@musex/core";
import { createContext, useContext, useReducer, type ReactNode } from "react";

type AuthState = "signed-out" | "signing-in" | "signed-in";
export type View =
  | { name: "albums" }
  | { name: "artists" }
  | { name: "album"; album: Album }
  | { name: "artist"; artist: Artist };

interface AppState {
  auth: AuthState;
  signInCode: string | null;
  library: Library | null;
  view: View;
}
type Action =
  | { type: "signing-in"; code: string }
  | { type: "signed-in"; library: Library }
  | { type: "navigate"; view: View };

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case "signing-in":
      return { ...s, auth: "signing-in", signInCode: a.code };
    case "signed-in":
      return { ...s, auth: "signed-in", library: a.library, signInCode: null, view: { name: "albums" } };
    case "navigate":
      return { ...s, view: a.view };
  }
}

interface AppApi extends AppState {
  dispatch: React.Dispatch<Action>;
}
const Ctx = createContext<AppApi | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    auth: "signed-out",
    signInCode: null,
    library: null,
    view: { name: "albums" },
  });
  return <Ctx.Provider value={{ ...state, dispatch }}>{children}</Ctx.Provider>;
}

export function useApp(): AppApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used within AppProvider");
  return v;
}
```

- [ ] **Step 3: Typecheck + commit.**
```bash
git add -A && git commit -m "renderer: PlayerProvider (hosts PlaybackSession) and AppProvider"
git push origin main
```

---

## Task C4: Theme + sign-in + shell

**Files:** `ui/theme.css`, `ui/SignIn.tsx`, `ui/Shell.tsx`. Build to match the **approved mockups** (sign-in mockup; shell = sidebar + content). Use the design tokens below (from the mockups).

- [ ] **Step 1: `ui/theme.css`** — tokens + shared classes:
```css
:root {
  --bg: #0d0e12; --panel: #16181f; --panel-2: #21242d; --sidebar: #0a0b0e;
  --text: #e7e9ee; --muted: rgba(231,233,238,.5); --line: rgba(255,255,255,.07);
  --green: #54d2a0; --purple: #7c5cff;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font-family: system-ui, -apple-system, sans-serif; }
.brand { font-weight: 800; }
.brand span { background: linear-gradient(90deg, var(--green), var(--purple)); -webkit-background-clip: text; background-clip: text; color: transparent; }
/* ...plus the classes used by SignIn/Shell/NowPlayingBar/views, ported from the mockups... */
```
> Port the specific classes from the three mockup HTML files (`.superpowers/brainstorm/75253-*/content/{signin,album-detail}.html`) into this stylesheet so components stay clean. The mockups are the visual source of truth.

- [ ] **Step 2: `ui/SignIn.tsx`** — matches the sign-in mockup; drives the real flow via `window.musex` + `useApp`:
```tsx
import { useApp } from "../state/app";
import { discoverMusicLibraries } from "@musex/core";

export function SignIn() {
  const { auth, signInCode, dispatch } = useApp();

  async function start() {
    const { code } = await window.musex.signInStart(); // main opens the browser
    dispatch({ type: "signing-in", code });
    for (let i = 0; i < 150; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const res = await window.musex.signInPoll();
      if (res.status === "ok") break;
      if (res.status === "error") return; // surface res.message in UI
      if (i === 149) return;
    }
    const { libraries } = await window.musex.discoverLibraries();
    const lib = libraries[0];
    if (!lib) return; // show "no music library found"
    await window.musex.selectLibrary(lib.id);
    dispatch({ type: "signed-in", library: lib });
  }

  // Render the mockup's initial + waiting states based on `auth`/`signInCode`,
  // with a button calling start(). (discoverMusicLibraries import is only needed
  // if discovery runs in the renderer; here main exposes discoverLibraries via IPC.)
  return /* JSX matching the sign-in mockup */;
}
```
> Slice-1 simplification (matches confirmed assumption): auto-select the first music library. A picker for multiple libraries is a later spec. Remove the unused `discoverMusicLibraries` import if discovery stays in main (it does).

- [ ] **Step 3: `ui/Shell.tsx`** — sidebar (Albums/Artists/Tracks nav + library switcher) + content slot, per the shell mockup. Nav items dispatch `navigate`. Tracks/Home/Search are present but `dim` (later specs).

- [ ] **Step 4: Typecheck + commit.**
```bash
git add -A && git commit -m "renderer: theme, sign-in screen, app shell"
git push origin main
```

---

## Task C5: Browse views + Now Playing bar

**Files:** `ui/views/AlbumsView.tsx`, `ui/views/ArtistsView.tsx`, `ui/views/AlbumDetailView.tsx`, `ui/NowPlayingBar.tsx`. All fetch via `window.musex.*` and render per the approved mockups; playback via `usePlayer`.

- [ ] **Step 1: `AlbumsView.tsx`** — on mount, `window.musex.listArtists(libraryId)` then per-artist `listAlbums`… **slice-1 simplification:** the approved shell shows an albums grid. Since the gateway browses artist→album, AlbumsView lists artists' albums by first loading artists then their albums, OR (simpler) the Artists view is primary. **Decision:** make **ArtistsView** the default landing (artists list), since the gateway is artist-centric; AlbumDetail is reached via artist → album. Keep AlbumsView as a flat grid built by flattening `listAlbums` across artists only if cheap; otherwise mark Albums nav `dim` for slice 1 and land on Artists. (Confirm during implementation based on how heavy flattening is; do not silently ship a slow all-albums fetch.)

- [ ] **Step 2: `ArtistsView.tsx`** — `window.musex.listArtists(libraryId)` → grid/list of artists (reuse the grid styling); click → `navigate({name:'artist', artist})`.

- [ ] **Step 3: `ArtistDetail`** (within ArtistsView or its own) — `listAlbums(libraryId, artistId)` → album grid; click album → `navigate({name:'album', album})`.

- [ ] **Step 4: `AlbumDetailView.tsx`** — matches the album-detail mockup: header (art, title, artist, year/song-count via `formatDuration` totals) + Play button + track list (`listTracks(libraryId, albumId)`). Clicking the Play button or a row calls `usePlayer().playAlbum(tracks, index)`. Highlight the currently-playing track by comparing `usePlayer().state.queue?.tracks[index].id`.

- [ ] **Step 5: `NowPlayingBar.tsx`** — matches the bar in the mockups, driven by `usePlayer().state`: art + title + "artist · album", transport (prev / play-pause / next), a seek bar (`positionSec`/`durationSec`, click-to-seek calling `seek`), times via `formatDuration`, volume slider (`setVolume`). Hidden/empty when `state.queue` is null.

- [ ] **Step 6: Typecheck + commit.**
```bash
git add -A && git commit -m "renderer: browse views (artists/albums/album-detail) + Now Playing bar"
git push origin main
```

---

## Task C6: Wire App + end-to-end

**Files:** `App.tsx`, `main.tsx` (replace the Plan B stub).

- [ ] **Step 1: `App.tsx`**
```tsx
import { AppProvider, useApp } from "./state/app";
import { PlayerProvider } from "./state/player";
import { SignIn } from "./ui/SignIn";
import { Shell } from "./ui/Shell";
import { NowPlayingBar } from "./ui/NowPlayingBar";
import "./ui/theme.css";

function Inner() {
  const { auth } = useApp();
  if (auth !== "signed-in") return <SignIn />;
  return (
    <>
      <Shell />
      <NowPlayingBar />
    </>
  );
}
export function App() {
  return (
    <AppProvider>
      <PlayerProvider>
        <Inner />
      </PlayerProvider>
    </AppProvider>
  );
}
```

- [ ] **Step 2: `main.tsx`** — mount `<App/>` (replace the stub):
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 3: Verify build + lint.** `pnpm --filter @musex/desktop typecheck`, `pnpm exec biome check --write .`, `pnpm check` (all unit tests + typechecks green), `pnpm --filter @musex/desktop build`.

- [ ] **Step 4: Commit.**
```bash
git add -A && git commit -m "renderer: wire App (auth gate -> shell + now playing); real UI"
git push origin main
```

- [ ] **Step 5: MANUAL end-to-end (user runs `pnpm --filter @musex/desktop dev`):**
  1. **Sign in** → browser opens → approve → land in the library (Artists).
  2. **Browse** an artist → an album → see its track list (validates `listAlbums`/`listTracks` + mapping at runtime — previously untested).
  3. **Play** a track → audio plays from the `musex-stream://` proxy (validates the stream proxy + Range at runtime).
  4. **Gapless**: let a track play to its end → it should flow into the next album track with **no gap** (validates Gapless-5 + `onAdvanced` end to end).
  5. **Transport**: pause/play, next/previous, **seek** (click the bar), **volume**.
  6. If a track is a transcode-only codec, confirm it still plays (hls.js path), accepting a gap at that boundary.
  Report any failures with the on-screen state + terminal/devtools console output.

---

## Done criteria (Plan C → slice 1 complete)

- `pnpm check` green; `electron-vite build` clean.
- Manual: sign in → browse artists/albums/tracks → play → **gapless transition between consecutive direct tracks** → seek/volume/next/prev all work against the real Plex library.
- Token never enters the renderer; audio flows via `musex-stream://`.

## Known risks / iterate-on-running-app

1. **Gapless-5 window/index sync (C2)** — the current+next model and keeping the session index aligned with Gapless-5's on auto-advance is the most likely place for bugs (double-advance, wrong track highlighted, seek drift). Test the auto-advance path explicitly; if it misbehaves, the fix is contained to `playback-engine.ts` + possibly `PlaybackSession.handleAdvanced`.
2. **Gapless-5 / hls.js exact type + callback names** — confirm against installed `.d.ts` (C2 Step 2).
3. **Transcode HLS through `musex-stream://`** — relative segment resolution is preserved by the path-based scheme, but only proven when a transcode-codec track is played (step 6). Direct-play is the priority.
4. **Browse landing (C5)** — artist-centric gateway vs an all-albums grid; land on Artists for slice 1 if flattening all albums is too heavy. Don't ship a slow all-albums fetch silently.
5. **React StrictMode double-invoke** — `PlayerProvider`'s `useMemo` session is created once; confirm StrictMode's double-render in dev doesn't create two engines/sessions (if it does, guard with a module-level ref or accept dev-only). 
```
