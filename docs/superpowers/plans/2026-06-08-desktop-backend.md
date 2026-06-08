# Desktop Backend Implementation Plan (Slice 1, Plan B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `@musex/desktop` Electron **main process + IPC backend**: window bootstrap, the `@ctrl/plex` `PlexGateway` adapter (sign-in, discovery, browse, stream URLs), secure token storage, persistence, the `musex-stream://` audio proxy, and the typed IPC bridge — plus a small core amendment finalizing the gapless contract. The renderer UI and audio engine are Plan C.

**Architecture:** Hexagonal. `@musex/core` (pure, already built) defines the ports and `PlaybackSession`. This plan implements the **main-process adapters** for those ports and exposes them to the renderer over typed IPC. Main is the "data plane": all Plex HTTP (Node, no CORS), the OS keychain, persistence, and a custom-protocol audio proxy that injects the token so it never reaches the renderer. Pure mapping/logic is split into electron-free modules so it is unit-tested with Vitest; Electron-bound glue is verified manually + by an opt-in real-Plex smoke test.

**Tech Stack (verified 2026-06-08 — see project `CLAUDE.md` "Tooling"):** electron ^42.3.3, electron-vite ^5, @vitejs/plugin-react ^6, vite 7 (transitive), react 19, @ctrl/plex ^6, electron-store ^11 (ESM-only), @regosen/gapless-5 ^1.6 + hls.js ^1.6 (renderer, Plan C), electron-builder ^26. Vitest 4 + Biome 2 from the root.

**Conventions (`CLAUDE.md`):** commit directly to `main`; `git add -A`; push after every commit; `pnpm check` green before push; TDD for pure logic; no silently swallowed errors; prefer latest stable; use the current documented API for the installed major version.

**Key design decisions (from docs research):**
- **Window security:** `contextIsolation: true`, `nodeIntegration: false`, **`sandbox: false`**. Rationale: the app only ever loads local bundled renderer content, and `sandbox: false` lets the preload be ESM (same as the ESM main), avoiding the CJS-preload-in-an-ESM-project friction. `contextIsolation` (the protection that matters) stays on. Hardening to `sandbox: true` + a CJS preload is a documented later enhancement.
- **Audio proxy:** custom privileged scheme `musex-stream://{serverId}{plexPath}` handled by `protocol.handle` + `net.fetch` (injects token, forwards `Range`). Path is preserved (not opaque-encoded) so HLS relative segment URLs resolve through the proxy.
- **Gapless:** `PlaybackEngine` gains `onAdvanced` (Task B0).

---

## File Structure

```
packages/desktop/
  package.json
  electron.vite.config.ts
  electron-builder.yml
  tsconfig.json                 # renderer + shared (DOM libs)
  tsconfig.node.json            # main + preload (node)
  vitest.config.ts              # unit tests for the electron-free modules only
  src/
    shared/
      ipc-contract.ts           # channel names + request/response types (no electron import)
    logic/                      # PURE, electron-free, unit-tested
      stream-kind.ts            # chooseStreamKind(track) -> 'direct' | 'hls'
      stream-url.ts             # buildProxyUrl(...) and parseProxyUrl(...)
      plex-mapping.ts           # @ctrl/plex objects -> @musex/core models
    main/
      index.ts                  # app/window bootstrap + protocol scheme registration
      ipc.ts                    # ipcMain.handle wiring (core use-cases + adapters)
      runtime.ts                # in-memory app runtime: connected server, token, store
      adapters/
        token-store.ts          # TokenStore via safeStorage + userData file
        persistence.ts          # electron-store wrapper (clientId, selection, volume, queue)
        plex-gateway.ts         # PlexGateway via @ctrl/plex (+ single-shot pollPin)
        stream-proxy.ts         # protocol.handle registration + handler
    preload/
      index.ts                  # contextBridge bridge -> window.musex
    renderer/
      index.html
      src/
        main.tsx                # STUB renderer (Plan C replaces with the real UI)
        vite-env.d.ts           # window.musex typing
```

**Boundaries:** `logic/` imports nothing from electron or @ctrl/plex (only `@musex/core` types + plain data) so it is Vitest-testable. `adapters/` and `main/` may import electron/@ctrl/plex and are verified manually + by the opt-in smoke test.

---

## Task B0: Core amendment — finalize the gapless `onAdvanced` contract

**Files (in `packages/core`):**
- Modify: `src/ports/playback-engine.ts`
- Modify: `src/testing/fakes.ts` (FakePlaybackEngine)
- Modify: `src/playback/playback-session.ts`
- Modify: `src/playback/playback-session.test.ts`

- [ ] **Step 1: Add `onAdvanced` to the port.** In `src/ports/playback-engine.ts`, add the method (and docstring) so the interface reads:

```ts
import type { StreamRef } from "./stream-resolver";

/** Audio output. Implemented in the renderer (Gapless-5 / hls.js). The session
 *  drives it and consumes its events; it performs no queue logic itself.
 *
 *  Gapless contract (verified against Gapless-5): when the current track ends and
 *  a track was `preload`ed, the engine seamlessly continues into it and fires
 *  `onAdvanced` (NOT `onEnded`). `onEnded` fires only when playback fully stops
 *  with nothing buffered to continue (true end of content). Manual skips go through
 *  `load()` (teardown + reload; a tiny gap is acceptable). */
export interface PlaybackEngine {
  load(ref: StreamRef): Promise<void>;
  preload(ref: StreamRef): Promise<void>;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  onPosition(cb: (seconds: number) => void): void;
  onAdvanced(cb: () => void): void;
  onEnded(cb: () => void): void;
  onError(cb: (err: Error) => void): void;
}
```

- [ ] **Step 2: Update `FakePlaybackEngine`.** In `src/testing/fakes.ts`, add an advanced callback field and registration + emit helper. Add next to `endedCb`:

```ts
  private advancedCb: (() => void) | null = null;
```
add the registration method (next to `onEnded`):
```ts
  onAdvanced(cb: () => void): void {
    this.advancedCb = cb;
  }
```
and add an emit helper (next to `emitEnded`):
```ts
  emitAdvanced(): void {
    this.advancedCb?.();
  }
```

- [ ] **Step 3: Write the failing test.** In `src/playback/playback-session.test.ts`, add:

```ts
  it("on gapless auto-advance, bumps the index without reloading and preloads the following track", async () => {
    const { engine, session } = setup();
    const tracks = [makeTrack("1"), makeTrack("2"), makeTrack("3")];
    await session.loadQueue({ tracks, index: 0 });
    // after load: engine.loaded == ["1"], engine.preloaded == ["2"]
    engine.emitAdvanced();

    await vi.waitFor(() => {
      expect(session.getState().queue?.index).toBe(1);
      expect(engine.preloaded.map((r) => r.url)).toEqual(["fake://stream/2", "fake://stream/3"]);
    });
    // crucially, the engine was NOT told to load track 2 again — it auto-advanced
    expect(engine.loaded.map((r) => r.url)).toEqual(["fake://stream/1"]);
    expect(session.getState().status).toBe("playing");
    expect(session.getState().durationSec).toBe(180);
  });
```

- [ ] **Step 4: Run — expect FAIL** (`session.handleAdvanced`/registration absent → index stays 0 or preload not called).
Run: `pnpm --filter @musex/core test`

- [ ] **Step 5: Implement.** In `src/playback/playback-session.ts`:
(a) In the constructor, after the `onEnded` registration, add:
```ts
    this.engine.onAdvanced(() => {
      void this.handleAdvanced();
    });
```
(b) Add the handler (next to `handleEnded`):
```ts
  private async handleAdvanced(): Promise<void> {
    const queue = this.state.queue;
    if (!queue) return;
    const nextIndex = queue.index + 1;
    const nextTrack = queue.tracks[nextIndex];
    if (!nextTrack) return; // engine signalled advance but we have no next; onEnded will finalize
    this.preloadedIndex = null;
    this.patch({
      queue: { ...queue, index: nextIndex },
      status: "playing",
      positionSec: 0,
      durationSec: nextTrack.durationMs / 1000,
    });
    await this.preloadNext();
  }
```
Leave `handleEnded` as-is (it remains the fallback: if a next track exists it `playIndex`es it, else `ended`).

- [ ] **Step 6: Run — expect PASS.** Then `pnpm check` from the root (all core tests + the new one green, Biome clean).

- [ ] **Step 7: Commit.**
```bash
git add -A
git commit -m "core: add PlaybackEngine.onAdvanced and gapless cursor handling"
git push origin main
```

---

## Task B1: `@musex/desktop` scaffold + launching window

**Files (all under `packages/desktop/`):** `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `vitest.config.ts`, `electron-builder.yml`, `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/src/main.tsx`, `src/renderer/src/vite-env.d.ts`. Also modify root `.npmrc` and `pnpm-workspace.yaml`.

- [ ] **Step 1: Root `.npmrc`** (create at repo root) — electron-builder needs a flat layout:
```ini
node-linker=hoisted
```

- [ ] **Step 2: Root `pnpm-workspace.yaml`** — allow electron's postinstall (downloads the binary). Update the `allowBuilds` block to:
```yaml
packages:
  - "packages/*"

# pnpm 11 gates dependency build scripts; allowlist the ones that need them.
allowBuilds:
  esbuild: true
  electron: true
```

- [ ] **Step 3: `packages/desktop/package.json`**
```json
{
  "name": "@musex/desktop",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./out/main/index.mjs",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "typecheck": "tsc -p tsconfig.node.json --noEmit && tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "package": "electron-vite build && electron-builder"
  },
  "dependencies": {
    "@ctrl/plex": "^6.0.0",
    "@musex/core": "workspace:*",
    "@regosen/gapless-5": "^1.6.2",
    "electron-store": "^11.0.2",
    "hls.js": "^1.6.16"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^6.0.2",
    "electron": "^42.3.3",
    "electron-builder": "^26.15.2",
    "electron-vite": "^5.0.0",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0"
  }
}
```
> `react`/`react-dom` are devDependencies because Vite bundles them into the renderer output (they are not needed as runtime `node_modules`). `@ctrl/plex`, `electron-store`, `@regosen/gapless-5`, `hls.js` are runtime deps. Verify each version with `npm view <pkg> version` before installing and bump to the latest matching major if newer.

- [ ] **Step 4: `packages/desktop/electron.vite.config.ts`**
```ts
import react from "@vitejs/plugin-react";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@musex/core"] })],
    build: { rollupOptions: { output: { format: "es" } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@musex/core"] })],
    build: { rollupOptions: { output: { format: "es" } } },
  },
  renderer: {
    plugins: [react()],
  },
});
```
> `@musex/core` ships `.ts` source, so it must be bundled (excluded from externalization) in both main and preload. Preload is ESM here because the window uses `sandbox: false` (see Step 6).

- [ ] **Step 5: tsconfigs.**
`packages/desktop/tsconfig.node.json` (main + preload + logic + shared — Node, no DOM):
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"],
    "lib": ["ES2023"]
  },
  "include": ["src/main", "src/preload", "src/logic", "src/shared", "electron.vite.config.ts", "vitest.config.ts"]
}
```
`packages/desktop/tsconfig.json` (renderer — DOM):
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": []
  },
  "include": ["src/renderer", "src/shared", "src/logic"]
}
```
> `@types/node` is available because it's a root dev dependency; `"types": ["node"]` in the node config pulls it in only there, keeping the renderer DOM-only.

- [ ] **Step 6: `packages/desktop/src/main/index.ts`** (window + scheme registration; protocol handler is wired in B5):
```ts
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, protocol } from "electron";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Must run synchronously, before app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "musex-stream",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0d0e12",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
```

- [ ] **Step 7: `packages/desktop/src/preload/index.ts`** (stub bridge; real API added in B6):
```ts
import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("musex", {
  ping: () => "pong",
});
```

- [ ] **Step 8: `packages/desktop/src/renderer/index.html`**
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>musex</title>
  </head>
  <body style="margin:0;background:#0d0e12;color:#e7e9ee;font-family:system-ui">
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 9: `packages/desktop/src/renderer/src/vite-env.d.ts`**
```ts
/// <reference types="vite/client" />

interface MusexApi {
  ping: () => string;
}
declare global {
  interface Window {
    musex: MusexApi;
  }
}
export {};
```

- [ ] **Step 10: `packages/desktop/src/renderer/src/main.tsx`** (stub — replaced in Plan C):
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

function App(): React.JSX.Element {
  return (
    <div style={{ padding: 24 }}>
      <h1>musex</h1>
      <p>Desktop shell is alive. Bridge says: {window.musex.ping()}</p>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 11: `packages/desktop/vitest.config.ts`** (only the electron-free modules):
```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/logic/**/*.test.ts", "src/shared/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
  },
});
```

- [ ] **Step 12: `packages/desktop/electron-builder.yml`** (macOS packaging; not exercised until later but committed now):
```yaml
appId: com.musex.desktop
productName: musex
directories:
  output: release
  buildResources: build
files:
  - out/**/*
mac:
  category: public.app-category.music
  target:
    - target: dmg
      arch: [arm64]
    - target: zip
      arch: [arm64]
```

- [ ] **Step 13: Install + verify the app launches.**
Run: `pnpm install` (from repo root; re-links with the new `.npmrc`). Confirm electron's binary was built (not "ignored build").
Run: `pnpm --filter @musex/desktop typecheck` → no errors.
Run (interactive, the user runs this — it opens a window): `pnpm --filter @musex/desktop dev` → a window opens showing "Desktop shell is alive. Bridge says: pong". Close it.
Run: `pnpm --filter @musex/desktop build` → produces `out/main`, `out/preload`, `out/renderer` with no errors.
> If `pnpm --filter @musex/desktop dev` cannot be run headlessly by an agent, mark this step for the user to run and confirm; do not block on it.

- [ ] **Step 14: Commit.**
```bash
git add -A
git commit -m "desktop: scaffold @musex/desktop electron-vite app shell"
git push origin main
```

---

## Task B2: Pure logic — stream-kind, proxy URL, Plex→core mapping (TDD)

**Files:** `src/logic/stream-kind.ts`(+test), `src/logic/stream-url.ts`(+test), `src/logic/plex-mapping.ts`(+test).

- [ ] **Step 1: Failing tests for `stream-kind.ts`** — `packages/desktop/src/logic/stream-kind.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { chooseStreamKind, CHROMIUM_AUDIO_CODECS } from "./stream-kind";

describe("chooseStreamKind", () => {
  it("returns 'direct' for codecs Chromium decodes", () => {
    for (const codec of ["mp3", "aac", "flac", "opus", "vorbis"]) {
      expect(chooseStreamKind(codec)).toBe("direct");
    }
  });
  it("returns 'hls' (transcode) for codecs Chromium cannot decode", () => {
    for (const codec of ["alac", "dsd", "ape", "wavpack"]) {
      expect(chooseStreamKind(codec)).toBe("hls");
    }
  });
  it("is case-insensitive and defaults unknown codecs to transcode", () => {
    expect(chooseStreamKind("FLAC")).toBe("direct");
    expect(chooseStreamKind("something-weird")).toBe("hls");
    expect(chooseStreamKind(undefined)).toBe("hls");
  });
  it("exposes the supported set", () => {
    expect(CHROMIUM_AUDIO_CODECS.has("flac")).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect FAIL** (`pnpm --filter @musex/desktop test`).

- [ ] **Step 3: Implement `packages/desktop/src/logic/stream-kind.ts`:**
```ts
import type { StreamKind } from "@musex/core";

/** Audio codecs Chromium decodes natively (so we can direct-play). Everything
 *  else falls back to Plex transcoding (HLS). */
export const CHROMIUM_AUDIO_CODECS: ReadonlySet<string> = new Set([
  "mp3",
  "mp2",
  "aac",
  "flac",
  "opus",
  "vorbis",
  "pcm",
  "wav",
]);

export function chooseStreamKind(audioCodec: string | undefined): StreamKind {
  if (!audioCodec) return "hls";
  return CHROMIUM_AUDIO_CODECS.has(audioCodec.toLowerCase()) ? "direct" : "hls";
}
```

- [ ] **Step 4: Run — expect PASS.**

- [ ] **Step 5: Failing tests for `stream-url.ts`** — `packages/desktop/src/logic/stream-url.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildProxyUrl, parseProxyUrl } from "./stream-url";

describe("proxy URL round-trip", () => {
  it("builds a musex-stream URL from a serverId and a plex path (no token)", () => {
    const url = buildProxyUrl("srv-1", "/library/parts/42/file.flac");
    expect(url).toBe("musex-stream://srv-1/library/parts/42/file.flac");
  });
  it("preserves query strings (e.g. transcode params) but strips X-Plex-Token", () => {
    const url = buildProxyUrl("srv-1", "/music/:/transcode/universal/start.m3u8?path=%2Fx&X-Plex-Token=secret&protocol=hls");
    expect(url).toContain("musex-stream://srv-1/music/:/transcode/universal/start.m3u8?");
    expect(url).toContain("path=%2Fx");
    expect(url).toContain("protocol=hls");
    expect(url).not.toContain("X-Plex-Token");
  });
  it("parseProxyUrl recovers the serverId and the plex path+query", () => {
    const parsed = parseProxyUrl("musex-stream://srv-1/library/parts/42/file.flac?foo=bar");
    expect(parsed).toEqual({ serverId: "srv-1", path: "/library/parts/42/file.flac", search: "?foo=bar" });
  });
  it("parseProxyUrl returns null for a non-musex-stream URL", () => {
    expect(parseProxyUrl("https://example.com/x")).toBeNull();
  });
});
```

- [ ] **Step 6: Run — expect FAIL.**

- [ ] **Step 7: Implement `packages/desktop/src/logic/stream-url.ts`:**
```ts
const SCHEME = "musex-stream";

/** Build a token-free proxy URL: musex-stream://{serverId}{plexPath}?{query-minus-token}.
 *  `plexPathWithQuery` is a server-relative path, optionally with a query string. */
export function buildProxyUrl(serverId: string, plexPathWithQuery: string): string {
  const [path, query = ""] = plexPathWithQuery.split("?", 2);
  const params = new URLSearchParams(query);
  params.delete("X-Plex-Token");
  const qs = params.toString();
  return `${SCHEME}://${serverId}${path}${qs ? `?${qs}` : ""}`;
}

export interface ParsedProxyUrl {
  serverId: string;
  path: string;
  search: string; // includes leading "?" or is ""
}

export function parseProxyUrl(url: string): ParsedProxyUrl | null {
  if (!url.startsWith(`${SCHEME}://`)) return null;
  const u = new URL(url);
  return { serverId: u.hostname, path: u.pathname, search: u.search };
}
```
> Note: a privileged "standard" scheme parses like http, so `URL` works and `u.hostname` is the serverId. Keep serverIds URL-safe (Plex `machineIdentifier` values are).

- [ ] **Step 8: Run — expect PASS.**

- [ ] **Step 9: Failing tests for `plex-mapping.ts`** — `packages/desktop/src/logic/plex-mapping.test.ts`. These map plain objects shaped like @ctrl/plex results into core models, so no @ctrl/plex import is needed:
```ts
import { describe, expect, it } from "vitest";
import { toAlbum, toArtist, toTrack } from "./plex-mapping";

describe("plex-mapping", () => {
  it("maps an artist", () => {
    const a = toArtist({ ratingKey: "10", title: "Radiohead", thumb: "/t.jpg" }, "srv-1");
    expect(a).toEqual({ id: "10", serverId: "srv-1", name: "Radiohead", thumb: "/t.jpg" });
  });
  it("maps an album with year + parent artist id", () => {
    const al = toAlbum(
      { ratingKey: "20", title: "In Rainbows", year: 2007, thumb: "/a.jpg", parentRatingKey: "10" },
      "srv-1",
    );
    expect(al).toEqual({
      id: "20",
      serverId: "srv-1",
      artistId: "10",
      title: "In Rainbows",
      year: 2007,
      thumb: "/a.jpg",
    });
  });
  it("maps a track with media/part and denormalized titles", () => {
    const t = toTrack(
      {
        ratingKey: "30",
        title: "Nude",
        index: 3,
        duration: 254000,
        parentRatingKey: "20",
        parentTitle: "In Rainbows",
        grandparentTitle: "Radiohead",
        media: [
          {
            audioCodec: "flac",
            bitrate: 900,
            container: "flac",
            parts: [{ id: 99, key: "/library/parts/99/file.flac", container: "flac" }],
          },
        ],
      },
      "srv-1",
    );
    expect(t).toEqual({
      id: "30",
      serverId: "srv-1",
      albumId: "20",
      albumTitle: "In Rainbows",
      artistName: "Radiohead",
      title: "Nude",
      trackNumber: 3,
      durationMs: 254000,
      media: { container: "flac", audioCodec: "flac", bitrate: 900, partId: "99", partKey: "/library/parts/99/file.flac" },
    });
  });
  it("throws if a track has no playable media part (not silently dropped)", () => {
    expect(() => toTrack({ ratingKey: "31", title: "x", duration: 1, media: [] }, "srv-1")).toThrow();
  });
});
```

- [ ] **Step 10: Run — expect FAIL.**

- [ ] **Step 11: Implement `packages/desktop/src/logic/plex-mapping.ts`** (loosely-typed inputs — we only read the fields we map; the adapter passes real @ctrl/plex objects which are structurally compatible):
```ts
import type { Album, Artist, MediaInfo, Track } from "@musex/core";

interface RawArtist {
  ratingKey: string;
  title: string;
  thumb?: string;
}
interface RawAlbum {
  ratingKey: string;
  title: string;
  year?: number;
  thumb?: string;
  parentRatingKey?: string;
}
interface RawPart {
  id: string | number;
  key: string;
  container?: string;
}
interface RawMedia {
  audioCodec?: string;
  container?: string;
  bitrate?: number;
  parts?: RawPart[];
}
interface RawTrack {
  ratingKey: string;
  title: string;
  index?: number;
  duration?: number;
  parentRatingKey?: string;
  parentTitle?: string;
  grandparentTitle?: string;
  media?: RawMedia[];
}

export function toArtist(raw: RawArtist, serverId: string): Artist {
  return { id: raw.ratingKey, serverId, name: raw.title, thumb: raw.thumb };
}

export function toAlbum(raw: RawAlbum, serverId: string): Album {
  return {
    id: raw.ratingKey,
    serverId,
    artistId: raw.parentRatingKey ?? "",
    title: raw.title,
    year: raw.year,
    thumb: raw.thumb,
  };
}

export function toTrack(raw: RawTrack, serverId: string): Track {
  const media = raw.media?.[0];
  const part = media?.parts?.[0];
  if (!media || !part) {
    throw new Error(`Track ${raw.ratingKey} ("${raw.title}") has no playable media part`);
  }
  const info: MediaInfo = {
    container: part.container ?? media.container ?? "",
    audioCodec: media.audioCodec ?? "",
    bitrate: media.bitrate,
    partId: String(part.id),
    partKey: part.key,
  };
  return {
    id: raw.ratingKey,
    serverId,
    albumId: raw.parentRatingKey ?? "",
    albumTitle: raw.parentTitle,
    artistName: raw.grandparentTitle ?? "",
    title: raw.title,
    trackNumber: raw.index,
    durationMs: raw.duration ?? 0,
    media: info,
  };
}
```

- [ ] **Step 12: Run — expect PASS.** Then `pnpm --filter @musex/desktop typecheck` and `pnpm exec biome check --write .`.

- [ ] **Step 13: Commit.**
```bash
git add -A
git commit -m "desktop: pure stream-kind, proxy-url, and Plex->core mapping (tested)"
git push origin main
```

---

## Task B3: Storage adapters — TokenStore (safeStorage) + persistence (electron-store)

**Files:** `src/main/adapters/token-store.ts`, `src/main/adapters/persistence.ts`. (Electron-bound; verified manually + wired in B6. No unit tests — keep them thin.)

- [ ] **Step 1: `packages/desktop/src/main/adapters/token-store.ts`** — implements core's `TokenStore`:
```ts
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { app, safeStorage } from "electron";
import type { TokenStore } from "@musex/core";

/** Persists the Plex token encrypted via the OS keychain (macOS Keychain).
 *  safeStorage only encrypts/decrypts — we persist the ciphertext to userData. */
export class SafeStorageTokenStore implements TokenStore {
  private readonly file = join(app.getPath("userData"), "plex-token.enc");

  async save(token: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("OS secure storage is unavailable; cannot persist Plex token");
    }
    const buf = await safeStorage.encryptStringAsync(token);
    writeFileSync(this.file, buf);
  }

  async load(): Promise<string | null> {
    if (!existsSync(this.file) || !safeStorage.isEncryptionAvailable()) return null;
    const buf = readFileSync(this.file);
    const { result } = await safeStorage.decryptStringAsync(buf);
    return result;
  }

  async clear(): Promise<void> {
    if (existsSync(this.file)) rmSync(this.file);
  }
}
```
> `encryptStringAsync`/`decryptStringAsync` are the current async API (Electron 42). If a `typecheck` shows they are unavailable in the installed `electron` typings, fall back to the sync `encryptString`/`decryptString` (Buffer in/out) and note it — but verify against the installed version's types first.

- [ ] **Step 2: `packages/desktop/src/main/adapters/persistence.ts`** — wraps `electron-store` with a typed schema; provides the stable client-id:
```ts
import { randomUUID } from "node:crypto";
import Store from "electron-store";

export interface PersistedState {
  clientId: string;
  selectedLibraryId: string | null;
  selectedServerId: string | null;
  volume: number;
}

const store = new Store<PersistedState>({
  defaults: {
    clientId: "",
    selectedLibraryId: null,
    selectedServerId: null,
    volume: 1,
  },
});

/** A stable per-install Plex client identifier (generated once, then reused). */
export function getClientId(): string {
  let id = store.get("clientId");
  if (!id) {
    id = randomUUID();
    store.set("clientId", id);
  }
  return id;
}

export const persistence = {
  getSelection(): { serverId: string | null; libraryId: string | null } {
    return { serverId: store.get("selectedServerId"), libraryId: store.get("selectedLibraryId") };
  },
  setSelection(serverId: string, libraryId: string): void {
    store.set("selectedServerId", serverId);
    store.set("selectedLibraryId", libraryId);
  },
  getVolume(): number {
    return store.get("volume");
  },
  setVolume(v: number): void {
    store.set("volume", v);
  },
};
```

- [ ] **Step 3: Typecheck.** `pnpm --filter @musex/desktop typecheck` → no errors. (These are exercised at runtime in B6; there are no unit tests because they are thin wrappers over Electron APIs.)

- [ ] **Step 4: Commit.**
```bash
git add -A
git commit -m "desktop: TokenStore (safeStorage) and electron-store persistence adapters"
git push origin main
```

---

## Task B4: `PlexGateway` adapter (@ctrl/plex)

**Files:** `src/main/adapters/plex-gateway.ts`, and an opt-in smoke test `src/main/adapters/plex-gateway.smoke.test.ts` (env-gated, NOT in `pnpm check`).

- [ ] **Step 1: Implement `packages/desktop/src/main/adapters/plex-gateway.ts`.** It implements core's `PlexGateway`, using `@ctrl/plex` for everything except the single-shot `pollPin` (hand-rolled per the verified API), and the pure mappers from B2.
```ts
import { MyPlexAccount } from "@ctrl/plex/myplex.js";
import { BASE_HEADERS } from "@ctrl/plex/config.js";
import type { Album, Artist, Library, Pin, PlexGateway, Server, Track } from "@musex/core";
import { PlexAuthError } from "@musex/core";
import { toAlbum, toArtist, toTrack } from "../../logic/plex-mapping.js";
import { getClientId } from "./persistence.js";

const PRODUCT = "musex";

/** Set a stable client identifier (default is MAC-derived). Call once at startup. */
export function initPlexIdentity(): void {
  BASE_HEADERS["X-Plex-Client-Identifier"] = getClientId();
  BASE_HEADERS["X-Plex-Product"] = PRODUCT;
}

export class PlexapiGateway implements PlexGateway {
  // Cache connected servers by id so browse calls don't reconnect each time.
  private readonly servers = new Map<string, Awaited<ReturnType<MyPlexAccount["resource"]>>>();

  async createPin(): Promise<Pin> {
    const web = await MyPlexAccount.getWebLogin();
    return { id: String(web.id), code: web.code, authUrl: web.uri };
  }

  async pollPin(id: string): Promise<{ authToken: string | null }> {
    // Single-shot poll (the core signIn use-case owns the loop/timeout).
    const res = await fetch(`https://plex.tv/api/v2/pins/${id}`, {
      headers: {
        accept: "application/json",
        "X-Plex-Client-Identifier": getClientId(),
        "X-Plex-Product": PRODUCT,
      },
    });
    if (res.status === 401 || res.status === 403) throw new PlexAuthError();
    if (!res.ok) return { authToken: null };
    const body = (await res.json()) as { authToken: string | null };
    return { authToken: body.authToken ?? null };
  }

  async listServers(token: string): Promise<Server[]> {
    const resources = await this.account(token).resources();
    return resources
      .filter((r) => r.provides?.includes("server"))
      .map((r) => ({
        id: r.clientIdentifier,
        name: r.name,
        connections: (r.connections ?? []).map((c) => ({
          uri: c.uri,
          local: Boolean(c.local),
          relay: Boolean(c.relay),
        })),
      }));
  }

  async listMusicLibraries(server: Server, token: string): Promise<Library[]> {
    const plexServer = await this.connect(server, token);
    const library = await plexServer.library();
    const sections = await library.sections();
    return sections
      .filter((s) => s.type === "artist") // music sections are type "artist"
      .map((s) => ({
        id: String(s.key),
        serverId: server.id,
        serverName: server.name,
        title: s.title,
        type: "music" as const,
      }));
  }

  async listArtists(library: Library, token: string): Promise<Artist[]> {
    const section = await this.musicSection(library, token);
    const artists = await section.searchArtists();
    return artists.map((a) => toArtist(a, library.serverId));
  }

  async listAlbums(library: Library, artistId: string, token: string): Promise<Album[]> {
    const plexServer = await this.connect({ id: library.serverId } as Server, token);
    const artist = await plexServer.fetchItem(`/library/metadata/${artistId}`);
    const albums = await artist.albums();
    return albums.map((al) => toAlbum(al, library.serverId));
  }

  async listTracks(library: Library, albumId: string, token: string): Promise<Track[]> {
    const plexServer = await this.connect({ id: library.serverId } as Server, token);
    const album = await plexServer.fetchItem(`/library/metadata/${albumId}`);
    const tracks = await album.tracks();
    return tracks.map((t) => toTrack(t, library.serverId));
  }

  // --- internal helpers ---

  private account(token: string): MyPlexAccount {
    return new MyPlexAccount({ token });
  }

  private async connect(server: Server, token: string) {
    const cached = this.servers.get(server.id);
    if (cached) return cached;
    const account = this.account(token);
    await account.connect();
    const resources = await account.resources();
    const resource = resources.find((r) => r.clientIdentifier === server.id);
    if (!resource) throw new Error(`Plex server ${server.id} not found for this account`);
    const plexServer = await resource.connect();
    this.servers.set(server.id, plexServer as never);
    return plexServer as never;
  }

  private async musicSection(library: Library, token: string) {
    const plexServer = await this.connect({ id: library.serverId } as Server, token);
    const lib = await plexServer.library();
    return lib.sectionByID(Number(library.id));
  }
}
```
> The exact `@ctrl/plex` subpath imports (`@ctrl/plex/myplex.js`, `/config.js`), the `fetchItem`/`albums()`/`tracks()`/`searchArtists()` method names, and `connections`/`provides` fields were verified from the v6 source during research, but **confirm them against the installed package's `.d.ts`** while implementing; adjust import paths/method names to what the installed types expose, keeping the same behavior. The `as never` casts bridge @ctrl/plex's concrete classes to our cache map; refine the types to the real classes if the typings make it easy.

- [ ] **Step 2: Catch 401 as `PlexAuthError` in browse/discovery too.** Where @ctrl/plex throws an HTTP error for an unauthorized token, wrap/translate it to `PlexAuthError` so the core treats it as a re-auth trigger (the `pollPin` path already does this). Add a small helper `asPlexError(err)` that detects a 401/403 status on the thrown error and rethrows `new PlexAuthError()`, used in `account.connect()`/`resources()` calls. Implement minimally based on what @ctrl/plex actually throws (inspect during implementation).

- [ ] **Step 3: Opt-in smoke test** — `packages/desktop/src/main/adapters/plex-gateway.smoke.test.ts`. This is **not** part of `pnpm check` (the desktop `vitest.config.ts` only includes `src/logic`/`src/shared`). It is run explicitly against a real account when desired:
```ts
import { describe, expect, it } from "vitest";
import { PlexapiGateway, initPlexIdentity } from "./plex-gateway";

const TOKEN = process.env.MUSEX_PLEX_E2E;
const run = TOKEN ? describe : describe.skip;

run("PlexapiGateway (real Plex, env-gated)", () => {
  it("discovers servers and lists music libraries + a first artist/album/tracks", async () => {
    initPlexIdentity();
    const gw = new PlexapiGateway();
    const servers = await gw.listServers(TOKEN!);
    expect(servers.length).toBeGreaterThan(0);
    const libs = await gw.listMusicLibraries(servers[0]!, TOKEN!);
    expect(libs.length).toBeGreaterThan(0);
    const artists = await gw.listArtists(libs[0]!, TOKEN!);
    expect(artists.length).toBeGreaterThan(0);
    const albums = await gw.listAlbums(libs[0]!, artists[0]!.id, TOKEN!);
    if (albums.length) {
      const tracks = await gw.listTracks(libs[0]!, albums[0]!.id, TOKEN!);
      expect(tracks[0]?.media.partKey).toMatch(/^\/library\/parts\//);
    }
  }, 30_000);
});
```
> To run it: `MUSEX_PLEX_E2E=<token> pnpm --filter @musex/desktop exec vitest run src/main/adapters/plex-gateway.smoke.test.ts`. This is the real-Plex validation of `@ctrl/plex`. If any method/import is wrong, this is where it surfaces — fix the adapter (not the test) and document any deviation from the assumed API in `CLAUDE.md`.

- [ ] **Step 4: Typecheck + commit.** `pnpm --filter @musex/desktop typecheck`, `pnpm exec biome check --write .`, then:
```bash
git add -A
git commit -m "desktop: PlexGateway adapter over @ctrl/plex with single-shot pollPin"
git push origin main
```

---

## Task B5: Stream proxy — `protocol.handle('musex-stream')`

**Files:** `src/main/adapters/stream-proxy.ts`.

- [ ] **Step 1: Implement `packages/desktop/src/main/adapters/stream-proxy.ts`.** It registers the protocol handler and provides the resolution (`Track` → `{url, kind}`) that the IPC layer exposes to the renderer as the `StreamResolver`. The handler maps `musex-stream://{serverId}{path}` back to the connected server's base URL + token.
```ts
import { net, protocol } from "electron";
import type { Server, StreamRef, Track } from "@musex/core";
import { chooseStreamKind } from "../../logic/stream-kind.js";
import { buildProxyUrl, parseProxyUrl } from "../../logic/stream-url.js";

/** Per-server connection info needed to fulfil a proxied stream request. */
export interface ServerEndpoint {
  baseUrl: string; // e.g. http://192.168.1.10:32400
  token: string; // per-server access token
}

export class StreamProxy {
  /** serverId -> live endpoint, populated when a server is connected/selected. */
  private readonly endpoints = new Map<string, ServerEndpoint>();

  registerServer(server: Server, endpoint: ServerEndpoint): void {
    this.endpoints.set(server.id, endpoint);
  }

  /** Called once in app.whenReady. */
  install(): void {
    protocol.handle("musex-stream", async (request) => {
      const parsed = parseProxyUrl(request.url);
      if (!parsed) return new Response("bad request", { status: 400 });
      const endpoint = this.endpoints.get(parsed.serverId);
      if (!endpoint) return new Response("unknown server", { status: 404 });

      const upstream = new URL(endpoint.baseUrl);
      upstream.pathname = parsed.path;
      upstream.search = parsed.search;
      upstream.searchParams.set("X-Plex-Token", endpoint.token);

      const headers = new Headers();
      const range = request.headers.get("Range");
      if (range) headers.set("Range", range);

      const res = await net.fetch(upstream.toString(), { method: "GET", headers });
      return new Response(res.body, { status: res.status, headers: res.headers });
    });
  }

  /** Resolve a track to a token-free proxy URL + kind, for the renderer engine. */
  resolve(track: Track): StreamRef {
    const kind = chooseStreamKind(track.media.audioCodec);
    const path =
      kind === "direct"
        ? track.media.partKey
        : `/music/:/transcode/universal/start.m3u8?path=${encodeURIComponent(
            `/library/metadata/${track.id}`,
          )}&protocol=hls&directStreamAudio=1`;
    return { url: buildProxyUrl(track.serverId, path), kind };
  }
}
```
> The transcode path here is the audio-universal-transcoder form; the research noted `@ctrl/plex`'s `getStreamURL` targets the video endpoint but works for audio. Either is acceptable — if `getStreamURL` is preferred, build the path from it (stripping the token) instead. Confirm the transcoded HLS actually plays end-to-end during Plan C; the direct path is the priority for slice 1.

- [ ] **Step 2: Manual verification (deferred to wiring in B6 / Plan C).** The proxy can only be exercised once a server is connected and a real URL is requested by an `<audio>` element. Add a checklist note: after B6 wiring, confirm a direct-play track streams and that seeking issues `Range` requests returning `206` (observable in the main-process net logs). No automated test here (it requires Electron + a live server); the pure URL mapping is already covered by B2.

- [ ] **Step 3: Typecheck + commit.**
```bash
git add -A
git commit -m "desktop: musex-stream:// audio proxy via protocol.handle"
git push origin main
```

---

## Task B6: IPC contract + main handlers + preload bridge

**Files:** `src/shared/ipc-contract.ts`(+test), `src/main/runtime.ts`, `src/main/ipc.ts`, modify `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/src/vite-env.d.ts`, `src/renderer/src/main.tsx`.

- [ ] **Step 1: `packages/desktop/src/shared/ipc-contract.ts`** — the typed surface shared by main/preload/renderer (no electron import). The renderer-facing API is token-free; main injects the token.
```ts
import type { Album, Artist, Library, Server, StreamRef, Track } from "@musex/core";

export const IPC = {
  signInStart: "musex:signIn:start", // -> { code: string; authUrl: string }
  signInPoll: "musex:signIn:poll", // -> { status: 'pending' | 'ok' | 'error' }
  discoverLibraries: "musex:discoverLibraries", // -> { libraries: Library[]; unreachable: Server[] }
  selectLibrary: "musex:selectLibrary", // (libraryId) -> void
  listArtists: "musex:listArtists", // (libraryId) -> Artist[]
  listAlbums: "musex:listAlbums", // (libraryId, artistId) -> Album[]
  listTracks: "musex:listTracks", // (libraryId, albumId) -> Track[]
  resolveStream: "musex:resolveStream", // (track) -> StreamRef
  getVolume: "musex:getVolume", // -> number
  setVolume: "musex:setVolume", // (v) -> void
} as const;

export type SignInStartResult = { code: string; authUrl: string };
export type SignInPollResult = { status: "pending" | "ok" | "error"; message?: string };
export type DiscoverResult = { libraries: Library[]; unreachable: Server[] };

/** The API exposed on window.musex by the preload bridge. */
export interface MusexApi {
  signInStart(): Promise<SignInStartResult>;
  signInPoll(): Promise<SignInPollResult>;
  discoverLibraries(): Promise<DiscoverResult>;
  selectLibrary(libraryId: string): Promise<void>;
  listArtists(libraryId: string): Promise<Artist[]>;
  listAlbums(libraryId: string, artistId: string): Promise<Album[]>;
  listTracks(libraryId: string, albumId: string): Promise<Track[]>;
  resolveStream(track: Track): Promise<StreamRef>;
  getVolume(): Promise<number>;
  setVolume(v: number): Promise<void>;
}
```

- [ ] **Step 2: Test the contract is internally consistent** — `packages/desktop/src/shared/ipc-contract.test.ts` (guards against a channel name typo / drift between `IPC` keys and `MusexApi`):
```ts
import { describe, expect, it } from "vitest";
import { IPC } from "./ipc-contract";

describe("IPC contract", () => {
  it("has unique, namespaced channel strings", () => {
    const values = Object.values(IPC);
    expect(new Set(values).size).toBe(values.length);
    for (const v of values) expect(v.startsWith("musex:")).toBe(true);
  });
});
```
Run: `pnpm --filter @musex/desktop test` (expect pass once the file exists; this is a light guard, not TDD-red-first).

- [ ] **Step 3: `packages/desktop/src/main/runtime.ts`** — holds the app's live state (token, gateway, selected library, stream proxy) and the in-flight sign-in:
```ts
import type { Library, Pin } from "@musex/core";
import { PlexapiGateway, initPlexIdentity } from "./adapters/plex-gateway.js";
import { SafeStorageTokenStore } from "./adapters/token-store.js";
import { StreamProxy } from "./adapters/stream-proxy.js";

export class Runtime {
  readonly gateway = new PlexapiGateway();
  readonly tokenStore = new SafeStorageTokenStore();
  readonly proxy = new StreamProxy();
  token: string | null = null;
  libraries: Library[] = [];

  private pendingPin: Pin | null = null;

  init(): void {
    initPlexIdentity();
    this.proxy.install();
  }

  async restore(): Promise<void> {
    this.token = await this.tokenStore.load();
  }

  async signInStart(): Promise<{ code: string; authUrl: string }> {
    this.pendingPin = await this.gateway.createPin();
    return { code: this.pendingPin.code, authUrl: this.pendingPin.authUrl };
  }

  async signInPoll(): Promise<{ status: "pending" | "ok" | "error"; message?: string }> {
    if (!this.pendingPin) return { status: "error", message: "no sign-in in progress" };
    const { authToken } = await this.gateway.pollPin(this.pendingPin.id);
    if (!authToken) return { status: "pending" };
    this.token = authToken;
    await this.tokenStore.save(authToken);
    this.pendingPin = null;
    return { status: "ok" };
  }

  requireToken(): string {
    if (!this.token) throw new Error("not signed in");
    return this.token;
  }

  findLibrary(libraryId: string): Library {
    const lib = this.libraries.find((l) => l.id === libraryId);
    if (!lib) throw new Error(`unknown library ${libraryId}`);
    return lib;
  }
}
```
> The runtime drives a renderer-friendly start/poll split rather than calling core's `signIn` use-case directly, because a single `invoke` that blocks up to 30 minutes would be poor UX. Core's `signIn` remains the canonical reference for the flow + timeout — reuse it if you ever run the whole loop in main.

- [ ] **Step 4: `packages/desktop/src/main/ipc.ts`** — register handlers. After discovering libraries, register each reachable server's endpoint with the proxy:
```ts
import { ipcMain } from "electron";
import { discoverMusicLibraries } from "@musex/core";
import type { Track } from "@musex/core";
import { IPC } from "../shared/ipc-contract.js";
import { persistence } from "./adapters/persistence.js";
import type { Runtime } from "./runtime.js";

export function registerIpc(rt: Runtime): void {
  ipcMain.handle(IPC.signInStart, () => rt.signInStart());
  ipcMain.handle(IPC.signInPoll, () => rt.signInPoll());

  ipcMain.handle(IPC.discoverLibraries, async () => {
    const token = rt.requireToken();
    const result = await discoverMusicLibraries(rt.gateway, token);
    rt.libraries = result.libraries;
    // register stream endpoints for each reachable server
    for (const server of await rt.gateway.listServers(token)) {
      const reachable = server.connections.find((c) => c.uri);
      if (reachable) {
        rt.proxy.registerServer(server, { baseUrl: reachable.uri, token });
      }
    }
    return result;
  });

  ipcMain.handle(IPC.selectLibrary, (_e, libraryId: string) => {
    const lib = rt.findLibrary(libraryId);
    persistence.setSelection(lib.serverId, lib.id);
  });

  ipcMain.handle(IPC.listArtists, (_e, libraryId: string) =>
    rt.gateway.listArtists(rt.findLibrary(libraryId), rt.requireToken()),
  );
  ipcMain.handle(IPC.listAlbums, (_e, libraryId: string, artistId: string) =>
    rt.gateway.listAlbums(rt.findLibrary(libraryId), artistId, rt.requireToken()),
  );
  ipcMain.handle(IPC.listTracks, (_e, libraryId: string, albumId: string) =>
    rt.gateway.listTracks(rt.findLibrary(libraryId), albumId, rt.requireToken()),
  );

  ipcMain.handle(IPC.resolveStream, (_e, track: Track) => rt.proxy.resolve(track));

  ipcMain.handle(IPC.getVolume, () => persistence.getVolume());
  ipcMain.handle(IPC.setVolume, (_e, v: number) => {
    if (typeof v !== "number" || v < 0 || v > 1) throw new Error("invalid volume");
    persistence.setVolume(v);
  });
}
```
> The per-server endpoint here uses the resource's first connection URI + the account token for simplicity. Refine to the per-server `accessToken` and a reachability check (try connections in order) as a follow-up; for a single-server home setup this is sufficient and keeps slice 1 moving.

- [ ] **Step 5: Wire runtime + IPC into `src/main/index.ts`.** Add near the top (module scope, after imports): construct the runtime is done in `whenReady`. Modify the `app.whenReady().then(...)` block to:
```ts
import { Runtime } from "./runtime.js";
import { registerIpc } from "./ipc.js";

// ... inside app.whenReady().then(async () => { ... }) BEFORE createWindow():
  const runtime = new Runtime();
  runtime.init();
  await runtime.restore();
  registerIpc(runtime);
  createWindow();
```
(Keep the `protocol.registerSchemesAsPrivileged` call at module top level as in B1.)

- [ ] **Step 6: Real preload bridge `src/preload/index.ts`** — expose the typed API, each channel wrapped explicitly:
```ts
import { contextBridge, ipcRenderer } from "electron";
import { IPC } from "../shared/ipc-contract.js";
import type { MusexApi } from "../shared/ipc-contract.js";

const api: MusexApi = {
  signInStart: () => ipcRenderer.invoke(IPC.signInStart),
  signInPoll: () => ipcRenderer.invoke(IPC.signInPoll),
  discoverLibraries: () => ipcRenderer.invoke(IPC.discoverLibraries),
  selectLibrary: (libraryId) => ipcRenderer.invoke(IPC.selectLibrary, libraryId),
  listArtists: (libraryId) => ipcRenderer.invoke(IPC.listArtists, libraryId),
  listAlbums: (libraryId, artistId) => ipcRenderer.invoke(IPC.listAlbums, libraryId, artistId),
  listTracks: (libraryId, albumId) => ipcRenderer.invoke(IPC.listTracks, libraryId, albumId),
  resolveStream: (track) => ipcRenderer.invoke(IPC.resolveStream, track),
  getVolume: () => ipcRenderer.invoke(IPC.getVolume),
  setVolume: (v) => ipcRenderer.invoke(IPC.setVolume, v),
};

contextBridge.exposeInMainWorld("musex", api);
```

- [ ] **Step 7: Update renderer typing + stub.** Replace `src/renderer/src/vite-env.d.ts` body's `MusexApi` with an import of the shared one:
```ts
/// <reference types="vite/client" />
import type { MusexApi } from "../../shared/ipc-contract";

declare global {
  interface Window {
    musex: MusexApi;
  }
}
export {};
```
Update `src/renderer/src/main.tsx` stub to prove an IPC round-trip (e.g. a button that calls `window.musex.signInStart()` and shows the returned `code`/`authUrl`). This is throwaway — Plan C builds the real UI — but it lets you manually verify sign-in end-to-end:
```tsx
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

function App(): React.JSX.Element {
  const [info, setInfo] = useState<string>("");
  return (
    <div style={{ padding: 24 }}>
      <h1>musex</h1>
      <button
        type="button"
        onClick={async () => {
          const { code, authUrl } = await window.musex.signInStart();
          setInfo(`code ${code} — open ${authUrl}`);
        }}
      >
        Start Plex sign-in
      </button>
      <pre>{info}</pre>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 8: Verify.** `pnpm --filter @musex/desktop typecheck` (both tsconfigs) and `pnpm check` from root (all unit tests incl. the IPC-contract guard + the B2 logic tests green, Biome clean). Then the manual end-to-end (user runs): `pnpm --filter @musex/desktop dev`, click "Start Plex sign-in", confirm a real `plex.tv` code + URL come back, approve in browser, and — with a follow-up poll button or auto-poll — confirm `discoverLibraries` returns the real music library. (Auto-poll + nicer UI is Plan C; this is just the plumbing proof.)

- [ ] **Step 9: Commit.**
```bash
git add -A
git commit -m "desktop: typed IPC contract, main handlers, preload bridge"
git push origin main
```

---

## Done criteria (Plan B)

- `pnpm check` green: core (incl. `onAdvanced`) + desktop pure-logic + IPC-contract tests; typecheck for both desktop tsconfigs; Biome clean.
- `pnpm --filter @musex/desktop dev` launches a window; the stub can start a real Plex PIN sign-in and (after approval) discover the real music library over IPC.
- Token is stored encrypted (safeStorage); never crosses IPC to the renderer.
- `musex-stream://` protocol is registered and resolves track URLs (full playback exercised in Plan C).
- The opt-in `plex-gateway.smoke.test.ts` passes against the real server (run manually with `MUSEX_PLEX_E2E`).

**Deliberately NOT in Plan B (→ Plan C):** the Gapless-5/hls.js `PlaybackEngine` adapter, the real React UI (sign-in screen, library browse, Now Playing bar), wiring `PlaybackSession` + the IPC-backed `StreamResolver`, and actual audio playback.

---

## Known risks / confirm-during-implementation

1. **`@ctrl/plex` exact import paths + method names** (`MyPlexAccount.getWebLogin`, `resource.connect()`, `library.sectionByID`, `searchArtists`, `albums()`, `tracks()`, `fetchItem`, `BASE_HEADERS`): verified from v6 source in research, but confirm against the installed `.d.ts` and fix imports/names to match — the smoke test (B4 Step 3) is the gate.
2. **safeStorage async methods** availability in the installed `electron` typings (B3 Step 1 fallback noted).
3. **electron-vite ESM preload**: with `sandbox: false` the ESM preload should load; if the bridge isn't present on `window.musex` at runtime, verify the preload output path (`../preload/index.mjs`) matches electron-vite's actual emitted filename, and adjust.
4. **electron-builder + pnpm**: `node-linker=hoisted` + `allowBuilds: electron` must take effect; if `pnpm install` reports electron's build was ignored, run `pnpm rebuild electron` (or `pnpm approve-builds`) and confirm before packaging.
5. **Transcoded HLS through the custom protocol**: relative segment resolution is preserved by the path-preserving URL scheme, but confirm end-to-end in Plan C; direct-play is the slice-1 priority.
