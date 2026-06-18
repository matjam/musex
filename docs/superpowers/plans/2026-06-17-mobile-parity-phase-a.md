# Mobile Feature Parity — Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the mobile app to the everyday-music-app baseline — search, star ratings (read+write), playlist CRUD, a per-track action sheet, queue reorder/remove, and genre/mood browsing — reusing core logic.

**Architecture:** Core already has the queue methods (`move`/`removeAt`/`enqueueNext`/`enqueueEnd`/`playTrackNext`/`jumpTo`), `PlaylistTrack.playlistItemId`, `searchLibrary`, and `TasteProfile.recordTrackRating`. So the work is: one tiny core helper (`rating.ts`), implement 8 mobile Plex-gateway stubs (raw-JSON `fetch`, mirroring the existing `getJson`/`assertOk`/`requireBase` pattern), a mobile `TasteService.recordTrackRating` passthrough, and mobile UI (a 4th Search tab, an action sheet, a star control, add-to-playlist sheets, and a draggable Up Next).

**Tech Stack:** TypeScript 6 (`verbatimModuleSyntax` → `import type`), Expo SDK 56 / RN 0.85 / expo-router, vitest 4 (fake-`fetch` for gateway), biome 2, lucide-react-native icons.

**Spec:** `docs/superpowers/specs/2026-06-17-mobile-parity-phase-a-design.md`

---

## Conventions for every task

- **Verification bar:** after a task's edits, run the full `pnpm check` from `/Users/matjam/src/musex` (`pnpm -r typecheck && biome check . && pnpm -r test`). Must exit 0 before commit. If biome reports diffs, run `pnpm exec biome check --write .` then re-run.
- **Icons:** always `lucide-react-native`. **No emoji** in UI (the mockups used emoji as shorthand — implement with the matching lucide icon).
- **Imports:** `import type` for type-only; merge into an existing `@musex/core` import line rather than adding a second.
- **Staging/commits:** `git add -A` always; conventional-commit messages; one commit per task. Do NOT push between tasks (controller pushes after review).
- **UI tasks are not unit-tested** (project pattern: core is the test target; RN UI is verified on-device by the user). For UI tasks the gate is `pnpm check` (typecheck + biome) plus a noted on-device acceptance item. Gateway + core tasks DO get real tests (TDD).
- Branch `feature/mobile-parity-phase-a` already exists with the spec committed.

---

## File Structure

**Core (new):** `packages/core/src/logic/rating.ts` (+ test); barrel line in `packages/core/src/index.ts`.

**Mobile gateway:** `packages/mobile/src/adapters/plex-gateway.ts` (implement 8 methods + a `send` helper); `packages/mobile/src/adapters/plex-gateway.test.ts` (new tests).

**Mobile taste:** `packages/mobile/src/taste/taste-service.ts` (add `recordTrackRating`).

**Mobile UI (new):** `src/ui/StarRating.tsx`, `src/ui/TrackActionSheet.tsx`, `src/ui/AddToPlaylistSheet.tsx`, `src/ui/NewPlaylistDialog.tsx`.

**Mobile routes (new):** `app/(tabs)/search/_layout.tsx`, `app/(tabs)/search/index.tsx`, `app/(tabs)/search/genre.tsx`, `app/(tabs)/search/mix.tsx`; modify `app/(tabs)/_layout.tsx` (4th tab), `app/now-playing.tsx` (star + draggable Up Next), `app/(tabs)/home/index.tsx` (playlist long-press), `src/ui/TrackList.tsx` + `app/(tabs)/library/tracks.tsx` (action-sheet wiring).

**Deps (Task 13):** `react-native-gesture-handler`, `react-native-reanimated`, `react-native-draggable-flatlist` via `expo install`; `babel.config.js` (reanimated plugin); app entry (gesture-handler import).

---

### Task 1: Core `rating.ts` helper

**Files:**
- Create: `packages/core/src/logic/rating.ts`, `packages/core/src/logic/rating.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/logic/rating.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rating10FromStars, starsFromRating10 } from "./rating.js";

describe("rating conversion", () => {
  it("starsFromRating10 maps the 0–10 scale to 0–5 stars", () => {
    expect(starsFromRating10(null)).toBe(0);
    expect(starsFromRating10(0)).toBe(0);
    expect(starsFromRating10(8)).toBe(4); // LOVED_RATING
    expect(starsFromRating10(10)).toBe(5);
    expect(starsFromRating10(7)).toBe(4); // rounds (3.5 → 4)
  });

  it("rating10FromStars maps 1–5 stars back to the 0–10 scale", () => {
    expect(rating10FromStars(0)).toBe(0);
    expect(rating10FromStars(4)).toBe(8);
    expect(rating10FromStars(5)).toBe(10);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @musex/core exec vitest run src/logic/rating.test.ts`
Expected: FAIL (cannot resolve `./rating.js`).

- [ ] **Step 3: Implement**

Create `packages/core/src/logic/rating.ts`:

```ts
/** Plex stores ratings on a 0–10 scale; the UI shows 0–5 stars. These convert
 *  between the two. (LOVED_RATING = 8 = 4 stars; see smart-playlists.) */

/** 0–10 Plex rating (or null/unrated) → 0–5 whole stars. */
export function starsFromRating10(rating10: number | null): number {
  if (rating10 == null || rating10 <= 0) return 0;
  return Math.round(rating10 / 2);
}

/** 0–5 whole stars → 0–10 Plex rating. */
export function rating10FromStars(stars: number): number {
  return stars * 2;
}
```

- [ ] **Step 4: Add the barrel export**

In `packages/core/src/index.ts`, add to the `// Logic` block, alphabetically between `export * from "./logic/play-monitor";` and `export * from "./logic/plex-mapping";`:

```ts
export * from "./logic/rating";
```

- [ ] **Step 5: Verify + commit**

Run from repo root: `pnpm check` → exit 0.

```bash
git add -A
git commit -m "feat(core): add rating stars↔0-10 conversion helper"
```

---

### Task 2: Gateway — `send` helper + `rateItem` + `getUserRating`

**Files:**
- Modify: `packages/mobile/src/adapters/plex-gateway.ts`
- Test: `packages/mobile/src/adapters/plex-gateway.test.ts`

Port signatures (from `@musex/core`): `rateItem(serverId, itemId, rating: number | null, token): Promise<void>`; `getUserRating(serverId, itemId, token): Promise<number | null>`.

- [ ] **Step 1: Write the failing tests**

Add to `packages/mobile/src/adapters/plex-gateway.test.ts` (follow the existing fake-fetch pattern in that file — `jsonResponse`, `vi.fn`, prime base url via `listMusicLibraries(server, token)`):

```ts
describe("rateItem", () => {
  it("PUTs /:/rate with key + rating", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 200));
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await gw.listMusicLibraries(server, "TOK");
    await gw.rateItem("srv", "123", 8, "TOK");
    const [url, init] = fetchFn.mock.calls.at(-1) as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(url).toContain("/:/rate");
    expect(url).toContain("key=123");
    expect(url).toContain("rating=8");
    expect(url).toContain("identifier=com.plexapp.plugins.library");
  });

  it("sends rating=-1 to clear (null)", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 200));
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await gw.listMusicLibraries(server, "TOK");
    await gw.rateItem("srv", "123", null, "TOK");
    expect(String(fetchFn.mock.calls.at(-1)?.[0])).toContain("rating=-1");
  });
});

describe("getUserRating", () => {
  it("reads userRating off the item metadata", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: "123", userRating: 8 }] } }),
    );
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await gw.listMusicLibraries(server, "TOK");
    expect(await gw.getUserRating("srv", "123", "TOK")).toBe(8);
  });

  it("returns null when unrated", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: "123" }] } }),
    );
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await gw.listMusicLibraries(server, "TOK");
    expect(await gw.getUserRating("srv", "123", "TOK")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @musex/mobile exec vitest run src/adapters/plex-gateway.test.ts`
Expected: FAIL (methods throw "not implemented").

- [ ] **Step 3: Add a private non-GET request helper + implement the two methods**

In `packages/mobile/src/adapters/plex-gateway.ts`, add this private helper next to `getJson` (it reuses `plexHeaders` + `assertOk`):

```ts
/** A non-GET authenticated Plex request. Returns the Response (callers that
 *  need a body call res.json()); most mutations ignore it. */
private async send(url: string, method: string, token: string): Promise<Response> {
  const res = await this.fetchFn(url, {
    method,
    headers: plexHeaders(this.clientId, { "X-Plex-Token": token }),
  });
  this.assertOk(res);
  return res;
}
```

Replace the `rateItem` and `getUserRating` stubs with:

```ts
async rateItem(serverId: string, itemId: string, rating: number | null, token: string): Promise<void> {
  const base = this.requireBase(serverId);
  const r = rating ?? -1; // Plex unsets a rating with -1
  await this.send(
    `${base}/:/rate?key=${encodeURIComponent(itemId)}&identifier=com.plexapp.plugins.library&rating=${r}`,
    "PUT",
    token,
  );
}

async getUserRating(serverId: string, itemId: string, token: string): Promise<number | null> {
  const base = this.requireBase(serverId);
  const json = await this.getJson(`${base}/library/metadata/${itemId}`, token);
  const meta = parseTracks(json, serverId)[0];
  return meta?.userRating ?? null;
}
```

Ensure `parseTracks` is imported from `../logic/plex-parse` (it already is for other methods; if not, add it).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @musex/mobile exec vitest run src/adapters/plex-gateway.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify + commit**

`pnpm check` → exit 0.

```bash
git add -A
git commit -m "feat(mobile): implement rateItem + getUserRating gateway methods"
```

---

### Task 3: Gateway — `search`

**Files:**
- Modify: `packages/mobile/src/adapters/plex-gateway.ts`
- Test: `packages/mobile/src/adapters/plex-gateway.test.ts`

Port signature: `search(library, query, token): Promise<SearchResults>` where `SearchResults = { artists, albums, tracks }`. Implementation: per-type section search (`type=8` artists, `9` albums, `10` tracks), reusing the existing parsers.

- [ ] **Step 1: Write the failing test**

Add to the gateway test:

```ts
describe("search", () => {
  it("queries artists/albums/tracks and assembles SearchResults", async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes("type=8"))
        return jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: "a1", title: "M83" }] } });
      if (url.includes("type=9"))
        return jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: "al1", title: "Junk" }] } });
      if (url.includes("type=10"))
        return jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: "t1", title: "Wait" }] } });
      return jsonResponse({ MediaContainer: {} });
    });
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    const lib = { id: "3", serverId: "srv", serverName: "T", title: "Music", type: "music" as const };
    await gw.listMusicLibraries(server, "TOK");
    const res = await gw.search(lib, "m83", "TOK");
    expect(res.artists[0]?.name).toBe("M83");
    expect(res.albums[0]?.title).toBe("Junk");
    expect(res.tracks[0]?.title).toBe("Wait");
    const urls = fetchFn.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("/library/sections/3/search") && u.includes("query=m83"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @musex/mobile exec vitest run src/adapters/plex-gateway.test.ts`
Expected: FAIL ("search not implemented").

- [ ] **Step 3: Implement**

Replace the `search` stub with (ensure `parseArtists`, `parseAlbums`, `parseTracks` are imported from `../logic/plex-parse`):

```ts
async search(library: Library, query: string, token: string): Promise<SearchResults> {
  const base = this.requireBase(library.serverId);
  const q = encodeURIComponent(query);
  const hit = (type: number) =>
    this.getJson(`${base}/library/sections/${library.id}/search?type=${type}&query=${q}`, token);
  const [a, al, t] = await Promise.all([hit(8), hit(9), hit(10)]);
  return {
    artists: parseArtists(a, library.serverId),
    albums: parseAlbums(al, library.serverId),
    tracks: parseTracks(t, library.serverId),
  };
}
```

Ensure `SearchResults` and `Library` are imported as types from `@musex/core`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @musex/mobile exec vitest run src/adapters/plex-gateway.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify + commit**

`pnpm check` → exit 0.

```bash
git add -A
git commit -m "feat(mobile): implement library search gateway method"
```

---

### Task 4: Gateway — playlist CRUD (create/add/remove/rename/delete)

**Files:**
- Modify: `packages/mobile/src/adapters/plex-gateway.ts`
- Test: `packages/mobile/src/adapters/plex-gateway.test.ts`

Port signatures: `createPlaylist(library, title, trackIds: string[], token): Promise<Playlist>`; `addToPlaylist(playlistId, serverId, trackIds: string[], token): Promise<void>`; `removeFromPlaylist(playlistId, serverId, playlistItemIds: string[], token): Promise<void>`; `renamePlaylist(playlistId, serverId, title, token): Promise<void>`; `deletePlaylist(playlistId, serverId, token): Promise<void>`. The Plex playlist `uri` is `server://{serverId}/com.plexapp.plugins.library/library/metadata/{ids joined by ,}`.

- [ ] **Step 1: Write the failing tests**

Add to the gateway test:

```ts
describe("playlist CRUD", () => {
  const lib = { id: "3", serverId: "srv", serverName: "T", title: "Music", type: "music" as const };

  it("createPlaylist POSTs type=audio with title + track uri and parses the result", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: "pl1", title: "Sunset", leafCount: 1 }] } }),
    );
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await gw.listMusicLibraries(server, "TOK");
    const pl = await gw.createPlaylist(lib, "Sunset", ["t1"], "TOK");
    expect(pl.id).toBe("pl1");
    const [url, init] = fetchFn.mock.calls.at(-1) as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(url).toContain("/playlists");
    expect(url).toContain("type=audio");
    expect(url).toContain("title=Sunset");
    expect(decodeURIComponent(url)).toContain("library/metadata/t1");
  });

  it("addToPlaylist PUTs items with the track uri", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 200));
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await gw.listMusicLibraries(server, "TOK");
    await gw.addToPlaylist("pl1", "srv", ["t2", "t3"], "TOK");
    const [url, init] = fetchFn.mock.calls.at(-1) as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(url).toContain("/playlists/pl1/items");
    expect(decodeURIComponent(url)).toContain("library/metadata/t2,t3");
  });

  it("removeFromPlaylist DELETEs each playlist item", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 200));
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await gw.listMusicLibraries(server, "TOK");
    await gw.removeFromPlaylist("pl1", "srv", ["i1", "i2"], "TOK");
    const calls = fetchFn.mock.calls.filter((c) => String(c[0]).includes("/playlists/pl1/items/"));
    expect(calls).toHaveLength(2);
    expect((calls[0]?.[1] as RequestInit).method).toBe("DELETE");
  });

  it("renamePlaylist PUTs the new title", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 200));
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await gw.listMusicLibraries(server, "TOK");
    await gw.renamePlaylist("pl1", "srv", "New Name", "TOK");
    const [url, init] = fetchFn.mock.calls.at(-1) as [string, RequestInit];
    expect(init.method).toBe("PUT");
    expect(url).toContain("/playlists/pl1");
    expect(url).toContain("title=New%20Name");
  });

  it("deletePlaylist DELETEs the playlist", async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 200));
    const gw = new PlexGatewayImpl(fetchFn, "CID");
    await gw.listMusicLibraries(server, "TOK");
    await gw.deletePlaylist("pl1", "srv", "TOK");
    const [url, init] = fetchFn.mock.calls.at(-1) as [string, RequestInit];
    expect(init.method).toBe("DELETE");
    expect(url).toContain("/playlists/pl1");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @musex/mobile exec vitest run src/adapters/plex-gateway.test.ts`
Expected: FAIL ("playlists not implemented").

- [ ] **Step 3: Implement**

Replace the five playlist stubs (ensure `parsePlaylists` and the `Playlist` type are imported):

```ts
async createPlaylist(library: Library, title: string, trackIds: string[], token: string): Promise<Playlist> {
  const base = this.requireBase(library.serverId);
  const uri = `server://${library.serverId}/com.plexapp.plugins.library/library/metadata/${trackIds.join(",")}`;
  const res = await this.send(
    `${base}/playlists?type=audio&smart=0&title=${encodeURIComponent(title)}&uri=${encodeURIComponent(uri)}`,
    "POST",
    token,
  );
  const pl = parsePlaylists(await res.json(), library.serverId)[0];
  if (!pl) throw new Error("createPlaylist: server returned no playlist");
  return pl;
}

async addToPlaylist(playlistId: string, serverId: string, trackIds: string[], token: string): Promise<void> {
  const base = this.requireBase(serverId);
  const uri = `server://${serverId}/com.plexapp.plugins.library/library/metadata/${trackIds.join(",")}`;
  await this.send(`${base}/playlists/${playlistId}/items?uri=${encodeURIComponent(uri)}`, "PUT", token);
}

async removeFromPlaylist(playlistId: string, serverId: string, playlistItemIds: string[], token: string): Promise<void> {
  const base = this.requireBase(serverId);
  for (const itemId of playlistItemIds) {
    await this.send(`${base}/playlists/${playlistId}/items/${itemId}`, "DELETE", token);
  }
}

async renamePlaylist(playlistId: string, serverId: string, title: string, token: string): Promise<void> {
  const base = this.requireBase(serverId);
  await this.send(`${base}/playlists/${playlistId}?title=${encodeURIComponent(title)}`, "PUT", token);
}

async deletePlaylist(playlistId: string, serverId: string, token: string): Promise<void> {
  const base = this.requireBase(serverId);
  await this.send(`${base}/playlists/${playlistId}`, "DELETE", token);
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @musex/mobile exec vitest run src/adapters/plex-gateway.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify + commit**

`pnpm check` → exit 0.

```bash
git add -A
git commit -m "feat(mobile): implement playlist CRUD gateway methods"
```

---

### Task 5: Mobile `TasteService.recordTrackRating` passthrough

**Files:**
- Modify: `packages/mobile/src/taste/taste-service.ts`
- Test: `packages/mobile/src/taste/taste-service.test.ts` (create if absent, else extend)

`TasteService` wraps the core `TasteProfile`, which already has `recordTrackRating(t, rating10)`. Add a passthrough that records and persists (mirror how `recordPlay` persists — find the debounced-save call it uses and reuse it).

- [ ] **Step 1: Read the current `recordPlay` to copy its persist pattern**

Open `packages/mobile/src/taste/taste-service.ts`. Note how `recordPlay` calls the underlying `TasteProfile` then schedules a save (e.g. `this.profile.recordPlay(...)` + `this.scheduleSave()` or similar). Reuse that exact persist call.

- [ ] **Step 2: Write the failing test**

Create/extend `packages/mobile/src/taste/taste-service.test.ts` — mock the persistence adapter so no native AsyncStorage is touched (mirror any existing taste-service test; if none, mock `../adapters/taste-persistence`). Minimal test:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("../adapters/taste-persistence", () => ({
  loadProfile: vi.fn(async () => null),
  saveProfile: vi.fn(async () => {}),
}));

import { TasteService } from "./taste-service";

describe("TasteService.recordTrackRating", () => {
  it("records a rating that surfaces in the snapshot's trackStats", async () => {
    const svc = new TasteService();
    await svc.init();
    svc.recordTrackRating({ title: "Wait", artistName: "M83" }, 8);
    const snap = svc.snapshot();
    const stat = snap.trackStats.find((s) => s.key.includes("wait"));
    expect(stat?.ratingStars).toBe(4);
  });
});
```

(Adjust the mock to match the real persistence module's exported names — read `src/adapters/taste-persistence.ts` first and match its exports.)

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @musex/mobile exec vitest run src/taste/taste-service.test.ts`
Expected: FAIL (`recordTrackRating` is not a function).

- [ ] **Step 4: Implement**

Add to the `TasteService` class (using the same persist call `recordPlay` uses — shown here as `this.scheduleSave()`; replace with the real method name from Step 1):

```ts
recordTrackRating(t: { title: string; artistName: string }, rating10: number | null): void {
  this.profile.recordTrackRating(t, rating10);
  this.scheduleSave();
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @musex/mobile exec vitest run src/taste/taste-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Verify + commit**

`pnpm check` → exit 0.

```bash
git add -A
git commit -m "feat(mobile): expose recordTrackRating on TasteService"
```

---

### Task 6: `StarRating` component

**Files:**
- Create: `packages/mobile/src/ui/StarRating.tsx`

A row of 5 tappable stars. Tapping star *n* sets rating to `rating10FromStars(n)`; tapping the current rating clears it (passes `null`). Single-line.

- [ ] **Step 1: Implement**

Create `packages/mobile/src/ui/StarRating.tsx`:

```tsx
import { rating10FromStars, starsFromRating10 } from "@musex/core";
import { Star } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { theme } from "./theme";

export function StarRating({
  rating10,
  onRate,
  size = 18,
}: {
  /** Current Plex 0–10 rating (null = unrated). */
  rating10: number | null;
  /** New 0–10 rating, or null to clear. */
  onRate: (rating10: number | null) => void;
  size?: number;
}) {
  const current = starsFromRating10(rating10);
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= current;
        return (
          <Pressable key={n} hitSlop={6} onPress={() => onRate(n === current ? null : rating10FromStars(n))}>
            <Star
              size={size}
              color={filled ? theme.accent : theme.textDim}
              fill={filled ? theme.accent : "transparent"}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
```

Tapping star *n* sets the rating to `rating10FromStars(n)`; tapping the current rating clears it (`null`).

- [ ] **Step 2: Verify + commit**

`pnpm check` → exit 0 (typecheck + biome; no unit test — verified on device via the action sheet/Now-Playing).

```bash
git add -A
git commit -m "feat(mobile): add StarRating control"
```

---

### Task 7: `AddToPlaylistSheet` + `NewPlaylistDialog`

**Files:**
- Create: `packages/mobile/src/ui/AddToPlaylistSheet.tsx`, `packages/mobile/src/ui/NewPlaylistDialog.tsx`

Both are RN `Modal`s (no new dependency). They read `gateway`, `library`, `token` from `useStore()`.

- [ ] **Step 1: Implement `NewPlaylistDialog`**

Create `packages/mobile/src/ui/NewPlaylistDialog.tsx`:

```tsx
import { useState } from "react";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { theme } from "./theme";

export function NewPlaylistDialog({
  visible,
  onCancel,
  onCreate,
}: {
  visible: boolean;
  onCancel: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState("");
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: "#000a", justifyContent: "center", padding: 24 }}>
        <View style={{ backgroundColor: theme.surface, borderRadius: 12, padding: 16 }}>
          <Text style={{ color: theme.text, fontWeight: "700", fontSize: 15, marginBottom: 10 }}>
            New playlist
          </Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Playlist name"
            placeholderTextColor={theme.textDim}
            autoFocus
            style={{
              backgroundColor: theme.bg,
              borderColor: theme.accent,
              borderWidth: 1,
              borderRadius: 8,
              padding: 10,
              color: theme.text,
            }}
          />
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 12, marginTop: 14 }}>
            <Pressable onPress={onCancel} style={{ paddingVertical: 6, paddingHorizontal: 14 }}>
              <Text style={{ color: theme.textDim }}>Cancel</Text>
            </Pressable>
            <Pressable
              disabled={!name.trim()}
              onPress={() => {
                onCreate(name.trim());
                setName("");
              }}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 14,
                borderRadius: 8,
                backgroundColor: theme.accent,
                opacity: name.trim() ? 1 : 0.4,
              }}
            >
              <Text style={{ color: "#000", fontWeight: "700" }}>Create</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
```

- [ ] **Step 2: Implement `AddToPlaylistSheet`**

Create `packages/mobile/src/ui/AddToPlaylistSheet.tsx`:

```tsx
import type { Playlist, Track } from "@musex/core";
import { ListPlus, Plus } from "lucide-react-native";
import { useEffect, useState } from "react";
import { FlatList, Modal, Pressable, Text, View } from "react-native";
import { useStore } from "../state/store";
import { NewPlaylistDialog } from "./NewPlaylistDialog";
import { theme } from "./theme";

export function AddToPlaylistSheet({
  track,
  visible,
  onClose,
}: {
  track: Track | null;
  visible: boolean;
  onClose: () => void;
}) {
  const { gateway, token } = useStore();
  const library = useStore().state.library;
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [dialog, setDialog] = useState(false);

  useEffect(() => {
    if (!visible || !library || !token) return;
    let live = true;
    gateway
      .listPlaylists(library, token)
      .then((p) => live && setPlaylists(p))
      .catch(() => live && setPlaylists([]));
    return () => {
      live = false;
    };
  }, [visible, library, token, gateway]);

  async function addTo(playlistId: string) {
    if (!track) return;
    await gateway.addToPlaylist(playlistId, track.serverId, [track.id], token ?? "");
    onClose();
  }

  async function create(name: string) {
    if (!track || !library) return;
    await gateway.createPlaylist(library, name, [track.id], token ?? "");
    setDialog(false);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "#0008" }} onPress={onClose} />
      <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 28, maxHeight: "70%" }}>
        <Text style={{ color: theme.text, fontWeight: "700", padding: 16 }} numberOfLines={1}>
          Add "{track?.title}" to…
        </Text>
        <Pressable
          onPress={() => setDialog(true)}
          style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}
        >
          <Plus color={theme.accent} size={20} />
          <Text style={{ color: theme.text }}>New playlist</Text>
        </Pressable>
        <FlatList
          data={playlists}
          keyExtractor={(p) => p.id}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => void addTo(item.id)}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}
            >
              <ListPlus color={theme.textDim} size={20} />
              <Text style={{ color: theme.text }} numberOfLines={1}>
                {item.title}
              </Text>
            </Pressable>
          )}
        />
      </View>
      <NewPlaylistDialog visible={dialog} onCancel={() => setDialog(false)} onCreate={(n) => void create(n)} />
    </Modal>
  );
}
```

NOTE: confirm `listPlaylists`'s signature in the gateway (it's already implemented). If it differs (e.g. takes `(library, token)` — it does per the existing code), match it. `Playlist` has `id` + `title` (confirm field names against the model; adjust `item.title` if the model uses `name`).

- [ ] **Step 3: Verify + commit**

`pnpm check` → exit 0.

```bash
git add -A
git commit -m "feat(mobile): add AddToPlaylistSheet + NewPlaylistDialog"
```

---

### Task 8: `TrackActionSheet` (the spine)

**Files:**
- Create: `packages/mobile/src/ui/TrackActionSheet.tsx`

A bottom-sheet `Modal` with the track header (art + title/artist + `StarRating`) and action rows. Opens `AddToPlaylistSheet`. Uses `useStore()` for `session`, `gateway`, `taste`, `token`, `artBaseFor`, and `useRouter()` for navigation.

- [ ] **Step 1: Implement**

Create `packages/mobile/src/ui/TrackActionSheet.tsx`:

```tsx
import type { Track } from "@musex/core";
import { useRouter } from "expo-router";
import { Disc3, ListEnd, ListPlus, ListStart, Mic2, Trash2 } from "lucide-react-native";
import { useState } from "react";
import { Modal, Pressable, Text, View } from "react-native";
import { useStore } from "../state/store";
import { AddToPlaylistSheet } from "./AddToPlaylistSheet";
import { AlbumArt } from "./AlbumArt";
import { artUrl } from "../logic/art-url";
import { StarRating } from "./StarRating";
import { theme } from "./theme";

export function TrackActionSheet({
  track,
  visible,
  onClose,
  playlistContext,
  onRemovedFromPlaylist,
}: {
  track: Track | null;
  visible: boolean;
  onClose: () => void;
  /** Present when opened from inside a playlist → enables "Remove from this playlist". */
  playlistContext?: { playlistId: string; playlistItemId: string };
  onRemovedFromPlaylist?: () => void;
}) {
  const { session, gateway, taste, token, artBaseFor } = useStore();
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [rating, setRating] = useState<number | null>(track?.userRating ?? null);

  if (!track) return null;
  const base = artBaseFor(track.serverId);
  const art = base && token ? artUrl(base, track.thumb, token) : null;

  async function rate(r: number | null) {
    setRating(r); // optimistic
    try {
      await gateway.rateItem(track!.serverId, track!.id, r, token ?? "");
      taste.recordTrackRating({ title: track!.title, artistName: track!.artistName }, r);
    } catch {
      setRating(track!.userRating ?? null); // revert on failure
    }
  }

  const go = (pathname: string, params: Record<string, string>) => {
    onClose();
    router.push({ pathname, params } as never);
  };

  const Row = ({ icon, label, onPress, danger }: { icon: React.ReactNode; label: string; onPress: () => void; danger?: boolean }) => (
    <Pressable onPress={onPress} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 }}>
      {icon}
      <Text style={{ color: danger ? "#e5534b" : theme.text, fontSize: 15 }}>{label}</Text>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "#0008" }} onPress={onClose} />
      <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 28 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 16, borderBottomWidth: 1, borderBottomColor: theme.border }}>
          <AlbumArt url={art} size={44} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontWeight: "600" }} numberOfLines={1}>{track.title}</Text>
            <Text style={{ color: theme.textDim, fontSize: 12, marginBottom: 6 }} numberOfLines={1}>
              {[track.albumTitle, track.artistName].filter(Boolean).join(" · ")}
            </Text>
            <StarRating rating10={rating} onRate={(r) => void rate(r)} />
          </View>
        </View>

        <Row icon={<ListStart color={theme.accent} size={20} />} label="Play next" onPress={() => { void session.playTrackNext(track); onClose(); }} />
        <Row icon={<ListEnd color={theme.accent} size={20} />} label="Add to queue" onPress={() => { void session.enqueueEnd([track]); onClose(); }} />
        <Row icon={<ListPlus color={theme.accent} size={20} />} label="Add to playlist…" onPress={() => setAddOpen(true)} />
        {playlistContext ? (
          <Row icon={<Trash2 color="#e5534b" size={20} />} label="Remove from this playlist" danger onPress={async () => {
            await gateway.removeFromPlaylist(playlistContext.playlistId, track.serverId, [playlistContext.playlistItemId], token ?? "");
            onClose();
            onRemovedFromPlaylist?.();
          }} />
        ) : null}
        <Row icon={<Mic2 color={theme.text} size={20} />} label="Go to artist" onPress={() => go("/(tabs)/library/albums", { artistId: track.artistId })} />
        <Row icon={<Disc3 color={theme.text} size={20} />} label="Go to album" onPress={() => go("/(tabs)/library/tracks", { albumId: track.albumId })} />
      </View>
      <AddToPlaylistSheet track={track} visible={addOpen} onClose={() => { setAddOpen(false); onClose(); }} />
    </Modal>
  );
}
```

NOTE: confirm `Track` has `artistId` + `albumId` (it does per the model). Confirm the lucide icon names import cleanly (`ListStart`, `ListEnd`, `Mic2`, `Disc3`, `ListPlus`, `Trash2`); if any is absent in the installed lucide-react-native, substitute the nearest available (e.g. `Music`, `Album`) — biome/tsc will flag a bad import.

- [ ] **Step 2: Verify + commit**

`pnpm check` → exit 0.

```bash
git add -A
git commit -m "feat(mobile): add per-track action sheet"
```

---

### Task 9: Wire the action sheet into `TrackList` + album `tracks.tsx`

**Files:**
- Modify: `packages/mobile/src/ui/TrackList.tsx`, `packages/mobile/app/(tabs)/library/tracks.tsx`

Add long-press + a trailing ⋯ button to track rows that open the `TrackActionSheet`. `TrackList` owns the sheet state.

- [ ] **Step 1: Add action-sheet state + row trigger to `TrackList`**

In `packages/mobile/src/ui/TrackList.tsx`: import `useState`, `MoreVertical` from `lucide-react-native`, and `TrackActionSheet`. Add `const [sheetTrack, setSheetTrack] = useState<Track | null>(null);`. On the row `Pressable`, add `onLongPress={() => setSheetTrack(item)}`. Add a trailing ⋯ button inside the row (after the title `View`):

```tsx
<Pressable hitSlop={8} onPress={() => setSheetTrack(item)} style={{ padding: 6 }}>
  <MoreVertical color={theme.textDim} size={20} />
</Pressable>
```

After the `FlatList`, wrap the return in a fragment and render:

```tsx
<TrackActionSheet track={sheetTrack} visible={sheetTrack !== null} onClose={() => setSheetTrack(null)} />
```

(Because `TrackList`'s root is a `FlatList`, change the return to `<>{<FlatList .../>}{<TrackActionSheet .../>}</>`.)

- [ ] **Step 2: Add the same to the album `tracks.tsx` numbered rows**

`packages/mobile/app/(tabs)/library/tracks.tsx` renders its own numbered rows (not `TrackList`). Add identical state + `onLongPress` + ⋯ button + the `<TrackActionSheet>` at the screen root, mirroring Step 1.

- [ ] **Step 3: Verify + commit**

`pnpm check` → exit 0. (On-device acceptance: long-press and ⋯ both open the sheet from album + TrackList screens.)

```bash
git add -A
git commit -m "feat(mobile): open track action sheet from track rows"
```

---

### Task 10: Search tab — tab + stack + search screen with grouped results

**Files:**
- Modify: `packages/mobile/app/(tabs)/_layout.tsx`
- Create: `packages/mobile/app/(tabs)/search/_layout.tsx`, `packages/mobile/app/(tabs)/search/index.tsx`

- [ ] **Step 1: Add the Search tab**

In `packages/mobile/app/(tabs)/_layout.tsx`: import `Search` from `lucide-react-native`. Add a `<TabTrigger>` between the Home and Library triggers:

```tsx
<TabTrigger name="search" href="/(tabs)/search" asChild>
  <TabButton icon={Search} label="Search" />
</TabTrigger>
```

- [ ] **Step 2: Create the search stack layout**

Create `packages/mobile/app/(tabs)/search/_layout.tsx` (mirror `library/_layout.tsx`):

```tsx
import { Stack } from "expo-router";
import { theme } from "../../../src/ui/theme";

export default function SearchLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.text,
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Search" }} />
      <Stack.Screen name="genre" options={{ title: "Genre" }} />
      <Stack.Screen name="mix" options={{ title: "Mix" }} />
    </Stack>
  );
}
```

- [ ] **Step 3: Create the search screen (query → grouped results; empty → Browse placeholder)**

Create `packages/mobile/app/(tabs)/search/index.tsx`. Use a debounced query calling `searchLibrary(gateway, library, q, token)`. Render grouped sections (Artists circular tiles, Albums + Tracks rows); tapping artist → `library/albums?artistId=`, album → `library/tracks?albumId=`, track → `playTracks([track],0)`; long-press/⋯ on a track row opens the action sheet. When the query is blank, render the Browse grid (Task 11 fills this — for now render an empty `<View>` placeholder so this task compiles independently).

```tsx
import { type SearchResults, searchLibrary } from "@musex/core";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, Text, TextInput, View } from "react-native";
import { artUrl } from "../../../src/logic/art-url";
import { useStore } from "../../../src/state/store";
import { AlbumArt } from "../../../src/ui/AlbumArt";
import { BrowseGrid } from "../../../src/ui/BrowseGrid"; // created in Task 11
import { TrackActionSheet } from "../../../src/ui/TrackActionSheet";
import { theme } from "../../../src/ui/theme";

const EMPTY: SearchResults = { artists: [], albums: [], tracks: [] };

export default function SearchScreen() {
  const { gateway, token, playTracks, artBaseFor } = useStore();
  const library = useStore().state.library;
  const router = useRouter();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<SearchResults>(EMPTY);
  const [sheetTrack, setSheetTrack] = useState<import("@musex/core").Track | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!library || !token) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      searchLibrary(gateway, library, q, token).then(setRes).catch(() => setRes(EMPTY));
    }, 250);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [q, library, token, gateway]);

  const art = (serverId: string, thumb?: string) => {
    const b = artBaseFor(serverId);
    return b && token ? artUrl(b, thumb, token) : null;
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search artists, albums, tracks…"
        placeholderTextColor={theme.textDim}
        style={{ backgroundColor: theme.surface, color: theme.text, margin: 12, borderRadius: 8, padding: 10 }}
      />
      {q.trim() === "" ? (
        <BrowseGrid />
      ) : (
        <FlatList
          data={res.tracks}
          keyExtractor={(t, i) => `${t.id}-${i}`}
          ListHeaderComponent={
            <View>
              {res.artists.length > 0 ? <Text style={hdr}>Artists</Text> : null}
              {res.artists.slice(0, 4).map((a) => (
                <Pressable key={a.id} onPress={() => router.push({ pathname: "/(tabs)/library/albums", params: { artistId: a.id } } as never)} style={rowS}>
                  <AlbumArt url={art(a.serverId, a.thumb)} size={44} circular />
                  <Text style={{ color: theme.text }} numberOfLines={1}>{a.name}</Text>
                </Pressable>
              ))}
              {res.albums.length > 0 ? <Text style={hdr}>Albums</Text> : null}
              {res.albums.slice(0, 4).map((al) => (
                <Pressable key={al.id} onPress={() => router.push({ pathname: "/(tabs)/library/tracks", params: { albumId: al.id } } as never)} style={rowS}>
                  <AlbumArt url={art(al.serverId, al.thumb)} size={44} />
                  <Text style={{ color: theme.text }} numberOfLines={1}>{al.title}</Text>
                </Pressable>
              ))}
              {res.tracks.length > 0 ? <Text style={hdr}>Tracks</Text> : null}
            </View>
          }
          renderItem={({ item, index }) => (
            <Pressable onLongPress={() => setSheetTrack(item)} onPress={() => void playTracks([item], 0)} style={rowS}>
              <AlbumArt url={art(item.serverId, item.thumb)} size={44} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text }} numberOfLines={1}>{item.title}</Text>
                <Text style={{ color: theme.textDim, fontSize: 12 }} numberOfLines={1}>{item.artistName}</Text>
              </View>
              <Pressable hitSlop={8} onPress={() => setSheetTrack(item)} style={{ padding: 6 }}>
                <Text style={{ color: theme.textDim, fontSize: 18 }}>⋯</Text>
              </Pressable>
            </Pressable>
          )}
        />
      )}
      <TrackActionSheet track={sheetTrack} visible={sheetTrack !== null} onClose={() => setSheetTrack(null)} />
    </View>
  );
}

const hdr = { color: theme.textDim, fontSize: 11, textTransform: "uppercase" as const, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, fontWeight: "700" as const };
const rowS = { flexDirection: "row" as const, alignItems: "center" as const, gap: 12, paddingHorizontal: 16, paddingVertical: 8 };
```

NOTE: the ⋯ in the trailing button should be the lucide `MoreVertical` icon (matching Task 9), not the literal character — replace `<Text>⋯</Text>` with `<MoreVertical color={theme.textDim} size={20} />` and import it. (Shown as text only to keep the snippet short.)

- [ ] **Step 4: Verify + commit**

`pnpm check` → exit 0. (`BrowseGrid` import resolves once Task 11 creates it — if running this task strictly before Task 11, create a one-line `BrowseGrid` stub returning `<View/>` first; Task 11 replaces it. Prefer doing Task 11 immediately after so the stub is short-lived.) On-device: typing searches the library; results group + navigate.

```bash
git add -A
git commit -m "feat(mobile): add Search tab with grouped library results"
```

---

### Task 11: Browse grid + genre/mood detail screens

**Files:**
- Create: `packages/mobile/src/ui/BrowseGrid.tsx`, `packages/mobile/app/(tabs)/search/genre.tsx`, `packages/mobile/app/(tabs)/search/mix.tsx`

`BrowseGrid` shows mood-mix tiles (`mood-mixes.ts`) + genre tiles (`genres.ts` over `listAllAlbums`) in a proper 2-column tiled grid. Detail screens reuse `TrackList`.

- [ ] **Step 1: Confirm the core APIs to call**

Read the exports of `packages/core/src/logic/mood-mixes.ts` and `packages/core/src/logic/genres.ts` from the `@musex/core` barrel. Identify: the mood-mix definitions list (the 5 mixes — names + the predicate/compute), the function that yields a mood mix's tracks given `allTracks`/`allAlbums`, `genreIndex(albums)` → genre list, and `tracksForGenre`/`albumsForGenre`. Use the actual exported names (do not invent — match the barrel).

- [ ] **Step 2: Implement `BrowseGrid`**

Create `packages/mobile/src/ui/BrowseGrid.tsx`: on mount, load `gateway.listAllAlbums(library, "title", token)` (already implemented). Build the genre list via `genreIndex`. Render a 2-column `FlatList` (`numColumns={2}`) — first the 5 mood mixes as color/`Collage` tiles, then genre tiles. Tap a mood → `router.push({ pathname: "/(tabs)/search/mix", params: { mood: <key> } })`; tap a genre → `.../search/genre", params: { genre }`. Use `Tile`/`Collage` for consistent tiling and the theme spacing. Keep tiles in a real grid (`numColumns`, equal widths) — not inline-wrap.

```tsx
import { genreIndex, MOOD_MIXES } from "@musex/core"; // use the ACTUAL exported names from Step 1
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { FlatList } from "react-native";
import { useStore } from "../state/store";
import { Tile } from "./Tile";
import { theme } from "./theme";

export function BrowseGrid() {
  const { gateway, token } = useStore();
  const library = useStore().state.library;
  const router = useRouter();
  const [genres, setGenres] = useState<string[]>([]);

  useEffect(() => {
    if (!library || !token) return;
    let live = true;
    gateway
      .listAllAlbums(library, "title", token)
      .then((albums) => live && setGenres(genreIndex(albums).map((g) => g.name))) // adjust to real shape
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [library, token, gateway]);

  type Cell = { kind: "mood" | "genre"; key: string; label: string };
  const cells: Cell[] = [
    ...MOOD_MIXES.map((m) => ({ kind: "mood" as const, key: m.id, label: m.name })), // adjust to real shape
    ...genres.map((g) => ({ kind: "genre" as const, key: g, label: g })),
  ];

  return (
    <FlatList
      data={cells}
      numColumns={2}
      keyExtractor={(c) => `${c.kind}:${c.key}`}
      contentContainerStyle={{ padding: theme.space(0.5) }}
      renderItem={({ item }) => (
        <Tile
          art={null}
          size={170}
          label={item.label}
          onPress={() =>
            router.push(
              item.kind === "mood"
                ? ({ pathname: "/(tabs)/search/mix", params: { mood: item.key } } as never)
                : ({ pathname: "/(tabs)/search/genre", params: { genre: item.key } } as never),
            )
          }
        />
      )}
    />
  );
}
```

(Adjust `MOOD_MIXES`/`genreIndex` shapes to the real exports from Step 1. If `Tile` needs a fixed width for clean 2-col tiling, compute `size` from the screen width / 2 minus padding, as `library/index.tsx` does — mirror that.)

- [ ] **Step 3: Implement the detail screens**

`packages/mobile/app/(tabs)/search/genre.tsx`: read `genre` param; load `listAllTracks`/`listAllAlbums`; compute the genre's tracks via the core genre function; render `<TrackList title={genre} tracks={tracks} session={session} artBaseFor={artBaseFor} token={token} />`.

`packages/mobile/app/(tabs)/search/mix.tsx`: read `mood` param; compute the mood mix's tracks via the core mood function over `listAllTracks`/`listAllAlbums`; render `<TrackList title={moodName} tracks={tracks} ... />`. Mirror the existing `home/mix.tsx` for how it loads tracks + builds a mix + renders `TrackList`.

- [ ] **Step 4: Verify + commit**

`pnpm check` → exit 0. On-device: Browse tiles tile cleanly in 2 columns; tapping a mood/genre opens a `TrackList` that plays.

```bash
git add -A
git commit -m "feat(mobile): add genre + mood-mix browse grid and detail screens"
```

---

### Task 12: Now-Playing star rating + playlist rename/delete

**Files:**
- Modify: `packages/mobile/app/now-playing.tsx`, `packages/mobile/app/(tabs)/home/index.tsx`

- [ ] **Step 1: Add the star control to Now-Playing**

In `app/now-playing.tsx`, under the title/artist (in the `ListHeaderComponent`), add the rating control for the CURRENT track. Track the current track from `queue.tracks[queue.index]`. Render `<StarRating rating10={current?.userRating ?? null} onRate={rate} />` centered, where `rate` calls `gateway.rateItem(current.serverId, current.id, r, token)` then `taste.recordTrackRating(...)` (optimistic local state for the displayed value). Pull `gateway`, `taste`, `token` from `useStore()`.

- [ ] **Step 2: Add rename/delete to Home playlist tiles**

In `app/(tabs)/home/index.tsx`, the "Your playlists" rail renders playlist cards. Add `onLongPress` to each playlist card that opens a small action menu (a `Modal` with Rename / Delete, mirroring the action-sheet row style). Rename → reuse `NewPlaylistDialog` (seed with the current name; on Create call `gateway.renamePlaylist(pl.id, pl.serverId, name, token)`). Delete → a confirm `Modal` → `gateway.deletePlaylist(pl.id, pl.serverId, token)`. After either, refetch the playlists list (re-run the existing playlists load).

NOTE: `Playlist` carries `serverId` (confirm against the model; if it's on a different field, adjust). `NewPlaylistDialog` can take an optional `initialName` prop — add it (default `""`) so it serves both create + rename.

- [ ] **Step 3: Verify + commit**

`pnpm check` → exit 0. On-device: rating the playing track persists + reflects in Top Rated; long-pressing a Home playlist offers Rename/Delete.

```bash
git add -A
git commit -m "feat(mobile): rate from Now-Playing + rename/delete playlists"
```

---

### Task 13: Queue editing — deps + draggable/swipeable Up Next

**Files:**
- Modify: `packages/mobile/package.json` (via `expo install`), `packages/mobile/babel.config.js`, the app entry (`packages/mobile/index.ts` or `app/_layout.tsx`), `packages/mobile/app/now-playing.tsx`

This task adds NATIVE dependencies → **the dev client must be rebuilt** (`expo prebuild` + `expo run:ios`); CI stays JS-only. It is LAST so all prior, verifiable work is committed first.

- [ ] **Step 1: Install the dependencies**

Run from `/Users/matjam/src/musex`:

```bash
pnpm --filter @musex/mobile exec expo install react-native-gesture-handler react-native-reanimated react-native-draggable-flatlist
```

This pins SDK-56-compatible versions and updates `package.json` + the lockfile.

- [ ] **Step 2: Configure babel for reanimated**

In `packages/mobile/babel.config.js`, add `react-native-reanimated/plugin` as the **LAST** entry of the `plugins` array (reanimated requires it to be last). If `babel.config.js` has no `plugins` array, add `plugins: ["react-native-reanimated/plugin"]`.

- [ ] **Step 3: Import gesture-handler at the app entry**

`react-native-gesture-handler` must be imported at the very top of the entry file. In `packages/mobile/index.ts` (or wherever `polyfills`/`expo-router/entry` are imported), add as the FIRST import line:

```ts
import "react-native-gesture-handler";
```

(Keep it before the existing polyfills/entry imports.)

- [ ] **Step 4: Replace the Up Next FlatList with a draggable + swipeable list**

In `packages/mobile/app/now-playing.tsx`, replace the Up Next `FlatList` with `DraggableFlatList` from `react-native-draggable-flatlist`. Wrap the screen root in `GestureHandlerRootView` (`flex: 1`). Each row: a drag handle (lucide `Menu`/`GripVertical`) bound to the library's `drag` callback, and a `Swipeable` (from `react-native-gesture-handler`) revealing a Remove action. On reorder end (`onDragEnd`), translate the new order into a `session.move(from, to)` call (compute from/to as ABSOLUTE queue indices = `baseIndex + 1 + listIndex`). On swipe-remove, call `session.removeAt(absIndex)`. Tap still `session.jumpTo(absIndex)`.

Because `DraggableFlatList` reorders its own `data`, drive it from the up-next slice and on `onDragEnd({ from, to })` call `session.move(baseIndex + 1 + from, baseIndex + 1 + to)` — the session is the source of truth; the subscribed state will re-render the list with the new queue order.

```tsx
import DraggableFlatList, { type RenderItemParams } from "react-native-draggable-flatlist";
import { GestureHandlerRootView, Swipeable } from "react-native-gesture-handler";
// … inside the component, wrap root in <GestureHandlerRootView style={{ flex: 1 }}> … </GestureHandlerRootView>
// Replace <FlatList data={upNext} …/> with:
<DraggableFlatList
  data={upNext}
  keyExtractor={(t, i) => `${t.id}-${i}`}
  onDragEnd={({ from, to }) => void session.move(baseIndex + 1 + from, baseIndex + 1 + to)}
  renderItem={({ item, getIndex, drag, isActive }: RenderItemParams<Track>) => {
    const pos = getIndex() ?? 0;
    const abs = baseIndex + 1 + pos;
    const b = artBaseFor(item.serverId);
    const u = b && token ? artUrl(b, item.thumb, token) : null;
    return (
      <Swipeable renderRightActions={() => (
        <Pressable onPress={() => void session.removeAt(abs)} style={{ backgroundColor: "#c0392b", justifyContent: "center", paddingHorizontal: 20 }}>
          <Trash2 color="#fff" size={20} />
        </Pressable>
      )}>
        <QueueRow track={item} art={u} abs={abs} session={session} onDrag={drag} active={isActive} />
      </Swipeable>
    );
  }}
/>
```

Extend `QueueRow` with an optional `onDrag`/`active` and a trailing drag handle: `<Pressable onLongPress={onDrag}><GripVertical color={theme.textDim} size={18} /></Pressable>`.

- [ ] **Step 5: Rebuild the dev client + on-device verification (manual)**

The implementer cannot run this in CI. Document that the user must run:

```bash
pnpm --filter @musex/mobile exec expo prebuild --platform ios
pnpm --filter @musex/mobile exec expo run:ios
```

then verify: Up Next drag-reorder works, swipe-left reveals Remove, tap still jumps. (This is user on-device acceptance.)

- [ ] **Step 6: Verify the JS bar + commit**

`pnpm check` → exit 0 (typecheck + biome + tests; the native list isn't exercised by CI). Then commit:

```bash
git add -A
git commit -m "feat(mobile): drag-reorder + swipe-remove the Up Next queue"
```

---

### Task 14: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm no gateway stubs remain**

Run from `/Users/matjam/src/musex`:

```bash
grep -n "not implemented in Phase 1" packages/mobile/src/adapters/plex-gateway.ts
```

Expected: ONLY `listAllTracksPage` remains (intentionally out of scope). `search`, `rateItem`, `getUserRating`, and the five playlist methods must NOT appear.

- [ ] **Step 2: Full check**

`pnpm check` → exit 0 across core + desktop (both tsc passes) + mobile + biome + all tests.

- [ ] **Step 3: No commit** unless a straggler fix was needed.

---

## Self-Review

**Spec coverage:**
- Search → Tasks 3 (gateway) + 10 (UI) ✓
- Ratings write-path + star UI → Tasks 1 (rating.ts) + 2 (rateItem/getUserRating) + 5 (taste passthrough) + 6 (StarRating) + 8 (sheet) + 12 (Now-Playing) ✓
- Playlist CRUD → Tasks 4 (gateway) + 7 (sheets) + 8 (remove row) + 12 (rename/delete) ✓
- Action sheet (spine) → Tasks 8 + 9 ✓
- Search tab nav (4 tabs) → Task 10 ✓
- Genres + mood mixes → Task 11 ✓
- Queue reorder/remove → Task 13 ✓
- Core "only rating.ts" → Task 1 is the sole core change ✓
- 8 gateway stubs (search, rateItem, getUserRating, 5 playlist) → Tasks 2/3/4; `listAllTracksPage` left unimplemented per spec, verified in Task 14 ✓
- Native-dep dev-client rebuild note → Task 13 Step 5 ✓

**Placeholder scan:** No TBD/"handle edge cases"/"similar to Task N". The few "confirm the real exported name / adjust to the real shape" notes (mood-mixes/genres APIs, Playlist field names, lucide icon availability) are explicit verification instructions with a named fallback, not hidden work — the implementer reads the actual export in the referenced file. The `BrowseGrid` ordering dependency between Tasks 10↔11 is called out with a stub fallback.

**Type/symbol consistency:** Gateway method signatures match the quoted core port exactly (`rateItem(serverId, itemId, rating, token)`, `createPlaylist(library, title, trackIds, token): Promise<Playlist>`, etc.). Session calls use the confirmed public names (`playTrackNext`, `enqueueEnd`, `move`, `removeAt`, `jumpTo`). `StarRating` prop is `onRate` (ASCII — flagged in Task 6). `rating10`/`starsFromRating10`/`rating10FromStars` are used consistently. `recordTrackRating(t, rating10)` matches the core `TasteProfile` signature.
