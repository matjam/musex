# Windows Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Windows x64 packaged target (NSIS installer + portable, bundled mpv.exe, unsigned), built on a `windows-latest` CI runner — mirroring the Linux build plus macOS-style mpv bundling, with a named-pipe mpv IPC.

**Architecture:** A `win32` branch in `mpv-paths.ts` (vendored `mpv.exe` + a `\\.\pipe\…` socket), `fetch-mpv.mjs` pinning + 7z-extracting a zhongfly mpv-winbuild, an `electron-builder.yml` `win` block, a committed `build/icon.ico`, and a `build-windows` CI job. Spec: `docs/superpowers/specs/2026-06-18-windows-build-design.md`.

**Tech Stack:** Electron 42, electron-builder 26 (NSIS), electron-updater, mpv (vendored), TS 6, GitHub Actions (`windows-latest`).

## Global Constraints
- **Unsigned for now** — no Windows cert env in the build; SmartScreen warning accepted. Auto-update (NSIS + `latest.yml` + `publish: github`) works unsigned.
- **mpv is bundled on Windows** (vendored `mpv.exe` + DLLs), like macOS — NOT a system dep.
- **`net.connect` is cross-platform** — only the socket-path *value* changes for Windows (a named pipe); the connect code is unchanged.
- **The `.exe` is CI-produced on `windows-latest`** — can't build/run on the macOS/Linux dev box. Local bar = `pnpm check` green + the committed `.ico`; the package + on-Windows mpv playback is a CI run + the user's Windows machine.
- The win32 mpv pin is fetched **only on Windows** (`fetch-mpv` keys on `process.platform`); `.7z` extraction uses 7-Zip, pre-installed on `windows-latest`.
- `git add -A`; `pnpm check` green before each commit; macOS/Linux builds unchanged.

---

### Task 1: mpv win32 paths + named-pipe IPC
**Files:** Modify `packages/desktop/src/main/adapters/mpv-paths.ts`, `packages/desktop/src/main/adapters/mpv-controller.ts`; Create `packages/desktop/src/main/adapters/mpv-socket-path.ts` + `.test.ts` (a small pure helper for the testable bit).

- [ ] **Step 1 — pure helper + test.** Create `mpv-socket-path.ts`:
```ts
import { randomUUID } from "node:crypto";
import { join } from "node:path";

/** mpv `--input-ipc-server` target: a unix socket file on macOS/Linux, a named
 *  pipe on Windows (per-launch unique to avoid multi-instance collisions). */
export function mpvSocketPath(platform: NodeJS.Platform, userDataDir: string, uuid = randomUUID()): string {
  return platform === "win32" ? `\\\\.\\pipe\\musex-mpv-${uuid}` : join(userDataDir, "mpv.sock");
}
```
Test `mpv-socket-path.test.ts`: `mpvSocketPath("win32","C:/x","abc")` === `"\\\\.\\pipe\\musex-mpv-abc"`; `mpvSocketPath("darwin","/u","x")` === `join("/u","mpv.sock")`; two `win32` calls (default uuid) differ.
- [ ] **Step 2 — run test → pass.** `pnpm --filter @musex/desktop test mpv-socket-path`.
- [ ] **Step 3 — `mpv-paths.ts`.** Use `mpvSocketPath(process.platform, app.getPath("userData"))` for `socketPath`. Replace the `win32` `throw` with: `binaryPath = app.isPackaged ? join(process.resourcesPath, "mpv", "mpv.exe") : join(__dirname, "../../../../vendor/mpv/win32-x64/mpv.exe")` + the `existsSync` guard ("mpv binary not found — run 'pnpm vendor'") + `return { binaryPath, socketPath }`.
- [ ] **Step 4 — `mpv-controller.ts` log path.** The `--log-file` arg (only when `MUSEX_MPV_LOG`) currently uses `${this.paths.socketPath}.log` — invalid on Windows (pipe path). Change it to a `userData`-based path, e.g. add `logPath` to `MpvPaths`/resolve it as `join(app.getPath("userData"), "mpv-ipc.log")` and use that. (Socket cleanup `rm(socketPath,{force:true})` is unchanged — a harmless no-op for a pipe.)
- [ ] **Step 5 — `pnpm check`** (both tsc passes + tests) → exit 0. Commit `feat(desktop): win32 mpv paths + named-pipe IPC`.

### Task 2: vendor Windows mpv (`fetch-mpv.mjs`)
**Files:** Modify `scripts/fetch-mpv.mjs`.

- [ ] **Step 1 — pin the build.** On the dev box, download a current zhongfly/mpv-winbuild x64 release (candidate: `https://github.com/zhongfly/mpv-winbuild/releases/download/2026-06-18-2d5dfb343a/mpv-x86_64-20260618-git-2d5dfb343a.7z`) and compute its sha256 (`curl -L <url> -o /tmp/mpv-win.7z && shasum -a 256 /tmp/mpv-win.7z`). If that exact asset is gone, pick the latest stable-ish dated release + its asset. Record the URL + sha.
- [ ] **Step 2 — add the PIN.** In the `PINS` object add:
```js
"win32-x64": {
  url: "<pinned zhongfly .7z URL>",
  sha256: "<computed>",
  binaryRelPath: "mpv.exe",   // mpv.exe is at the archive root, alongside its DLLs
  archive: "7z",
},
```
- [ ] **Step 3 — 7z extraction.** The current extract step uses `unzip` (zip). Branch on the archive type: when the pin's `archive === "7z"` (or the URL ends `.7z`), extract with 7-Zip — `execFileSync("7z", ["x", "-y", `-o${destDir}`, archivePath], { stdio: "inherit" })` (fall back to `7za` if `7z` isn't found). Keep `unzip` for the macOS `.zip`. The destination is `vendor/mpv/win32-x64/` (flat: `mpv.exe` + DLLs). Note `7z`/`7za` is pre-installed on `windows-latest`; this path only runs when `process.platform === "win32"` so it never needs 7z on the mac/Linux dev boxes.
- [ ] **Step 4.** `pnpm check` (the script isn't typechecked, but ensure nothing else broke). Commit `feat(build): vendor Windows mpv (zhongfly winbuild, 7z)`. (The win32 fetch is exercised on the Windows runner, not locally.)

### Task 3: Windows icon (`gen-icon.sh` → committed `build/icon.ico`)
**Files:** Modify `scripts/gen-icon.sh`; Create (committed) `packages/desktop/build/icon.ico`.

- [ ] **Step 1 — add the .ico step.** After the desktop `.icns`/`.png` generation, add:
```bash
# --- Windows: multi-size .ico (committed; CI has no ImageMagick) ---
magick "$TMP/transparent.png" -define icon:auto-resize=256,128,64,48,32,16 \
  "$ROOT/packages/desktop/build/icon.ico"
```
(Use the transparent-corner squircle — Windows draws the icon as-is, no macOS-grid inset.) Update the final echo to mention the .ico.
- [ ] **Step 2 — run it + commit the output.** `bash scripts/gen-icon.sh` (this dev box has ImageMagick), then visually sanity-check `build/icon.ico` (e.g. `magick identify packages/desktop/build/icon.ico` shows the multiple sizes). Commit `feat(build): generate committed Windows icon.ico`. (`gen-icon.sh` also re-emits the mac/mobile icons — only the new `.ico` should differ if the master is unchanged; if the mac/mobile PNGs re-encode identically there's no diff, otherwise note it.)

### Task 4: electron-builder `win` block
**Files:** Modify `packages/desktop/electron-builder.yml`; check `packages/desktop/build/ensure-writable.cjs`.

- [ ] **Step 1 — `win` + `nsis` blocks.** After the `linux:` section add:
```yaml
win:
  target:
    - target: nsis
      arch: [x64]
    - target: portable
      arch: [x64]
  icon: build/icon.ico
  extraResources:
    # mpv.exe lands at Resources/mpv/mpv.exe (matches mpv-paths.ts win32 branch).
    - from: ../../vendor/mpv/win32-x64/
      to: mpv/
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
  createDesktopShortcut: true
  createStartMenuShortcut: true
  shortcutName: musex
```
(No Windows signing config — unsigned. The existing `publish: github` already emits `latest.yml` for the win target.)
- [ ] **Step 2 — afterPack Windows-safety.** Read `build/ensure-writable.cjs` (it `chmod`s the packed tree `u+w` for the macOS ShipIt quarantine fix). Ensure it does NOT throw on Windows: either guard the chmod with `if (process.platform === "win32") return;` (the ShipIt issue is macOS-only) or wrap per-file chmod in try/catch. Keep the macOS/Linux behavior unchanged.
- [ ] **Step 3.** `pnpm check` (config isn't built locally, but the change is YAML + a cjs guard — confirm nothing else breaks). Commit `feat(build): electron-builder Windows (nsis + portable, bundled mpv)`.

### Task 5: `build-windows` CI job
**Files:** Modify `.github/workflows/release-please.yml`.

- [ ] **Step 1 — add the job** after `build-linux`, mirroring it (same `needs`/`if` gating as `build-macos`/`build-linux`):
```yaml
  build-windows:
    needs: release-please
    if: ${{ always() && (needs.release-please.outputs.release_created == 'true' || github.event_name == 'workflow_dispatch') }}
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Vendor mpv
        run: pnpm vendor        # fetches + 7z-extracts the Windows mpv (7-Zip is on windows-latest)
      - name: Check (typecheck + lint + tests)
        run: pnpm check
      - name: Package (unsigned)
        run: pnpm --filter @musex/desktop run package   # electron-builder builds the win targets; no Windows cert env
      - name: Upload artifacts to release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAG_NAME: ${{ needs.release-please.outputs.tag_name || inputs.tag }}
        shell: pwsh
        run: |
          gh release upload "$env:TAG_NAME" `
            (Get-Item packages/desktop/release/*.exe) `
            (Get-Item packages/desktop/release/*.blockmap) `
            packages/desktop/release/latest.yml `
            --clobber
```
Match the EXACT action versions + node version + the `tag` `workflow_dispatch` input the other jobs use (read build-linux first — copy its `uses:` pins + setup). Use `shell: pwsh` + backtick line-continuation (NOT `\`). The portable build also emits an `.exe`; the glob covers both installer + portable.
- [ ] **Step 2.** No local CI run possible. Commit `feat(ci): build-windows job (windows-latest, unsigned)`.

### Task 6: Final verification + docs
- [ ] **Step 1.** Controller `pnpm check` (both desktop tsc passes + biome + tests) → exit 0; confirm the new `mpv-socket-path` test passes + macOS/Linux untouched.
- [ ] **Step 2.** Update root `CLAUDE.md` (the Windows-build bullet: CI-runner not cross-compile; bundled mpv via zhongfly 7z + `fetch-mpv` 7z extraction; the named-pipe IPC [`net.connect` cross-platform, only the path changes; `mpv-socket-path.ts`]; the win block + committed `.ico`; unsigned + SmartScreen caveat; auto-update via nsis/latest.yml; the inherited non-mac branches).
- [ ] **Step 3.** Commit; push; PR #67 description already covers it. Note in the PR: trigger a `workflow_dispatch` (or the next release) to produce the first Windows build; on-Windows playback (named-pipe mpv) is the user's acceptance.

---

## Self-review notes
- **Spec coverage:** IPC named-pipe (T1) ✓; mpv vendoring + 7z (T2) ✓; .ico (T3) ✓; electron-builder win + afterPack-safety (T4) ✓; CI job (T5) ✓; inherited branches verified in the spec (no task needed) ✓; unsigned (T4/T5, no cert env) ✓.
- **Placeholders:** none — the zhongfly URL is a concrete candidate; the sha is computed in T2 step 1 (a real action, not a placeholder).
- **Consistency:** `mpvSocketPath`/`binaryRelPath`/the `win.extraResources` `mpv/` target ↔ `mpv-paths.ts` `Resources/mpv/mpv.exe` all align.
- **Risk:** the exact zhongfly asset may rotate (dated releases) — T2 step 1 picks a current one + records its sha; if the archive layout isn't flat-`mpv.exe`-at-root, adjust `binaryRelPath` + the extract dest. The Windows build + 7z extraction is only verifiable on CI/Windows.
