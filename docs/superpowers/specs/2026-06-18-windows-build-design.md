# Windows Build Design

**Date:** 2026-06-18
**Status:** Approved (design); proceeding to plan + build (autonomous, unsigned-for-now per user).
**Context:** musex ships macOS (vendored mpv, dmg/zip, signed+notarized) + Linux (system mpv, AppImage/deb, CI-only) — see `docs/superpowers/specs/2026-06-12-linux-build-design.md`. This adds **Windows x64** as a third packaged target, built on a `windows-latest` CI runner (NOT cross-compiled — electron-builder's wine path is fragile with native mpv + auto-update). Windows **bundles mpv** (like macOS; unlike Linux's system dep — Windows has no package manager for it). Two changes go beyond packaging: the **mpv IPC named pipe** (a runtime change) and **7z extraction** for the Windows mpv archive.

## Decisions

- **Build on `windows-latest` CI** (mirrors the existing `build-macos`/`build-linux` jobs); no cross-compilation.
- **Targets:** NSIS installer (auto-updatable) + a portable `.exe`, **x64** only (arm64 Windows deferred).
- **mpv bundled** (vendored `mpv.exe` + DLLs), like macOS.
- **Unsigned for now** — Windows code-signing needs a separate Authenticode cert ($/setup); SmartScreen shows an "unknown publisher" warning on first run (acceptable, like the unsigned Linux artifacts). Auto-update (NSIS + `latest.yml`) works unsigned. Signing is a later add (a `win.certificateFile`/`CSC_LINK_WIN` env, documented but not wired).
- **Auto-update:** NSIS + `latest.yml` + the existing `publish: github` feed — works on Windows; the updater's `isPackageManagerInstall` gate is Linux-only so Windows auto-updates.
- **Verification reality:** the `.exe` is produced by CI on `windows-latest` (can't build on the macOS/Linux dev box). Locally we verify `pnpm check` (the win32 IPC/path logic + tests) + the committed `.ico`; the actual package + on-Windows playback is a CI run + the user's Windows machine.

## Architecture / changes

### 1. mpv IPC — named pipe (the runtime change)
`mpv-controller.ts` spawns mpv with `--input-ipc-server=${paths.socketPath}` and connects via `net.connect(paths.socketPath)`. **`net.connect` is cross-platform** — it transparently treats a `\\.\pipe\…` string as a Windows named pipe, so the connect code is unchanged. The only changes:
- **`mpv-paths.ts`:** the `socketPath` for Windows is a **named pipe** `\\.\pipe\musex-<uuid>` (per process), not a `userData/mpv.sock` filesystem path.
- **The `--log-file` path** (`mpv-controller.ts`, only when `MUSEX_MPV_LOG` is set) currently appends `.log` to `socketPath`; on Windows that'd be an invalid file path (`\\.\pipe\…log`). Derive the log path from `userData` (e.g. `userData/mpv-ipc.log`) instead of `socketPath + ".log"` — on all platforms or win32-gated.
- **Socket cleanup** (`rm(socketPath, { force: true })`) is a harmless no-op for a pipe path (`force: true`) — no change.

### 2. mpv binary resolution + vendoring
- **`mpv-paths.ts`:** add a `win32` branch (replacing the current `throw`): `binaryPath = app.isPackaged ? join(process.resourcesPath, "mpv", "mpv.exe") : join(__dirname, "../../../../vendor/mpv/win32-x64/mpv.exe")`, `existsSync` guard, the named-pipe `socketPath`.
- **`fetch-mpv.mjs`:** add a `win32-x64` PIN — a pinned, sha256-verified **zhongfly/mpv-winbuild** (or shinchiro) Windows x64 build (ships `mpv.exe` + its DLLs). Candidate: `https://github.com/zhongfly/mpv-winbuild/releases/download/2026-06-18-2d5dfb343a/mpv-x86_64-20260618-git-2d5dfb343a.7z` (the build pins the exact URL + records its sha256; pick a current stable-ish dated release). The archive is **`.7z`** (no zip from the major sources), so fetch-mpv needs **7z extraction** (shell out to `7z`/`7za`) for the win32 entry — `windows-latest` runners have 7-Zip pre-installed, and the win32 pin is only fetched when `process.platform === "win32"` (the macOS/Linux dev boxes never hit it). Vendor the full `mpv.exe` + DLL set into `vendor/mpv/win32-x64/`.

### 3. Packaging (`electron-builder.yml`)
Add a `win` block + `nsis` block:
- `win.target`: `nsis` (x64) + `portable` (x64); `win.icon: build/icon.ico`.
- `win.extraResources`: `../../vendor/mpv/win32-x64/ → mpv/` (so `Resources/mpv/mpv.exe` matches `mpv-paths.ts`; mirrors `mac.extraResources`).
- `nsis`: `oneClick: false`, `allowToChangeInstallationDirectory: true`, `createDesktopShortcut: true`, `createStartMenuShortcut: true`, `shortcutName: musex`.
- **No Windows signing config** (unsigned). Confirm the existing `afterPack: build/ensure-writable.cjs` is a safe no-op on Windows (its `chmod u+w` is a macOS/Linux ShipIt fix; on Windows `fs.chmod` is tolerated/no-op — verify it doesn't throw, guard with a platform check if needed).
- The `publish: github` block already emits `latest.yml` for the win target (auto-update feed).

### 4. Icon (`gen-icon.sh`)
Add a committed **`packages/desktop/build/icon.ico`** generated from the raster master via ImageMagick (`-define icon:auto-resize=256,128,64,48,32,16` for a proper multi-size .ico). Use the same transparent-corner squircle as the macOS source (Windows draws the icon as-is; no macOS-grid inset needed). Committed (CI has no ImageMagick).

### 5. CI (`.github/workflows/release-please.yml`)
Add a **`build-windows`** job (`runs-on: windows-latest`), same gating as `build-macos`/`build-linux` (release-created or `workflow_dispatch`): checkout → pnpm/node setup → `pnpm install` → `pnpm vendor` (fetches + 7z-extracts the Windows mpv; 7z present on the runner) → `pnpm check` → `pnpm --filter @musex/desktop run package` (electron-builder builds the `win` targets, **unsigned** — no Windows cert env) → `gh release upload` the `*.exe` (installer + portable) + `*.blockmap` + `latest.yml` (PowerShell line-continuation backticks, not `\`).

### 6. Inherited platform branches (no work — verified)
Windows gets `data-platform="win32"` from preload → the non-mac CSS (no traffic-light inset) applies; the menu uses the non-mac template; the keyboard `(meta||ctrl)` combo handles Ctrl; the updater auto-updates (not a package-manager install). All already cross-platform.

## Testing
- **Unit (`pnpm check`):** the `mpv-paths.ts` win32 branch (the existing `find-system-mpv`/paths tests pattern — add a win32 paths case if testable without `app`), the mpv-IPC log-path change. The packaging config + CI YAML aren't unit-tested.
- **`.ico`:** generated by `gen-icon.sh` on the dev box (macOS, has ImageMagick), committed + visually checked.
- **CI-produced + on-Windows (user):** a `workflow_dispatch` (or the next release) builds the NSIS installer + portable on `windows-latest`; the user installs on Windows and verifies: app launches, signs into Plex, **mpv plays** (the named-pipe IPC works), auto-update checks. The mpv `.7z` fetch + 7z extraction is exercised only on the Windows runner.

## Non-goals
- **Windows code-signing** (unsigned for now; SmartScreen warning accepted) — a documented later add.
- **arm64 Windows.**
- **Cross-compilation** from macOS/Linux (CI runner instead).
- Changing the macOS/Linux builds.

## Success criteria
- `electron-builder.yml` has a `win` block; `mpv-paths.ts` resolves the vendored `mpv.exe` + a named-pipe socket; `fetch-mpv.mjs` pins + 7z-extracts the Windows mpv; `gen-icon.sh` emits a committed `build/icon.ico`; a `build-windows` CI job builds + uploads the NSIS installer + portable + `latest.yml`, unsigned.
- `pnpm check` green; the macOS/Linux builds unchanged.
- A `windows-latest` CI run produces an installable `.exe`; on Windows the app launches and mpv plays (named-pipe IPC) — the user's acceptance.
