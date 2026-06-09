# Spec: Native mpv Playback Engine (bundled, main-process)

**Status:** approved direction (2026-06-09) — pivot decided with user; provisioning approach chosen ("fetch pinned official builds").

## Why

Every playback failure class so far traces to Chromium's built-in decoders:

- ALAC / DSD / APE / WavPack can't direct-play → forced the transcode/HLS path, which is broken (Plex 400 — see CLAUDE.md "KNOWN BUG").
- Specific files decode a few seconds then hang the pipeline (repro: "Dark Angel 2.2 – Radio #1 (demo version)").
- The gapless-5 → raw-`<audio>` saga, AbortError races, double-stream bug — all workarounds around `<audio>` element behavior.

Replacing the decoder ends the class. **mpv** (ffmpeg-based) plays everything Plex can store, does true gapless, and is battle-tested. The hexagonal seam already exists: `PlaybackEngine` is a core port; `WebPlaybackEngine` is just one adapter. Core `PlaybackSession` does not change.

## Decisions (all confirmed with user)

1. **Pivot to mpv** rather than patching Chromium playback case-by-case.
2. **All runtime dependencies are bundled** — no system/homebrew installs, dev uses the identical vendored binary (CLAUDE.md Conventions).
3. **Provision by fetching pinned official builds** (mpv GitHub release artifacts), not building from source. Verified 2026-06-09: official releases attach macOS arm64 CI builds (v0.41.0: `macOS 14/15/26 arm64`, plus Windows). Upstream publishes no checksums → we compute the artifact sha256 once at pin time and commit it; the fetch script verifies every download against the committed hash.
4. **Keep the loopback stream proxy.** mpv plays the existing proxy URLs: token stays in main, Range/206 and the write-through media cache keep working, per-launch secret unchanged. (mpv sends no `Origin`; proxy only reflects it when present — no CORS change needed.)
5. **Spawn the `mpv` binary; do not link libmpv.** A spawned process over mpv's JSON IPC needs no native Node addon, isolates crashes, and keeps the GPL boundary clean (separate program ≈ aggregation; our code stays our license).
6. **Session stays in the renderer.** Only the engine moves to main; a thin IPC adapter implements the port.

## Architecture

```
renderer                        main                          vendored
─────────                       ────                          ────────
PlaybackSession (core, as-is)
  └─ IpcPlaybackEngine ──IPC──► MpvController ──JSON IPC────► mpv --idle
       (implements                (spawn, socket,   unix       --input-ipc-server
        PlaybackEngine)            event mapping)   socket      plays proxy URLs
```

### Vendoring (`scripts/fetch-mpv.mjs` + `vendor/`)

- Committed script; pins `{ version, platformKey → { artifactUrl, sha256 } }` in one place at the top.
- Downloads the official release artifact for the host platform into `vendor/mpv/<platform>/`, verifies sha256, unzips, `chmod +x`, sanity-runs `mpv --version`.
- `vendor/` is gitignored; the pin table is the source of truth. Upgrades = bump version + new hashes, one commit.
- Wired so it runs automatically before dev (`predev`) and is idempotent/fast when already present.
- Initial platform: **macOS arm64, the `macOS 14` artifact** (oldest-supported build → runs on 14+ including the dev machine; the 15/26 variants gain nothing we need). Table is extensible to win/linux later.
- electron-builder packaging (later phase) ships `vendor/mpv/<platform>` via `extraResources`; a single `resolveMpvPath()` works in dev and packaged.

### Main: `MpvController` (`main/adapters/mpv-engine.ts`)

- Spawns the vendored binary once at startup (or lazily on first load):
  `--idle=yes --no-video --no-terminal --no-config --gapless-audio=yes --input-ipc-server=<userData>/mpv-<pid>.sock`
- Talks newline-delimited JSON over the unix socket (`net.Socket`): `loadfile`, `playlist-append`, `set pause`, `seek`, `set volume`, with `request_id` correlation; `observe_property` on `time-pos`, `pause`, `idle-active`, `playlist-pos`, and `end-file` events.
- Maps mpv state → port events:
  - `time-pos` changes → position (already ~throttled by mpv's tick).
  - playlist auto-advance into the appended next track → **advanced**.
  - `end-file` (eof, nothing queued) → **ended**; `end-file` reason=error → **error**.
- **Contract parity with the port:** `load()` is prepare-only (load paused; `play()` un-pauses — exact mpv flag, e.g. `loadfile … pause=yes` vs `set pause` ordering, verified against mpv docs at implementation). `seek()` before readiness uses mpv's start-position option so `restore()` (load → seek → stay paused) keeps working.
- `preload(ref)` → `playlist-append` (mpv prefetches/gapless-joins); a fresh `load()` replaces the playlist (single-stream guarantee is structural now — one mpv, one output).
- Process supervision: if mpv dies, surface **error** and respawn once on next `load()`. No retry loops.

### IPC + renderer adapter

- New channels: `playback:load/preload/play/pause/seek/setVolume` (invoke) and a **push channel** `playback:event` (main → `webContents.send`; preload exposes `musex.onPlaybackEvent(cb)` — first event-push in the app, exposed as a specific wrapped listener per the secure-IPC convention).
- `renderer/src/audio/ipc-playback-engine.ts`: `IpcPlaybackEngine implements PlaybackEngine` — forwards calls, re-emits pushed events to the port callbacks. One-line swap in `player.tsx`.

### Deletions (the payoff)

- Transcode/HLS path entirely: hand-rolled transcode URL (the 400 bug), `chooseStreamKind` (everything is direct now), hls.js dependency.
- `WebPlaybackEngine` + the `AbortError`/double-stream workarounds.
- gapless-5 dependency + its pnpm patch (already inert).
- `StreamRef.kind` simplifies to always-direct (port type may keep `kind` for future surfaces; decide in plan).

## Testing

- Core: untouched; `FakePlaybackEngine` still exercises `PlaybackSession`.
- Main: mpv JSON-IPC framing + event mapping as pure logic (`logic/mpv-ipc.ts`: encode commands, decode/route events) — unit-tested without a socket or process. The socket/spawn shell stays thin.
- One env-gated smoke test (`MUSEX_MPV_E2E=1`): spawn the vendored binary, load a small local file, assert position advances + ended fires. Not in normal CI.
- Manual acceptance: the Dark Angel repro track plays to completion; an ALAC track plays (formerly 400); gapless album transition; restore-paused-at-position still works; volume; rapid next/prev produces no console errors and never two streams.

## Phases

1. **Vendor:** fetch script + pin table + predev wiring (`pnpm vendor`).
2. **Main engine:** `logic/mpv-ipc.ts` (tested) + `MpvController` + IPC channels/preload.
3. **Renderer swap:** `IpcPlaybackEngine`, swap in `player.tsx`, manual acceptance.
4. **Cleanup:** delete WebPlaybackEngine/hls.js/gapless-5/transcode path; update CLAUDE.md (engine notes, fixed-bug removal, vendoring docs).

## Risks / notes

- mpv CI artifact layout (single binary vs bundle) is verified by the script's `--version` sanity check; adjust unzip logic to the real layout during Phase 1.
- macOS Gatekeeper: spawning an unsigned vendored binary is fine in dev; packaged builds must include it in signing/notarization scope (handled in the packaging phase, noted in the pin script's README comment).
- Licensing: GPL mpv as a spawned separate program; do not link libmpv without revisiting.
- The audio proxy stays for now (cache + token); if mpv-direct-to-Plex is ever wanted, that's a separate spec.
