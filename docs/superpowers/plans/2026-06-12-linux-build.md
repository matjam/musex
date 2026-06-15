# Linux Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Linux desktop build (AppImage + .deb, x64) alongside macOS, using system mpv on Linux, with a graceful keyring-less fallback and the platform-UX fixes a macOS-only build glossed over.

**Architecture:** Keep the mpv-subprocess engine; branch platform-specific resolution. mpv is bundled on macOS (unchanged) and required-as-system-package on Linux. New shared `secure-store` helper wraps safeStorage with a plaintext fallback. electron-builder gains a `linux` block; CI gains a parallel `build-linux` job.

**Tech Stack:** Electron 42 / electron-builder 26 / electron-updater, Node 24 main, vitest. Spec: `docs/superpowers/specs/2026-06-12-linux-build-design.md`.

**Conventions:** branch `feature/linux-build`; main/shared/preload imports use `.js`, renderer none, tests extensionless siblings; `pnpm exec biome check --write .` then `pnpm check` (exit 0) before each commit; `git add -A`; push after each commit. theme.css is biome-ignored.

---

### Task 1: mpv resolution (system mpv on Linux) + non-crashing startup + vendor no-op

**Files:**
- Modify: `packages/desktop/src/main/adapters/mpv-paths.ts`
- Create: `packages/desktop/src/main/adapters/mpv-paths.test.ts`
- Modify: `scripts/fetch-mpv.mjs`
- Modify: `packages/desktop/src/main/runtime.ts` (tolerate resolve failure)
- Modify: `packages/desktop/src/main/ipc.ts` (playback handlers surface the reason)

- [ ] **Step 1: Write the failing test** — `packages/desktop/src/main/adapters/mpv-paths.test.ts`. We extract the pure PATH search so it's testable without Electron:

```ts
import { describe, expect, it } from "vitest";
import { findSystemMpv } from "./mpv-paths";

describe("findSystemMpv", () => {
  const exists = (set: string[]) => (p: string) => set.includes(p);

  it("finds mpv on PATH", () => {
    expect(findSystemMpv("/usr/bin:/usr/local/bin", exists(["/usr/local/bin/mpv"]))).toBe(
      "/usr/local/bin/mpv",
    );
  });

  it("prefers the earliest PATH entry", () => {
    expect(
      findSystemMpv("/a:/b", exists(["/a/mpv", "/b/mpv"])),
    ).toBe("/a/mpv");
  });

  it("falls back to common locations when PATH misses", () => {
    expect(findSystemMpv("", exists(["/usr/bin/mpv"]))).toBe("/usr/bin/mpv");
  });

  it("returns null when mpv is nowhere", () => {
    expect(findSystemMpv("/usr/bin:/x", exists([]))).toBeNull();
  });

  it("tolerates an undefined PATH", () => {
    expect(findSystemMpv(undefined, exists(["/usr/bin/mpv"]))).toBe("/usr/bin/mpv");
  });
});
```

- [ ] **Step 2: Run it — fails** (`findSystemMpv` not exported): `pnpm --filter @musex/desktop exec vitest run src/main/adapters/mpv-paths.test.ts`

- [ ] **Step 3: Implement `mpv-paths.ts`:**

```ts
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import type { MpvPaths } from "./mpv-controller.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/** Common absolute fallbacks if mpv isn't on PATH (login-shell PATH can differ
 *  from the GUI-launched process env). Pure + injectable for testing. */
const COMMON_MPV_PATHS = ["/usr/bin/mpv", "/usr/local/bin/mpv", "/opt/homebrew/bin/mpv"];

export function findSystemMpv(
  pathEnv: string | undefined,
  exists: (p: string) => boolean = existsSync,
): string | null {
  const dirs = (pathEnv ?? "").split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = join(dir, "mpv");
    if (exists(candidate)) return candidate;
  }
  for (const p of COMMON_MPV_PATHS) {
    if (exists(p)) return p;
  }
  return null;
}

/** mpv requirement message shown when the binary can't be located. */
const LINUX_MPV_HELP =
  "mpv is required for playback. Install it with your package manager — e.g. `sudo apt install mpv` (or dnf/pacman). mpv 0.34 or newer is recommended.";

/** Locate the mpv binary + IPC socket path. macOS uses the vendored bundle;
 *  Linux uses system mpv (a deliberate Linux-only exception to the bundle
 *  rule). Throws a clear, user-facing Error when mpv can't be found — the
 *  Runtime catches it so startup survives and playback reports the reason. */
export function resolveMpvPaths(): MpvPaths {
  const socketPath = join(app.getPath("userData"), "mpv.sock");

  if (process.platform === "darwin") {
    const binaryPath = app.isPackaged
      ? join(process.resourcesPath, "mpv", "mpv.app/Contents/MacOS/mpv")
      : // out/main → repo root is 4 up.
        join(__dirname, "../../../../vendor/mpv/darwin-arm64/mpv.app/Contents/MacOS/mpv");
    if (!existsSync(binaryPath)) throw new Error("mpv binary not found — run 'pnpm vendor'");
    return { binaryPath, socketPath };
  }

  if (process.platform === "linux") {
    const binaryPath = findSystemMpv(process.env.PATH);
    if (!binaryPath) throw new Error(LINUX_MPV_HELP);
    return { binaryPath, socketPath };
  }

  // win32: future — vendored mpv.exe + a named-pipe socket
  // (\\.\pipe\musex-…). Not implemented; subprocess model otherwise applies.
  throw new Error(`unsupported platform for mpv: ${process.platform}`);
}
```

- [ ] **Step 4: Tests pass.** Re-run the vitest command.

- [ ] **Step 5: `fetch-mpv.mjs` graceful Linux no-op.** After computing `key`, before the `if (!pin)` error:

```js
  if (process.platform === "linux") {
    console.log("fetch-mpv: Linux uses system mpv — nothing to vendor");
    return;
  }
```

- [ ] **Step 6: Runtime tolerates missing mpv.** READ `runtime.ts` around `this.mpv = new MpvController(resolveMpvPaths())`. Replace with:

```ts
    try {
      this.mpv = new MpvController(resolveMpvPaths());
    } catch (err) {
      this.mpvUnavailableReason = err instanceof Error ? err.message : String(err);
      console.error("[musex mpv]", this.mpvUnavailableReason);
    }
```

Add the field `mpvUnavailableReason: string | null = null;` and make `mpv` nullable (`mpv: MpvController | null` — or keep `!` and guard call sites). Wherever `rt.mpv` is used by playback IPC, guard (next step).

- [ ] **Step 7: Playback handlers surface the reason.** In `ipc.ts`, the playback handlers (`playbackLoad/play/pause/seek/setVolume/...`) call `rt.mpv`. Add a guard at the top of each (or a small helper `requireMpv()` that throws `rt.mpvUnavailableReason ?? "mpv unavailable"`). The renderer already surfaces playback errors — the friendly message flows through. Audio-prefs handlers that call `rt.mpv.applyAudioConfig` must also tolerate a null mpv (no-op when unavailable).

- [ ] **Step 8: Verify + commit**

```bash
pnpm exec biome check --write . && pnpm check
git add -A && git commit -m "feat: resolve system mpv on Linux; survive missing mpv at startup" && git push
```

---

### Task 2: electron-builder Linux config

**Files:**
- Modify: `packages/desktop/electron-builder.yml`

No unit test (build config); validated by the mac local-build regression in Task 6 and CI in Task 5.

- [ ] **Step 1: Move mpv `extraResources` under `mac`.** Today the top-level `extraResources` copies `../../vendor/mpv/darwin-arm64/` — a Linux build would fail (dir absent). Relocate it so it only runs for mac:

```yaml
mac:
  # …existing mac config…
  extraResources:
    - from: ../../vendor/mpv/darwin-arm64/
      to: mpv/
```

Remove the top-level `extraResources:` block. (Confirm nothing else lived in it — only the mpv entry remains post-Phase-0.)

- [ ] **Step 2: Add the `linux` + `deb` blocks.** READ the installed electron-builder's default deb `depends` (check `node_modules/app-builder-lib` or its docs for v26) and append `mpv` to the real default list rather than replacing it blind. Add:

```yaml
linux:
  target:
    - target: AppImage
      arch: [x64]
    - target: deb
      arch: [x64]
  icon: build/icon.png   # committed 1024 PNG; Linux uses PNG, no .icns
  category: AudioVideo
  maintainer: Nathan Ollerenshaw <nathan@ollerenshaw.org>
  synopsis: Spotify-style desktop player for your Plex music library
  description: >-
    musex streams your own Plex music library with gapless, all-codec direct
    play (via mpv), smart mixes, and Lidarr-powered discovery.
  desktop:
    entry:
      Categories: AudioVideo;Audio;Player;
deb:
  priority: optional
  depends:
    # electron-builder's standard runtime deps for the installed major PLUS
    # mpv (musex shells out to the system mpv on Linux). Verify the default
    # set against the installed app-builder-lib before finalizing.
    - mpv
    - libgtk-3-0
    - libnotify4
    - libnss3
    - libxss1
    - libxtst6
    - xdg-utils
    - libatspi2.0-0
    - libuuid1
    - libsecret-1-0
```

(`publish: github` already at top level covers Linux — electron-builder emits `latest-linux.yml` for the AppImage. The `afterPack` ensure-writable hook stays; it's harmless on Linux.)

- [ ] **Step 3: Verify (mac build unaffected) + commit.** `pnpm check`; full mac package build happens in Task 6.

```bash
git add -A && git commit -m "feat: electron-builder Linux config (AppImage + deb, system-mpv dep)" && git push
```

---

### Task 3: Auto-update + platform UX (menu, chrome, shortcut labels)

**Files:**
- Modify: `packages/desktop/src/main/updater.ts`
- Modify: `packages/desktop/src/main/menu.ts`
- Modify: `packages/desktop/src/preload/index.ts` (+ `MusexApi` in `shared/ipc-contract.ts`)
- Modify: `packages/desktop/src/renderer/src/main.tsx` (or the renderer entry) + `ui/theme.css`
- Modify: `packages/desktop/src/renderer/src/ui/hooks/useKeyboardShortcuts.ts` (+ ShortcutsModal label mapping)

- [ ] **Step 1: Updater non-AppImage Linux.** In `updater.ts`: the silent-check schedule should skip when `process.platform === "linux" && !process.env.APPIMAGE` (deb/other — electron-updater can't self-update those). The interactive `checkForUpdatesInteractive`, in that same case, shows a friendly dialog ("musex was installed via a package; update it through your package manager.") instead of running the check. macOS/AppImage paths unchanged.

- [ ] **Step 2: Non-darwin menu.** In `menu.ts`, branch `const isMac = process.platform === "darwin"`. Keep the current template for mac. For non-mac, build a template WITHOUT `appMenu`/`services`/`hide*` roles: a top-level **File** menu (`Settings…` `CmdOrCtrl+,`, separator, `Check for Updates…`, separator, `{ role: "quit" }`), `{ role: "editMenu" }`, the View menu (dev items + fullscreen), and **Help** (About musex, Keyboard Shortcuts `CmdOrCtrl+/`, separator, GitHub, Report an Issue, separator, Show Logs, Open Logs Folder). Same `deps` callbacks. (The non-mac Help is where About/Shortcuts live since there's no app menu.)

- [ ] **Step 3: Expose platform to renderer.** In `preload/index.ts`, add a static field to the bridge: `platform: process.platform` (sandboxed preloads expose `process.platform`). Add `platform: NodeJS.Platform` (or `string`) to `MusexApi` in `shared/ipc-contract.ts`. In the renderer entry (`main.tsx`), before render: `document.documentElement.dataset.platform = window.musex.platform;`.

- [ ] **Step 4: Drop the traffic-light inset off-darwin.** In `theme.css`, the `.titlebar` (or topbar) rule with `padding: 0 16px 0 86px` keeps the 86px only for mac. Add an override:

```css
/* Only macOS has the in-window traffic lights the left inset clears. */
html:not([data-platform="darwin"]) .titlebar {
  padding-left: 16px;
}
```

(Match the real class name found in theme.css — the audit cited `.titlebar`; verify and use whatever the search box's container actually is.)

- [ ] **Step 5: Shortcut labels.** In `useKeyboardShortcuts.ts` / ShortcutsModal, the displayed `⌘`/`⌥` glyphs map to `Ctrl`/`Alt` when `window.musex.platform !== "darwin"` (or a small `modLabel` helper). Behavior is already correct via `ctrlKey`; this is display-only.

- [ ] **Step 6: Verify + commit**

```bash
pnpm exec biome check --write . && pnpm check
git add -A && git commit -m "feat: Linux platform UX — menu, window chrome, shortcut labels, updater channel" && git push
```

---

### Task 4: safeStorage plaintext fallback (keyring-less Linux)

**Files:**
- Create: `packages/desktop/src/main/adapters/secure-store.ts`
- Test: `packages/desktop/src/main/adapters/secure-store.test.ts`
- Modify: `packages/desktop/src/main/adapters/token-store.ts`
- Modify: `packages/desktop/src/main/runtime.ts` (plugin-secrets encrypt/decrypt)
- Modify: `packages/desktop/src/main/ipc.ts` + `shared/ipc-contract.ts` (`Preferences.secureStorageAvailable`)
- Modify: `packages/desktop/src/renderer/src/ui/views/SettingsView.tsx` (General warning row)

- [ ] **Step 1: Failing test** — `secure-store.test.ts`. The helper is pure given an injected `safeStorage`-like backend:

```ts
import { describe, expect, it } from "vitest";
import { secureDecrypt, secureEncrypt } from "./secure-store";

const realBackend = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(`ENC(${s})`),
  decryptString: (b: Buffer) => b.toString().replace(/^ENC\((.*)\)$/, "$1"),
};
const noBackend = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => "" };

describe("secure-store", () => {
  it("round-trips through a real backend", () => {
    const buf = secureEncrypt("tok", realBackend);
    expect(secureDecrypt(buf, realBackend)).toBe("tok");
  });

  it("falls back to tagged plaintext when encryption is unavailable", () => {
    const buf = secureEncrypt("tok", noBackend);
    expect(buf.toString("utf8").startsWith("musex-plaintext:v1:")).toBe(true);
    // plaintext is readable even by a backend that now reports available
    expect(secureDecrypt(buf, realBackend)).toBe("tok");
  });

  it("empty/garbage decrypts safely", () => {
    expect(secureDecrypt(Buffer.alloc(0), noBackend)).toBeNull();
  });
});
```

- [ ] **Step 2: Run — fails. Step 3: Implement `secure-store.ts`:**

```ts
import { safeStorage as electronSafeStorage } from "electron";

/** The slice of Electron safeStorage we use — injectable for tests. */
export interface SecureBackend {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(buf: Buffer): string;
}

const PLAINTEXT_TAG = "musex-plaintext:v1:";

/** Encrypt `plain` to a Buffer. When the OS keyring is unavailable (common on
 *  minimal Linux WMs) we fall back to TAGGED plaintext so the app stays usable
 *  — a deliberate, surfaced downgrade (the Plex token is revocable +
 *  self-hosted). The tag lets decrypt tell the two apart; real safeStorage
 *  ciphertext never starts with it. */
export function secureEncrypt(plain: string, backend: SecureBackend = electronSafeStorage): Buffer {
  if (backend.isEncryptionAvailable()) return backend.encryptString(plain);
  return Buffer.from(PLAINTEXT_TAG + plain, "utf8");
}

/** Inverse of secureEncrypt. Returns null for empty input. */
export function secureDecrypt(
  buf: Buffer,
  backend: SecureBackend = electronSafeStorage,
): string | null {
  if (buf.length === 0) return null;
  const asText = buf.toString("utf8");
  if (asText.startsWith(PLAINTEXT_TAG)) return asText.slice(PLAINTEXT_TAG.length);
  return backend.decryptString(buf);
}

/** Whether real OS encryption is in effect (false → plaintext fallback). */
export function isSecureStorageAvailable(backend: SecureBackend = electronSafeStorage): boolean {
  return backend.isEncryptionAvailable();
}
```

NOTE: electron's `safeStorage.encryptStringAsync`/`decryptStringAsync` are the async variants the codebase uses today; the sync `encryptString`/`decryptString` exist too and keep this helper simple/synchronous. Using sync here is fine (token + secrets are tiny, infrequent). If the reviewer prefers async to match prior style, mirror the interface with promises — either is acceptable; sync is simpler.

- [ ] **Step 4: token-store uses it.** Rewrite `SafeStorageTokenStore.save/load` to use `secureEncrypt`/`secureDecrypt` (no more throwing when unavailable). `save` writes `secureEncrypt(token)` to the file; `load` reads the file and returns `secureDecrypt(buf)`. Update the class docstring (no longer "macOS Keychain"-only; note the Linux plaintext fallback).

- [ ] **Step 5: plugin-secrets use it.** In `runtime.ts`, replace the `encrypt`/`decrypt` closures (lines ~120–129) with `secureEncrypt`/`secureDecrypt` (base64 the buffer for storage, as today): `encrypt: async (s) => secureEncrypt(s).toString("base64")`, `decrypt: async (s) => secureDecrypt(Buffer.from(s, "base64")) ?? ""`. Remove the throw.

- [ ] **Step 6: Startup warning + status to renderer.** In `runtime.ts` init (or main), if `!isSecureStorageAvailable()` log a one-line warning. Add `secureStorageAvailable: boolean` to the `Preferences` type and the `getPreferences` IPC handler (`isSecureStorageAvailable()`). In `SettingsView.tsx` General pane, when `!secureStorageAvailable`, render a warning row ("Secure storage unavailable — your Plex token is stored unencrypted. Install a keyring (gnome-keyring/kwallet) to enable encryption.") using the existing `error-text`/settings-row styling.

- [ ] **Step 7: Verify + commit**

```bash
pnpm exec biome check --write . && pnpm check
git add -A && git commit -m "feat: plaintext token/secret fallback when OS keyring is unavailable (Linux)" && git push
```

---

### Task 5: CI — parallel Linux release job

**Files:**
- Modify: `.github/workflows/release-please.yml`

- [ ] **Step 1:** Rename the existing `build` job to `build-macos` (keep all its steps + the `if`/`needs`). Add a sibling `build-linux` job, same `needs: release-please` + `if`, `runs-on: ubuntu-latest`:

```yaml
  build-linux:
    needs: release-please
    if: ${{ always() && (needs.release-please.outputs.release_created == 'true' || github.event_name == 'workflow_dispatch') }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v6
        with:
          node-version: 24
          cache: pnpm
      - name: Install dependencies
        run: pnpm install --frozen-lockfile
      - name: Check (typecheck + lint + tests)
        run: pnpm check
      - name: Package (AppImage + deb)
        run: pnpm --filter @musex/desktop run package
      - name: Upload artifacts to release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          TAG_NAME: ${{ needs.release-please.outputs.tag_name || inputs.tag }}
        run: |
          gh release upload "$TAG_NAME" \
            packages/desktop/release/*.AppImage \
            packages/desktop/release/*.deb \
            packages/desktop/release/*.blockmap \
            packages/desktop/release/latest-linux.yml \
            --clobber
```

(No `pnpm vendor` step — Linux uses system mpv, and the build itself doesn't need mpv present. If the electron-builder deb step fails on the runner for a missing tool, add `sudo apt-get update && sudo apt-get install -y fakeroot` before packaging — note this as the known fallback.)

- [ ] **Step 2: Commit**

```bash
git add -A && git commit -m "ci: parallel Linux release build (AppImage + deb)" && git push
```

---

### Task 6: Docs + verification + PR (controller, not a subagent)

- [ ] **mac regression build:** `pnpm vendor` then `cd packages/desktop && CSC_IDENTITY_AUTO_DISCOVERY=false pnpm run package` — confirm the dmg still builds and `Resources/mpv/…` is present (the `extraResources` move didn't break mac). Linux packaging is CI-only on this dev machine — note that.
- [ ] **CLAUDE.md:** new bullet — Linux build (AppImage+deb x64; system mpv as a documented Linux-only exception to the bundle rule; mpv resolved via PATH with a friendly missing-mpv state, not a crash; safeStorage plaintext fallback + Settings warning; non-darwin menu/chrome/shortcut-label handling; `mac.extraResources` move; updater AppImage-only on Linux; parallel CI job). Note Windows is the next platform (named-pipe IPC seam already commented).
- [ ] **README:** Install section gains Linux (AppImage download + `chmod +x`; .deb via `apt`/`dpkg` which pulls mpv; note AppImage users need `mpv` installed).
- [ ] **Draft PR** `feat: linux build (AppImage + deb)` — summary + the explicit note that Linux packaging is verified in CI, not on the macOS dev box.
