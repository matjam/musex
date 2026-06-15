# Linux Build — Design

**Date:** 2026-06-12
**Status:** Approved decisions; spec under review.

Add a Linux desktop build alongside macOS, keeping the **mpv-subprocess** playback model. Windows comes later (same model, named-pipe IPC); iOS/Android later (different `PlaybackEngine` adapter — out of scope). Decisions taken with the user:

- **Packages:** AppImage **and** .deb, x64 only.
- **mpv on Linux:** **require system mpv** (a deliberate, Linux-only exception to the "always bundle native deps" rule — Linux has package managers; macOS didn't, which is why macOS bundles. Windows will still bundle mpv.exe). The .deb declares `Depends: mpv`; AppImage users install mpv themselves and get a clear in-app error if it's missing.
- **Auto-update:** AppImage updates via electron-updater (`latest-linux.yml`); .deb is a manual-upgrade channel.

## Engine portability (settled, for the record)

The `PlaybackEngine` port is the seam. Desktop adapter = mpv subprocess + JSON IPC; works on macOS (unix socket), Linux (unix socket), Windows (named pipe `\\.\pipe\…`, verified — Node `net` connects identically). iOS/Android cannot spawn subprocesses and will implement the same port with a native adapter (react-native-track-player) — unaffected by anything here.

## 1. mpv resolution (`main/adapters/mpv-paths.ts`)

Branch on `process.platform`:
- **darwin:** unchanged (vendored `mpv.app/Contents/MacOS/mpv`, packaged under `resourcesPath/mpv/`).
- **linux:** resolve the system `mpv` — check `$PATH` (via `which`/scanning `PATH`) plus common fallbacks (`/usr/bin/mpv`, `/usr/local/bin/mpv`, `/opt/homebrew`… no). If not found, throw a **clear, actionable** error surfaced to the user: "mpv is required. Install it with your package manager (e.g. `sudo apt install mpv`)." (Renderer shows this as the playback-unavailable state rather than a crash.)
- **win32:** leave a structured branch + comment for the future (vendored `mpv.exe`); not implemented now.
- **socket path:** unix socket under `userData` on mac/linux (unchanged). Windows will use `\\.\pipe\musex-<pid|rand>` — note in code, not built now.

Runtime must **not hard-pin** the mpv version (system mpv varies). Our JSON IPC + `lavfi` af usage is stable across modern mpv; document a sane minimum (mpv ≥ 0.34) in the missing/old error. The pinned-version smoke test stays mac-vendored-binary only.

## 2. Vendoring (`scripts/fetch-mpv.mjs`, `pnpm vendor`)

On Linux, `pnpm vendor` must **no-op gracefully** (currently errors "no pin for linux-x64"): detect `process.platform === "linux"`, print "Linux uses system mpv — nothing to vendor", exit 0. darwin behavior unchanged. (Windows pin added later.)

## 3. electron-builder (`packages/desktop/electron-builder.yml`)

- Move the **mpv `extraResources`** entry under **`mac.extraResources`** (today it's top-level → a Linux build would fail copying the nonexistent darwin vendor dir). Linux ships no bundled mpv.
- Add `linux:` block: `target: [AppImage, deb]`, `icon: build/icon.png` (the existing committed 1024 PNG — Linux uses PNG, no .icns needed), `category: AudioVideo`, `maintainer` (from package.json author), `synopsis`/`description`.
- `deb:` block: `depends` = electron-builder's standard set for the installed version **plus `mpv`** (verify the installed default list and append, don't blindly replace). `priority: optional`.
- `desktop` entry: name, `Categories=AudioVideo;Audio;Player;`, `StartupWMClass` if needed.
- The `afterPack` ensure-writable hook stays (harmless on Linux — chmod succeeds). `publish: github` already covers Linux (`latest-linux.yml`).

## 4. Auto-update (`main/updater.ts`)

electron-updater auto-detects platform and reads `latest-linux.yml` for AppImage. On a **.deb** install there's no `APPIMAGE` env and electron-updater errors; today our silent check `.catch`-logs so it's harmless, but cleaner: **skip the silent check when on Linux and `!process.env.APPIMAGE`** (deb/other). The interactive "Check for Updates" on a non-AppImage Linux build shows a friendly "updates are managed by your package manager" dialog instead of an error.

## 5. Platform UX (from the macOS-assumptions audit)

- **App menu** (`main/menu.ts`): the macOS-only roles (`appMenu`, `services`, `hide*`) silently vanish on Linux, leaving a thin/odd menu. Build a **non-darwin menu template**: a standard layout with our items (Settings, Check for Updates, About, Keyboard Shortcuts, Show Logs) under sensible top-level menus; accelerators already resolve Cmd→Ctrl.
- **Window chrome / search-bar gap** (`index.ts` `trafficLightPosition`; `theme.css` left padding `…0 86px`): the 86px left inset exists only to clear macOS traffic lights. Add a platform class to `<body>` (or a CSS var set from `process.platform`) so non-darwin drops the inset and the search box centers correctly. `trafficLightPosition` is ignored off-darwin (harmless).
- **Shortcut labels** (`useKeyboardShortcuts.ts` / ShortcutsModal): displayed glyphs are hardcoded `⌘`/`⌥`. Show Ctrl/Alt on non-darwin (behavior already correct via `ctrlKey`). Scope: label mapping only.

## 6. safeStorage on Linux (security posture — confirm at review)

Token + plugin-secret storage uses Electron `safeStorage`, which on Linux needs libsecret/kwallet. On a minimal WM with no keyring daemon, `isEncryptionAvailable()` is false and the app currently **throws on startup**. Proposed policy: if encryption is unavailable, **fall back to storing the token unencrypted in `userData`** with a logged warning and a one-line note in Settings → General ("Secure storage unavailable; your Plex token is stored unencrypted — install a keyring to enable encryption"). Rationale: the Plex token is revocable and self-hosted; keeping the app usable beats a hard crash. **This is a deliberate security downgrade on misconfigured Linux only — flag for the user to confirm vs. the alternative (hard-fail with instructions to install a keyring).**

## 7. CI / release (`.github/workflows/release-please.yml`)

Add a **`build-linux` job** (ubuntu-latest) parallel to the existing `build-macos` job, both gated on `release-please`/dispatch. Linux job: checkout, pnpm, install, `pnpm check`, `pnpm --filter @musex/desktop run package` (no mpv vendor step, no signing env), upload `*.AppImage`, `*.deb`, `*.blockmap`, `latest-linux.yml` to the release. `ci.yml` is unchanged (already ubuntu, no mpv needed). The existing macOS job's artifact upload is unchanged.

## 8. Verification

- Local: on this macOS box, confirm mac build still works (no regression from the extraResources move). Linux packaging itself can only be fully built on Linux/CI — so the Linux build is validated in CI (the release workflow's build-linux job on a dispatch/dry-run) rather than locally; the spec calls this out as the one part not locally verifiable on the dev machine.
- Code paths testable on mac: `fetch-mpv` linux no-op (run with a forced platform or unit-check the guard), mpv-paths linux branch (unit test the resolver with a faked platform + PATH), menu template selection, safeStorage fallback logic (unit).
- Manual (when a Linux box/VM is available, or trusted CI artifact): AppImage launches, finds system mpv, plays a FLAC; missing-mpv error is friendly; deb installs and pulls mpv via apt.

## Out of scope

- Windows build (next), iOS/Android (later).
- arm64 Linux, snap/flatpak/rpm.
- Bundling mpv on Linux (system mpv by decision).
