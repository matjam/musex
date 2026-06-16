# iOS Foundation (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A React Native (Expo SDK 56 + dev client) iOS app that signs into Plex, browses Artists → Albums → Tracks, and plays a queue through `expo-audio`, proving `@musex/core` + its four ports port to mobile.

**Architecture:** New `packages/mobile` Expo app, a thin adapter over the pure `@musex/core` (consumed as TS source via Metro). Four port adapters (`TokenStore`→expo-secure-store, `PlexGateway`→hand-rolled `fetch`, `StreamResolver`→codec-decision, `PlaybackEngine`→expo-audio) plus a small app-local state store hosting the core `PlaybackSession`.

**Tech Stack:** Expo SDK 56, React Native 0.85 (New Architecture), `expo-audio`, `expo-router`, `expo-secure-store`, `react-native-url-polyfill`, Metro (monorepo), Vitest + Biome + tsc.

**Spec:** `docs/superpowers/specs/2026-06-15-ios-foundation-design.md`

**Conventions for the implementer:**
- The repo uses pnpm workspaces (`nodeLinker: hoisted`). Run all `pnpm` commands from the repo root unless told otherwise; filter with `--filter @musex/mobile`.
- `@musex/core` is **pure** — never add Node/DOM/Electron/RN imports to it. New pure logic could go in core, but Phase 1 keeps mobile-only adapters in `packages/mobile`.
- TypeScript base config (`tsconfig.base.json`) sets `moduleResolution: "Bundler"`, `verbatimModuleSyntax: true` (use `import type`/`export type`), `noUncheckedIndexedAccess: true`.
- Biome ignores `_`-prefixed unused params. `pnpm check` at the root is the bar (biome + tsc + vitest across packages).
- **Verify every Expo dependency version before pinning** with `npx expo install --check` / `npm view <pkg> version`; never trust a version written in this plan from memory — `expo install` resolves the SDK-56-correct version. When a step pins a version, it is a starting point; let `expo install` correct it.
- Commit after each task with a conventional-commit message (`feat:` / `chore:` / `test:`). Push is handled at the branch level; commit locally per task.

---

## File structure (what gets created)

```
packages/mobile/
  package.json                      # @musex/mobile, expo deps, scripts
  app.json                          # Expo config (plugins, iOS bundle id, bg-audio groundwork)
  tsconfig.json                     # extends ../../tsconfig.base.json
  babel.config.js                   # babel-preset-expo
  metro.config.js                   # monorepo watchFolders + resolver
  vitest.config.ts                  # node env, for adapter/pure unit tests
  index.ts                          # entry: import polyfills, then expo-router/entry
  src/
    polyfills.ts                    # URL + structuredClone for Hermes
    config.ts                       # CLIENT_ID (stable per install), PLEX_PRODUCT headers
    adapters/
      token-store.ts                # TokenStore via expo-secure-store
      token-store.test.ts
      stream-resolver.ts            # StreamResolver port impl (wraps logic/stream-ref)
      audio-engine.ts               # PlaybackEngine via expo-audio
      audio-engine.smoke.test.ts    # env-gated (MUSEX_AUDIO_E2E)
      plex-gateway.ts               # PlexGateway via fetch
      plex-gateway.test.ts
    logic/
      stream-ref.ts                 # PURE: codec decision + URL building
      stream-ref.test.ts
      plex-parse.ts                 # PURE: PMS JSON -> core models
      plex-parse.test.ts
      plex-headers.ts               # PURE: X-Plex-* header builder
    state/
      store.tsx                     # React context + reducer; hosts PlaybackSession
    ui/
      theme.ts                      # minimal colors/spacing constants
      Spinner.tsx, Row.tsx          # tiny shared primitives
  app/                              # expo-router routes
    _layout.tsx                     # Stack + StoreProvider + bootstrap
    index.tsx                       # gate: -> sign-in or -> library
    sign-in.tsx
    picker.tsx                      # server/library picker
    artists.tsx
    albums.tsx                      # params: artistId
    tracks.tsx                      # params: albumId
    _components/MiniPlayer.tsx
```

---

## Task 1: Scaffold the Expo package + workspace wiring

**Files:**
- Create: `packages/mobile/package.json`
- Create: `packages/mobile/app.json`
- Create: `packages/mobile/tsconfig.json`
- Create: `packages/mobile/babel.config.js`
- Modify: `.gitignore`

- [ ] **Step 1: Create `packages/mobile/package.json`**

```json
{
  "name": "@musex/mobile",
  "version": "0.0.0",
  "private": true,
  "main": "index.ts",
  "scripts": {
    "start": "expo start --dev-client",
    "ios": "expo run:ios",
    "prebuild": "expo prebuild --platform ios",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@musex/core": "workspace:*",
    "expo": "^56.0.0",
    "expo-audio": "*",
    "expo-router": "*",
    "expo-secure-store": "*",
    "expo-constants": "*",
    "expo-linking": "*",
    "react": "19.2.0",
    "react-native": "0.85.0",
    "react-native-url-polyfill": "^2.0.0",
    "react-native-safe-area-context": "*",
    "react-native-screens": "*"
  },
  "devDependencies": {
    "@types/react": "~19.2.0",
    "babel-preset-expo": "*",
    "typescript": "6.0.3",
    "vitest": "4.1.8"
  }
}
```

Note: the `"*"` Expo packages are corrected to SDK-56-exact versions by `expo install` in Step 5. `react`/`react-native`/`expo` are starting points — verify against the SDK 56 release notes.

- [ ] **Step 2: Create `packages/mobile/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022"],
    "types": ["react", "vitest/globals"],
    "moduleResolution": "Bundler",
    "noEmit": true
  },
  "include": ["index.ts", "src/**/*", "app/**/*", "*.config.ts"]
}
```

- [ ] **Step 3: Create `packages/mobile/babel.config.js`**

```js
module.exports = (api) => {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
  };
};
```

- [ ] **Step 4: Create `packages/mobile/app.json`**

```json
{
  "expo": {
    "name": "musex",
    "slug": "musex",
    "scheme": "musex",
    "version": "0.0.1",
    "orientation": "portrait",
    "ios": {
      "bundleIdentifier": "net.stupendous.musex",
      "supportsTablet": false,
      "infoPlist": {
        "UIBackgroundModes": ["audio"]
      }
    },
    "plugins": ["expo-router", "expo-audio", "expo-secure-store"]
  }
}
```

Note: SDK 56 runs the New Architecture unconditionally — there is **no `newArchEnabled` field** (removed in SDK 55+), so it is omitted here. `UIBackgroundModes: ["audio"]` is **groundwork only** — the background playback path is Phase 4. It is harmless to declare now and avoids a later prebuild churn.

- [ ] **Step 5: Add Expo deps and let `expo install` pin SDK-56-correct versions**

Run (repo root):
```bash
pnpm --filter @musex/mobile install
pnpm --filter @musex/mobile exec expo install expo-audio expo-router expo-secure-store expo-constants expo-linking react-native-url-polyfill react-native-safe-area-context react-native-screens
```
Expected: `package.json` dependency versions are rewritten to the exact versions Expo SDK 56 expects. Commit those exact versions.

- [ ] **Step 6: Update `.gitignore`** — append:

```
# Expo / RN
packages/mobile/.expo/
packages/mobile/ios/
packages/mobile/android/
packages/mobile/dist/
```

Note: `ios/`/`android/` are generated by `expo prebuild`; they stay out of git (managed-with-prebuild model). If a config plugin ever requires committed native dirs, that's a later decision.

- [ ] **Step 7: Verify Expo is installed at SDK 56**

Run: `pnpm --filter @musex/mobile exec expo --version`
Expected: a 56.x SDK-compatible Expo CLI. Also run `pnpm --filter @musex/mobile exec expo-doctor` and resolve any reported issues.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore(mobile): scaffold @musex/mobile Expo SDK 56 package"
```

---

## Task 2: Metro monorepo config + Hermes polyfills + core-import smoke

**Files:**
- Create: `packages/mobile/metro.config.js`
- Create: `packages/mobile/src/polyfills.ts`
- Create: `packages/mobile/index.ts`

- [ ] **Step 1: Create `packages/mobile/metro.config.js`**

```js
// Monorepo Metro config (Expo "Work with monorepos" guide).
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// 1. Watch the whole monorepo so @musex/core source changes are picked up.
config.watchFolders = [workspaceRoot];

// 2. Resolve modules from the package first, then the hoisted root.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// 3. @musex/core ships TS source via package.json "exports"; package-exports
//    resolution is on by default in SDK 56. Keep it explicit.
config.resolver.unstable_enablePackageExports = true;

module.exports = config;
```

- [ ] **Step 2: Create `packages/mobile/src/polyfills.ts`**

```ts
// Host globals the pure @musex/core relies on (see packages/core/src/globals.d.ts):
// URL (four members) and structuredClone. Hermes lacks a full URL implementation
// and historically lacked structuredClone. Import this FIRST, before any core code.
import "react-native-url-polyfill/auto";

if (typeof globalThis.structuredClone !== "function") {
  // Minimal structured clone sufficient for core's plain-data models.
  globalThis.structuredClone = (value: unknown) =>
    value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}
```

Note: the JSON-based fallback is acceptable because core only `structuredClone`s plain-data models (no Dates/Maps/cycles). If `expo-doctor`/runtime shows Hermes already provides `structuredClone`, the branch is simply skipped — leave it for safety.

- [ ] **Step 3: Create `packages/mobile/index.ts`** (entry point)

```ts
import "./src/polyfills";
import "expo-router/entry";
```

- [ ] **Step 4: Smoke-test that core imports under TS** — create a temporary file `packages/mobile/src/__core-smoke.ts`:

```ts
import { PlaybackSession, buildQueue } from "@musex/core";
import type { Track } from "@musex/core";

// Compile-only: prove the barrel resolves and types flow.
export const _smoke = (t: Track[]): unknown => {
  const q = buildQueue(t, 0, false, "none");
  return { PlaybackSession, q };
};
```

- [ ] **Step 5: Typecheck the package**

Run: `pnpm --filter @musex/mobile run typecheck`
Expected: PASS (no errors resolving `@musex/core`). If `@musex/core`'s `exports` source path fails to resolve under `moduleResolution: Bundler`, confirm the symlink `node_modules/@musex/core` exists (pnpm workspace) and points at `packages/core`.

- [ ] **Step 6: Delete the smoke file**

```bash
rm packages/mobile/src/__core-smoke.ts
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore(mobile): metro monorepo config + Hermes polyfills"
```

---

## Task 3: Tooling — vitest + biome + root check + CI

**Files:**
- Create: `packages/mobile/vitest.config.ts`
- Modify: `biome.json`
- Modify: root `package.json` (if it lists per-package check fan-out)
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Create `packages/mobile/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Smoke tests are opt-in only.
    exclude: ["**/*.smoke.test.ts", "**/node_modules/**"],
  },
});
```

- [ ] **Step 2: Confirm Biome includes the new package** — open `biome.json` and verify `files.includes` covers `packages/mobile` (the repo glob likely already does). The Expo-generated `ios/`/`android/`/`.expo/` are gitignored so won't be linted; add explicit Biome ignores if any slip in:

```jsonc
// biome.json -> files.includes (append if not already covered by a wildcard)
"!packages/mobile/ios/**",
"!packages/mobile/android/**",
"!packages/mobile/.expo/**"
```

- [ ] **Step 3: Run the root check to confirm the new package is picked up**

Run: `pnpm check`
Expected: biome + tsc + vitest run across all packages including `@musex/mobile` (which currently has no tests → vitest passes with no tests, or `passWithNoTests` already set at root). Fix any wiring so the mobile package's `typecheck` and `test` scripts are invoked.

- [ ] **Step 4: Extend CI** — open `.github/workflows/ci.yml`. The existing job runs `pnpm install` + `pnpm check` on ubuntu and needs **neither mpv nor the Electron runtime**; the mobile package's unit tests (pure logic + adapters with mocked native modules) run on ubuntu too. Confirm `pnpm check` is what CI runs; if CI enumerates packages, add `@musex/mobile`. The Expo **native build** stays out of CI (built via EAS/local), exactly like desktop packaging.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(mobile): wire vitest/biome/CI for @musex/mobile"
```

---

## Task 4: `config.ts` + `plex-headers.ts` (pure header builder)

**Files:**
- Create: `packages/mobile/src/config.ts`
- Create: `packages/mobile/src/logic/plex-headers.ts`
- Create: `packages/mobile/src/logic/plex-headers.test.ts`

- [ ] **Step 1: Write the failing test** `plex-headers.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { plexHeaders } from "./plex-headers";

describe("plexHeaders", () => {
  it("includes the client identifier and product headers", () => {
    const h = plexHeaders("abc-123");
    expect(h["X-Plex-Client-Identifier"]).toBe("abc-123");
    expect(h["X-Plex-Product"]).toBe("musex");
    expect(h.Accept).toBe("application/json");
  });

  it("merges and overrides with extra headers", () => {
    const h = plexHeaders("id", { "X-Plex-Token": "tok" });
    expect(h["X-Plex-Token"]).toBe("tok");
    expect(h["X-Plex-Client-Identifier"]).toBe("id");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @musex/mobile exec vitest run src/logic/plex-headers.test.ts`
Expected: FAIL — cannot find `./plex-headers`.

- [ ] **Step 3: Create `config.ts`**

```ts
import * as Application from "expo-constants";

// A stable-per-install client id. expo-constants' installationId is deprecated;
// generate once and persist via SecureStore is overkill for Phase 1 — derive a
// stable id from the session at app start instead (see store bootstrap). This
// constant is the product identity used in every Plex request.
export const PLEX_PRODUCT = "musex";
export const PLEX_VERSION =
  (Application.default.expoConfig?.version as string | undefined) ?? "0.0.1";
export const PLEX_PLATFORM = "iOS";
```

- [ ] **Step 4: Create `plex-headers.ts`** (minimal implementation to pass)

```ts
import { PLEX_PLATFORM, PLEX_PRODUCT, PLEX_VERSION } from "../config";

/** Builds the X-Plex-* headers every Plex request needs. `clientId` must be
 *  stable per install so create-pin and poll-pin agree. */
export function plexHeaders(
  clientId: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    Accept: "application/json",
    "X-Plex-Client-Identifier": clientId,
    "X-Plex-Product": PLEX_PRODUCT,
    "X-Plex-Version": PLEX_VERSION,
    "X-Plex-Platform": PLEX_PLATFORM,
    "X-Plex-Device": "iOS",
    ...extra,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @musex/mobile exec vitest run src/logic/plex-headers.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(mobile): plex request headers + config"
```

---

## Task 5: `stream-ref.ts` — pure codec decision + URL building

**Files:**
- Create: `packages/mobile/src/logic/stream-ref.ts`
- Create: `packages/mobile/src/logic/stream-ref.test.ts`

- [ ] **Step 1: Write the failing test** `stream-ref.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { Track } from "@musex/core";
import { AVPLAYER_CODECS, decideStreamRef, isDirectPlayable } from "./stream-ref";

const track = (audioCodec: string, partKey = "/library/parts/9/file.x"): Track => ({
  id: "100",
  serverId: "srv",
  albumId: "10",
  artistId: "1",
  artistName: "A",
  title: "T",
  durationMs: 1000,
  media: { container: "x", audioCodec, partId: "9", partKey },
});

describe("isDirectPlayable", () => {
  it("accepts AVPlayer-supported codecs case-insensitively", () => {
    for (const c of AVPLAYER_CODECS) expect(isDirectPlayable(c.toUpperCase())).toBe(true);
  });
  it("rejects opus/vorbis/wavpack", () => {
    expect(isDirectPlayable("opus")).toBe(false);
    expect(isDirectPlayable("vorbis")).toBe(false);
    expect(isDirectPlayable("wavpack")).toBe(false);
  });
});

describe("decideStreamRef", () => {
  const base = "https://pms.example:32400";

  it("builds a direct URL for a supported codec", () => {
    const ref = decideStreamRef(track("flac"), base, "TOK", "CID");
    expect(ref.kind).toBe("direct");
    expect(ref.url).toBe(
      "https://pms.example:32400/library/parts/9/file.x?X-Plex-Token=TOK",
    );
  });

  it("builds an HLS transcode URL for an unsupported codec", () => {
    const ref = decideStreamRef(track("opus"), base, "TOK", "CID");
    expect(ref.kind).toBe("hls");
    expect(ref.url).toContain("/audio/:/transcode/universal/start.m3u8?");
    expect(ref.url).toContain("path=" + encodeURIComponent("/library/metadata/100"));
    expect(ref.url).toContain("protocol=hls");
    expect(ref.url).toContain("X-Plex-Token=TOK");
    expect(ref.url).toContain("X-Plex-Client-Identifier=CID");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @musex/mobile exec vitest run src/logic/stream-ref.test.ts`
Expected: FAIL — cannot find `./stream-ref`.

- [ ] **Step 3: Implement `stream-ref.ts`**

```ts
import type { StreamRef, Track } from "@musex/core";

/** Audio codecs Apple AVPlayer (the engine behind expo-audio on iOS) can
 *  direct-play. Everything else falls back to a Plex HLS transcode. */
export const AVPLAYER_CODECS = ["aac", "mp3", "alac", "flac", "pcm", "aiff", "wav"] as const;

export function isDirectPlayable(audioCodec: string): boolean {
  return (AVPLAYER_CODECS as readonly string[]).includes(audioCodec.toLowerCase());
}

function directUrl(serverBaseUrl: string, partKey: string, token: string): string {
  return `${serverBaseUrl}${partKey}?X-Plex-Token=${encodeURIComponent(token)}`;
}

function transcodeUrl(
  serverBaseUrl: string,
  trackId: string,
  token: string,
  clientId: string,
): string {
  const params = new URLSearchParams({
    path: `/library/metadata/${trackId}`,
    mediaIndex: "0",
    partIndex: "0",
    protocol: "hls",
    fastSeek: "1",
    copyts: "1",
    offset: "0",
    "X-Plex-Platform": "Chrome",
    "X-Plex-Client-Identifier": clientId,
    "X-Plex-Token": token,
  });
  return `${serverBaseUrl}/audio/:/transcode/universal/start.m3u8?${params.toString()}`;
}

/** Pure decision: direct-play when AVPlayer supports the codec, else HLS transcode. */
export function decideStreamRef(
  track: Track,
  serverBaseUrl: string,
  token: string,
  clientId: string,
): StreamRef {
  if (isDirectPlayable(track.media.audioCodec)) {
    return { kind: "direct", url: directUrl(serverBaseUrl, track.media.partKey, token) };
  }
  return { kind: "hls", url: transcodeUrl(serverBaseUrl, track.id, token, clientId) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @musex/mobile exec vitest run src/logic/stream-ref.test.ts`
Expected: PASS. (The transcode test uses `toContain`, so `URLSearchParams` ordering does not matter.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(mobile): pure codec decision + stream URL builder"
```

---

## Task 6: `plex-parse.ts` — pure PMS-JSON → core-model mappers

**Files:**
- Create: `packages/mobile/src/logic/plex-parse.ts`
- Create: `packages/mobile/src/logic/plex-parse.test.ts`

Background: Plex returns JSON when `Accept: application/json` is sent. The shapes below are the relevant subsets. `parts[0].key` → `partKey`; `Media[0].audioCodec` → `audioCodec`. Tracks come from `/library/metadata/{albumId}/children`, albums from `/library/sections/{id}/all?type=9&artist.id=...` or `/library/metadata/{artistId}/children`, artists from `/library/sections/{id}/all?type=8`.

- [ ] **Step 1: Write the failing test** `plex-parse.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { parseAlbums, parseArtists, parseLibraries, parseServers, parseTracks } from "./plex-parse";

describe("parseArtists", () => {
  it("maps Directory entries to Artist", () => {
    const json = {
      MediaContainer: {
        Metadata: [
          { ratingKey: "1", title: "Boards of Canada", thumb: "/t/1", userRating: 8 },
        ],
      },
    };
    const out = parseArtists(json, "srv");
    expect(out).toEqual([
      { id: "1", serverId: "srv", name: "Boards of Canada", thumb: "/t/1", userRating: 8 },
    ]);
  });
  it("returns [] when MediaContainer is empty", () => {
    expect(parseArtists({ MediaContainer: {} }, "srv")).toEqual([]);
  });
});

describe("parseTracks", () => {
  it("maps a Track with its first Media/Part", () => {
    const json = {
      MediaContainer: {
        Metadata: [
          {
            ratingKey: "100",
            title: "Roygbiv",
            parentRatingKey: "10",
            grandparentRatingKey: "1",
            grandparentTitle: "Boards of Canada",
            parentTitle: "Music Has the Right",
            index: 3,
            duration: 172000,
            thumb: "/t/100",
            Media: [
              {
                audioCodec: "flac",
                container: "flac",
                bitrate: 900,
                Part: [{ id: "9", key: "/library/parts/9/file.flac" }],
              },
            ],
          },
        ],
      },
    };
    const out = parseTracks(json, "srv");
    expect(out[0]).toMatchObject({
      id: "100",
      serverId: "srv",
      albumId: "10",
      artistId: "1",
      artistName: "Boards of Canada",
      albumTitle: "Music Has the Right",
      title: "Roygbiv",
      durationMs: 172000,
      trackNumber: 3,
      media: { container: "flac", audioCodec: "flac", partId: "9", partKey: "/library/parts/9/file.flac" },
    });
  });
  it("skips tracks with no playable Part", () => {
    const json = { MediaContainer: { Metadata: [{ ratingKey: "1", title: "x", Media: [] }] } };
    expect(parseTracks(json, "srv")).toEqual([]);
  });
});

describe("parseLibraries", () => {
  it("keeps only music sections and uses max(updatedAt, scannedAt)", () => {
    const json = {
      MediaContainer: {
        Directory: [
          { key: "3", type: "artist", title: "Music", updatedAt: 100, scannedAt: 200 },
          { key: "4", type: "movie", title: "Movies" },
        ],
      },
    };
    const out = parseLibraries(json, "srv", "Server");
    expect(out).toEqual([
      { id: "3", serverId: "srv", serverName: "Server", title: "Music", type: "music", updatedAt: 200000 },
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @musex/mobile exec vitest run src/logic/plex-parse.test.ts`
Expected: FAIL — cannot find `./plex-parse`.

- [ ] **Step 3: Implement `plex-parse.ts`**

```ts
import type { Album, Artist, Library, Server, Track } from "@musex/core";

type Json = Record<string, unknown>;
const container = (j: unknown): Json =>
  ((j as Json)?.MediaContainer as Json) ?? {};
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const tags = (v: unknown): string[] | undefined => {
  const list = arr(v).map((t) => str(t.tag)).filter((t): t is string => !!t);
  return list.length ? list : undefined;
};

export function parseArtists(json: unknown, serverId: string): Artist[] {
  return arr(container(json).Metadata).map((m) => ({
    id: String(m.ratingKey),
    serverId,
    name: str(m.title) ?? "",
    thumb: str(m.thumb),
    updatedAt: num(m.updatedAt) ? (num(m.updatedAt) as number) * 1000 : undefined,
    userRating: num(m.userRating),
    genres: tags(m.Genre),
    moods: tags(m.Mood),
  }));
}

export function parseAlbums(json: unknown, serverId: string): Album[] {
  return arr(container(json).Metadata).map((m) => ({
    id: String(m.ratingKey),
    serverId,
    artistId: String(m.parentRatingKey ?? ""),
    title: str(m.title) ?? "",
    year: num(m.year),
    thumb: str(m.thumb),
    updatedAt: num(m.updatedAt) ? (num(m.updatedAt) as number) * 1000 : undefined,
    userRating: num(m.userRating),
    genres: tags(m.Genre),
    moods: tags(m.Mood),
  }));
}

export function parseTracks(json: unknown, serverId: string): Track[] {
  const out: Track[] = [];
  for (const m of arr(container(json).Metadata)) {
    const media = arr(m.Media)[0];
    const part = media ? arr(media.Part)[0] : undefined;
    if (!media || !part) continue; // no playable part -> skip
    out.push({
      id: String(m.ratingKey),
      serverId,
      albumId: String(m.parentRatingKey ?? ""),
      artistId: String(m.grandparentRatingKey ?? ""),
      artistName: str(m.grandparentTitle) ?? "",
      albumTitle: str(m.parentTitle),
      title: str(m.title) ?? "",
      durationMs: num(m.duration) ?? 0,
      trackNumber: num(m.index),
      thumb: str(m.thumb),
      userRating: num(m.userRating),
      genres: tags(m.Genre),
      moods: tags(m.Mood),
      media: {
        container: str(media.container) ?? "",
        audioCodec: str(media.audioCodec) ?? "",
        bitrate: num(media.bitrate),
        partId: String(part.id),
        partKey: str(part.key) ?? "",
      },
    });
  }
  return out;
}

export function parseLibraries(json: unknown, serverId: string, serverName: string): Library[] {
  return arr(container(json).Directory)
    .filter((d) => d.type === "artist")
    .map((d) => {
      const updated = Math.max(num(d.updatedAt) ?? 0, num(d.scannedAt) ?? 0);
      return {
        id: String(d.key),
        serverId,
        serverName,
        title: str(d.title) ?? "",
        type: "music" as const,
        updatedAt: updated ? updated * 1000 : undefined,
      };
    });
}

/** plex.tv /api/v2/resources response (array of resources). */
export function parseServers(json: unknown): Server[] {
  return arr(json)
    .filter((r) => r.provides && String(r.provides).includes("server"))
    .map((r) => ({
      id: String(r.clientIdentifier),
      name: str(r.name) ?? "",
      connections: arr(r.connections).map((c) => ({
        uri: str(c.uri) ?? "",
        local: Boolean(c.local),
        relay: Boolean(c.relay),
      })),
    }));
}
```

Note: timestamps from Plex are epoch **seconds**; core models store epoch **ms**, hence `* 1000`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @musex/mobile exec vitest run src/logic/plex-parse.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(mobile): pure PMS JSON -> core model parsers"
```

---

## Task 7: `plex-gateway.ts` — `PlexGateway` over `fetch`

**Files:**
- Create: `packages/mobile/src/adapters/plex-gateway.ts`
- Create: `packages/mobile/src/adapters/plex-gateway.test.ts`

The gateway takes an injected `fetch` and `clientId` so it is testable without a network. It throws `PlexAuthError` on 401. Server connection selection picks the first reachable connection (local → non-relay → relay), probing with a short timeout; in tests the fake fetch makes the first candidate succeed.

- [ ] **Step 1: Write the failing test** `plex-gateway.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { PlexAuthError } from "@musex/core";
import { PlexGatewayImpl } from "./plex-gateway";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const server = {
  id: "srv",
  name: "Tower",
  connections: [{ uri: "https://pms.local:32400", local: true, relay: false }],
};

describe("PlexGatewayImpl", () => {
  it("createPin maps the pins response", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ id: 42, code: "WXYZ", authToken: null }),
    );
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    const pin = await gw.createPin();
    expect(pin).toMatchObject({ id: "42", code: "WXYZ" });
    expect(pin.authUrl).toContain("WXYZ");
  });

  it("pollPin returns the token once present", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ id: 42, authToken: "TOK" }));
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    expect(await gw.pollPin("42")).toEqual({ authToken: "TOK" });
  });

  it("listArtists parses Metadata and sends the token", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: "1", title: "BoC" }] } }),
    );
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    const lib = { id: "3", serverId: "srv", serverName: "Tower", title: "Music", type: "music" as const };
    // prime the resolved base url so listArtists hits the server
    await gw.listMusicLibraries(server, "TOK"); // resolves+caches the base url
    const artists = await gw.listArtists(lib, "TOK");
    expect(artists[0]).toMatchObject({ id: "1", name: "BoC", serverId: "srv" });
    const calledUrls = fetchFn.mock.calls.map((c) => String(c[0]));
    expect(calledUrls.some((u) => u.includes("/library/sections/3/all"))).toBe(true);
  });

  it("throws PlexAuthError on 401", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 401));
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await expect(gw.listServers("BAD")).rejects.toBeInstanceOf(PlexAuthError);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @musex/mobile exec vitest run src/adapters/plex-gateway.test.ts`
Expected: FAIL — cannot find `./plex-gateway`.

- [ ] **Step 3: Implement `plex-gateway.ts`**

```ts
import type {
  Album,
  Artist,
  Library,
  LibrarySort,
  Pin,
  PlaylistTrack,
  PlexGateway,
  SearchResults,
  Server,
  Track,
} from "@musex/core";
import { PlexAuthError } from "@musex/core";
import { plexHeaders } from "../logic/plex-headers";
import { parseAlbums, parseArtists, parseLibraries, parseServers, parseTracks } from "../logic/plex-parse";

const PLEX_TV = "https://plex.tv";
const PROBE_TIMEOUT_MS = 4000;

type FetchFn = typeof fetch;

/** Phase 1 PlexGateway. Implements auth + browse only; unimplemented methods
 *  throw so the type is satisfied without pretending to support them yet. */
export class PlexGatewayImpl implements PlexGateway {
  private baseUrlByServer = new Map<string, string>();

  constructor(
    private readonly fetchFn: FetchFn,
    private readonly clientId: string,
  ) {}

  // --- auth ---

  async createPin(): Promise<Pin> {
    const res = await this.fetchFn(`${PLEX_TV}/api/v2/pins?strong=true`, {
      method: "POST",
      headers: plexHeaders(this.clientId),
    });
    this.assertOk(res);
    const j = (await res.json()) as { id: number; code: string };
    return {
      id: String(j.id),
      code: j.code,
      authUrl: `https://app.plex.tv/auth#?clientID=${encodeURIComponent(
        this.clientId,
      )}&code=${encodeURIComponent(j.code)}&context%5Bdevice%5D%5Bproduct%5D=musex`,
    };
  }

  async pollPin(id: string): Promise<{ authToken: string | null }> {
    const res = await this.fetchFn(`${PLEX_TV}/api/v2/pins/${id}`, {
      headers: plexHeaders(this.clientId),
    });
    this.assertOk(res);
    const j = (await res.json()) as { authToken: string | null };
    return { authToken: j.authToken ?? null };
  }

  // --- discovery ---

  async listServers(token: string): Promise<Server[]> {
    const res = await this.fetchFn(
      `${PLEX_TV}/api/v2/resources?includeHttps=1&includeRelay=1`,
      { headers: plexHeaders(this.clientId, { "X-Plex-Token": token }) },
    );
    this.assertOk(res);
    return parseServers(await res.json());
  }

  async listMusicLibraries(server: Server, token: string): Promise<Library[]> {
    const base = await this.resolveBaseUrl(server, token);
    const json = await this.getJson(`${base}/library/sections`, token);
    return parseLibraries(json, server.id, server.name);
  }

  async listArtists(library: Library, token: string): Promise<Artist[]> {
    const base = this.requireBase(library.serverId);
    const json = await this.getJson(`${base}/library/sections/${library.id}/all?type=8`, token);
    return parseArtists(json, library.serverId);
  }

  async listAlbums(library: Library, artistId: string, token: string): Promise<Album[]> {
    const base = this.requireBase(library.serverId);
    const json = await this.getJson(`${base}/library/metadata/${artistId}/children`, token);
    return parseAlbums(json, library.serverId);
  }

  async listTracks(library: Library, albumId: string, token: string): Promise<Track[]> {
    const base = this.requireBase(library.serverId);
    const json = await this.getJson(`${base}/library/metadata/${albumId}/children`, token);
    return parseTracks(json, library.serverId);
  }

  /** Returns the base url a Track's StreamResolver should use. */
  baseUrlFor(serverId: string): string {
    return this.requireBase(serverId);
  }

  // --- internals ---

  private async resolveBaseUrl(server: Server, token: string): Promise<string> {
    const cached = this.baseUrlByServer.get(server.id);
    if (cached) return cached;
    // Preference: local, then remote (non-relay), then relay.
    const ordered = [...server.connections].sort(
      (a, b) => score(a) - score(b),
    );
    for (const conn of ordered) {
      if (await this.reachable(conn.uri, token)) {
        this.baseUrlByServer.set(server.id, conn.uri);
        return conn.uri;
      }
    }
    throw new Error(`No reachable connection for server ${server.name}`);
  }

  private async reachable(uri: string, token: string): Promise<boolean> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await this.fetchFn(`${uri}/`, {
        headers: plexHeaders(this.clientId, { "X-Plex-Token": token }),
        signal: ctrl.signal,
      });
      if (res.status === 401) throw new PlexAuthError();
      return res.ok;
    } catch (err) {
      if (err instanceof PlexAuthError) throw err;
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private requireBase(serverId: string): string {
    const base = this.baseUrlByServer.get(serverId);
    if (!base) throw new Error(`Server ${serverId} not connected; call listMusicLibraries first`);
    return base;
  }

  private async getJson(url: string, token: string): Promise<unknown> {
    const res = await this.fetchFn(url, {
      headers: plexHeaders(this.clientId, { "X-Plex-Token": token }),
    });
    this.assertOk(res);
    return res.json();
  }

  private assertOk(res: Response): void {
    if (res.status === 401) throw new PlexAuthError();
    if (!res.ok) throw new Error(`Plex request failed: ${res.status}`);
  }

  // --- not implemented in Phase 1 (search/playlists/ratings are later phases) ---

  search(): Promise<SearchResults> {
    throw new Error("search not implemented in Phase 1");
  }
  listPlaylists(): Promise<never> {
    throw new Error("playlists not implemented in Phase 1");
  }
  listPlaylistTracks(): Promise<PlaylistTrack[]> {
    throw new Error("playlists not implemented in Phase 1");
  }
  createPlaylist(): Promise<never> {
    throw new Error("playlists not implemented in Phase 1");
  }
  addToPlaylist(): Promise<void> {
    throw new Error("playlists not implemented in Phase 1");
  }
  removeFromPlaylist(): Promise<void> {
    throw new Error("playlists not implemented in Phase 1");
  }
  renamePlaylist(): Promise<void> {
    throw new Error("playlists not implemented in Phase 1");
  }
  deletePlaylist(): Promise<void> {
    throw new Error("playlists not implemented in Phase 1");
  }
  listAllAlbums(_l: Library, _s: LibrarySort, _t: string): Promise<Album[]> {
    throw new Error("listAllAlbums not implemented in Phase 1");
  }
  listAllTracks(_l: Library, _s: LibrarySort, _t: string): Promise<Track[]> {
    throw new Error("listAllTracks not implemented in Phase 1");
  }
  listAllTracksPage(): Promise<{ items: Track[]; total: number }> {
    throw new Error("listAllTracksPage not implemented in Phase 1");
  }
  rateItem(): Promise<void> {
    throw new Error("rateItem not implemented in Phase 1");
  }
  getUserRating(): Promise<number | null> {
    throw new Error("getUserRating not implemented in Phase 1");
  }
}

function score(c: { local: boolean; relay: boolean }): number {
  if (c.local) return 0;
  if (!c.relay) return 1;
  return 2;
}
```

Note: the `PlexGateway` interface requires the full method set (it is shared with desktop). Phase 1 implements auth + browse; the rest throw with a clear message — they are wired to UI only in later phases, so they are never called. If `verbatimModuleSyntax`/`noUnusedParameters` complains about the stub signatures, prefix unused params with `_` (Biome/TS ignore those).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @musex/mobile exec vitest run src/adapters/plex-gateway.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck (confirms the full `PlexGateway` interface is satisfied)**

Run: `pnpm --filter @musex/mobile run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(mobile): PlexGateway over fetch (auth + browse)"
```

---

## Task 8: `audio-engine.ts` — `PlaybackEngine` over `expo-audio`

**Files:**
- Create: `packages/mobile/src/adapters/audio-engine.ts`
- Create: `packages/mobile/src/adapters/audio-engine.smoke.test.ts`

The adapter creates a fresh `AudioPlayer` per `load()` (disposing the previous), attaches one internal `playbackStatusUpdate` listener that fans out to the stored core callbacks, and maps the rest of the port directly. `preload()` is a no-op (gapless deferred per the spec); `onAdvanced` is registered but only fires via the manual-advance path the session drives, so the adapter never calls it (it routes end-of-track through `onEnded`).

**Reference (verified against expo-audio SDK 56 docs):** `createAudioPlayer(source, { updateInterval })` → `AudioPlayer`; methods `play()`, `pause()`, `seekTo(seconds)`; properties `volume` (0–1, settable), `currentTime`, `isLoaded`; `addListener("playbackStatusUpdate", (status) => …)` where `status` has `currentTime`, `didJustFinish`, `isLoaded`, `playing`; `setAudioModeAsync({ playsInSilentMode })`. Confirm method/property names against the installed `expo-audio` typings before finishing this task.

- [ ] **Step 1: Implement `audio-engine.ts`**

```ts
import {
  type AudioPlayer,
  type AudioStatus,
  createAudioPlayer,
  setAudioModeAsync,
} from "expo-audio";
import type { PlaybackEngine, StreamRef } from "@musex/core";

const POSITION_UPDATE_MS = 250;

export class ExpoAudioEngine implements PlaybackEngine {
  private player: AudioPlayer | null = null;
  private sub: { remove: () => void } | null = null;

  private positionCb: ((seconds: number) => void) | null = null;
  private advancedCb: (() => void) | null = null;
  private endedCb: (() => void) | null = null;
  private errorCb: ((err: Error) => void) | null = null;

  private lastEnded = false;

  /** Must be awaited once before first playback (sets the iOS audio session so
   *  audio plays even when the ringer is silent). Call from app bootstrap. */
  async init(): Promise<void> {
    await setAudioModeAsync({ playsInSilentMode: true });
  }

  async load(ref: StreamRef): Promise<void> {
    this.teardownPlayer();
    this.lastEnded = false;
    const player = createAudioPlayer({ uri: ref.url }, { updateInterval: POSITION_UPDATE_MS });
    this.player = player;
    this.sub = player.addListener("playbackStatusUpdate", (status: AudioStatus) => {
      this.onStatus(status);
    });
    // expo-audio loads asynchronously; resolve when isLoaded flips true (or error).
    await this.waitUntilLoaded(player);
  }

  preload(_ref: StreamRef): Promise<void> {
    // Gapless deferred (Phase 1): see spec. No-op keeps the port satisfied.
    return Promise.resolve();
  }

  play(): void {
    this.player?.play();
  }

  pause(): void {
    this.player?.pause();
  }

  seek(seconds: number): void {
    void this.player?.seekTo(seconds);
  }

  setVolume(volume: number): void {
    if (this.player) this.player.volume = Math.max(0, Math.min(1, volume));
  }

  onPosition(cb: (seconds: number) => void): void {
    this.positionCb = cb;
  }
  onAdvanced(cb: () => void): void {
    this.advancedCb = cb;
  }
  onEnded(cb: () => void): void {
    this.endedCb = cb;
  }
  onError(cb: (err: Error) => void): void {
    this.errorCb = cb;
  }

  dispose(): void {
    this.teardownPlayer();
  }

  private onStatus(status: AudioStatus): void {
    if (typeof status.currentTime === "number") this.positionCb?.(status.currentTime);
    if (status.didJustFinish && !this.lastEnded) {
      this.lastEnded = true;
      this.endedCb?.();
    }
  }

  private waitUntilLoaded(player: AudioPlayer): Promise<void> {
    if (player.isLoaded) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const sub = player.addListener("playbackStatusUpdate", (status: AudioStatus) => {
        if (status.isLoaded) {
          sub.remove();
          resolve();
        }
      });
      // Safety timeout so a dead URL doesn't hang the session forever.
      setTimeout(() => {
        sub.remove();
        if (!player.isLoaded) {
          const err = new Error("audio load timed out");
          this.errorCb?.(err);
          reject(err);
        }
      }, 30000);
    });
  }

  private teardownPlayer(): void {
    this.sub?.remove();
    this.sub = null;
    this.player?.remove();
    this.player = null;
  }
}
```

Note on `onAdvanced`: the core `PlaybackEngine` gapless contract distinguishes auto-continue (`onAdvanced`) from true stop (`onEnded`). Phase 1 has no preloaded gapless continuation, so every track end is a real stop from the engine's view → `onEnded`; the session's own `next()` drives the queue. `advancedCb` stays wired for the later gapless phase. If `player.remove` is named `release` in the installed typings, use that — confirm against `expo-audio`'s `.d.ts`.

- [ ] **Step 2: Write the env-gated smoke test** `audio-engine.smoke.test.ts`

```ts
import { describe, expect, it } from "vitest";

// Real-engine smoke test. Skipped unless MUSEX_AUDIO_E2E=1 AND run inside a
// device/simulator JS runtime (expo-audio is a native module — it cannot load
// under plain Node/vitest). This file is excluded from the default vitest run
// (see vitest.config.ts) and documents how to exercise the engine on-device.
const enabled = process.env.MUSEX_AUDIO_E2E === "1";

describe.skipIf(!enabled)("ExpoAudioEngine (device smoke)", () => {
  it("documents manual verification steps", () => {
    // Manual on-device procedure (run via a temporary dev-screen button):
    //   const e = new ExpoAudioEngine(); await e.init();
    //   e.onPosition(s => console.log("pos", s));
    //   e.onEnded(() => console.log("ended"));
    //   await e.load({ kind: "direct", url: "<a real proxied track url>" });
    //   e.play();  // expect audible output + position logs, "ended" at track end
    expect(enabled).toBe(true);
  });
});
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @musex/mobile run typecheck`
Expected: PASS. (If `expo-audio` types differ — e.g. `seekTo` returns a Promise, status field names — adjust to the installed typings; the structure stays the same.)

- [ ] **Step 4: Run the default test suite (smoke is excluded)**

Run: `pnpm --filter @musex/mobile exec vitest run`
Expected: PASS — smoke test is skipped, all pure/adapter tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(mobile): expo-audio PlaybackEngine adapter"
```

---

## Task 9: `state/store.tsx` — app store hosting `PlaybackSession`

**Files:**
- Create: `packages/mobile/src/adapters/stream-resolver.ts`
- Create: `packages/mobile/src/adapters/token-store.ts`
- Create: `packages/mobile/src/adapters/token-store.test.ts`
- Create: `packages/mobile/src/state/store.tsx`

- [ ] **Step 1: Write the failing `token-store.test.ts`**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Map<string, string>();
vi.mock("expo-secure-store", () => ({
  setItemAsync: vi.fn(async (k: string, v: string) => void mem.set(k, v)),
  getItemAsync: vi.fn(async (k: string) => mem.get(k) ?? null),
  deleteItemAsync: vi.fn(async (k: string) => void mem.delete(k)),
}));

import { SecureTokenStore } from "./token-store";

describe("SecureTokenStore", () => {
  beforeEach(() => mem.clear());
  it("saves, loads, and clears the token", async () => {
    const ts = new SecureTokenStore();
    expect(await ts.load()).toBeNull();
    await ts.save("TOK");
    expect(await ts.load()).toBe("TOK");
    await ts.clear();
    expect(await ts.load()).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @musex/mobile exec vitest run src/adapters/token-store.test.ts`
Expected: FAIL — cannot find `./token-store`.

- [ ] **Step 3: Implement `token-store.ts`**

```ts
import * as SecureStore from "expo-secure-store";
import type { TokenStore } from "@musex/core";

const KEY = "plex-token";

export class SecureTokenStore implements TokenStore {
  async save(token: string): Promise<void> {
    await SecureStore.setItemAsync(KEY, token);
  }
  async load(): Promise<string | null> {
    return SecureStore.getItemAsync(KEY);
  }
  async clear(): Promise<void> {
    await SecureStore.deleteItemAsync(KEY);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @musex/mobile exec vitest run src/adapters/token-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `stream-resolver.ts`** (no test — it is a 1-line wrapper over the tested `decideStreamRef`; covered by `stream-ref.test.ts`)

```ts
import type { StreamRef, StreamResolver, Track } from "@musex/core";
import { decideStreamRef } from "../logic/stream-ref";

/** Resolves a Track to a playable URL. `baseUrlFor` comes from the gateway
 *  (the reachable PMS connection); `token` is a GETTER so one long-lived
 *  PlaybackSession can outlive a sign-in (the token isn't known at construction). */
export class PlexStreamResolver implements StreamResolver {
  constructor(
    private readonly baseUrlFor: (serverId: string) => string,
    private readonly token: () => string,
    private readonly clientId: string,
  ) {}

  resolve(track: Track): Promise<StreamRef> {
    return Promise.resolve(
      decideStreamRef(track, this.baseUrlFor(track.serverId), this.token(), this.clientId),
    );
  }
}
```

- [ ] **Step 6: Implement `state/store.tsx`**

```tsx
import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import type { ReactNode } from "react";
import {
  type Library,
  PlaybackSession,
  type PlaybackState,
  type Server,
  type Track,
  buildQueue,
} from "@musex/core";
import { ExpoAudioEngine } from "../adapters/audio-engine";
import { PlexGatewayImpl } from "../adapters/plex-gateway";
import { PlexStreamResolver } from "../adapters/stream-resolver";
import { SecureTokenStore } from "../adapters/token-store";
import { CLIENT_ID } from "../config-client-id";

type Phase = "loading" | "signed-out" | "signed-in";

interface State {
  phase: Phase;
  token: string | null;
  servers: Server[];
  library: Library | null;
  playback: PlaybackState | null;
}

type Action =
  | { type: "bootstrapped"; token: string | null }
  | { type: "signed-in"; token: string; servers: Server[] }
  | { type: "library-selected"; library: Library }
  | { type: "signed-out" }
  | { type: "playback"; state: PlaybackState };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "bootstrapped":
      return { ...state, phase: action.token ? "signed-in" : "signed-out", token: action.token };
    case "signed-in":
      return { ...state, phase: "signed-in", token: action.token, servers: action.servers };
    case "library-selected":
      return { ...state, library: action.library };
    case "signed-out":
      return { ...state, phase: "signed-out", token: null, servers: [], library: null };
    case "playback":
      return { ...state, playback: action.state };
  }
}

interface Store {
  state: State;
  gateway: PlexGatewayImpl;
  tokenStore: SecureTokenStore;
  dispatch: (a: Action) => void;
  /** Build a queue from a track list and start playback at `index`. */
  playTracks: (tracks: Track[], index: number) => Promise<void>;
  session: PlaybackSession;
}

const StoreCtx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(StoreCtx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    phase: "loading",
    token: null,
    servers: [],
    library: null,
    playback: null,
  });

  // Always-current token, read by the resolver at resolve-time (the session is
  // long-lived and created before sign-in).
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = state.token;

  const gateway = useMemo(() => new PlexGatewayImpl(fetch, CLIENT_ID), []);
  const tokenStore = useMemo(() => new SecureTokenStore(), []);
  const engine = useMemo(() => new ExpoAudioEngine(), []);

  // ONE long-lived session. PlaybackSession's 3rd ctor arg is `shuffleRest`
  // (a shuffle fn) — NOT a state callback; state is observed via subscribe().
  const session = useMemo(() => {
    const resolver = new PlexStreamResolver(
      (sid) => gateway.baseUrlFor(sid),
      () => tokenRef.current ?? "",
      CLIENT_ID,
    );
    return new PlaybackSession(engine, resolver);
  }, [engine, gateway]);

  // Mirror session state into the reducer. subscribe() returns the unsubscribe.
  useEffect(
    () => session.subscribe((s) => dispatch({ type: "playback", state: s })),
    [session],
  );

  // Bootstrap: init audio session, restore token, discover servers.
  useEffect(() => {
    let alive = true;
    (async () => {
      await engine.init();
      const token = await tokenStore.load();
      if (!alive) return;
      if (!token) {
        dispatch({ type: "bootstrapped", token: null });
        return;
      }
      try {
        const servers = await gateway.listServers(token);
        if (alive) dispatch({ type: "signed-in", token, servers });
      } catch {
        // Bad/expired token -> signed out (never loop).
        await tokenStore.clear();
        if (alive) dispatch({ type: "bootstrapped", token: null });
      }
    })();
    return () => {
      alive = false;
      engine.dispose();
    };
  }, [engine, gateway, tokenStore]);

  // loadQueue() loads + auto-plays the start index (it calls engine.play()).
  const playTracks = useMemo(
    () => async (tracks: Track[], index: number) => {
      await session.loadQueue(buildQueue(tracks, index));
    },
    [session],
  );

  const value: Store = { state, gateway, tokenStore, dispatch, playTracks, session };
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}
```

Verified against `packages/core/src/playback/playback-session.ts`:
`new PlaybackSession(engine, resolver, shuffleRest?)`; observe state via
`subscribe(cb) => unsubscribe` + `getState()`; `loadQueue(queue)` loads AND
auto-plays; controls `play()` / `pause()` (sync) and `next()` / `previous()`
(async); `buildQueue(tracks, startIndex)` takes exactly two args.

- [ ] **Step 7: Create `config-client-id.ts`** — a stable per-install client id (used by gateway + resolver):

```ts
// A stable identifier for this install. For Phase 1 a per-process random id is
// acceptable for browse/playback (pin create+poll happen in one session). For a
// durable id across launches, persist it via SecureStore (later phase).
import { randomUUID } from "expo-crypto";

let id: string | null = null;
export const CLIENT_ID: string = (() => {
  if (!id) id = `musex-ios-${randomUUID()}`;
  return id;
})();
```

Run `pnpm --filter @musex/mobile exec expo install expo-crypto` first. If a persistent id is wanted now, read it from SecureStore at bootstrap and pass it into the gateway instead of this module-level constant — note this as a known Phase-1 simplification.

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @musex/mobile run typecheck`
Expected: PASS (after matching the real `PlaybackSession` API).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(mobile): token store, stream resolver, app store hosting PlaybackSession"
```

---

## Task 10: `expo-router` layout + sign-in screen

**Files:**
- Create: `packages/mobile/src/ui/theme.ts`
- Create: `packages/mobile/app/_layout.tsx`
- Create: `packages/mobile/app/index.tsx`
- Create: `packages/mobile/app/sign-in.tsx`

UI is intentionally minimal (spec: polish is Phase 2). Verification is manual on the Simulator (no per-component unit tests — matches the project's "core is the test target, UI is manually verified" convention).

- [ ] **Step 1: Create `ui/theme.ts`**

```ts
export const theme = {
  bg: "#0d0d10",
  surface: "#17171c",
  text: "#f2f2f5",
  textDim: "#9a9aa6",
  accent: "#1db954",
  border: "#26262e",
  space: (n: number) => n * 8,
} as const;
```

- [ ] **Step 2: Create `app/_layout.tsx`**

```tsx
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StoreProvider } from "../src/state/store";
import { theme } from "../src/ui/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: theme.surface },
            headerTintColor: theme.text,
            contentStyle: { backgroundColor: theme.bg },
          }}
        />
      </StoreProvider>
    </SafeAreaProvider>
  );
}
```

Run `pnpm --filter @musex/mobile exec expo install expo-status-bar` if not already present.

- [ ] **Step 3: Create `app/index.tsx`** (the routing gate)

```tsx
import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useStore } from "../src/state/store";
import { theme } from "../src/ui/theme";

export default function Index() {
  const { state } = useStore();
  if (state.phase === "loading") {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }
  return <Redirect href={state.phase === "signed-in" ? "/picker" : "/sign-in"} />;
}
```

- [ ] **Step 4: Create `app/sign-in.tsx`**

```tsx
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Linking, Pressable, Text, View } from "react-native";
import type { Pin } from "@musex/core";
import { useStore } from "../src/state/store";
import { theme } from "../src/ui/theme";

export default function SignIn() {
  const { gateway, tokenStore, dispatch } = useStore();
  const router = useRouter();
  const [pin, setPin] = useState<Pin | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const p = await gateway.createPin();
      setPin(p);
      await Linking.openURL(p.authUrl);
      // Poll until the token appears (cap ~2 min).
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const { authToken } = await gateway.pollPin(p.id);
        if (authToken) {
          await tokenStore.save(authToken);
          const servers = await gateway.listServers(authToken);
          dispatch({ type: "signed-in", token: authToken, servers });
          router.replace("/picker");
          return;
        }
      }
      setError("Sign-in timed out. Try again.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: theme.space(3) }}>
      <Text style={{ color: theme.text, fontSize: 28, fontWeight: "700", marginBottom: theme.space(2) }}>
        musex
      </Text>
      <Text style={{ color: theme.textDim, textAlign: "center", marginBottom: theme.space(4) }}>
        Sign in with your Plex account to stream your library.
      </Text>
      {pin && (
        <Text style={{ color: theme.text, fontSize: 18, marginBottom: theme.space(2) }}>
          Code: {pin.code}
        </Text>
      )}
      <Pressable
        onPress={start}
        disabled={busy}
        style={{
          backgroundColor: theme.accent,
          paddingHorizontal: theme.space(4),
          paddingVertical: theme.space(2),
          borderRadius: 999,
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? <ActivityIndicator color="#000" /> : <Text style={{ fontWeight: "700" }}>Sign in with Plex</Text>}
      </Pressable>
      {error && <Text style={{ color: "#ff6b6b", marginTop: theme.space(2) }}>{error}</Text>}
    </View>
  );
}
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @musex/mobile run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(mobile): expo-router layout + Plex sign-in screen"
```

---

## Task 11: Picker + Artists screens

**Files:**
- Create: `packages/mobile/app/picker.tsx`
- Create: `packages/mobile/app/artists.tsx`
- Create: `packages/mobile/src/ui/Row.tsx`

- [ ] **Step 1: Create `ui/Row.tsx`** (a reusable tappable list row)

```tsx
import { Pressable, Text, View } from "react-native";
import { theme } from "./theme";

export function Row({ title, subtitle, onPress }: { title: string; subtitle?: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: theme.space(2),
        paddingVertical: theme.space(1.5),
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
      }}
    >
      <Text style={{ color: theme.text, fontSize: 16 }}>{title}</Text>
      {subtitle ? <Text style={{ color: theme.textDim, fontSize: 13 }}>{subtitle}</Text> : null}
    </Pressable>
  );
}
```

- [ ] **Step 2: Create `app/picker.tsx`** (choose server → library; auto-advance when single)

```tsx
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, View } from "react-native";
import type { Library, Server } from "@musex/core";
import { useStore } from "../src/state/store";
import { Row } from "../src/ui/Row";
import { theme } from "../src/ui/theme";

export default function Picker() {
  const { state, gateway, dispatch } = useStore();
  const router = useRouter();
  const [libraries, setLibraries] = useState<Library[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadLibraries(server: Server) {
    if (!state.token) return;
    setLoading(true);
    const libs = await gateway.listMusicLibraries(server, state.token);
    setLibraries(libs);
    setLoading(false);
    if (libs.length === 1 && libs[0]) {
      dispatch({ type: "library-selected", library: libs[0] });
      router.replace("/artists");
    }
  }

  useEffect(() => {
    if (state.servers.length === 1 && state.servers[0]) {
      void loadLibraries(state.servers[0]);
    } else {
      setLoading(false);
    }
  }, [state.servers]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  // Multi-server: pick a server first, then its single/used library list.
  if (state.servers.length > 1 && libraries.length === 0) {
    return (
      <FlatList
        data={state.servers}
        keyExtractor={(s) => s.id}
        renderItem={({ item }) => <Row title={item.name} onPress={() => void loadLibraries(item)} />}
      />
    );
  }

  return (
    <FlatList
      data={libraries}
      keyExtractor={(l) => l.id}
      renderItem={({ item }) => (
        <Row
          title={item.title}
          subtitle={item.serverName}
          onPress={() => {
            dispatch({ type: "library-selected", library: item });
            router.push("/artists");
          }}
        />
      )}
    />
  );
}
```

- [ ] **Step 3: Create `app/artists.tsx`**

```tsx
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, View } from "react-native";
import type { Artist } from "@musex/core";
import { useStore } from "../src/state/store";
import { Row } from "../src/ui/Row";
import { theme } from "../src/ui/theme";

export default function Artists() {
  const { state, gateway } = useStore();
  const router = useRouter();
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!state.library || !state.token) return;
      const list = await gateway.listArtists(state.library, state.token);
      if (alive) {
        setArtists(list);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [state.library, state.token]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <FlatList
      data={artists}
      keyExtractor={(a) => a.id}
      renderItem={({ item }) => (
        <Row title={item.name} onPress={() => router.push({ pathname: "/albums", params: { artistId: item.id } })} />
      )}
    />
  );
}
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @musex/mobile run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(mobile): server/library picker + artists list"
```

---

## Task 12: Albums + Tracks screens

**Files:**
- Create: `packages/mobile/app/albums.tsx`
- Create: `packages/mobile/app/tracks.tsx`

- [ ] **Step 1: Create `app/albums.tsx`**

```tsx
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, View } from "react-native";
import type { Album } from "@musex/core";
import { useStore } from "../src/state/store";
import { Row } from "../src/ui/Row";
import { theme } from "../src/ui/theme";

export default function Albums() {
  const { artistId } = useLocalSearchParams<{ artistId: string }>();
  const { state, gateway } = useStore();
  const router = useRouter();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!state.library || !state.token || !artistId) return;
      const list = await gateway.listAlbums(state.library, artistId, state.token);
      if (alive) {
        setAlbums(list);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [state.library, state.token, artistId]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <FlatList
      data={albums}
      keyExtractor={(a) => a.id}
      renderItem={({ item }) => (
        <Row
          title={item.title}
          subtitle={item.year ? String(item.year) : undefined}
          onPress={() => router.push({ pathname: "/tracks", params: { albumId: item.id } })}
        />
      )}
    />
  );
}
```

- [ ] **Step 2: Create `app/tracks.tsx`** (tapping a track starts the queue at that index)

```tsx
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, View } from "react-native";
import type { Track } from "@musex/core";
import { useStore } from "../src/state/store";
import { Row } from "../src/ui/Row";
import { theme } from "../src/ui/theme";

export default function Tracks() {
  const { albumId } = useLocalSearchParams<{ albumId: string }>();
  const { state, gateway, playTracks } = useStore();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!state.library || !state.token || !albumId) return;
      const list = await gateway.listTracks(state.library, albumId, state.token);
      if (alive) {
        setTracks(list);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [state.library, state.token, albumId]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <FlatList
      data={tracks}
      keyExtractor={(t) => t.id}
      renderItem={({ item, index }) => (
        <Row
          title={`${item.trackNumber ? `${item.trackNumber}. ` : ""}${item.title}`}
          subtitle={item.artistName}
          onPress={() => void playTracks(tracks, index)}
        />
      )}
    />
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @musex/mobile run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(mobile): albums + tracks screens, tap-to-play"
```

---

## Task 13: Mini player + end-to-end run on the Simulator

**Files:**
- Create: `packages/mobile/app/_components/MiniPlayer.tsx`
- Modify: `packages/mobile/app/_layout.tsx` (mount MiniPlayer above the Stack)

- [ ] **Step 1: Create `app/_components/MiniPlayer.tsx`**

```tsx
import { Pressable, Text, View } from "react-native";
import { useStore } from "../../src/state/store";
import { theme } from "../../src/ui/theme";

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function MiniPlayer() {
  const { state, session } = useStore();
  const pb = state.playback;
  // PlaybackState has no `current`: derive it from the queue.
  const current = pb?.queue ? pb.queue.tracks[pb.queue.index] : undefined;
  if (!pb || !current) return null;

  const playing = pb.status === "playing";
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        backgroundColor: theme.surface,
        borderTopWidth: 1,
        borderTopColor: theme.border,
        paddingHorizontal: theme.space(2),
        paddingVertical: theme.space(1.5),
        gap: theme.space(1.5),
      }}
    >
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: theme.text, fontWeight: "600" }}>
          {current.title}
        </Text>
        <Text numberOfLines={1} style={{ color: theme.textDim, fontSize: 12 }}>
          {current.artistName} · {fmt(pb.positionSec)} / {fmt(current.durationMs / 1000)}
        </Text>
      </View>
      <Pressable onPress={() => void session.previous()}>
        <Text style={{ color: theme.text, fontSize: 18 }}>⏮</Text>
      </Pressable>
      <Pressable onPress={() => (playing ? session.pause() : session.play())}>
        <Text style={{ color: theme.accent, fontSize: 22 }}>{playing ? "⏸" : "▶"}</Text>
      </Pressable>
      <Pressable onPress={() => void session.next()}>
        <Text style={{ color: theme.text, fontSize: 18 }}>⏭</Text>
      </Pressable>
    </View>
  );
}
```

Note: the glyphs above are placeholders for the manual-test build only. **Before merge, replace them with lucide icons** — the project rule is lucide-react across the UI, no emoji. On RN use `lucide-react-native` (`expo install lucide-react-native react-native-svg`); import `SkipBack`, `Play`, `Pause`, `SkipForward`. Verified against `packages/core/src/playback/playback-session.ts`: controls are `play`/`pause` (sync) + `next`/`previous` (async); `PlaybackState` fields are `queue`/`status`/`positionSec`/`durationSec` (no `current` — derive from `queue.tracks[queue.index]`).

- [ ] **Step 2: Mount `MiniPlayer` in `_layout.tsx`** — wrap the `Stack` so the bar sits at the bottom across all screens:

```tsx
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { MiniPlayer } from "./_components/MiniPlayer";
import { StoreProvider } from "../src/state/store";
import { theme } from "../src/ui/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar style="light" />
        <View style={{ flex: 1, backgroundColor: theme.bg }}>
          <View style={{ flex: 1 }}>
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: theme.surface },
                headerTintColor: theme.text,
                contentStyle: { backgroundColor: theme.bg },
              }}
            />
          </View>
          <SafeAreaView edges={["bottom"]} style={{ backgroundColor: theme.surface }}>
            <MiniPlayer />
          </SafeAreaView>
        </View>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
```

- [ ] **Step 3: Replace placeholder glyphs with lucide icons** (per the project no-emoji rule)

Run: `pnpm --filter @musex/mobile exec expo install lucide-react-native react-native-svg`
Then swap the three `<Text>` glyphs in `MiniPlayer.tsx` for `<SkipBack/>`, `<Play/>`/`<Pause/>`, `<SkipForward/>` from `lucide-react-native` (size 20–24, `color={theme.text}` / `theme.accent`).

- [ ] **Step 4: Full local check**

Run: `pnpm check`
Expected: biome + tsc + vitest PASS across all packages including `@musex/mobile`.

- [ ] **Step 5: Build the dev client and run on the iOS Simulator**

Run:
```bash
pnpm --filter @musex/mobile exec expo prebuild --platform ios
pnpm --filter @musex/mobile exec expo run:ios
```
Expected: the app builds, the Simulator launches musex.

- [ ] **Step 6: Manual end-to-end verification** (the real acceptance test for Phase 1)

Walk the flow and confirm each:
1. **Sign-in** — tap "Sign in with Plex" → browser opens app.plex.tv with the code → approve → app advances to the picker. Token persists: kill and relaunch → app skips sign-in.
2. **Discovery** — server/library auto-skips when single; lists when multiple.
3. **Browse** — artists load → tap → albums load → tap → tracks load.
4. **Playback** — tap a track → **audio plays through the Simulator**; mini player shows title/artist and a ticking position; play/pause works; next/prev moves tracks; a track **auto-advances** to the next at its end.
5. **Codec fallback** — if your library has an Opus/OGG track, confirm it plays (HLS transcode path).

Capture anything that fails as a follow-up task; do not mark Phase 1 done until 1–4 pass.

- [ ] **Step 7: Update docs** — add a `## iOS (mobile)` section to the project `CLAUDE.md` Tooling notes capturing the verified-current facts discovered during the build (exact Expo SDK 56 dep versions, expo-audio method/property names as they actually shipped, any Hermes polyfill needed, the `expo prebuild`/`run:ios` dev loop). This is required by the repo's "persist what you learn" rule.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(mobile): mini player + end-to-end playback wiring"
```

---

## Self-review (completed by plan author)

**Spec coverage:**
- Expo SDK 56 + dev client → Task 1 (dev-client scripts; New Arch always-on, no `newArchEnabled` field), Task 13 (prebuild/run).
- Metro monorepo + Hermes polyfills → Task 2.
- `TokenStore` (Keychain) → Task 9.
- `PlexGateway` hand-rolled fetch, auth+browse, 401→PlexAuthError, `@ctrl/plex` not reused → Tasks 4/6/7.
- `StreamResolver` direct + HLS-transcode by codec, no proxy → Task 5 (+ wrapper Task 9).
- `PlaybackEngine` expo-audio, preload no-op/gapless deferred, position/ended/error → Task 8.
- PlaybackSession wiring + queue → Task 9, exercised in Tasks 12–13.
- UI (expo-router: sign-in, picker, artists, albums, tracks, mini player) → Tasks 10–13.
- Testing (gateway/resolver/parsers/token-store unit; engine env-gated smoke; local bar=CI) → in each task + Task 3.
- Build simulator-first, no Apple account → Task 13.
- Codec/transcode + lucide-not-emoji + persist-learnings conventions → Tasks 5/13.

**Placeholder scan:** No "TBD/TODO/handle edge cases" left. One honest "verify against installed typings" note remains (expo-audio method/property names in Task 8) — those must be read from the freshly-installed package at execution; the plan gives the expected shape and the file to check. The `PlaybackSession`/`buildQueue` API was read from core and the plan's usage corrected to match (`subscribe`/`loadQueue`, two-arg `buildQueue`, no `current` field), so it is no longer an unknown.

**Type consistency:** `decideStreamRef(track, baseUrl, token, clientId)` is defined in Task 5 and called identically in Task 9. `PlexGatewayImpl(fetch, clientId)` + `baseUrlFor(serverId)` defined in Task 7, used in Tasks 9/12. `parse*` signatures defined in Task 6, used in Task 7. `ExpoAudioEngine` (`init/load/play/pause/seek/setVolume/on*/dispose`) defined in Task 8, used in Task 9. Store actions/`playTracks` defined in Task 9, used in Tasks 10–13.

**Known execution-time unknowns (flagged, not placeholders):** exact `expo-audio` method/property names (Task 8); exact SDK-56 dependency versions (resolved by `expo install`, Task 1). Each is called out at the point it matters with the authoritative source to check.
