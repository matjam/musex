# mpv Playback Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Spec: `docs/superpowers/specs/2026-06-09-mpv-playback-engine-design.md`.

**Goal:** Replace Chromium-decoder playback with a vendored, pinned mpv binary driven from the Electron main process over mpv's JSON IPC, behind the existing core `PlaybackEngine` port. Then delete the transcode/HLS path, `WebPlaybackEngine`, and gapless-5.

**Architecture:** renderer `IpcPlaybackEngine` (implements the port) → IPC → main `MpvController` (spawns vendored mpv, JSON IPC over unix socket) → plays existing proxy URLs. Core `PlaybackSession` untouched.

**Conventions:** main/shared `.js` import suffixes; renderer no suffix; `import type`; `noUncheckedIndexedAccess`; Biome. `git add -A`; commit to `main`; push each commit; every task ends GREEN on `pnpm check`.

**Verified facts (2026-06-09, live-tested — do NOT re-derive from memory):**
- Pin: mpv **v0.41.0**, artifact `mpv-v0.41.0-macos-14-arm.zip` from `https://github.com/mpv-player/mpv/releases/download/v0.41.0/mpv-v0.41.0-macos-14-arm.zip`, sha256 `5c96f9b21355fc0a11d2e2161ad65f33031070e9fb3f6bd9865fb459b94587e6` (43,693,888 bytes).
- Artifact layout: zip contains `mpv.tar.gz`, which contains `mpv.app/`; the binary `mpv.app/Contents/MacOS/mpv` **runs standalone** from any extraction dir (`--version` verified; FFmpeg 8.0.1; `av://lavfi` inputs available).
- JSON IPC (verified against the running binary): newline-delimited JSON on `--input-ipc-server=<sock>`.
  - `{"command":["loadfile",URL,"replace","-1",{"pause":"yes","start":"0.3"}],"request_id":N}` loads **paused at 0.3s** (note the 4th arg `-1` playlist-index before the options object — required in this mpv version). Response: `{"data":{"playlist_entry_id":1},"request_id":N,"error":"success"}`.
  - `observe_property` (`time-pos`, `pause`) → `{"event":"property-change","id":…,"name":"time-pos","data":0.31}` ticks ~every 64ms; `data` ABSENT (undefined) when no file.
  - `{"command":["set_property","pause",false]}` starts playback.
  - Track end: `{"event":"end-file","reason":"eof","playlist_entry_id":1}` then `{"event":"idle"}` when nothing queued. `start-file` fires with `playlist_entry_id` whenever a (new or queued) entry begins.
  - Spawn args (verified): `--idle=yes --no-video --no-terminal --no-config --gapless-audio=yes --input-ipc-server=<path>`.
- Wiring: root `package.json` has no `vendor` script yet; desktop `dev` is `electron-vite dev` (pnpm pre/post script semantics are version-dependent — chain explicitly, don't rely on `predev`).

---

### Task 1: Vendor pipeline (`scripts/fetch-mpv.mjs`)

**Files:** Create `scripts/fetch-mpv.mjs`. Modify root `package.json`, `packages/desktop/package.json`, `.gitignore`.

- [ ] **Step 1:** Create `scripts/fetch-mpv.mjs` (root). Behavior: resolve platform key (`darwin-arm64` only for now — exit with a clear error otherwise); if `vendor/mpv/<key>/mpv.app/Contents/MacOS/mpv` already exists, exit 0 silently (idempotent + fast). Otherwise download the pinned URL to a temp file (Node `fetch` + streams), sha256-verify against the committed hash (mismatch = delete + hard fail), extract (`unzip -o -q` then `tar -xzf` of the inner `mpv.tar.gz` — both always present on macOS), move `mpv.app` into place, and sanity-run `<binary> --version` (must exit 0 and print `mpv v0.41.0`). Pin table at the top of the file:

```js
const PINS = {
  "darwin-arm64": {
    url: "https://github.com/mpv-player/mpv/releases/download/v0.41.0/mpv-v0.41.0-macos-14-arm.zip",
    sha256: "5c96f9b21355fc0a11d2e2161ad65f33031070e9fb3f6bd9865fb459b94587e6",
    binaryRelPath: "mpv.app/Contents/MacOS/mpv",
  },
};
```
Use `node:crypto` `createHash("sha256")`, `node:child_process` `execFileSync` for unzip/tar/--version. All paths under `vendor/mpv/<key>/`. No npm deps.

- [ ] **Step 2:** Wire it: root `package.json` scripts add `"vendor": "node scripts/fetch-mpv.mjs"`; desktop `"dev"` becomes `"node ../../scripts/fetch-mpv.mjs && electron-vite dev"` (explicit chain — same vendored binary in dev as packaged). Add `vendor/` to `.gitignore`.

- [ ] **Step 3:** Run `pnpm vendor` — downloads, verifies, extracts, prints the mpv version. Run again — instant no-op. `pnpm check` GREEN.

- [ ] **Step 4:** Commit `feat(vendor): pinned, checksum-verified mpv fetch script (darwin-arm64)` + push.

---

### Task 2: Pure IPC logic (`packages/desktop/src/logic/mpv-ipc.ts` + tests)

**Files:** Create `packages/desktop/src/logic/mpv-ipc.ts`, `packages/desktop/src/logic/mpv-ipc.test.ts`.

TDD. Two pieces, both pure (no socket, no process):

- [ ] **Step 1 (types + command builders + tests first):**

```ts
export type MpvCommand = { command: unknown[]; request_id: number };
export const cmdLoadfile = (id: number, url: string, opts: { startSec?: number }): MpvCommand => ({
  command: ["loadfile", url, "replace", "-1",
    { pause: "yes", ...(opts.startSec != null ? { start: String(opts.startSec) } : {}) }],
  request_id: id,
});
// cmdAppend(id,url) -> ["loadfile",url,"append","-1",{}]
// cmdSetPause(id,bool), cmdSeekAbs(id,sec) -> ["seek",sec,"absolute"],
// cmdSetVolume(id,v01) -> ["set_property","volume",Math.round(v01*100)],
// cmdObserve(id,observeId,prop)
export const encodeLine = (c: MpvCommand): string => `${JSON.stringify(c)}\n`;
```

- [ ] **Step 2 (event mapper + tests first):** `class MpvEventMapper` — feed it parsed IPC messages, get engine events out. State: `expectExplicitStart` (set by `noteExplicitLoad()`), position throttle (inject `now()` for tests). Mapping rules (from the verified protocol):
  - `property-change time-pos` with numeric `data` → `{type:"position",sec}` throttled to ≥250ms between emissions (always emit the first after a `start-file`/seek).
  - `start-file` when `expectExplicitStart` → consume the flag, emit nothing (it's our own load). `start-file` WITHOUT the flag → `{type:"advanced"}` (gapless auto-advance into an appended entry).
  - `end-file reason:"eof"` → emit nothing by itself (either an advance's `start-file` follows, or `idle` follows).
  - `idle` event → `{type:"ended"}` — but NOT the initial idle before any load (gate on "a file has started since boot").
  - `end-file` with `reason:"error"` (or any non-eof/non-redirect reason) → `{type:"error", message}`.
  - Also export `splitLines(buffer)` helper for newline-framing partial socket chunks (carry remainder).
  Test the sequences captured in the spec verification: load→file-loaded→ticks→end-file(eof)→idle = positions then ended; load→ticks→end-file(eof)→start-file = advanced; double explicit load consumes flags correctly; tick throttling.

- [ ] **Step 3:** `pnpm check` GREEN. Commit `feat(desktop): pure mpv JSON-IPC command builders + event mapper` + push.

---

### Task 3: Main-process `MpvController` + IPC surface

**Files:** Create `packages/desktop/src/main/adapters/mpv-controller.ts`. Modify `packages/desktop/src/main/runtime.ts`, `main/index.ts`, `main/ipc.ts`, `shared/ipc-contract.ts`, `preload/index.ts`.

- [ ] **Step 1 (`mpv-controller.ts`):** thin shell over Task 2's logic:
  - `resolveMpvBinary()`: `app.isPackaged ? path.join(process.resourcesPath, "mpv", BINARY_REL) : path.join(__dirnameOfModule, "../../../../vendor/mpv/darwin-arm64/", BINARY_REL)` (main bundle runs from `packages/desktop/out/main/` in dev; derive `__dirname` via `fileURLToPath(import.meta.url)` as `main/index.ts` does). Fail with a clear "run pnpm vendor" error if missing.
  - `start()`: spawn (`child_process.spawn`, stdio ignore) with the verified args; socket at `path.join(app.getPath("userData"), "mpv.sock")` (unlink stale first); retry-connect `net.connect` every 100ms up to 5s; then `observe_property` time-pos + pause; wire socket data → `splitLines` → `JSON.parse` → `MpvEventMapper` → `this.sink?.(event)`; route `request_id` replies to pending promises.
  - `load(url, {startSec})`: `noteExplicitLoad()`, send `cmdLoadfile`, **resolve on the `file-loaded` event** (not the command ACK) so a following `seek()` always lands; reject→`error` event on `end-file reason:error` for that load.
  - `preload(url)` → `cmdAppend`; `play()/pause()` → `cmdSetPause`; `seek(sec)` → `cmdSeekAbs`; `setVolume(v01)` → `cmdSetVolume`.
  - Supervision: on process `exit` while not disposing → emit `{type:"error",message:"mpv exited"}`, mark dead; next `load()` re-runs `start()` once. `dispose()` on app quit (`app.on("will-quit")`): send `quit`, kill, unlink socket.
- [ ] **Step 2 (IPC):** `ipc-contract.ts`: add channels `playbackLoad/playbackPreload/playbackPlay/playbackPause/playbackSeek/playbackSetVolume` (invoke) + `playbackEvent` (push); add to `MusexApi`: the six methods + `onPlaybackEvent(cb: (e: PlaybackEngineEvent) => void): () => void` with `export type PlaybackEngineEvent = {type:"position";sec:number}|{type:"advanced"}|{type:"ended"}|{type:"error";message:string}`. Preload: wrap each invoke; `onPlaybackEvent` wraps `ipcRenderer.on(IPC.playbackEvent, handler)` returning an unsubscribe (specific channel only — keep the no-generic-invoke rule). `main/ipc.ts`: handlers call `rt.mpv.*`; `load` receives `{url, startSec?}`. `runtime.ts`: `readonly mpv = new MpvController()` + `start()` in `init()`. `main/index.ts`: after `createWindow()`, set the controller's sink to `win.webContents.send(IPC.playbackEvent, e)` (re-set per window creation).
- [ ] **Step 3:** Env-gated smoke test `packages/desktop/src/main/adapters/mpv-controller.smoke.test.ts` (`MUSEX_MPV_E2E=1`, else `describe.skip` like the plex smoke test): start controller against the vendored binary with `av://lavfi:sine=frequency=440:duration=1`, assert a position event arrives and then `ended`. (Electron `app` must be stubbed/injected — give the controller constructor-injected `{binaryPath, socketPath}` overrides so the test passes plain paths; production callers use the resolvers.)
- [ ] **Step 4:** `pnpm check` GREEN. Commit `feat(main): MpvController — vendored mpv over JSON IPC + playback IPC surface` + push.

---

### Task 4: Renderer `IpcPlaybackEngine` + swap

**Files:** Create `packages/desktop/src/renderer/src/audio/ipc-playback-engine.ts`. Modify `packages/desktop/src/renderer/src/state/player.tsx`.

- [ ] **Step 1:** `IpcPlaybackEngine implements PlaybackEngine`:

```ts
export class IpcPlaybackEngine implements PlaybackEngine {
  private positionCb = …; private advancedCb = …; private endedCb = …; private errorCb = …;
  constructor() {
    window.musex.onPlaybackEvent((e) => {
      if (e.type === "position") this.positionCb(e.sec);
      else if (e.type === "advanced") this.advancedCb();
      else if (e.type === "ended") this.endedCb();
      else this.errorCb(new Error(e.message));
    });
  }
  async load(ref: StreamRef) { await window.musex.playbackLoad({ url: ref.url }); } // loads paused
  async preload(ref: StreamRef) { await window.musex.playbackPreload(ref.url); }
  play() { void window.musex.playbackPlay(); }
  pause() { void window.musex.playbackPause(); }
  seek(sec: number) { void window.musex.playbackSeek(sec); }
  setVolume(v: number) { void window.musex.playbackSetVolume(v); }
  // onPosition/onAdvanced/onEnded/onError setters as in WebPlaybackEngine
}
```
(Port contract holds: `load` is prepare-only/paused — mpv loadfile carries `pause:"yes"`; `PlaybackSession.playIndex` calls `play()` after; `restore()` does load→seek→stay-paused, and seek works because main's `load` resolves on `file-loaded`.)

- [ ] **Step 2:** `player.tsx`: `new PlaybackSession(new IpcPlaybackEngine(), new IpcStreamResolver())`. Leave `WebPlaybackEngine` in the tree (deleted next task).
- [ ] **Step 3:** `pnpm check` GREEN. Commit `feat(renderer): IpcPlaybackEngine — playback now runs on vendored mpv` + push.
- [ ] **Step 4 (manual acceptance — user):** Dark Angel repro plays to completion; an ALAC track plays (previously 400); gapless album transition; restore-paused-at-position; volume; rapid next/prev clean.

---

### Task 5: Cleanup (the payoff)

**Files:** Delete `renderer/src/audio/playback-engine.ts`, `src/logic/stream-kind.ts` + its test, gapless patch file. Modify `main/adapters/stream-proxy.ts`, `main/ipc.ts`, `packages/desktop/package.json`, `pnpm-workspace.yaml`, `CLAUDE.md`.

- [ ] **Step 1:** Delete `WebPlaybackEngine` (`playback-engine.ts`). Remove `hls.js` and `@regosen/gapless-5` from desktop deps; remove `patchedDependencies` + `patches/@regosen__gapless-5@1.6.2.patch`; `pnpm install` to settle the lockfile.
- [ ] **Step 2:** `stream-proxy.ts` `resolve()`: always `{ url: mediaUrl(serverId, partKey), kind: "direct" }` — delete the hand-rolled transcode URL (the 400 bug dies here). Delete `logic/stream-kind.ts` + test; remove the `chooseStreamKind` filter in `main/ipc.ts`'s prefetch handler (every track is cacheable-direct now). Keep `StreamRef.kind` in the core port (no core churn; desktop always says "direct").
- [ ] **Step 3:** `CLAUDE.md`: replace the raw-HTML5 engine section with the mpv architecture (vendored pin + fetch script, controller/IPC shape, `load` resolves on file-loaded, spawn-not-libmpv + GPL note, smoke-test env vars); delete the transcode KNOWN BUG note (path removed); note hls.js/gapless-5 removal.
- [ ] **Step 4:** `pnpm check` GREEN. Commit `chore(audio): remove Chromium playback path — WebPlaybackEngine, hls.js, gapless-5, transcode URL` + push.

---

## Self-Review

- **Spec coverage:** vendor script w/ pin+hash+sanity-run (T1); JSON IPC pure logic + mapper (T2); controller, push channel, supervision, smoke test (T3); renderer adapter + swap (T4); deletions + docs (T5). Restore/prepare-only contract preserved (verified `pause`/`start` loadfile options; load resolves on file-loaded). Gapless via append + start-file-without-flag → advanced.
- **Type consistency:** `PlaybackEngineEvent` defined once in the shared contract, used by preload/renderer; controller injects `{binaryPath,socketPath}` for the smoke test.
- **Risks:** mpv event-order edge cases (seek during pause, repeat-one self-append) are covered by the mapper rules + unit tests; anything residual surfaces in T4 manual acceptance against the real binary.
