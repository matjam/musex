# Foundation + Core Implementation Plan (Slice 1, Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the musex pnpm monorepo and build `@musex/core` — the pure, platform-agnostic domain (models, ports, playback session state machine, use-cases) — fully unit-tested against fake ports, with zero Electron/DOM dependencies.

**Architecture:** Hexagonal. `@musex/core` defines domain models, port *interfaces* (`PlexGateway`, `TokenStore`, `PlaybackEngine`, `StreamResolver`), a pure `PlaybackSession` state machine, and use-cases. Nothing in core imports Node, the DOM, or Electron. Consumers (the desktop app in Plan B; React Native later) provide adapters. Internal packages export TypeScript **source** (no build emit) and are compiled by each consumer's bundler (Vite/electron-vite) and by Vitest.

**Tech Stack:** TypeScript 6, pnpm workspaces, Vitest 4 (+ Vite 7 as its peer), Biome 2 (lint + format). No runtime dependencies in core.

**Project conventions (from `CLAUDE.md`):** commit directly to `main`; `git add -A` (never selective); push after every commit; local bar = CI bar (`pnpm check` must pass before push); TDD; no silently swallowed errors.

---

## File Structure

```
musex/
  package.json                      # root: pnpm workspace, scripts, dev tooling
  pnpm-workspace.yaml
  tsconfig.base.json                # shared compiler options
  biome.json                        # lint + format config
  packages/
    core/
      package.json                  # @musex/core — exports ./src/index.ts, no build
      tsconfig.json                 # typecheck only (noEmit)
      vitest.config.ts
      src/
        models/index.ts            # Server, Library, Artist, Album, Track, MediaInfo, Queue
        ports/
          plex-gateway.ts          # PlexGateway + Pin
          token-store.ts           # TokenStore
          stream-resolver.ts       # StreamResolver + StreamRef + StreamKind
          playback-engine.ts       # PlaybackEngine
          index.ts                 # re-exports
        playback/
          playback-session.ts      # PlaybackSession state machine
          playback-session.test.ts
        usecases/
          sign-in.ts               # signIn (PIN flow orchestration)
          sign-in.test.ts
          discover-libraries.ts    # discoverMusicLibraries
          discover-libraries.test.ts
          build-queue.ts           # buildQueue
          build-queue.test.ts
        testing/fakes.ts           # FakePlexGateway, FakeTokenStore, FakePlaybackEngine, FakeStreamResolver
        index.ts                   # public exports
```

**Responsibility boundaries:** `models` = plain data only. `ports` = interfaces only (no logic). `playback/playback-session.ts` = the one stateful unit; depends only on `PlaybackEngine` + `StreamResolver`, never on audio I/O directly. `usecases` = small pure orchestrators over ports. `testing/fakes.ts` = deterministic in-memory port implementations used by every test.

---

## Task 1: Monorepo + core scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/src/index.ts`

- [ ] **Step 1: Root `package.json`**

```json
{
  "name": "musex",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@11.5.2",
  "scripts": {
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "lint": "biome lint .",
    "format": "biome format --write .",
    "check": "pnpm -r typecheck && biome check . && pnpm -r test"
  },
  "devDependencies": {
    "@biomejs/biome": "^2.4.16",
    "@types/node": "^25.0.0",
    "typescript": "^6.0.3",
    "vite": "^7.0.0",
    "vitest": "^4.1.8"
  }
}
```

> Note: pnpm 11 **removed** `onlyBuiltDependencies` from `package.json`; build-script approval now lives in `pnpm-workspace.yaml` under `allowBuilds` (Step 2).

- [ ] **Step 2: `pnpm-workspace.yaml`**

```yaml
packages:
  - "packages/*"

# pnpm 11 gates dependency build scripts; allowlist esbuild (used by Vite/Vitest).
allowBuilds:
  esbuild: true
```

- [ ] **Step 3: `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": [],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  }
}
```

- [ ] **Step 4: `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.4.16/schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true },
  "files": { "includes": ["**/*.ts", "**/*.tsx", "**/*.json"] },
  "formatter": { "enabled": true, "indentStyle": "space", "indentWidth": 2, "lineWidth": 100 },
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "assist": { "actions": { "source": { "organizeImports": "on" } } }
}
```

- [ ] **Step 5: `packages/core/package.json`**

```json
{
  "name": "@musex/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

- [ ] **Step 6: `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "./src" },
  "include": ["src/**/*"]
}
```

- [ ] **Step 7: `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
  },
});
```

- [ ] **Step 8: Placeholder `packages/core/src/index.ts`** (replaced in Task 9)

```ts
export {};
```

- [ ] **Step 9: Install and verify tooling**

Run: `pnpm install`
Then: `pnpm -r typecheck`
Expected: completes with no errors (core has only an empty export so far).
Run: `pnpm exec biome check .`
Expected: no errors.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "Add monorepo scaffold and @musex/core skeleton"
git push origin main
```

---

## Task 2: Domain models

**Files:**
- Create: `packages/core/src/models/index.ts`

- [ ] **Step 1: Write the models** (plain data; no logic)

```ts
export interface Connection {
  uri: string;
  local: boolean;
  relay: boolean;
}

export interface Server {
  id: string; // machineIdentifier
  name: string;
  connections: Connection[];
}

export interface Library {
  id: string; // section key
  serverId: string;
  serverName: string;
  title: string;
  type: "music";
}

export interface Artist {
  id: string;
  serverId: string;
  name: string;
  thumb?: string;
}

export interface Album {
  id: string;
  serverId: string;
  artistId: string;
  title: string;
  year?: number;
  thumb?: string;
}

export interface MediaInfo {
  container: string;
  audioCodec: string;
  bitrate?: number;
  partId: string;
  partKey: string; // e.g. /library/parts/12345/file.flac
}

export interface Track {
  id: string;
  serverId: string;
  albumId: string;
  artistName: string;
  title: string;
  durationMs: number;
  trackNumber?: number;
  media: MediaInfo;
}

export interface Queue {
  tracks: Track[];
  index: number;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @musex/core typecheck`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Add core domain models"
git push origin main
```

---

## Task 3: Ports (interfaces)

**Files:**
- Create: `packages/core/src/ports/plex-gateway.ts`, `token-store.ts`, `stream-resolver.ts`, `playback-engine.ts`, `index.ts`

- [ ] **Step 1: `stream-resolver.ts`** (defined first; others import `StreamRef`)

```ts
import type { Track } from "../models/index";

export type StreamKind = "direct" | "hls";

export interface StreamRef {
  url: string;
  kind: StreamKind;
}

/** Turns a Track into a playable URL. In the desktop app this returns a
 *  localhost stream-proxy URL so the Plex token never reaches the renderer. */
export interface StreamResolver {
  resolve(track: Track): Promise<StreamRef>;
}
```

- [ ] **Step 2: `plex-gateway.ts`**

```ts
import type { Album, Artist, Library, Server, Track } from "../models/index";

export interface Pin {
  id: string;
  code: string;
  authUrl: string;
}

/** Auth, discovery and browse. Implemented in the main process (Node, no CORS)
 *  wrapping a Plex client; the token is passed explicitly by the caller. */
export interface PlexGateway {
  createPin(): Promise<Pin>;
  pollPin(id: string): Promise<{ authToken: string | null }>;
  listServers(token: string): Promise<Server[]>;
  listMusicLibraries(server: Server, token: string): Promise<Library[]>;
  listArtists(library: Library, token: string): Promise<Artist[]>;
  listAlbums(library: Library, artistId: string, token: string): Promise<Album[]>;
  listTracks(library: Library, albumId: string, token: string): Promise<Track[]>;
}
```

- [ ] **Step 3: `token-store.ts`**

```ts
export interface TokenStore {
  save(token: string): Promise<void>;
  load(): Promise<string | null>;
  clear(): Promise<void>;
}
```

- [ ] **Step 4: `playback-engine.ts`**

```ts
import type { StreamRef } from "./stream-resolver";

/** Audio output. Implemented in the renderer (Gapless-5 / hls.js). The session
 *  drives it and consumes its events; it performs no queue logic itself. */
export interface PlaybackEngine {
  load(ref: StreamRef): Promise<void>;
  /** Buffer the next track ahead of time so the transition is gapless. */
  preload(ref: StreamRef): Promise<void>;
  play(): void;
  pause(): void;
  seek(seconds: number): void;
  setVolume(volume: number): void;
  onPosition(cb: (seconds: number) => void): void;
  onEnded(cb: () => void): void;
  onError(cb: (err: Error) => void): void;
}
```

- [ ] **Step 5: `index.ts`** (re-exports)

```ts
export type { Pin, PlexGateway } from "./plex-gateway";
export type { TokenStore } from "./token-store";
export type { StreamKind, StreamRef, StreamResolver } from "./stream-resolver";
export type { PlaybackEngine } from "./playback-engine";
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @musex/core typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "Add core port interfaces"
git push origin main
```

---

## Task 4: Test fakes

**Files:**
- Create: `packages/core/src/testing/fakes.ts`

- [ ] **Step 1: Write the fakes** (deterministic, in-memory)

```ts
import type { Album, Artist, Library, Server, Track } from "../models/index";
import type { Pin, PlexGateway } from "../ports/plex-gateway";
import type { PlaybackEngine } from "../ports/playback-engine";
import type { StreamRef, StreamResolver } from "../ports/stream-resolver";
import type { TokenStore } from "../ports/token-store";

export class FakeTokenStore implements TokenStore {
  private token: string | null = null;
  readonly saved: string[] = [];
  async save(token: string): Promise<void> {
    this.token = token;
    this.saved.push(token);
  }
  async load(): Promise<string | null> {
    return this.token;
  }
  async clear(): Promise<void> {
    this.token = null;
  }
}

export class FakePlexGateway implements PlexGateway {
  pin: Pin = { id: "pin-1", code: "ABCD", authUrl: "https://app.plex.tv/auth#?code=ABCD" };
  pollResults: Array<{ authToken: string | null }> = [];
  servers: Server[] = [];
  readonly libraries = new Map<string, Library[]>(); // serverId -> libs
  readonly artists = new Map<string, Artist[]>(); // libraryId -> artists
  readonly albums = new Map<string, Album[]>(); // artistId -> albums
  readonly tracks = new Map<string, Track[]>(); // albumId -> tracks
  readonly unreachableServerIds = new Set<string>();
  createPinCalls = 0;
  private pollIdx = 0;

  async createPin(): Promise<Pin> {
    this.createPinCalls++;
    return this.pin;
  }
  async pollPin(_id: string): Promise<{ authToken: string | null }> {
    const result = this.pollResults[this.pollIdx] ?? { authToken: null };
    if (this.pollIdx < this.pollResults.length - 1) this.pollIdx++;
    return result;
  }
  async listServers(_token: string): Promise<Server[]> {
    return this.servers;
  }
  async listMusicLibraries(server: Server, _token: string): Promise<Library[]> {
    if (this.unreachableServerIds.has(server.id)) {
      throw new Error(`unreachable server: ${server.id}`);
    }
    return this.libraries.get(server.id) ?? [];
  }
  async listArtists(library: Library, _token: string): Promise<Artist[]> {
    return this.artists.get(library.id) ?? [];
  }
  async listAlbums(_library: Library, artistId: string, _token: string): Promise<Album[]> {
    return this.albums.get(artistId) ?? [];
  }
  async listTracks(_library: Library, albumId: string, _token: string): Promise<Track[]> {
    return this.tracks.get(albumId) ?? [];
  }
}

export class FakeStreamResolver implements StreamResolver {
  readonly resolved: Track[] = [];
  async resolve(track: Track): Promise<StreamRef> {
    this.resolved.push(track);
    return { url: `fake://stream/${track.id}`, kind: "direct" };
  }
}

export class FakePlaybackEngine implements PlaybackEngine {
  readonly loaded: StreamRef[] = [];
  readonly preloaded: StreamRef[] = [];
  playCalls = 0;
  pauseCalls = 0;
  readonly seekCalls: number[] = [];
  readonly volumeCalls: number[] = [];
  private positionCb: ((s: number) => void) | null = null;
  private endedCb: (() => void) | null = null;
  private errorCb: ((e: Error) => void) | null = null;

  async load(ref: StreamRef): Promise<void> {
    this.loaded.push(ref);
  }
  async preload(ref: StreamRef): Promise<void> {
    this.preloaded.push(ref);
  }
  play(): void {
    this.playCalls++;
  }
  pause(): void {
    this.pauseCalls++;
  }
  seek(seconds: number): void {
    this.seekCalls.push(seconds);
  }
  setVolume(volume: number): void {
    this.volumeCalls.push(volume);
  }
  onPosition(cb: (s: number) => void): void {
    this.positionCb = cb;
  }
  onEnded(cb: () => void): void {
    this.endedCb = cb;
  }
  onError(cb: (e: Error) => void): void {
    this.errorCb = cb;
  }

  // --- test helpers to simulate engine events ---
  emitPosition(seconds: number): void {
    this.positionCb?.(seconds);
  }
  emitEnded(): void {
    this.endedCb?.();
  }
  emitError(err: Error): void {
    this.errorCb?.(err);
  }
}
```

- [ ] **Step 2: Add a test-data helper at the bottom of the same file** (used across tests)

```ts
export function makeTrack(id: string, overrides: Partial<Track> = {}): Track {
  return {
    id,
    serverId: "srv-1",
    albumId: "alb-1",
    artistName: "Test Artist",
    title: `Track ${id}`,
    durationMs: 180_000,
    media: { container: "flac", audioCodec: "flac", partId: `part-${id}`, partKey: `/library/parts/${id}/file.flac` },
    ...overrides,
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @musex/core typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Add core test fakes"
git push origin main
```

---

## Task 5: PlaybackSession state machine (TDD)

**Files:**
- Create: `packages/core/src/playback/playback-session.test.ts`
- Create: `packages/core/src/playback/playback-session.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { FakePlaybackEngine, FakeStreamResolver, makeTrack } from "../testing/fakes";
import { PlaybackSession } from "./playback-session";

function setup() {
  const engine = new FakePlaybackEngine();
  const resolver = new FakeStreamResolver();
  const session = new PlaybackSession(engine, resolver);
  return { engine, resolver, session };
}

describe("PlaybackSession", () => {
  it("loads a queue, plays the start index, and reports playing", async () => {
    const { engine, session } = setup();
    const tracks = [makeTrack("1"), makeTrack("2"), makeTrack("3")];
    await session.loadQueue({ tracks, index: 0 });

    expect(engine.loaded.map((r) => r.url)).toEqual(["fake://stream/1"]);
    expect(engine.playCalls).toBe(1);
    expect(session.getState().status).toBe("playing");
    expect(session.getState().durationSec).toBe(180);
  });

  it("preloads the next track for gapless playback", async () => {
    const { engine, session } = setup();
    const tracks = [makeTrack("1"), makeTrack("2")];
    await session.loadQueue({ tracks, index: 0 });

    expect(engine.preloaded.map((r) => r.url)).toEqual(["fake://stream/2"]);
  });

  it("does not preload past the end of the queue", async () => {
    const { engine, session } = setup();
    await session.loadQueue({ tracks: [makeTrack("1")], index: 0 });
    expect(engine.preloaded).toEqual([]);
  });

  it("advances to the next track when the current one ends", async () => {
    const { engine, session } = setup();
    const tracks = [makeTrack("1"), makeTrack("2")];
    await session.loadQueue({ tracks, index: 0 });
    engine.emitEnded();

    // onEnded triggers an async advance chain; poll until it settles.
    await vi.waitFor(() => {
      expect(engine.loaded.map((r) => r.url)).toEqual(["fake://stream/1", "fake://stream/2"]);
    });
    expect(session.getState().queue?.index).toBe(1);
  });

  it("ends when the last track finishes", async () => {
    const { engine, session } = setup();
    await session.loadQueue({ tracks: [makeTrack("1")], index: 0 });
    engine.emitEnded();

    await vi.waitFor(() => {
      expect(session.getState().status).toBe("ended");
    });
  });

  it("pause and play update status and call the engine", async () => {
    const { engine, session } = setup();
    await session.loadQueue({ tracks: [makeTrack("1")], index: 0 });
    session.pause();
    expect(engine.pauseCalls).toBe(1);
    expect(session.getState().status).toBe("paused");
    session.play();
    expect(session.getState().status).toBe("playing");
  });

  it("seek and setVolume delegate to the engine and update state", async () => {
    const { engine, session } = setup();
    await session.loadQueue({ tracks: [makeTrack("1")], index: 0 });
    session.seek(42);
    session.setVolume(0.5);
    expect(engine.seekCalls).toEqual([42]);
    expect(engine.volumeCalls).toEqual([0.5]);
    expect(session.getState().positionSec).toBe(42);
    expect(session.getState().volume).toBe(0.5);
  });

  it("surfaces engine errors as error status", async () => {
    const { engine, session } = setup();
    await session.loadQueue({ tracks: [makeTrack("1")], index: 0 });
    engine.emitError(new Error("decode failed"));
    expect(session.getState().status).toBe("error");
    expect(session.getState().error).toBe("decode failed");
  });

  it("notifies subscribers on state change", async () => {
    const { session } = setup();
    const states: string[] = [];
    session.subscribe((s) => states.push(s.status));
    await session.loadQueue({ tracks: [makeTrack("1")], index: 0 });
    expect(states).toContain("playing");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @musex/core test`
Expected: FAIL — `Cannot find module './playback-session'` / `PlaybackSession is not defined`.

- [ ] **Step 3: Implement `playback-session.ts`**

```ts
import type { Queue } from "../models/index";
import type { PlaybackEngine } from "../ports/playback-engine";
import type { StreamResolver } from "../ports/stream-resolver";

export type PlaybackStatus = "idle" | "loading" | "playing" | "paused" | "ended" | "error";

export interface PlaybackState {
  queue: Queue | null;
  status: PlaybackStatus;
  positionSec: number;
  durationSec: number;
  volume: number;
  error: string | null;
}

const INITIAL_STATE: PlaybackState = {
  queue: null,
  status: "idle",
  positionSec: 0,
  durationSec: 0,
  volume: 1,
  error: null,
};

export class PlaybackSession {
  private state: PlaybackState = INITIAL_STATE;
  private readonly listeners = new Set<(s: PlaybackState) => void>();
  private preloadedIndex: number | null = null;

  constructor(
    private readonly engine: PlaybackEngine,
    private readonly resolver: StreamResolver,
  ) {
    this.engine.onPosition((sec) => this.patch({ positionSec: sec }));
    this.engine.onEnded(() => {
      void this.handleEnded();
    });
    this.engine.onError((err) => this.patch({ status: "error", error: err.message }));
  }

  getState(): PlaybackState {
    return this.state;
  }

  subscribe(cb: (s: PlaybackState) => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  async loadQueue(queue: Queue): Promise<void> {
    this.patch({ queue, error: null });
    await this.playIndex(queue.index);
  }

  async playIndex(index: number): Promise<void> {
    const queue = this.state.queue;
    if (!queue) return;
    const track = queue.tracks[index];
    if (!track) return;

    this.preloadedIndex = null;
    this.patch({ queue: { ...queue, index }, status: "loading", positionSec: 0 });
    const ref = await this.resolver.resolve(track);
    await this.engine.load(ref);
    this.engine.play();
    this.patch({ status: "playing", durationSec: track.durationMs / 1000 });
    await this.preloadNext();
  }

  play(): void {
    if (!this.state.queue) return;
    this.engine.play();
    this.patch({ status: "playing" });
  }

  pause(): void {
    this.engine.pause();
    this.patch({ status: "paused" });
  }

  async next(): Promise<void> {
    const queue = this.state.queue;
    if (queue) await this.playIndex(queue.index + 1);
  }

  async previous(): Promise<void> {
    const queue = this.state.queue;
    if (queue) await this.playIndex(queue.index - 1);
  }

  seek(seconds: number): void {
    this.engine.seek(seconds);
    this.patch({ positionSec: seconds });
  }

  setVolume(volume: number): void {
    this.engine.setVolume(volume);
    this.patch({ volume });
  }

  private async preloadNext(): Promise<void> {
    const queue = this.state.queue;
    if (!queue) return;
    const nextIndex = queue.index + 1;
    const nextTrack = queue.tracks[nextIndex];
    if (!nextTrack || this.preloadedIndex === nextIndex) return;
    const ref = await this.resolver.resolve(nextTrack);
    await this.engine.preload(ref);
    this.preloadedIndex = nextIndex;
  }

  private async handleEnded(): Promise<void> {
    const queue = this.state.queue;
    if (!queue) return;
    if (queue.index + 1 < queue.tracks.length) {
      await this.playIndex(queue.index + 1);
    } else {
      this.patch({ status: "ended" });
    }
  }

  private patch(partial: Partial<PlaybackState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener(this.state);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @musex/core test`
Expected: PASS (all PlaybackSession tests green).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add PlaybackSession state machine with gapless lookahead"
git push origin main
```

---

## Task 6: signIn use-case (TDD)

**Files:**
- Create: `packages/core/src/usecases/sign-in.test.ts`
- Create: `packages/core/src/usecases/sign-in.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { FakePlexGateway, FakeTokenStore } from "../testing/fakes";
import { signIn, SignInTimeoutError } from "./sign-in";

function clock(values: number[]) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0;
}

describe("signIn", () => {
  it("opens the auth URL, polls until a token appears, and saves it", async () => {
    const gateway = new FakePlexGateway();
    gateway.pollResults = [{ authToken: null }, { authToken: "tok-123" }];
    const tokenStore = new FakeTokenStore();
    const opened: string[] = [];

    const result = await signIn(
      {
        gateway,
        tokenStore,
        openAuthUrl: (url) => {
          opened.push(url);
        },
        wait: async () => {},
        now: clock([0, 1, 2]),
      },
      { pollIntervalMs: 1, timeoutMs: 1000 },
    );

    expect(opened).toEqual([gateway.pin.authUrl]);
    expect(result.token).toBe("tok-123");
    expect(tokenStore.saved).toEqual(["tok-123"]);
  });

  it("throws SignInTimeoutError when the token never appears in time", async () => {
    const gateway = new FakePlexGateway();
    gateway.pollResults = [{ authToken: null }];
    const tokenStore = new FakeTokenStore();

    await expect(
      signIn(
        {
          gateway,
          tokenStore,
          openAuthUrl: () => {},
          wait: async () => {},
          now: clock([0, 500, 1000, 1500]),
        },
        { pollIntervalMs: 1, timeoutMs: 1000 },
      ),
    ).rejects.toBeInstanceOf(SignInTimeoutError);
    expect(tokenStore.saved).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @musex/core test`
Expected: FAIL — `Cannot find module './sign-in'`.

- [ ] **Step 3: Implement `sign-in.ts`**

```ts
import type { PlexGateway } from "../ports/plex-gateway";
import type { TokenStore } from "../ports/token-store";

export interface SignInDeps {
  gateway: PlexGateway;
  tokenStore: TokenStore;
  openAuthUrl: (url: string) => void | Promise<void>;
  wait: (ms: number) => Promise<void>;
  now: () => number;
}

export interface SignInOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface SignInResult {
  token: string;
}

export class SignInTimeoutError extends Error {
  constructor() {
    super("Plex sign-in timed out waiting for approval");
    this.name = "SignInTimeoutError";
  }
}

export async function signIn(deps: SignInDeps, options: SignInOptions = {}): Promise<SignInResult> {
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;

  const pin = await deps.gateway.createPin();
  await deps.openAuthUrl(pin.authUrl);

  const start = deps.now();
  for (;;) {
    const { authToken } = await deps.gateway.pollPin(pin.id);
    if (authToken) {
      await deps.tokenStore.save(authToken);
      return { token: authToken };
    }
    if (deps.now() - start >= timeoutMs) {
      throw new SignInTimeoutError();
    }
    await deps.wait(pollIntervalMs);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @musex/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add signIn use-case (PIN flow orchestration)"
git push origin main
```

---

## Task 7: discoverMusicLibraries use-case (TDD)

**Files:**
- Create: `packages/core/src/usecases/discover-libraries.test.ts`
- Create: `packages/core/src/usecases/discover-libraries.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import type { Library, Server } from "../models/index";
import { FakePlexGateway } from "../testing/fakes";
import { discoverMusicLibraries } from "./discover-libraries";

function server(id: string): Server {
  return { id, name: `Server ${id}`, connections: [{ uri: `http://${id}`, local: true, relay: false }] };
}
function library(id: string, serverId: string): Library {
  return { id, serverId, serverName: `Server ${serverId}`, title: `Music ${id}`, type: "music" };
}

describe("discoverMusicLibraries", () => {
  it("returns music libraries from all reachable servers", async () => {
    const gateway = new FakePlexGateway();
    gateway.servers = [server("a"), server("b")];
    gateway.libraries.set("a", [library("a1", "a")]);
    gateway.libraries.set("b", [library("b1", "b")]);

    const libs = await discoverMusicLibraries(gateway, "tok");
    expect(libs.map((l) => l.id)).toEqual(["a1", "b1"]);
  });

  it("skips unreachable servers without failing the whole discovery", async () => {
    const gateway = new FakePlexGateway();
    gateway.servers = [server("a"), server("b")];
    gateway.libraries.set("a", [library("a1", "a")]);
    gateway.unreachableServerIds.add("b");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const libs = await discoverMusicLibraries(gateway, "tok");

    expect(libs.map((l) => l.id)).toEqual(["a1"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @musex/core test`
Expected: FAIL — `Cannot find module './discover-libraries'`.

- [ ] **Step 3: Implement `discover-libraries.ts`**

```ts
import type { Library } from "../models/index";
import type { PlexGateway } from "../ports/plex-gateway";

/** Lists music libraries across every reachable server. An unreachable server is
 *  logged and skipped (not swallowed silently) rather than failing discovery. */
export async function discoverMusicLibraries(
  gateway: PlexGateway,
  token: string,
): Promise<Library[]> {
  const servers = await gateway.listServers(token);
  const libraries: Library[] = [];
  for (const server of servers) {
    try {
      const libs = await gateway.listMusicLibraries(server, token);
      libraries.push(...libs);
    } catch (err) {
      console.warn(`musex: skipping unreachable server "${server.name}" (${server.id})`, err);
    }
  }
  return libraries;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @musex/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add discoverMusicLibraries use-case"
git push origin main
```

---

## Task 8: buildQueue use-case (TDD)

**Files:**
- Create: `packages/core/src/usecases/build-queue.test.ts`
- Create: `packages/core/src/usecases/build-queue.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { makeTrack } from "../testing/fakes";
import { buildQueue } from "./build-queue";

describe("buildQueue", () => {
  it("builds a queue starting at the given index", () => {
    const tracks = [makeTrack("1"), makeTrack("2"), makeTrack("3")];
    const queue = buildQueue(tracks, 1);
    expect(queue.tracks).toBe(tracks);
    expect(queue.index).toBe(1);
  });

  it("defaults to index 0", () => {
    const queue = buildQueue([makeTrack("1")]);
    expect(queue.index).toBe(0);
  });

  it("clamps an out-of-range index", () => {
    const tracks = [makeTrack("1"), makeTrack("2")];
    expect(buildQueue(tracks, 99).index).toBe(1);
    expect(buildQueue(tracks, -5).index).toBe(0);
  });

  it("clamps to 0 for an empty track list", () => {
    expect(buildQueue([], 3).index).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @musex/core test`
Expected: FAIL — `Cannot find module './build-queue'`.

- [ ] **Step 3: Implement `build-queue.ts`**

```ts
import type { Queue, Track } from "../models/index";

export function buildQueue(tracks: Track[], startIndex = 0): Queue {
  const maxIndex = Math.max(tracks.length - 1, 0);
  const index = Math.min(Math.max(startIndex, 0), maxIndex);
  return { tracks, index };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @musex/core test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Add buildQueue use-case"
git push origin main
```

---

## Task 9: Public exports + full green

**Files:**
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the public barrel**

```ts
// Models
export type {
  Album,
  Artist,
  Connection,
  Library,
  MediaInfo,
  Queue,
  Server,
  Track,
} from "./models/index";

// Ports
export type { Pin, PlexGateway } from "./ports/plex-gateway";
export type { TokenStore } from "./ports/token-store";
export type { StreamKind, StreamRef, StreamResolver } from "./ports/stream-resolver";
export type { PlaybackEngine } from "./ports/playback-engine";

// Playback
export { PlaybackSession } from "./playback/playback-session";
export type { PlaybackState, PlaybackStatus } from "./playback/playback-session";

// Use-cases
export { signIn, SignInTimeoutError } from "./usecases/sign-in";
export type { SignInDeps, SignInOptions, SignInResult } from "./usecases/sign-in";
export { discoverMusicLibraries } from "./usecases/discover-libraries";
export { buildQueue } from "./usecases/build-queue";
```

- [ ] **Step 2: Run the full local CI bar**

Run: `pnpm check`
Expected: typecheck PASS, `biome check .` PASS (no lint/format issues), all tests PASS.
If Biome reports formatting diffs, run `pnpm format` then re-run `pnpm check`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "Export @musex/core public API; core slice complete"
git push origin main
```

---

## Done criteria

- `pnpm check` is green (typecheck + Biome + Vitest).
- `@musex/core` exposes models, ports, `PlaybackSession`, and the `signIn` / `discoverMusicLibraries` / `buildQueue` use-cases.
- Zero Node/DOM/Electron imports anywhere in `packages/core/src`.
- Every unit is tested against fakes; no real network or audio involved.

**Next:** Plan B (Desktop app) — wire `@musex/core` to Plex (`@ctrl/plex`), the stream proxy, the Gapless-5 engine, IPC, and the React UI.
