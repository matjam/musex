# Shared-Logic Promotion to @musex/core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move five units of pure logic into `@musex/core` and repoint their consumers, with zero behavior change, so mobile parity work can import shared logic instead of duplicating it.

**Architecture:** Hard-move (no re-export shims): create the module in `packages/core/src/logic/`, export it from the core barrel, repoint consumers to `@musex/core`, delete the original, and move its test into core. Core modules import each other by relative path — never via `@musex/core` (core must not import its own barrel).

**Tech Stack:** TypeScript 6 (`verbatimModuleSyntax` → `import type` for types), pnpm 11 workspaces, vitest 4, biome 2.

**Spec:** `docs/superpowers/specs/2026-06-17-shared-logic-promotion-design.md`

---

## Conventions for every task

- **Verification bar:** after the edits in a task, run the full `pnpm check` from the repo root (`/Users/matjam/src/musex`). It runs `pnpm -r typecheck && biome check . && pnpm -r test` across core + desktop (two tsc passes) + mobile. Expected: exit 0.
- If biome reports import-ordering or formatting diffs, run `pnpm exec biome check --write .` from the repo root, then re-run `pnpm check`.
- **Staging:** `git add -A` always (never selective). Commit messages are conventional-commit style.
- Do NOT push between tasks — the controller pushes after review. (Branch `feature/core-shared-logic-promotion` already exists with the spec committed.)

---

## File Structure

**Created in core:**
- `packages/core/src/logic/format.ts` — duration / relative-time / byte formatting
- `packages/core/src/logic/format.test.ts`
- `packages/core/src/logic/group-tracks-by-album.ts` — group `Track[]` by album for tiled display
- `packages/core/src/logic/group-tracks-by-album.test.ts`
- `packages/core/src/logic/az-index.ts` — A–Z first-letter bucketing for scroll indexes
- `packages/core/src/logic/az-index.test.ts`
- `packages/core/src/logic/recently-played.ts` — most-recently-played tracks joined from taste stats
- `packages/core/src/logic/recently-played.test.ts`

**Modified:**
- `packages/core/src/logic/smart-playlists.ts` — export `LOVED_RATING`
- `packages/core/src/index.ts` — barrel exports for the four new modules
- 5 desktop files (repoint `format` import) + `OnDeviceView.tsx` (repoint `group-tracks-by-album`)
- 2 mobile files (`library/index.tsx`, `home/index.tsx`) + `home-data.ts` (drop `recentlyPlayedTracks` + now-unused `smartTrackKey` import)

**Deleted:**
- `packages/desktop/src/renderer/src/util/format.ts` + `format.test.ts`
- `packages/desktop/src/renderer/src/util/group-tracks-by-album.ts` + `group-tracks-by-album.test.ts`
- `packages/mobile/src/logic/az-index.ts` + `az-index.test.ts`

---

### Task 1: Export `LOVED_RATING` from core

**Files:**
- Modify: `packages/core/src/logic/smart-playlists.ts:24`
- Test: `packages/core/src/logic/smart-playlists.test.ts` (add one assertion; create the file only if it does not already exist)

- [ ] **Step 1: Make the constant public**

In `packages/core/src/logic/smart-playlists.ts`, change line 24 from:

```ts
const LOVED_RATING = 8;
```

to:

```ts
/** Plex 0–10 rating at/above which a track counts as "loved" (8 = 4 stars). */
export const LOVED_RATING = 8;
```

It is already re-exported through the barrel via `export * from "./logic/smart-playlists"` in `packages/core/src/index.ts` — no barrel edit needed.

- [ ] **Step 2: Add a lock-the-export assertion**

Check whether `packages/core/src/logic/smart-playlists.test.ts` exists.

If it exists, add this test to it:

```ts
import { LOVED_RATING } from "../index.js";

describe("LOVED_RATING", () => {
  it("is the public 0–10 loved threshold (8 = 4 stars)", () => {
    expect(LOVED_RATING).toBe(8);
  });
});
```

If it does NOT exist, create `packages/core/src/logic/smart-playlists.test.ts` with:

```ts
import { describe, expect, it } from "vitest";
import { LOVED_RATING } from "../index.js";

describe("LOVED_RATING", () => {
  it("is the public 0–10 loved threshold (8 = 4 stars)", () => {
    expect(LOVED_RATING).toBe(8);
  });
});
```

(Import from `../index.js` — the barrel — to verify the export is actually public, not just module-local.)

- [ ] **Step 3: Verify**

Run from `/Users/matjam/src/musex`: `pnpm check`
Expected: exit 0 (the new assertion passes; nothing else changed behavior).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor(core): export LOVED_RATING from smart-playlists"
```

---

### Task 2: Move `format` into core

**Files:**
- Create: `packages/core/src/logic/format.ts`, `packages/core/src/logic/format.test.ts`
- Modify: `packages/core/src/index.ts`, and 5 desktop importers
- Delete: `packages/desktop/src/renderer/src/util/format.ts`, `packages/desktop/src/renderer/src/util/format.test.ts`

- [ ] **Step 1: Create the core module (content moved verbatim — no imports to fix)**

Create `packages/core/src/logic/format.ts`:

```ts
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

/** Coarse human relative time: "just now" under a minute, then the largest
 *  whole unit ("3 days ago"). Future/invalid times clamp to "just now". */
export function relativeTime(thenMs: number, nowMs: number): string {
  const sec = Math.floor((nowMs - thenMs) / 1000);
  if (!Number.isFinite(sec) || sec < 60) return "just now";
  const minutes = Math.floor(sec / 60);
  if (minutes < 60) return ago(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return ago(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 7) return ago(days, "day");
  if (days < 30) return ago(Math.floor(days / 7), "week");
  return ago(Math.floor(days / 30), "month");
}

function ago(n: number, unit: string): string {
  return `${n} ${unit}${n !== 1 ? "s" : ""} ago`;
}

/** Human-readable byte size (binary units, e.g. "5 GB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const decimals = value >= 10 || Number.isInteger(value) ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[i] ?? "TB"}`;
}
```

- [ ] **Step 2: Move the test**

Copy the entire contents of `packages/desktop/src/renderer/src/util/format.test.ts` into a new file `packages/core/src/logic/format.test.ts`. Fix the import of the module under test so it points at the sibling module: the import line must be `import { formatDuration, relativeTime, formatBytes } from "./format.js";` (keep only the symbols the test actually uses). Ensure `import { describe, expect, it } from "vitest";` is present (add it if the desktop test relied on globals). Do not change any test cases.

- [ ] **Step 3: Add the barrel export**

In `packages/core/src/index.ts`, add this line in the `// Logic` block, alphabetically between `export * from "./logic/external-url";` and `export * from "./logic/for-you";`:

```ts
export * from "./logic/format";
```

- [ ] **Step 4: Repoint the 5 desktop importers**

Edit each import to come from `@musex/core` (keep the same named symbols):

- `packages/desktop/src/renderer/src/ui/NowPlayingBar.tsx:19` — `import { formatDuration } from "../util/format";` → `import { formatDuration } from "@musex/core";`
- `packages/desktop/src/renderer/src/ui/TrackRow.tsx:7` — `import { formatDuration } from "../util/format";` → `import { formatDuration } from "@musex/core";`
- `packages/desktop/src/renderer/src/ui/discovery/EntityPanel.tsx:10` — `import { formatDuration, relativeTime } from "../../util/format";` → `import { formatDuration, relativeTime } from "@musex/core";`
- `packages/desktop/src/renderer/src/ui/views/OnDeviceView.tsx:7` — `import { formatBytes } from "../../util/format";` → `import { formatBytes } from "@musex/core";`
- `packages/desktop/src/renderer/src/ui/views/SettingsView.tsx:25` — `import { formatBytes } from "../../util/format";` → `import { formatBytes } from "@musex/core";`

Note: several of these files already import other symbols from `@musex/core`. If so, MERGE the formatting symbols into the existing `@musex/core` import line rather than adding a second one (biome's organizeImports will otherwise flag/merge it). Running `biome check --write .` will also merge duplicates.

- [ ] **Step 5: Delete the originals**

```bash
rm packages/desktop/src/renderer/src/util/format.ts packages/desktop/src/renderer/src/util/format.test.ts
```

- [ ] **Step 6: Verify**

Run from `/Users/matjam/src/musex`: `pnpm check`
Expected: exit 0. If biome reports import diffs, run `pnpm exec biome check --write .` then re-run `pnpm check`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(core): move format helpers into @musex/core"
```

---

### Task 3: Move `group-tracks-by-album` into core

**Files:**
- Create: `packages/core/src/logic/group-tracks-by-album.ts`, `packages/core/src/logic/group-tracks-by-album.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/desktop/src/renderer/src/ui/views/OnDeviceView.tsx`
- Delete: `packages/desktop/src/renderer/src/util/group-tracks-by-album.ts`, `packages/desktop/src/renderer/src/util/group-tracks-by-album.test.ts`

- [ ] **Step 1: Create the core module (Track import rewritten to relative)**

Create `packages/core/src/logic/group-tracks-by-album.ts`. The ONLY change from the desktop original is the import: `import type { Track } from "@musex/core";` becomes `import type { Track } from "../models/index.js";`.

```ts
import type { Track } from "../models/index.js";

/** One album's worth of playable downloaded tracks, for the "On this device" grid. */
export interface TrackAlbumGroup {
  albumId: string;
  /** First track's album title; "Unknown Album" when none carry one. */
  albumTitle: string;
  artistName: string;
  /** First track that actually has a (baked) thumb, if any. */
  thumb?: string;
  /** The album's tracks, in the order they arrived (already album→trackNumber
   *  sorted by `downloadedTracks()`). */
  tracks: Track[];
}

/** Group playable tracks by `albumId` for tiled display. Buckets preserve the
 *  input order of their tracks (callers pass tracks pre-sorted album→trackNumber);
 *  the bucket's title/artist come from its first track, its thumb falls through to
 *  the first track that actually carries one. Groups are returned sorted by album
 *  title (case-insensitive) then artist — a stable order so the grid doesn't
 *  reshuffle on refetch. */
export function groupTracksByAlbum(tracks: Track[]): TrackAlbumGroup[] {
  const byAlbum = new Map<string, TrackAlbumGroup>();
  for (const t of tracks) {
    const existing = byAlbum.get(t.albumId);
    if (existing) {
      existing.tracks.push(t);
      if (!existing.thumb && t.thumb) existing.thumb = t.thumb;
    } else {
      byAlbum.set(t.albumId, {
        albumId: t.albumId,
        albumTitle: t.albumTitle ?? "Unknown Album",
        artistName: t.artistName,
        thumb: t.thumb,
        tracks: [t],
      });
    }
  }
  return [...byAlbum.values()].sort(
    (a, b) =>
      a.albumTitle.localeCompare(b.albumTitle, undefined, { sensitivity: "base" }) ||
      a.artistName.localeCompare(b.artistName, undefined, { sensitivity: "base" }),
  );
}
```

- [ ] **Step 2: Move the test**

Copy `packages/desktop/src/renderer/src/util/group-tracks-by-album.test.ts` into `packages/core/src/logic/group-tracks-by-album.test.ts`. Fix the module-under-test import to `import { groupTracksByAlbum } from "./group-tracks-by-album.js";` (and `import type { TrackAlbumGroup }` from the same path if the test references the type). If the test imports the `Track` type or test fixtures from `@musex/core`, that stays as `@musex/core` (the test is allowed to use the barrel; only non-test core source must avoid it). Ensure `vitest` imports are present. Do not change test cases.

- [ ] **Step 3: Add the barrel export**

In `packages/core/src/index.ts`, add alphabetically between `export * from "./logic/genres";` and `export * from "./logic/library-select";`:

```ts
export * from "./logic/group-tracks-by-album";
```

- [ ] **Step 4: Repoint the consumer**

In `packages/desktop/src/renderer/src/ui/views/OnDeviceView.tsx:8`, change:

```ts
import { groupTracksByAlbum } from "../../util/group-tracks-by-album";
```

to import from `@musex/core` (merge into the existing `@musex/core` import line in that file if present):

```ts
import { groupTracksByAlbum } from "@musex/core";
```

If `TrackAlbumGroup` is also imported anywhere in that file from the old path, repoint it to `@musex/core` too.

- [ ] **Step 5: Delete the originals**

```bash
rm packages/desktop/src/renderer/src/util/group-tracks-by-album.ts packages/desktop/src/renderer/src/util/group-tracks-by-album.test.ts
```

- [ ] **Step 6: Verify**

Run from `/Users/matjam/src/musex`: `pnpm check`
Expected: exit 0 (biome `--write` if needed, then re-run).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(core): move group-tracks-by-album into @musex/core"
```

---

### Task 4: Move `az-index` into core

**Files:**
- Create: `packages/core/src/logic/az-index.ts`, `packages/core/src/logic/az-index.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/mobile/app/(tabs)/library/index.tsx`
- Delete: `packages/mobile/src/logic/az-index.ts`, `packages/mobile/src/logic/az-index.test.ts`

- [ ] **Step 1: Create the core module (content moved verbatim — no imports to fix)**

Create `packages/core/src/logic/az-index.ts`:

```ts
/** First-letter bucket for an A–Z index. A–Z map to themselves (uppercased);
 *  digits, symbols, accented/non-ASCII, and empty all bucket under "#".
 *  (Plex sorts accents under their base letter; v1 buckets them under # — a
 *  known minor mismatch, acceptable until we normalize.) */
export function letterFor(name: string): string {
  const c = (name.trim()[0] ?? "").toUpperCase();
  return c >= "A" && c <= "Z" ? c : "#";
}

const ORDER = ["#", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"];

/** Given an ALREADY ALPHABETICALLY-SORTED list, returns the present letters (in
 *  #,A..Z order) and the first index of each — for FlatList scrollToIndex. */
export function buildLetterIndex<T>(
  items: T[],
  keyFn: (t: T) => string,
): { letters: string[]; indexOf: Record<string, number> } {
  const indexOf: Record<string, number> = {};
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item === undefined) continue;
    const l = letterFor(keyFn(item));
    if (!(l in indexOf)) indexOf[l] = i;
  }
  const letters = ORDER.filter((l) => l in indexOf);
  return { letters, indexOf };
}
```

- [ ] **Step 2: Move the test**

Copy `packages/mobile/src/logic/az-index.test.ts` into `packages/core/src/logic/az-index.test.ts`. Fix the module-under-test import to `import { buildLetterIndex, letterFor } from "./az-index.js";` (keep only the symbols the test uses). Ensure `vitest` imports are present. Do not change test cases.

- [ ] **Step 3: Add the barrel export**

In `packages/core/src/index.ts`, add as the FIRST entry of the `// Logic` block (alphabetically before `export * from "./logic/collage";`):

```ts
export * from "./logic/az-index";
```

- [ ] **Step 4: Repoint the consumer**

In `packages/mobile/app/(tabs)/library/index.tsx:13`, change:

```ts
import { buildLetterIndex } from "../../../src/logic/az-index";
```

to:

```ts
import { buildLetterIndex } from "@musex/core";
```

Merge into the existing `@musex/core` import line in that file if one is present.

- [ ] **Step 5: Delete the originals**

```bash
rm packages/mobile/src/logic/az-index.ts packages/mobile/src/logic/az-index.test.ts
```

- [ ] **Step 6: Verify**

Run from `/Users/matjam/src/musex`: `pnpm check`
Expected: exit 0 (biome `--write` if needed, then re-run).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(core): move az-index into @musex/core"
```

---

### Task 5: Split `recentlyPlayedTracks` out of mobile `home-data.ts` into core

**Files:**
- Create: `packages/core/src/logic/recently-played.ts`, `packages/core/src/logic/recently-played.test.ts`
- Modify: `packages/core/src/index.ts`, `packages/mobile/src/logic/home-data.ts`, `packages/mobile/src/logic/home-data.test.ts`, `packages/mobile/app/(tabs)/home/index.tsx`

- [ ] **Step 1: Create the core module (imports rewritten to relative)**

Create `packages/core/src/logic/recently-played.ts`. `smartTrackKey` lives in `packages/core/src/logic/smart-playlists.ts`; `Track` lives in `packages/core/src/models/index.ts`:

```ts
import type { Track } from "../models/index.js";
import { smartTrackKey } from "./smart-playlists.js";

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
```

- [ ] **Step 2: Remove `recentlyPlayedTracks` from mobile `home-data.ts` and drop the now-unused import**

Edit `packages/mobile/src/logic/home-data.ts`:
1. Delete the `recentlyPlayedTracks` function (the block at lines 4–19, including its doc comment).
2. The file's first two lines are:
   ```ts
   import type { ForYouInput, ForYouTrackStat, Track } from "@musex/core";
   import { smartTrackKey } from "@musex/core";
   ```
   After removing `recentlyPlayedTracks`, `smartTrackKey` is no longer used (only `recentlyPlayedTracks` used it), so DELETE the second line entirely. Keep the first line — `buildForYouInput` still uses `ForYouInput`, `ForYouTrackStat`, and `Track`.

The file now contains only `buildForYouInput` and its type import.

- [ ] **Step 3: Carve the test**

Open `packages/mobile/src/logic/home-data.test.ts`. Move the `recentlyPlayedTracks` test cases into a new file `packages/core/src/logic/recently-played.test.ts`, and leave the `buildForYouInput` test cases in the mobile file.

In the new core test file, the module-under-test import is `import { recentlyPlayedTracks } from "./recently-played.js";`. Any `Track` fixtures it needs may be imported from `@musex/core` (test files may use the barrel). Ensure `import { describe, expect, it } from "vitest";` is present.

In the mobile `home-data.test.ts`, remove the now-moved `recentlyPlayedTracks` cases and remove `recentlyPlayedTracks` from its import of `./home-data` (leaving `buildForYouInput`). If that leaves the mobile test file with zero tests, delete the file instead (mobile vitest is configured `passWithNoTests`, but an empty describe is dead code — prefer deleting if nothing remains; keep it if `buildForYouInput` cases remain).

- [ ] **Step 4: Add the barrel export**

In `packages/core/src/index.ts`, add alphabetically between `export * from "./logic/play-monitor";` and `export * from "./logic/plex-mapping";`:

```ts
export * from "./logic/recently-played";
```

- [ ] **Step 5: Repoint the consumer**

In `packages/mobile/app/(tabs)/home/index.tsx:7`, change:

```ts
import { recentlyPlayedTracks } from "../../../src/logic/home-data";
```

to:

```ts
import { recentlyPlayedTracks } from "@musex/core";
```

Merge into the existing `@musex/core` import line if one is present. Leave `home/mix.tsx` untouched — it imports `buildForYouInput` from `../../../src/logic/home-data`, which still lives there.

- [ ] **Step 6: Verify**

Run from `/Users/matjam/src/musex`: `pnpm check`
Expected: exit 0 (biome `--write` if needed, then re-run). Confirm mobile's `home/mix.tsx` still resolves `buildForYouInput` from the local `home-data` module.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(core): move recentlyPlayedTracks into @musex/core"
```

---

### Task 6: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm no stragglers reference the old paths**

Run from `/Users/matjam/src/musex`:

```bash
grep -rn "util/format\b\|util/group-tracks-by-album\|src/logic/az-index" packages/desktop/src packages/mobile/app packages/mobile/src
```

Expected: NO results (every consumer now imports from `@musex/core`). Investigate and fix any hit.

- [ ] **Step 2: Confirm the moved source files are gone**

```bash
ls packages/desktop/src/renderer/src/util/format.ts \
   packages/desktop/src/renderer/src/util/group-tracks-by-album.ts \
   packages/mobile/src/logic/az-index.ts 2>&1
```

Expected: all three report "No such file or directory".

- [ ] **Step 3: Full check**

Run from `/Users/matjam/src/musex`: `pnpm check`
Expected: exit 0 across core + desktop (both tsc passes) + mobile + biome + all tests.

- [ ] **Step 4: No commit needed** unless Step 1 surfaced a fix (in which case `git add -A && git commit -m "refactor(core): repoint straggler import"`).

---

## Self-Review

**Spec coverage:**
- format → Task 2 ✓; group-tracks-by-album → Task 3 ✓; az-index → Task 4 ✓; recentlyPlayedTracks → Task 5 ✓; LOVED_RATING export → Task 1 ✓.
- "core must not import its own barrel" rule → applied in Task 3 (Track → `../models/index.js`) and Task 5 (`smartTrackKey` → `./smart-playlists.js`, Track → `../models/index.js`) ✓.
- buildForYouInput stays in mobile → Task 5 Step 2 keeps it; Step 5 leaves `home/mix.tsx` untouched ✓.
- Tests move into core → each move task moves its test; Task 5 carves the split ✓.
- No shims, originals deleted → each task deletes originals; Task 6 verifies ✓.
- pnpm check gate → every task's verify step + Task 6 ✓.

**Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N" — every code block is complete moved content. ✓

**Type/symbol consistency:** Symbol names (`formatDuration`/`relativeTime`/`formatBytes`, `groupTracksByAlbum`/`TrackAlbumGroup`, `letterFor`/`buildLetterIndex`, `recentlyPlayedTracks`, `LOVED_RATING`) are used identically across the create/export/repoint steps. Relative import paths use `.js` specifiers to match core's NodeNext-style source convention. ✓
