# Mobile Home + Taste Subsystem + Lock-Screen Commands — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Home tab (taste-driven mixes + Plex/smart playlists + recently-played), an on-device taste subsystem that records plays and feeds those mixes, and lock-screen next/previous track commands — to the Expo iOS app, in one PR.

**Architecture:** Hexagonal. All decision logic is pure in `@musex/core` (`PlayTracker`/`classifyPlay`/`PlayMonitor`, plus the existing `computeSmartPlaylist`/`composeForYou`/`smartMix*`). Mobile adds thin adapters: `taste-persistence` (AsyncStorage), a `lock-screen-commands` local Expo native module (Swift `MPRemoteCommandCenter` → JS events), a `TasteService`, and the Home view layer. Nothing platform-specific leaks into core.

**Tech Stack:** Expo SDK 56, React Native 0.85, expo-router/ui, expo-audio, `@react-native-async-storage/async-storage`, a local Expo module (Swift), `@musex/core`, vitest.

**Spec:** `docs/superpowers/specs/2026-06-16-mobile-home-taste-lockscreen-design.md`

**Branch:** `feature/mobile-home-taste-lockscreen` (already created off `main`).

---

## Reference facts (verified against the codebase)

- `theme` keys (`packages/mobile/src/ui/theme.ts`): `bg #0d0d10`, `surface #17171c`, `text #f2f2f5`, `textDim #9a9aa6`, `accent #1db954`, `border #26262e`, `space: (n)=>n*8`.
- `PlaybackState` (`@musex/core`): `{ queue: Queue | null; status: "idle"|"loading"|"playing"|"paused"|"ended"|"error"; positionSec: number; durationSec: number; volume: number; error: string | null }`. `Queue = { tracks: Track[]; index: number; shuffle: boolean; repeat: RepeatMode }`.
- `PlaybackSession` methods: `subscribe(cb)`, `loadQueue(queue)`, `loadQueueShuffled(tracks)`, `enqueueEnd(tracks)`, `play()`, `pause()`, `seek(s)`, **`next()`**, **`previous()`**, `setShuffle`, `cycleRepeat`, `jumpTo`. `buildQueue(tracks, startIndex=0)`.
- `Track` has `id, serverId, albumId, artistId, artistName, albumTitle?, title, durationMs, trackNumber?, thumb?, userRating?, genres?, moods?, media`.
- `Playlist = { id, serverId, title, trackCount, durationMs?, thumb?, updatedAt? }`. `PlaylistTrack = { track: Track; playlistItemId: string }`.
- Taste core API (all re-exported from `@musex/core`): `TasteProfile` (`recordPlay(t,kind)`, `topArtists(limit?)`, `trackStats()`, `serialize()`, `load(state)`), `TasteState = { artists: Record<string,ArtistStat>; tracks: Record<string,TrackStat> }`, `computeSmartPlaylist(kind, tracks, stats, artistScores, nowMs)` (kind = `"top-rated"|"heavy-rotation"|"rediscover"`), `composeForYou(ForYouInput)`, `smartMixThumbs(kind, tracks, stats, artistScores, nowMs)`, `smartMixEmpty(kind, tracks, stats, artistScores, nowMs)`, `smartTrackKey({artistName,title})`, `SMART_TITLES`, `SmartKind` (`"for-you"|"top-rated"|"heavy-rotation"|"rediscover"`). `trackStats()` items are `{ artistName, title, plays, skips, lastPlayedMs, ratingStars, key, decayedPlays }` — structurally a superset of `SmartTrackStat` (`{key,plays,lastPlayedMs,decayedPlays}`), so they pass directly as `stats`.
- `ForYouInput = { ownTop: {artistId,name,score}[]; similarOwned: {artistId,name,viaArtist}[]; tracksByArtist: Map<string,Track[]>; stats: Map<string,ForYouTrackStat>; nowMs }`. `ForYouTrackStat = { plays; skips; lastPlayedMs; ratingStars? }`.
- Run commands from repo root: typecheck/lint/test = `pnpm check`. Mobile-only tests: `pnpm --filter @musex/mobile test`. Core tests: `pnpm --filter @musex/core test`.

**Deviation from spec (documented):** `TrackList` is used by the new **mix** and **playlist** screens only. The existing album `library/tracks.tsx` keeps its numbered-row + big-art-header layout (a different shape) and is **not** refactored — avoids regressing working UI for marginal DRY gain. The pure logic for play recording is consolidated into a single core module `logic/play-monitor.ts` (`classifyPlay` + `PlayTracker` + `PlayMonitor`) rather than split — more testable.

---

## Task 1: Core — `classifyPlay` + `PlayTracker` + `PlayMonitor`

**Files:**
- Create: `packages/core/src/logic/play-monitor.ts`
- Test: `packages/core/src/logic/play-monitor.test.ts`
- Modify: `packages/core/src/index.ts` (add barrel export)

- [ ] **Step 1: Write the failing tests**

`packages/core/src/logic/play-monitor.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { PlaybackState, Track } from "../index.js";
import { classifyPlay, PlayMonitor, PlayTracker } from "./play-monitor.js";

function track(id: string, durationMs = 200_000): Track {
  return {
    id,
    serverId: "s",
    albumId: "al",
    artistId: "ar",
    artistName: `Artist ${id}`,
    title: `Track ${id}`,
    durationMs,
    media: { container: "", audioCodec: "", partId: "p", partKey: "/p" },
  };
}

function state(tracks: Track[], index: number, status: PlaybackState["status"], positionSec: number): PlaybackState {
  return {
    queue: tracks.length ? { tracks, index, shuffle: false, repeat: "none" } : null,
    status,
    positionSec,
    durationSec: tracks[index] ? tracks[index].durationMs / 1000 : 0,
    volume: 1,
    error: null,
  };
}

describe("classifyPlay", () => {
  it("full when played past the scrobble threshold (min 240s or half)", () => {
    expect(classifyPlay(120, 200)).toBe("full"); // half of 200 = 100, played 120
    expect(classifyPlay(240, 1000)).toBe("full"); // abs cap 240 on a long track
  });
  it("skip when under 60s AND under 25% of duration", () => {
    expect(classifyPlay(10, 200)).toBe("skip"); // 10 < 60 and 10 < 50
  });
  it("partial otherwise", () => {
    expect(classifyPlay(70, 200)).toBe("partial"); // not full (<100), not skip (>=60)
  });
  it("unknown duration falls back to the absolute thresholds", () => {
    expect(classifyPlay(10, 0)).toBe("skip");
    expect(classifyPlay(250, 0)).toBe("full");
  });
});

describe("PlayTracker", () => {
  it("accumulates continuous playing deltas", () => {
    const t = new PlayTracker();
    t.start(200);
    for (let p = 0; p <= 120; p++) t.update(p, true);
    expect(t.playedSec()).toBeGreaterThanOrEqual(119);
    expect(t.finish()).toBe("full");
  });
  it("ignores seeks (jumps > 2s)", () => {
    const t = new PlayTracker();
    t.start(200);
    t.update(0, true);
    t.update(120, true); // a 120s jump = seek, not credited
    expect(t.playedSec()).toBe(0);
  });
  it("does not accrue while paused", () => {
    const t = new PlayTracker();
    t.start(200);
    t.update(0, true);
    t.update(1, true); // +1
    t.update(2, false); // paused, no credit
    t.update(3, false);
    expect(t.playedSec()).toBe(1);
  });
});

describe("PlayMonitor", () => {
  it("records the previous track as a skip when the user jumps to the next early", () => {
    const m = new PlayMonitor();
    const tracks = [track("a"), track("b")];
    expect(m.onState(state(tracks, 0, "playing", 0))).toBeNull(); // start a
    expect(m.onState(state(tracks, 0, "playing", 5))).toBeNull(); // 5s in
    const ev = m.onState(state(tracks, 1, "playing", 0)); // jumped to b
    expect(ev).toEqual({ title: "Track a", artistName: "Artist a", kind: "skip" });
  });

  it("records a full play on natural end of the final track exactly once", () => {
    const m = new PlayMonitor();
    const tracks = [track("a", 100_000)];
    m.onState(state(tracks, 0, "playing", 0));
    for (let p = 0; p <= 80; p++) m.onState(state(tracks, 0, "playing", p));
    const ev = m.onState(state(tracks, 0, "ended", 80));
    expect(ev).toEqual({ title: "Track a", artistName: "Artist a", kind: "full" });
    // a second "ended" must not double-record
    expect(m.onState(state(tracks, 0, "ended", 80))).toBeNull();
  });

  it("does not double-record when auto-advance follows a natural end", () => {
    const m = new PlayMonitor();
    const tracks = [track("a", 100_000), track("b")];
    m.onState(state(tracks, 0, "playing", 0));
    for (let p = 0; p <= 80; p++) m.onState(state(tracks, 0, "playing", p));
    const ended = m.onState(state(tracks, 0, "ended", 80));
    expect(ended?.kind).toBe("full");
    const advance = m.onState(state(tracks, 1, "playing", 0)); // index moved to b
    expect(advance).toBeNull(); // already recorded a; now tracking b
  });
});
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm --filter @musex/core test play-monitor`
Expected: FAIL (`Cannot find module './play-monitor.js'`).

- [ ] **Step 3: Implement `play-monitor.ts`**

`packages/core/src/logic/play-monitor.ts`:

```typescript
import type { PlaybackState } from "../playback/playback-session.js";

export type PlayKind = "full" | "skip" | "partial";

const SCROBBLE_ABS_SEC = 240;
const SCROBBLE_FRACTION = 0.5;
const SKIP_MAX_SEC = 60;
const SKIP_MAX_FRACTION = 0.25;
const MAX_CONTINUOUS_DELTA = 2;

/** Classify a finished play from effective listening seconds + track duration.
 *  "full" = listened past min(240s, half); "skip" = under 60s AND under 25%;
 *  otherwise "partial". Unknown duration (<=0) uses the absolute thresholds. */
export function classifyPlay(playedSec: number, durationSec: number): PlayKind {
  const scrobbleAt =
    durationSec > 0 ? Math.min(SCROBBLE_ABS_SEC, durationSec * SCROBBLE_FRACTION) : SCROBBLE_ABS_SEC;
  if (playedSec >= scrobbleAt) return "full";
  const skipFrac = durationSec > 0 ? durationSec * SKIP_MAX_FRACTION : Number.POSITIVE_INFINITY;
  if (playedSec < SKIP_MAX_SEC && playedSec < skipFrac) return "skip";
  return "partial";
}

/** Folds position updates into effective listening seconds, ignoring seeks
 *  (a jump > 2s) and pauses. Pure; the host feeds it position ticks. */
export class PlayTracker {
  private durationSec = 0;
  private accumulated = 0;
  private lastPos: number | null = null;

  start(durationSec: number): void {
    this.durationSec = durationSec;
    this.accumulated = 0;
    this.lastPos = null;
  }

  update(positionSec: number, playing: boolean): void {
    if (this.lastPos !== null && playing) {
      const delta = positionSec - this.lastPos;
      if (delta > 0 && delta <= MAX_CONTINUOUS_DELTA) this.accumulated += delta;
    }
    this.lastPos = positionSec;
  }

  playedSec(): number {
    return this.accumulated;
  }

  finish(): PlayKind {
    return classifyPlay(this.accumulated, this.durationSec);
  }
}

export interface CompletedPlay {
  title: string;
  artistName: string;
  kind: PlayKind;
}

/** Consumes a stream of PlaybackState and emits a CompletedPlay when a track's
 *  play-through ends — by track change, stop, or natural end of the final
 *  track. Records each track at most once (guards double-count when auto-advance
 *  follows a natural end). Pure; the host calls onState in its subscribe loop
 *  and forwards any returned event to TasteProfile.recordPlay. */
export class PlayMonitor {
  private tracker = new PlayTracker();
  private currentId: string | null = null;
  private currentInfo: { title: string; artistName: string } | null = null;
  private recorded = false;

  onState(s: PlaybackState): CompletedPlay | null {
    const cur = s.queue ? s.queue.tracks[s.queue.index] : undefined;

    if (!cur || cur.id !== this.currentId) {
      const completed = this.flush();
      if (cur) {
        this.tracker.start(cur.durationMs / 1000);
        this.currentId = cur.id;
        this.currentInfo = { title: cur.title, artistName: cur.artistName };
        this.recorded = false;
        this.tracker.update(s.positionSec, s.status === "playing");
      } else {
        this.reset();
      }
      return completed;
    }

    if (s.status === "ended" && !this.recorded) {
      this.recorded = true;
      return this.currentInfo ? { ...this.currentInfo, kind: this.tracker.finish() } : null;
    }

    this.tracker.update(s.positionSec, s.status === "playing");
    return null;
  }

  private flush(): CompletedPlay | null {
    if (this.currentInfo && !this.recorded) {
      return { ...this.currentInfo, kind: this.tracker.finish() };
    }
    return null;
  }

  private reset(): void {
    this.currentId = null;
    this.currentInfo = null;
    this.recorded = false;
  }
}
```

- [ ] **Step 4: Add the barrel export**

In `packages/core/src/index.ts`, add (alphabetically, after the `nav-history` line and before `plex-mapping`):

```typescript
export * from "./logic/play-monitor";
```

- [ ] **Step 5: Run the tests, verify they pass**

Run: `pnpm --filter @musex/core test play-monitor`
Expected: PASS (all cases green).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(core): play-monitor — classifyPlay, PlayTracker, PlayMonitor"
```

---

## Task 2: Add AsyncStorage dependency

**Files:** Modify `packages/mobile/package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Install via expo (picks the SDK-56-compatible version)**

Run: `pnpm --filter @musex/mobile exec expo install @react-native-async-storage/async-storage`
Expected: adds `@react-native-async-storage/async-storage` to `packages/mobile/package.json` dependencies and updates the lockfile.

- [ ] **Step 2: Verify it resolves**

Run: `pnpm --filter @musex/mobile exec node -e "require.resolve('@react-native-async-storage/async-storage')"`
Expected: prints a path, no error.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(mobile): add async-storage for the taste profile"
```

---

## Task 3: Taste persistence adapter

**Files:**
- Create: `packages/mobile/src/adapters/taste-persistence.ts`
- Test: `packages/mobile/src/adapters/taste-persistence.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/mobile/src/adapters/taste-persistence.test.ts`:

```typescript
import type { TasteState } from "@musex/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Keep the backing store INSIDE the factory (vitest hoists vi.mock above imports).
vi.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map<string, string>();
  return {
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: async (k: string) => {
        store.delete(k);
      },
      __store: store,
    },
  };
});

import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadTasteState, saveTasteState } from "./taste-persistence";

const sample: TasteState = {
  artists: { lamb: { name: "Lamb", score: 3, plays: 5, skips: 0, lastSeenMs: 1, artistRatingStars: null } },
  tracks: {},
};

describe("taste-persistence", () => {
  beforeEach(() => {
    (AsyncStorage as unknown as { __store: Map<string, string> }).__store.clear();
  });

  it("round-trips a TasteState", async () => {
    expect(await loadTasteState()).toBeNull();
    await saveTasteState(sample);
    expect(await loadTasteState()).toEqual(sample);
  });

  it("returns null on malformed JSON instead of throwing", async () => {
    await AsyncStorage.setItem("musex.listening-profile", "{not json");
    expect(await loadTasteState()).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @musex/mobile test taste-persistence`
Expected: FAIL (`Cannot find module './taste-persistence'`).

- [ ] **Step 3: Implement**

`packages/mobile/src/adapters/taste-persistence.ts`:

```typescript
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { TasteState } from "@musex/core";

const KEY = "musex.listening-profile";

/** Load the persisted listening profile, or null if absent/corrupt. Never
 *  throws — a read failure starts the user fresh rather than breaking launch. */
export async function loadTasteState(): Promise<TasteState | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as TasteState) : null;
  } catch (err) {
    console.warn("[taste] load failed", err);
    return null;
  }
}

/** Persist the listening profile. Never throws — a write failure is logged and
 *  dropped (the next debounced save retries). */
export async function saveTasteState(state: TasteState): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("[taste] save failed", err);
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @musex/mobile test taste-persistence`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(mobile): taste-persistence over AsyncStorage"
```

---

## Task 4: TasteService

**Files:** Create `packages/mobile/src/taste/taste-service.ts`

No new unit test (it's thin glue over the tested `TasteProfile` + tested persistence; the debounce uses real timers and is verified by typecheck + on-device use).

- [ ] **Step 1: Implement**

`packages/mobile/src/taste/taste-service.ts`:

```typescript
import { TasteProfile } from "@musex/core";
import type { ArtistStat, TrackStat } from "@musex/core";
import type { PlayKind } from "@musex/core";
import { loadTasteState, saveTasteState } from "../adapters/taste-persistence";

const SAVE_DEBOUNCE_MS = 5_000;

export interface TasteSnapshot {
  topArtists: { name: string; score: number }[];
  trackStats: (TrackStat & { key: string; decayedPlays: number })[];
  nowMs: number;
}

/** Owns the on-device TasteProfile: loads it on init, records plays, persists
 *  with a 5s debounce (mirrors desktop), and hands the Home screen a snapshot. */
export class TasteService {
  private profile = new TasteProfile();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  async init(): Promise<void> {
    const state = await loadTasteState();
    if (state) this.profile.load(state);
  }

  recordPlay(t: { title: string; artistName: string }, kind: PlayKind): void {
    this.profile.recordPlay(t, kind);
    this.scheduleSave();
  }

  snapshot(): TasteSnapshot {
    return {
      topArtists: this.profile.topArtists(),
      trackStats: this.profile.trackStats(),
      nowMs: Date.now(),
    };
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void saveTasteState(this.profile.serialize());
    }, SAVE_DEBOUNCE_MS);
  }
}

// Re-export so consumers can keep one import site.
export type { ArtistStat };
```

(Note: `PlayKind` is exported from `@musex/core` via Task 1's barrel addition. `TrackStat`/`ArtistStat` are existing core exports.)

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @musex/mobile exec tsc --noEmit -p tsconfig.json`
Expected: no errors in `taste-service.ts`.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(mobile): TasteService (profile + debounced persistence + snapshot)"
```

---

## Task 5: Gateway parsers — extract `parseTrack`, add `parsePlaylists` + `parsePlaylistTracks`

**Files:**
- Modify: `packages/mobile/src/logic/plex-parse.ts`
- Test: `packages/mobile/src/logic/plex-parse.test.ts` (create)

- [ ] **Step 1: Write the failing test**

`packages/mobile/src/logic/plex-parse.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parsePlaylists, parsePlaylistTracks } from "./plex-parse";

describe("parsePlaylists", () => {
  it("maps playlist Metadata", () => {
    const json = {
      MediaContainer: {
        Metadata: [
          {
            ratingKey: "55",
            title: "Late Night",
            leafCount: 42,
            duration: 1000,
            composite: "/playlists/55/composite/1",
            updatedAt: 1700,
          },
        ],
      },
    };
    const pls = parsePlaylists(json, "srv");
    expect(pls[0]).toMatchObject({
      id: "55",
      serverId: "srv",
      title: "Late Night",
      trackCount: 42,
      durationMs: 1000,
      thumb: "/playlists/55/composite/1",
    });
    expect(pls[0]?.updatedAt).toBe(1700 * 1000);
  });
});

describe("parsePlaylistTracks", () => {
  it("attaches playlistItemId and the parsed track", () => {
    const json = {
      MediaContainer: {
        Metadata: [
          {
            ratingKey: "9",
            playlistItemID: "777",
            title: "Song",
            grandparentTitle: "BoC",
            duration: 200000,
            Media: [{ container: "flac", Part: [{ id: "1", key: "/p/1" }] }],
          },
        ],
      },
    };
    const items = parsePlaylistTracks(json, "srv");
    expect(items).toHaveLength(1);
    expect(items[0]?.playlistItemId).toBe("777");
    expect(items[0]?.track).toMatchObject({ id: "9", artistName: "BoC", title: "Song" });
  });

  it("skips rows with no playable part", () => {
    const json = { MediaContainer: { Metadata: [{ ratingKey: "9", playlistItemID: "1", title: "x" }] } };
    expect(parsePlaylistTracks(json, "srv")).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `pnpm --filter @musex/mobile test plex-parse`
Expected: FAIL (`parsePlaylists`/`parsePlaylistTracks` not exported).

- [ ] **Step 3: Refactor `parseTracks` to a per-item helper and add the new parsers**

In `packages/mobile/src/logic/plex-parse.ts`, replace the existing `parseTracks` function with a per-item helper plus a thin `parseTracks`, and append the two playlist parsers. The `Json`/`container`/`arr`/`str`/`num`/`tags` helpers already exist at the top of the file — reuse them; add `Playlist` and `PlaylistTrack` to the type import.

Change the import line at the top from:

```typescript
import type { Album, Artist, Library, Server, Track } from "@musex/core";
```

to:

```typescript
import type { Album, Artist, Library, Playlist, PlaylistTrack, Server, Track } from "@musex/core";
```

Replace the whole `export function parseTracks(...) { ... }` block with:

```typescript
/** Parse a single Plex track Metadata node, or null if it has no playable part. */
function parseTrack(m: Json, serverId: string): Track | null {
  const media = arr(m.Media)[0];
  const part = media ? arr(media.Part)[0] : undefined;
  if (!media || !part) return null;
  return {
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
  };
}

export function parseTracks(json: unknown, serverId: string): Track[] {
  const out: Track[] = [];
  for (const m of arr(container(json).Metadata)) {
    const t = parseTrack(m, serverId);
    if (t) out.push(t);
  }
  return out;
}

export function parsePlaylists(json: unknown, serverId: string): Playlist[] {
  return arr(container(json).Metadata).map((m) => ({
    id: String(m.ratingKey),
    serverId,
    title: str(m.title) ?? "",
    trackCount: num(m.leafCount) ?? 0,
    durationMs: num(m.duration),
    thumb: str(m.composite) ?? str(m.thumb),
    updatedAt: num(m.updatedAt) ? (num(m.updatedAt) as number) * 1000 : undefined,
  }));
}

export function parsePlaylistTracks(json: unknown, serverId: string): PlaylistTrack[] {
  const out: PlaylistTrack[] = [];
  for (const m of arr(container(json).Metadata)) {
    const track = parseTrack(m, serverId);
    if (track) out.push({ track, playlistItemId: String(m.playlistItemID ?? "") });
  }
  return out;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `pnpm --filter @musex/mobile test plex-parse`
Expected: PASS. Also run the existing gateway test to confirm `parseTracks` still works:
Run: `pnpm --filter @musex/mobile test plex-gateway`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(mobile): parsePlaylists + parsePlaylistTracks (extract parseTrack)"
```

---

## Task 6: Gateway — implement `listPlaylists` + `listPlaylistTracks`

**Files:**
- Modify: `packages/mobile/src/adapters/plex-gateway.ts`
- Test: `packages/mobile/src/adapters/plex-gateway.test.ts`

- [ ] **Step 1: Write the failing tests** (append inside the existing `describe("PlexGatewayImpl", ...)` block in `plex-gateway.test.ts`)

```typescript
  it("listPlaylists queries audio playlists and parses", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        MediaContainer: { Metadata: [{ ratingKey: "55", title: "Late Night", leafCount: 42 }] },
      }),
    );
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    const lib = { id: "3", serverId: "srv", serverName: "T", title: "Music", type: "music" as const };
    await gw.listMusicLibraries(server, "TOK"); // prime base url
    const pls = await gw.listPlaylists(lib, "TOK");
    expect(pls[0]).toMatchObject({ id: "55", title: "Late Night", trackCount: 42 });
    const urls = fetchFn.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls.some((u) => u.includes("/playlists") && u.includes("playlistType=audio"))).toBe(true);
  });

  it("listPlaylistTracks queries items and parses PlaylistTracks", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        MediaContainer: {
          Metadata: [
            {
              ratingKey: "9",
              playlistItemID: "777",
              title: "Song",
              grandparentTitle: "BoC",
              Media: [{ Part: [{ id: "1", key: "/p/1" }] }],
            },
          ],
        },
      }),
    );
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await gw.listMusicLibraries(server, "TOK"); // prime base url for serverId "srv"
    const items = await gw.listPlaylistTracks("55", "srv", "TOK");
    expect(items[0]).toMatchObject({ playlistItemId: "777" });
    expect(items[0]?.track.title).toBe("Song");
    const urls = fetchFn.mock.calls.map((c) => String((c as unknown[])[0]));
    expect(urls.some((u) => u.includes("/playlists/55/items"))).toBe(true);
  });
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm --filter @musex/mobile test plex-gateway`
Expected: FAIL (current `listPlaylists`/`listPlaylistTracks` throw "not implemented").

- [ ] **Step 3: Implement the two methods**

In `packages/mobile/src/adapters/plex-gateway.ts`:

Add `Playlist` to the type import (it already imports `PlaylistTrack`):

```typescript
import type {
  Album,
  Artist,
  Library,
  LibrarySort,
  Pin,
  Playlist,
  PlaylistTrack,
  PlexGateway,
  SearchResults,
  Server,
  Track,
} from "@musex/core";
```

Add the parsers to the existing parse import:

```typescript
import {
  parseAlbums,
  parseArtists,
  parseLibraries,
  parsePlaylists,
  parsePlaylistTracks,
  parseServers,
  parseTracks,
} from "../logic/plex-parse";
```

Replace the two stubbed methods:

```typescript
  listPlaylists(): Promise<never> {
    throw new Error("playlists not implemented in Phase 1");
  }
  listPlaylistTracks(): Promise<PlaylistTrack[]> {
    throw new Error("playlists not implemented in Phase 1");
  }
```

with:

```typescript
  async listPlaylists(library: Library, token: string): Promise<Playlist[]> {
    const base = this.requireBase(library.serverId);
    const json = await this.getJson(`${base}/playlists?playlistType=audio`, token);
    return parsePlaylists(json, library.serverId);
  }

  async listPlaylistTracks(
    playlistId: string,
    serverId: string,
    token: string,
  ): Promise<PlaylistTrack[]> {
    const base = this.requireBase(serverId);
    const json = await this.getJson(`${base}/playlists/${playlistId}/items`, token);
    return parsePlaylistTracks(json, serverId);
  }
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `pnpm --filter @musex/mobile test plex-gateway`
Expected: PASS (all gateway tests, old + new).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(mobile): gateway listPlaylists + listPlaylistTracks"
```

---

## Task 7: Lock-screen native module (local Expo module)

**Files (create):**
- `packages/mobile/modules/lock-screen-commands/expo-module.config.json`
- `packages/mobile/modules/lock-screen-commands/index.ts`
- `packages/mobile/modules/lock-screen-commands/ios/LockScreenCommands.podspec`
- `packages/mobile/modules/lock-screen-commands/ios/LockScreenCommandsModule.swift`

This is hand-authored (deterministic; no interactive generator). iOS-only: the config declares only the `apple` platform, so Android autolinking skips it.

- [ ] **Step 1: Module config**

`packages/mobile/modules/lock-screen-commands/expo-module.config.json`:

```json
{
  "platforms": ["apple"],
  "apple": {
    "modules": ["LockScreenCommandsModule"]
  }
}
```

- [ ] **Step 2: Swift module**

`packages/mobile/modules/lock-screen-commands/ios/LockScreenCommandsModule.swift`:

```swift
import ExpoModulesCore
import MediaPlayer

// Bridges iOS lock-screen / Control-Center NEXT and PREVIOUS track commands to
// JS. expo-audio owns play/pause/seek + now-playing metadata; this module only
// adds the two track commands (separate MPRemoteCommand objects, no conflict).
// Targets are added when JS starts observing and removed when it stops.
public class LockScreenCommandsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("LockScreenCommands")

    Events("onNext", "onPrevious")

    OnStartObserving {
      let center = MPRemoteCommandCenter.shared()
      center.nextTrackCommand.isEnabled = true
      center.nextTrackCommand.addTarget { [weak self] _ in
        self?.sendEvent("onNext", [:])
        return .success
      }
      center.previousTrackCommand.isEnabled = true
      center.previousTrackCommand.addTarget { [weak self] _ in
        self?.sendEvent("onPrevious", [:])
        return .success
      }
    }

    OnStopObserving {
      let center = MPRemoteCommandCenter.shared()
      center.nextTrackCommand.removeTarget(nil)
      center.previousTrackCommand.removeTarget(nil)
    }
  }
}
```

- [ ] **Step 3: Podspec**

`packages/mobile/modules/lock-screen-commands/ios/LockScreenCommands.podspec`:

```ruby
Pod::Spec.new do |s|
  s.name           = 'LockScreenCommands'
  s.version        = '1.0.0'
  s.summary        = 'Lock-screen next/previous track commands for musex'
  s.description    = 'Bridges iOS MPRemoteCommandCenter next/previous to JS events'
  s.author         = 'musex'
  s.homepage       = 'https://github.com/matjam/musex'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
```

- [ ] **Step 4: JS entry (safe — does not throw when the native module is absent)**

`packages/mobile/modules/lock-screen-commands/index.ts`:

```typescript
import { NativeModule, requireNativeModule } from "expo";

type LockScreenCommandsEvents = {
  onNext: () => void;
  onPrevious: () => void;
};

declare class LockScreenCommandsModule extends NativeModule<LockScreenCommandsEvents> {}

// requireNativeModule throws when the native module isn't built into the binary
// (Expo Go, unit tests, pre-prebuild). Swallow that so importing this module is
// always safe; consumers null-check the default export.
let native: LockScreenCommandsModule | null = null;
try {
  native = requireNativeModule<LockScreenCommandsModule>("LockScreenCommands");
} catch {
  native = null;
}

export default native;
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @musex/mobile exec tsc --noEmit -p tsconfig.json`
Expected: no errors (the Swift/podspec/json are not type-checked; `index.ts` typechecks against `expo` types).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(mobile): lock-screen-commands native module (iOS next/prev)"
```

---

## Task 8: Lock-screen JS adapter

**Files:** Create `packages/mobile/src/adapters/lock-screen-commands.ts`

- [ ] **Step 1: Implement**

`packages/mobile/src/adapters/lock-screen-commands.ts`:

```typescript
import lockScreenCommands from "../../modules/lock-screen-commands";

export interface RemoteCommandHandlers {
  onNext: () => void;
  onPrevious: () => void;
}

/** Subscribe to lock-screen / Control-Center next & previous track commands.
 *  Returns an unsubscribe function. A no-op (returning a no-op cleanup) when the
 *  native module isn't present — never throws. */
export function subscribeRemoteCommands(handlers: RemoteCommandHandlers): () => void {
  const mod = lockScreenCommands;
  if (!mod) return () => {};
  const next = mod.addListener("onNext", handlers.onNext);
  const prev = mod.addListener("onPrevious", handlers.onPrevious);
  return () => {
    next.remove();
    prev.remove();
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @musex/mobile exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(mobile): subscribeRemoteCommands adapter (safe fallback)"
```

---

## Task 9: Wire taste + play-monitor + lock-screen into the store

**Files:** Modify `packages/mobile/src/state/store.tsx`

One edit: construct `TasteService` + `PlayMonitor`, init taste in bootstrap, feed the monitor from the existing subscribe loop, subscribe to remote commands, and expose `taste` on the context.

- [ ] **Step 1: Add imports**

At the top of `store.tsx`, add to the `@musex/core` value import and add new adapter imports:

```typescript
import { buildQueue, PlaybackSession, PlayMonitor } from "@musex/core";
```

and after the existing adapter imports:

```typescript
import { subscribeRemoteCommands } from "../adapters/lock-screen-commands";
import { TasteService } from "../taste/taste-service";
```

- [ ] **Step 2: Extend the `Store` interface**

Add `taste` to the `Store` interface:

```typescript
interface Store {
  state: State;
  gateway: PlexGatewayImpl;
  tokenStore: SecureTokenStore;
  dispatch: (a: Action) => void;
  playTracks: (tracks: Track[], index: number) => Promise<void>;
  session: PlaybackSession;
  artBaseFor: (serverId: string) => string | null;
  token: string | null;
  taste: TasteService;
}
```

- [ ] **Step 3: Construct the service + monitor**

After the `engine` useMemo, add:

```typescript
  const taste = useMemo(() => new TasteService(), []);
  const monitor = useMemo(() => new PlayMonitor(), []);
```

- [ ] **Step 4: Feed the monitor from the subscribe loop**

In the existing `session.subscribe((s) => { ... })` effect, add the monitor call at the TOP of the callback (before the existing track-change/setNowPlaying logic), and add `taste`/`monitor` to the dependency array:

```typescript
  useEffect(
    () =>
      session.subscribe((s) => {
        const completed = monitor.onState(s);
        if (completed) {
          taste.recordPlay({ title: completed.title, artistName: completed.artistName }, completed.kind);
        }
        dispatch({ type: "playback", state: s });
        const cur = s.queue ? s.queue.tracks[s.queue.index] : undefined;
        if (cur && cur.id !== lastTrackId.current) {
          lastTrackId.current = cur.id;
          const tok = tokenRef.current;
          const base = tok ? safeBaseUrl(gateway, cur.serverId) : null;
          engine.setNowPlaying({
            title: cur.title,
            artist: cur.artistName,
            album: cur.albumTitle,
            artwork: base && tok ? (artUrl(base, cur.thumb, tok) ?? undefined) : undefined,
          });
        }
      }),
    [session, engine, gateway, taste, monitor],
  );
```

- [ ] **Step 5: Subscribe to remote commands (new effect)**

Add a new effect after the subscribe effect:

```typescript
  // Lock-screen / Control-Center next & previous -> queue navigation.
  useEffect(() => subscribeRemoteCommands({
    onNext: () => void session.next(),
    onPrevious: () => void session.previous(),
  }), [session]);
```

- [ ] **Step 6: Init taste during bootstrap**

In the bootstrap effect, add `await taste.init();` right after `await engine.init();`, and add `taste` to that effect's dependency array:

```typescript
      await engine.init();
      await taste.init();
```

and change the dep array of the bootstrap effect from `[engine, gateway, tokenStore]` to `[engine, gateway, tokenStore, taste]`.

- [ ] **Step 7: Expose `taste` on the context value**

```typescript
  const value: Store = {
    state,
    gateway,
    tokenStore,
    dispatch,
    playTracks,
    session,
    artBaseFor: (sid) => safeBaseUrl(gateway, sid),
    token: state.token,
    taste,
  };
```

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @musex/mobile exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(mobile): wire taste recording + lock-screen commands into the store"
```

---

## Task 10: `Collage` component

**Files:** Create `packages/mobile/src/ui/Collage.tsx`

- [ ] **Step 1: Implement**

`packages/mobile/src/ui/Collage.tsx`:

```tsx
import { View } from "react-native";
import { AlbumArt } from "./AlbumArt";

/** A 2x2 grid of album art baked from up to four image URLs. Fewer than four
 *  (or nulls) render as placeholders, so it always fills the square. */
export function Collage({ urls, size }: { urls: (string | null)[]; size: number }) {
  const cell = size / 2;
  const four: (string | null)[] = [urls[0] ?? null, urls[1] ?? null, urls[2] ?? null, urls[3] ?? null];
  return (
    <View style={{ width: size, height: size, flexDirection: "row", flexWrap: "wrap", borderRadius: 8, overflow: "hidden" }}>
      {four.map((u, i) => (
        <AlbumArt key={i} url={u} size={cell} />
      ))}
    </View>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @musex/mobile exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(mobile): Collage 2x2 album-art grid"
```

---

## Task 11: Home pure helpers (`home-data.ts`)

**Files:**
- Create: `packages/mobile/src/logic/home-data.ts`
- Test: `packages/mobile/src/logic/home-data.test.ts`

- [ ] **Step 1: Write the failing tests**

`packages/mobile/src/logic/home-data.test.ts`:

```typescript
import type { Track } from "@musex/core";
import { smartTrackKey } from "@musex/core";
import { describe, expect, it } from "vitest";
import { buildForYouInput, recentlyPlayedTracks } from "./home-data";

function track(id: string, artistId: string, artistName: string, title: string): Track {
  return {
    id,
    serverId: "s",
    albumId: "al",
    artistId,
    artistName,
    title,
    durationMs: 200000,
    media: { container: "", audioCodec: "", partId: "p", partKey: "/p" },
  };
}

const tracks = [track("1", "ar1", "Lamb", "Gorecki"), track("2", "ar2", "Bonobo", "Kiara")];

describe("recentlyPlayedTracks", () => {
  it("returns library tracks most-recently-played first, joined by key", () => {
    const stats = [
      { key: smartTrackKey(tracks[0]), lastPlayedMs: 100 }, // Lamb / Gorecki
      { key: smartTrackKey(tracks[1]), lastPlayedMs: 200 }, // Bonobo / Kiara
    ];
    const got = recentlyPlayedTracks(stats, tracks, 10);
    expect(got.map((t) => t.title)).toEqual(["Kiara", "Gorecki"]);
  });

  it("drops stats with no matching library track and honors the limit", () => {
    const stats = [
      { key: smartTrackKey(tracks[1]), lastPlayedMs: 200 }, // Bonobo / Kiara
      { key: "ghost␟missing", lastPlayedMs: 300 }, // no matching library track
    ];
    expect(recentlyPlayedTracks(stats, tracks, 1).map((t) => t.title)).toEqual(["Kiara"]);
  });
});

describe("buildForYouInput", () => {
  it("resolves artist ids by name, groups tracks, and leaves similarOwned empty", () => {
    const input = buildForYouInput(
      [{ name: "Lamb", score: 5 }, { name: "Unknown", score: 1 }],
      [{ id: "ar1", name: "Lamb" }, { id: "ar2", name: "Bonobo" }],
      tracks,
      [{ key: "lamb␟gorecki", plays: 3, skips: 0, lastPlayedMs: 100, ratingStars: null }],
      1000,
    );
    expect(input.ownTop).toEqual([{ artistId: "ar1", name: "Lamb", score: 5 }]); // "Unknown" dropped
    expect(input.similarOwned).toEqual([]);
    expect(input.tracksByArtist.get("ar1")?.[0]?.title).toBe("Gorecki");
    expect(input.stats.get("lamb␟gorecki")?.plays).toBe(3);
    expect(input.nowMs).toBe(1000);
  });
});
```

(Note: `␟` is the `KEY_SEPARATOR` "␟" that `smartTrackKey` uses — `lower(artist)␟lower(title)`.)

- [ ] **Step 2: Run the tests, verify they fail**

Run: `pnpm --filter @musex/mobile test home-data`
Expected: FAIL (`Cannot find module './home-data'`).

- [ ] **Step 3: Implement**

`packages/mobile/src/logic/home-data.ts`:

```typescript
import { smartTrackKey } from "@musex/core";
import type { ForYouInput, ForYouTrackStat, Track } from "@musex/core";

/** Most-recently-played library tracks, joined from taste stats by track key. */
export function recentlyPlayedTracks(
  stats: { key: string; lastPlayedMs: number }[],
  allTracks: Track[],
  limit: number,
): Track[] {
  const byKey = new Map<string, Track>();
  for (const t of allTracks) byKey.set(smartTrackKey(t), t);
  return stats
    .filter((s) => s.lastPlayedMs > 0)
    .slice()
    .sort((a, b) => b.lastPlayedMs - a.lastPlayedMs)
    .map((s) => byKey.get(s.key))
    .filter((t): t is Track => !!t)
    .slice(0, limit);
}

/** Assemble ForYouInput for the mobile (seeds-only) For You mix: resolve top
 *  artist names to ids, group the library by artist, and leave similarOwned
 *  empty (no recommendation provider on mobile). */
export function buildForYouInput(
  topArtists: { name: string; score: number }[],
  allArtists: { id: string; name: string }[],
  allTracks: Track[],
  stats: { key: string; plays: number; skips: number; lastPlayedMs: number; ratingStars: number | null }[],
  nowMs: number,
): ForYouInput {
  const idByName = new Map<string, string>();
  for (const a of allArtists) idByName.set(a.name.toLowerCase(), a.id);

  const ownTop = topArtists
    .map((a) => ({ artistId: idByName.get(a.name.toLowerCase()) ?? "", name: a.name, score: a.score }))
    .filter((a) => a.artistId);

  const tracksByArtist = new Map<string, Track[]>();
  for (const t of allTracks) {
    const list = tracksByArtist.get(t.artistId);
    if (list) list.push(t);
    else tracksByArtist.set(t.artistId, [t]);
  }

  const statMap = new Map<string, ForYouTrackStat>();
  for (const s of stats) {
    statMap.set(s.key, {
      plays: s.plays,
      skips: s.skips,
      lastPlayedMs: s.lastPlayedMs,
      ratingStars: s.ratingStars,
    });
  }

  return { ownTop, similarOwned: [], tracksByArtist, stats: statMap, nowMs };
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `pnpm --filter @musex/mobile test home-data`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(mobile): home-data helpers (recentlyPlayed, buildForYouInput)"
```

---

## Task 12: `TrackList` component

**Files:** Create `packages/mobile/src/ui/TrackList.tsx`

A reusable titled track list: a title, the existing `ActionBar` (Play/Shuffle/Add over the whole list), and art rows that play from their index. Used by the mix and playlist screens.

- [ ] **Step 1: Implement**

`packages/mobile/src/ui/TrackList.tsx`:

```tsx
import { buildQueue, type PlaybackSession, type Track } from "@musex/core";
import { FlatList, Pressable, Text, View } from "react-native";
import { artUrl } from "../logic/art-url";
import { ActionBar } from "./ActionBar";
import { AlbumArt } from "./AlbumArt";
import { theme } from "./theme";

export function TrackList({
  title,
  tracks,
  session,
  artBaseFor,
  token,
}: {
  title: string;
  tracks: Track[];
  session: PlaybackSession;
  artBaseFor: (serverId: string) => string | null;
  token: string | null;
}) {
  return (
    <FlatList
      style={{ flex: 1, backgroundColor: theme.bg }}
      data={tracks}
      keyExtractor={(t, i) => `${t.id}-${i}`}
      ListHeaderComponent={
        <View>
          <Text
            style={{
              color: theme.text,
              fontSize: 22,
              fontWeight: "700",
              paddingHorizontal: theme.space(2),
              paddingTop: theme.space(2),
              paddingBottom: theme.space(1),
            }}
          >
            {title}
          </Text>
          <ActionBar session={session} getTracks={() => tracks} />
        </View>
      }
      renderItem={({ item, index }) => {
        const base = artBaseFor(item.serverId);
        const art = base && token ? artUrl(base, item.thumb, token) : null;
        const sub = [item.albumTitle, item.artistName].filter(Boolean).join(" · ");
        return (
          <Pressable
            onPress={() => void session.loadQueue(buildQueue(tracks, index))}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingHorizontal: theme.space(2),
              paddingVertical: theme.space(1),
              borderBottomWidth: 1,
              borderBottomColor: theme.border,
            }}
          >
            <AlbumArt url={art} size={48} />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={{ color: theme.text, fontSize: 15 }}>
                {item.title}
              </Text>
              {sub ? (
                <Text numberOfLines={1} style={{ color: theme.textDim, fontSize: 12 }}>
                  {sub}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      }}
    />
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @musex/mobile exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(mobile): reusable TrackList (title + ActionBar + art rows)"
```

---

## Task 13: Home tab + home stack layout

**Files:**
- Modify: `packages/mobile/app/(tabs)/_layout.tsx`
- Create: `packages/mobile/app/(tabs)/home/_layout.tsx`

- [ ] **Step 1: Add the Home tab (first) in `(tabs)/_layout.tsx`**

Change the icon import to include `Home`:

```tsx
import { Cog, Home, Library, type LucideIcon } from "lucide-react-native";
```

Add the Home `TabTrigger` as the FIRST child of `<TabList>` (before the library trigger):

```tsx
        <TabTrigger name="home" href="/(tabs)/home" asChild>
          <TabButton icon={Home} label="Home" />
        </TabTrigger>
        <TabTrigger name="library" href="/(tabs)/library" asChild>
          <TabButton icon={Library} label="Library" />
        </TabTrigger>
        <TabTrigger name="settings" href="/(tabs)/settings" asChild>
          <TabButton icon={Cog} label="Settings" />
        </TabTrigger>
```

- [ ] **Step 2: Create the home stack layout**

`packages/mobile/app/(tabs)/home/_layout.tsx`:

```tsx
import { Stack } from "expo-router";
import { theme } from "../../../src/ui/theme";

export default function HomeLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.text,
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Home" }} />
      <Stack.Screen name="mix" options={{ title: "" }} />
      <Stack.Screen name="playlist" options={{ title: "" }} />
    </Stack>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @musex/mobile exec tsc --noEmit -p tsconfig.json`
Expected: no errors (the `home/index|mix|playlist` screens are created in the next tasks; expo-router resolves routes at runtime, and `typedRoutes` is OFF so the string hrefs typecheck regardless).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(mobile): Home tab + home stack layout"
```

---

## Task 14: Home screen (rails)

**Files:** Create `packages/mobile/app/(tabs)/home/index.tsx`

Layout A: three vertical sections, each a horizontal rail. "Made for you" (non-empty taste mixes), "Your playlists", "Recently played".

- [ ] **Step 1: Implement**

`packages/mobile/app/(tabs)/home/index.tsx`:

```tsx
import type { Playlist, SmartKind, Track } from "@musex/core";
import { SMART_TITLES, smartMixEmpty, smartMixThumbs } from "@musex/core";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { artUrl } from "../../../src/logic/art-url";
import { recentlyPlayedTracks } from "../../../src/logic/home-data";
import { useStore } from "../../../src/state/store";
import { AlbumArt } from "../../../src/ui/AlbumArt";
import { Collage } from "../../../src/ui/Collage";
import { theme } from "../../../src/ui/theme";

const MIX_KINDS: SmartKind[] = ["for-you", "top-rated", "heavy-rotation", "rediscover"];
const CARD = 130;

export default function HomeScreen() {
  const { state, gateway, taste, artBaseFor, token, playTracks } = useStore();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [mixes, setMixes] = useState<{ kind: SmartKind; thumbs: string[] }[]>([]);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [recent, setRecent] = useState<Track[]>([]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (!state.library || !state.token) return;
        setLoading(true);
        try {
          const [allTracks, pls] = await Promise.all([
            gateway.listAllTracks(state.library, "title", state.token),
            gateway.listPlaylists(state.library, state.token).catch(() => [] as Playlist[]),
          ]);
          const snap = taste.snapshot();
          const builtMixes = MIX_KINDS.filter(
            (k) => !smartMixEmpty(k, allTracks, snap.trackStats, snap.topArtists, snap.nowMs),
          ).map((k) => ({
            kind: k,
            thumbs: smartMixThumbs(k, allTracks, snap.trackStats, snap.topArtists, snap.nowMs),
          }));
          const rec = recentlyPlayedTracks(snap.trackStats, allTracks, 12);
          if (alive) {
            setMixes(builtMixes);
            setPlaylists(pls);
            setRecent(rec);
            setLoading(false);
          }
        } catch {
          if (alive) {
            setMixes([]);
            setPlaylists([]);
            setRecent([]);
            setLoading(false);
          }
        }
      })();
      return () => {
        alive = false;
      };
    }, [state.library, state.token, gateway, taste]),
  );

  const base = state.library ? artBaseFor(state.library.serverId) : null;
  const bake = (thumb?: string) => (base && token && thumb ? artUrl(base, thumb, token) : null);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }} contentContainerStyle={{ paddingVertical: theme.space(1) }}>
      {mixes.length > 0 ? (
        <Section title="Made for you">
          {mixes.map((m) => (
            <Pressable
              key={m.kind}
              onPress={() => router.push({ pathname: "/(tabs)/home/mix", params: { kind: m.kind } })}
              style={{ width: CARD }}
            >
              <Collage urls={m.thumbs.slice(0, 4).map(bake)} size={CARD} />
              <Text numberOfLines={2} style={cardLabel}>
                {SMART_TITLES[m.kind]}
              </Text>
            </Pressable>
          ))}
        </Section>
      ) : null}

      {playlists.length > 0 ? (
        <Section title="Your playlists">
          {playlists.map((p) => (
            <Pressable
              key={p.id}
              onPress={() =>
                router.push({ pathname: "/(tabs)/home/playlist", params: { id: p.id, serverId: p.serverId } })
              }
              style={{ width: CARD }}
            >
              <AlbumArt url={bake(p.thumb)} size={CARD} />
              <Text numberOfLines={2} style={cardLabel}>
                {p.title}
              </Text>
              <Text numberOfLines={1} style={cardSub}>
                {p.trackCount} tracks
              </Text>
            </Pressable>
          ))}
        </Section>
      ) : null}

      {recent.length > 0 ? (
        <Section title="Recently played">
          {recent.map((t, i) => {
            const tb = artBaseFor(t.serverId);
            const art = tb && token ? artUrl(tb, t.thumb, token) : null;
            return (
              <Pressable key={`${t.id}-${i}`} onPress={() => void playTracks([t], 0)} style={{ width: CARD }}>
                <AlbumArt url={art} size={CARD} />
                <Text numberOfLines={2} style={cardLabel}>
                  {t.title}
                </Text>
                <Text numberOfLines={1} style={cardSub}>
                  {t.artistName}
                </Text>
              </Pressable>
            );
          })}
        </Section>
      ) : null}

      {mixes.length === 0 && playlists.length === 0 && recent.length === 0 ? (
        <Text style={{ color: theme.textDim, textAlign: "center", marginTop: theme.space(6), paddingHorizontal: theme.space(3) }}>
          Start playing music and your mixes will appear here.
        </Text>
      ) : null}
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: theme.space(2) }}>
      <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700", paddingHorizontal: theme.space(2), marginBottom: theme.space(1) }}>
        {title}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 12, paddingHorizontal: theme.space(2) }}>
        {children}
      </ScrollView>
    </View>
  );
}

const cardLabel = { color: theme.text, fontSize: 13, fontWeight: "600" as const, marginTop: 6 };
const cardSub = { color: theme.textDim, fontSize: 11, marginTop: 2 };
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @musex/mobile exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(mobile): Home screen with taste mixes, playlists, recently-played rails"
```

---

## Task 15: Mix screen

**Files:** Create `packages/mobile/app/(tabs)/home/mix.tsx`

- [ ] **Step 1: Implement**

`packages/mobile/app/(tabs)/home/mix.tsx`:

```tsx
import type { SmartKind, Track } from "@musex/core";
import { composeForYou, computeSmartPlaylist, SMART_TITLES } from "@musex/core";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { buildForYouInput } from "../../../src/logic/home-data";
import { useStore } from "../../../src/state/store";
import { TrackList } from "../../../src/ui/TrackList";
import { theme } from "../../../src/ui/theme";

export default function MixScreen() {
  const { kind } = useLocalSearchParams<{ kind: SmartKind }>();
  const { state, gateway, session, taste, artBaseFor, token } = useStore();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!state.library || !state.token || !kind) return;
      setLoading(true);
      const snap = taste.snapshot();
      const allTracks = await gateway.listAllTracks(state.library, "title", state.token);
      let result: Track[];
      if (kind === "for-you") {
        const artists = await gateway.listArtists(state.library, state.token);
        result = composeForYou(
          buildForYouInput(snap.topArtists, artists, allTracks, snap.trackStats, snap.nowMs),
        );
      } else {
        result = computeSmartPlaylist(kind, allTracks, snap.trackStats, snap.topArtists, snap.nowMs);
      }
      if (alive) {
        setTracks(result);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [kind, state.library, state.token, gateway, taste]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <TrackList
      title={kind ? SMART_TITLES[kind] : "Mix"}
      tracks={tracks}
      session={session}
      artBaseFor={artBaseFor}
      token={token}
    />
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @musex/mobile exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(mobile): mix screen (smart playlists + seeds-only For You)"
```

---

## Task 16: Playlist screen

**Files:** Create `packages/mobile/app/(tabs)/home/playlist.tsx`

- [ ] **Step 1: Implement**

`packages/mobile/app/(tabs)/home/playlist.tsx`:

```tsx
import type { Track } from "@musex/core";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { useStore } from "../../../src/state/store";
import { TrackList } from "../../../src/ui/TrackList";
import { theme } from "../../../src/ui/theme";

export default function PlaylistScreen() {
  const { id, serverId } = useLocalSearchParams<{ id: string; serverId: string }>();
  const { state, gateway, session, artBaseFor, token } = useStore();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!state.token || !id || !serverId) return;
      setLoading(true);
      const items = await gateway.listPlaylistTracks(id, serverId, state.token);
      if (alive) {
        setTracks(items.map((it) => it.track));
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, serverId, state.token, gateway]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return <TrackList title="Playlist" tracks={tracks} session={session} artBaseFor={artBaseFor} token={token} />;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @musex/mobile exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(mobile): playlist screen"
```

---

## Task 17: Full check, docs, push, draft PR

**Files:** Modify `CLAUDE.md` (project) with the new facts.

- [ ] **Step 1: Run the full CI-equivalent bar**

Run: `pnpm check`
Expected: typecheck + biome + all tests green across core/desktop/mobile. Fix anything that fails before proceeding (biome `--write` for format/lint fixes, then re-run).

- [ ] **Step 2: Update `CLAUDE.md`**

Add a bullet to the mobile section of `packages/../CLAUDE.md` (the project `CLAUDE.md`) capturing the durable facts:
- New iOS Home tab + taste subsystem + lock-screen commands (PR `feature/mobile-home-taste-lockscreen`).
- **Top Rated reads `Track.userRating`** (Plex 0–10, already mapped by `plex-parse`) → no mobile rating UI; reflects Plex ratings across devices.
- **expo-audio 56 exposes NO JS callback for lock-screen next/previous** → a local Expo module `modules/lock-screen-commands` (Swift `MPRemoteCommandCenter` next/prev → JS events; `OnStartObserving`/`OnStopObserving`; `platforms: ["apple"]`, iOS-only). Needs `expo prebuild` to autolink; CI stays JS-only. Adapter `src/adapters/lock-screen-commands.ts` no-ops if the native module is absent.
- **Taste profile on mobile is local & separate from desktop** (no sync), persisted via `@react-native-async-storage/async-storage` (`musex.listening-profile`), 5s-debounced, loaded on bootstrap. Pure recording logic = core `logic/play-monitor.ts` (`classifyPlay`/`PlayTracker`/`PlayMonitor`) fed from the store's `session.subscribe` loop.
- **For You is seeds-only on mobile** (`composeForYou` with `similarOwned: []` — no recommendation provider).
- Reminder: after a native-module change, the dev client must be rebuilt (`expo prebuild` + `expo run:ios`).

- [ ] **Step 3: Commit the docs**

```bash
git add -A
git commit -m "docs: record mobile Home/taste/lock-screen facts in CLAUDE.md"
```

- [ ] **Step 4: Push**

```bash
git push
```

- [ ] **Step 5: Open the Draft PR**

```bash
gh pr create --draft --title "feat: mobile Home tab, taste-driven mixes, and lock-screen track commands" --body "<summary + spec link + on-device test checklist>"
```

The PR body must summarize the three pieces, link the spec, note the For-You seeds-only / no-rating-UI scope decisions, and list the on-device verification steps (Home rails + collage art; empty mixes hidden; mix/playlist open a track list with a working ActionBar; mixes populate as you listen; lock-screen next/prev advance the queue after a dev-client rebuild).

---

## Self-review checklist (controller, before dispatching)

- **Spec coverage:** Piece 1 = Tasks 7–9; Piece 2 = Tasks 5,6,10,12,13,14,15,16; Piece 3 = Tasks 1,2,3,4,9,11. Recently-played = Task 11/14. Empty-mix hiding = Task 14. ✓
- **Type consistency:** `PlayMonitor.onState → CompletedPlay {title,artistName,kind}` (Task 1) consumed in Task 9. `TasteService.snapshot()` shape (Task 4) consumed in Tasks 14/15. `Playlist`/`PlaylistTrack` (Tasks 5/6) consumed in Tasks 14/16. `taste` added to `Store` (Task 9) used in Tasks 14/15. ✓
- **No placeholders:** every code step has full code; commands have expected output. ✓
- **On-device-only items** (native module behavior, lock-screen, mixes filling) are explicitly deferred to user verification — not asserted as automated. ✓
