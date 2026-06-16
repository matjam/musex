# Library Browse v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flat segmented library browse (Artists/Albums/Tracks) with 2-column tiles + an A–Z fast-scroll bar, drill-down preserved, and Play/Shuffle/Add-to-Queue action bars on album & artist screens.

**Architecture:** All in `packages/mobile`. Implement the stubbed gateway methods + a new `listArtistTracks` (Plex `allLeaves`). A pure `az-index` helper drives the A–Z scrubber. New reusable UI: `Tile`, `SegmentedControl`, `AZScrubber`, `ActionBar`. The library `index.tsx` becomes a segmented tiled browse; `albums.tsx`/`tracks.tsx` gain action bars.

**Tech Stack:** Expo SDK 56, expo-router, `@musex/core` (`PlaybackSession`, `plexSort`, `buildQueue`), React Native `FlatList` (`numColumns`, `getItemLayout`, `scrollToIndex`).

**Spec:** `docs/superpowers/specs/2026-06-16-library-browse-v2-design.md`

**Conventions:** `git add -A`, conventional commits, commit per task, **DO NOT push** (controller pushes after review). `pnpm exec biome check --write packages/mobile` before checking; bar = `pnpm check` EXIT 0. Pure logic is unit-tested (TDD); UI screens are verified manually. Branch: `feature/mobile-ui-phase2`.

---

## File structure

```
packages/mobile/src/
  adapters/plex-gateway.ts        # MODIFY: implement listAllAlbums/listAllTracks; add listArtistTracks
  adapters/plex-gateway.test.ts   # MODIFY: tests for the three
  logic/az-index.ts               # NEW pure: letterFor + buildLetterIndex (+ test)
  ui/Tile.tsx                     # NEW: art + label + sublabel tile (fixed width)
  ui/SegmentedControl.tsx         # NEW: Artists/Albums/Tracks switch
  ui/AZScrubber.tsx               # NEW: vertical A–Z bar, drag-to-scrub + bubble
  ui/ActionBar.tsx                # NEW: Play / Shuffle / Add to Queue
packages/mobile/app/(tabs)/library/
  index.tsx                       # MODIFY: artists-list -> segmented tiled browse + scrubber
  albums.tsx                      # MODIFY: artist's albums as tiles + ActionBar (artist tracks)
  tracks.tsx                      # MODIFY: art header + ActionBar (album tracks) + track list
```

---

## Task 1: Gateway — listAllAlbums / listAllTracks / listArtistTracks (TDD)

**Files:** Modify `packages/mobile/src/adapters/plex-gateway.ts`, `packages/mobile/src/adapters/plex-gateway.test.ts`.

Context: Phase 1 stubbed `listAllAlbums`/`listAllTracks` to throw. Implement them with raw Plex queries (`type=9` albums, `type=10` tracks, `sort=${plexSort(sort)}`), and add `listArtistTracks` (`/library/metadata/{id}/allLeaves`). All use the existing `parseAlbums`/`parseTracks` + the connection cache (`requireBase`). `plexSort` comes from `@musex/core`.

- [ ] **Step 1: Add the failing tests** (append to `plex-gateway.test.ts`)

```ts
it("listAllAlbums queries type=9 with sort and parses", async () => {
  const fetchFn = vi.fn(async () =>
    jsonResponse({ MediaContainer: { Metadata: [{ ratingKey: "10", title: "Funeral" }] } }),
  );
  const gw = new PlexGatewayImpl(fetchFn, "CID");
  const lib = { id: "3", serverId: "srv", serverName: "T", title: "Music", type: "music" as const };
  await gw.listMusicLibraries(server, "TOK"); // prime base url
  const albums = await gw.listAllAlbums(lib, "title", "TOK");
  expect(albums[0]).toMatchObject({ id: "10", title: "Funeral" });
  const urls = fetchFn.mock.calls.map((c) => String((c as unknown[])[0]));
  expect(urls.some((u) => u.includes("/library/sections/3/all") && u.includes("type=9"))).toBe(true);
});

it("listAllTracks queries type=10", async () => {
  const fetchFn = vi.fn(async () =>
    jsonResponse({ MediaContainer: { Metadata: [] } }),
  );
  const gw = new PlexGatewayImpl(fetchFn, "CID");
  const lib = { id: "3", serverId: "srv", serverName: "T", title: "Music", type: "music" as const };
  await gw.listMusicLibraries(server, "TOK");
  await gw.listAllTracks(lib, "title", "TOK");
  const urls = fetchFn.mock.calls.map((c) => String((c as unknown[])[0]));
  expect(urls.some((u) => u.includes("type=10"))).toBe(true);
});

it("listArtistTracks queries allLeaves and parses", async () => {
  const fetchFn = vi.fn(async () =>
    jsonResponse({
      MediaContainer: {
        Metadata: [
          { ratingKey: "100", title: "Song", grandparentTitle: "BoC", Media: [{ Part: [{ id: "9", key: "/p/9" }] }] },
        ],
      },
    }),
  );
  const gw = new PlexGatewayImpl(fetchFn, "CID");
  const lib = { id: "3", serverId: "srv", serverName: "T", title: "Music", type: "music" as const };
  await gw.listMusicLibraries(server, "TOK");
  const tracks = await gw.listArtistTracks("1", lib, "TOK");
  expect(tracks[0]).toMatchObject({ id: "100", artistName: "BoC" });
  const urls = fetchFn.mock.calls.map((c) => String((c as unknown[])[0]));
  expect(urls.some((u) => u.includes("/library/metadata/1/allLeaves"))).toBe(true);
});
```

- [ ] **Step 2: Run — expect FAIL** (the stubs throw / method missing)

Run: `pnpm --filter @musex/mobile exec vitest run src/adapters/plex-gateway.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement** — replace the throwing `listAllAlbums`/`listAllTracks` stubs and add `listArtistTracks`. Add the import at the top (with the other `@musex/core` import):

```ts
import { PlexAuthError, plexSort } from "@musex/core";
```
Replace the two stubs and add the new method (place near the other browse methods):
```ts
  async listAllAlbums(library: Library, sort: LibrarySort, token: string): Promise<Album[]> {
    const base = this.requireBase(library.serverId);
    const json = await this.getJson(
      `${base}/library/sections/${library.id}/all?type=9&sort=${plexSort(sort)}`,
      token,
    );
    return parseAlbums(json, library.serverId);
  }

  async listAllTracks(library: Library, sort: LibrarySort, token: string): Promise<Track[]> {
    const base = this.requireBase(library.serverId);
    const json = await this.getJson(
      `${base}/library/sections/${library.id}/all?type=10&sort=${plexSort(sort)}`,
      token,
    );
    return parseTracks(json, library.serverId);
  }

  /** All tracks for an artist (Plex allLeaves). Mobile-only — feeds the Artist
   *  action bar; not part of the core PlexGateway port. */
  async listArtistTracks(artistId: string, library: Library, token: string): Promise<Track[]> {
    const base = this.requireBase(library.serverId);
    const json = await this.getJson(`${base}/library/metadata/${artistId}/allLeaves`, token);
    return parseTracks(json, library.serverId);
  }
```
Remove the old `listAllAlbums`/`listAllTracks` throwing stubs (in the "not implemented" block). `plexSort` is exported from `@musex/core` (`logic/library-sort`).

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @musex/mobile exec vitest run src/adapters/plex-gateway.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @musex/mobile run typecheck` (PASS).
```bash
git add -A
git commit -m "feat(mobile): implement listAllAlbums/listAllTracks + listArtistTracks"
```

---

## Task 2: `az-index.ts` — pure A–Z index helper (TDD)

**Files:** Create `packages/mobile/src/logic/az-index.ts`, `packages/mobile/src/logic/az-index.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { buildLetterIndex, letterFor } from "./az-index";

describe("letterFor", () => {
  it("uppercases the first letter", () => {
    expect(letterFor("arcade fire")).toBe("A");
    expect(letterFor("Zaz")).toBe("Z");
  });
  it("maps digits, symbols, accents and empty to #", () => {
    expect(letterFor("2Pac")).toBe("#");
    expect(letterFor("")).toBe("#");
    expect(letterFor("  ")).toBe("#");
    expect(letterFor("Éclair")).toBe("#");
  });
});

describe("buildLetterIndex", () => {
  it("maps each present letter to the first index in a sorted list", () => {
    const items = ["ABBA", "Air", "Beck", "Zaz"];
    const { letters, indexOf } = buildLetterIndex(items, (s) => s);
    expect(letters).toEqual(["A", "B", "Z"]);
    expect(indexOf).toEqual({ A: 0, B: 2, Z: 3 });
  });
  it("orders # first when present", () => {
    const items = ["2Pac", "ABBA"];
    const { letters } = buildLetterIndex(items, (s) => s);
    expect(letters).toEqual(["#", "A"]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @musex/mobile exec vitest run src/logic/az-index.test.ts`
Expected: FAIL — cannot find `./az-index`.

- [ ] **Step 3: Implement**

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

- [ ] **Step 4: Run — expect PASS**; **Step 5: Commit**

```bash
pnpm --filter @musex/mobile exec vitest run src/logic/az-index.test.ts
git add -A && git commit -m "feat(mobile): pure A–Z index helper"
```

---

## Task 3: `Tile` + `SegmentedControl`

**Files:** Create `packages/mobile/src/ui/Tile.tsx`, `packages/mobile/src/ui/SegmentedControl.tsx`.

- [ ] **Step 1: `Tile.tsx`**

```tsx
import { Pressable, Text, View } from "react-native";
import { AlbumArt } from "./AlbumArt";
import { theme } from "./theme";

export function Tile({
  art,
  size,
  label,
  sublabel,
  circular = false,
  onPress,
}: {
  art: string | null;
  size: number;
  label: string;
  sublabel?: string;
  circular?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={{ width: size, padding: 6 }}>
      <View style={{ alignItems: circular ? "center" : "stretch" }}>
        <AlbumArt url={art} size={size - 12} circular={circular} />
      </View>
      <Text numberOfLines={1} style={{ color: theme.text, fontSize: 13, marginTop: 6 }}>
        {label}
      </Text>
      {sublabel ? (
        <Text numberOfLines={1} style={{ color: theme.textDim, fontSize: 11 }}>
          {sublabel}
        </Text>
      ) : null}
    </Pressable>
  );
}
```

- [ ] **Step 2: `SegmentedControl.tsx`**

```tsx
import { Pressable, Text, View } from "react-native";
import { theme } from "./theme";

export function SegmentedControl({
  segments,
  value,
  onChange,
}: {
  segments: string[];
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: theme.surface,
        borderRadius: 8,
        padding: 2,
        margin: theme.space(1.5),
      }}
    >
      {segments.map((s) => {
        const on = s === value;
        return (
          <Pressable
            key={s}
            onPress={() => onChange(s)}
            style={{
              flex: 1,
              paddingVertical: 7,
              borderRadius: 6,
              backgroundColor: on ? theme.border : "transparent",
              alignItems: "center",
            }}
          >
            <Text style={{ color: on ? theme.text : theme.textDim, fontSize: 13 }}>{s}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
```

- [ ] **Step 3: biome + typecheck + commit**

```bash
pnpm exec biome check --write packages/mobile && pnpm --filter @musex/mobile run typecheck
git add -A && git commit -m "feat(mobile): Tile + SegmentedControl components"
```

---

## Task 4: `AZScrubber`

**Files:** Create `packages/mobile/src/ui/AZScrubber.tsx`.

Context: a thin vertical bar of letters on the right. While the finger moves, it computes which letter the touch is over (by fractional position) and calls `onScrubTo(letter)`; it also shows a large bubble with the active letter. The PARENT owns the FlatList + the letter→index map and does the actual scroll.

- [ ] **Step 1: Implement**

```tsx
import { useRef, useState } from "react";
import { type GestureResponderEvent, type LayoutChangeEvent, Text, View } from "react-native";
import { theme } from "./theme";

export function AZScrubber({
  letters,
  onScrubTo,
}: {
  letters: string[];
  onScrubTo: (letter: string) => void;
}) {
  const heightRef = useRef(0);
  const [active, setActive] = useState<string | null>(null);

  function pick(e: GestureResponderEvent) {
    if (letters.length === 0 || heightRef.current === 0) return;
    const y = e.nativeEvent.locationY;
    const idx = Math.min(letters.length - 1, Math.max(0, Math.floor((y / heightRef.current) * letters.length)));
    const letter = letters[idx];
    if (letter && letter !== active) {
      setActive(letter);
      onScrubTo(letter);
    }
  }

  return (
    <View
      onLayout={(e: LayoutChangeEvent) => {
        heightRef.current = e.nativeEvent.layout.height;
      }}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderGrant={pick}
      onResponderMove={pick}
      onResponderRelease={() => setActive(null)}
      style={{
        position: "absolute",
        right: 0,
        top: 0,
        bottom: 0,
        width: 22,
        justifyContent: "space-between",
        alignItems: "center",
        paddingVertical: 8,
      }}
    >
      {letters.map((l) => (
        <Text key={l} style={{ fontSize: 9, color: l === active ? theme.accent : theme.textDim }}>
          {l}
        </Text>
      ))}
      {active ? (
        <View
          style={{
            position: "absolute",
            right: 30,
            top: "45%",
            width: 48,
            height: 48,
            borderRadius: 12,
            backgroundColor: theme.accent,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ color: "#000", fontWeight: "800", fontSize: 24 }}>{active}</Text>
        </View>
      ) : null}
    </View>
  );
}
```

- [ ] **Step 2: biome + typecheck + commit**

```bash
pnpm exec biome check --write packages/mobile && pnpm --filter @musex/mobile run typecheck
git add -A && git commit -m "feat(mobile): AZScrubber (drag-to-jump + letter bubble)"
```

---

## Task 5: `ActionBar`

**Files:** Create `packages/mobile/src/ui/ActionBar.tsx`.

Context: three equal icon+label buttons. `getTracks` returns the track set (album tracks, or all artist tracks). Maps to `PlaybackSession`: Play → `loadQueue(buildQueue(tracks, 0))`; Shuffle → `loadQueueShuffled(tracks)`; Add to Queue → `enqueueEnd(tracks)`. Disables briefly while fetching.

- [ ] **Step 1: Implement**

```tsx
import { type PlaybackSession, type Track, buildQueue } from "@musex/core";
import { ListPlus, Play, Shuffle } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { theme } from "./theme";

export function ActionBar({
  session,
  getTracks,
}: {
  session: PlaybackSession;
  getTracks: () => Track[] | Promise<Track[]>;
}) {
  const [busy, setBusy] = useState(false);

  async function run(action: (tracks: Track[]) => void | Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      const tracks = await getTracks();
      if (tracks.length) await action(tracks);
    } finally {
      setBusy(false);
    }
  }

  const Btn = ({ icon, label, onPress }: { icon: React.ReactNode; label: string; onPress: () => void }) => (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={{ flex: 1, alignItems: "center", gap: 4, paddingVertical: 8, opacity: busy ? 0.5 : 1 }}
    >
      {icon}
      <Text style={{ color: theme.textDim, fontSize: 10 }}>{label}</Text>
    </Pressable>
  );

  return (
    <View style={{ flexDirection: "row", paddingHorizontal: theme.space(1) }}>
      {busy ? (
        <View style={{ flex: 1, alignItems: "center", paddingVertical: 8 }}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <>
          <Btn
            icon={<Play color={theme.accent} size={20} />}
            label="Play"
            onPress={() => run((t) => session.loadQueue(buildQueue(t, 0)))}
          />
          <Btn
            icon={<Shuffle color={theme.text} size={20} />}
            label="Shuffle"
            onPress={() => run((t) => session.loadQueueShuffled(t))}
          />
          <Btn
            icon={<ListPlus color={theme.text} size={20} />}
            label="Add to Queue"
            onPress={() => run((t) => session.enqueueEnd(t))}
          />
        </>
      )}
    </View>
  );
}
```
Note: confirm `loadQueue`, `loadQueueShuffled(tracks, repeat?)`, `enqueueEnd(tracks)` exist on `PlaybackSession` (they do — `packages/core/src/playback/playback-session.ts`). lucide `ListPlus`/`Play`/`Shuffle` exist in `lucide-react-native`.

- [ ] **Step 2: biome + typecheck + commit**

```bash
pnpm exec biome check --write packages/mobile && pnpm --filter @musex/mobile run typecheck
git add -A && git commit -m "feat(mobile): ActionBar (Play/Shuffle/Add to Queue)"
```

---

## Task 6: Library flat browse — `index.tsx`

**Files:** Modify `packages/mobile/app/(tabs)/library/index.tsx`.

Context: replace the artists-only list with a `SegmentedControl` (Artists / Albums / Tracks) over a 2-col tiled `FlatList` + `AZScrubber`. Each segment loads its data, builds the A–Z index, and renders tiles. `getItemLayout` (fixed row height) makes `scrollToIndex` reliable for the scrubber.

- [ ] **Step 1: Implement**

```tsx
import type { Album, Artist, Track } from "@musex/core";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, useWindowDimensions, View } from "react-native";
import { artUrl } from "../../../src/logic/art-url";
import { buildLetterIndex, letterFor } from "../../../src/logic/az-index";
import { useStore } from "../../../src/state/store";
import { AZScrubber } from "../../../src/ui/AZScrubber";
import { SegmentedControl } from "../../../src/ui/SegmentedControl";
import { theme } from "../../../src/ui/theme";
import { Tile } from "../../../src/ui/Tile";

type Segment = "Artists" | "Albums" | "Tracks";
type Item =
  | { kind: "artist"; data: Artist }
  | { kind: "album"; data: Album }
  | { kind: "track"; data: Track };

export default function LibraryBrowse() {
  const { state, gateway, artBaseFor, token, playTracks } = useStore();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [segment, setSegment] = useState<Segment>("Artists");
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const listRef = useRef<FlatList<Item>>(null);

  const tileSize = (width - 22) / 2; // 22 = scrubber gutter
  const ROW_H = tileSize + 36; // art + labels + padding

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!state.library || !state.token) return;
      setLoading(true);
      let next: Item[] = [];
      if (segment === "Artists") {
        next = (await gateway.listArtists(state.library, state.token)).map((d) => ({ kind: "artist", data: d }));
      } else if (segment === "Albums") {
        next = (await gateway.listAllAlbums(state.library, "title", state.token)).map((d) => ({ kind: "album", data: d }));
      } else {
        next = (await gateway.listAllTracks(state.library, "title", state.token)).map((d) => ({ kind: "track", data: d }));
      }
      if (alive) {
        setItems(next);
        setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [segment, state.library, state.token, gateway]);

  const nameOf = (it: Item) => (it.kind === "artist" ? it.data.name : it.data.title);
  const { letters, indexOf } = useMemo(() => buildLetterIndex(items, nameOf), [items]);

  function scrubTo(letter: string) {
    const idx = indexOf[letter];
    if (idx != null) listRef.current?.scrollToIndex({ index: idx, viewPosition: 0, animated: false });
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <SegmentedControl segments={["Artists", "Albums", "Tracks"]} value={segment} onChange={(s) => setSegment(s as Segment)} />
      {loading ? (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <FlatList
            ref={listRef}
            data={items}
            numColumns={2}
            keyExtractor={(it, i) => `${it.kind}-${it.data.id}-${i}`}
            getItemLayout={(_d, index) => ({ length: ROW_H, offset: ROW_H * Math.floor(index / 2), index })}
            onScrollToIndexFailed={(info) => {
              listRef.current?.scrollToOffset({ offset: ROW_H * Math.floor(info.index / 2), animated: false });
            }}
            renderItem={({ item }) => {
              const base = artBaseFor(item.data.serverId);
              const art = base && token ? artUrl(base, item.data.thumb, token) : null;
              if (item.kind === "artist") {
                return (
                  <Tile art={art} size={tileSize} label={item.data.name} circular
                    onPress={() => router.push({ pathname: "/(tabs)/library/albums", params: { artistId: item.data.id } })} />
                );
              }
              if (item.kind === "album") {
                return (
                  <Tile art={art} size={tileSize} label={item.data.title} sublabel={item.data.artistId ? undefined : undefined}
                    onPress={() => router.push({ pathname: "/(tabs)/library/tracks", params: { albumId: item.data.id } })} />
                );
              }
              return (
                <Tile art={art} size={tileSize} label={item.data.title} sublabel={item.data.artistName}
                  onPress={() => void playTracks([item.data], 0)} />
              );
            }}
          />
          <AZScrubber letters={letters} onScrubTo={scrubTo} />
        </View>
      )}
    </View>
  );
}
```
Note: album sublabel (artist name) isn't on the `Album` model directly (it has `artistId`, not artist name) — leave album sublabel empty for v1 (shown above as undefined), or fetch artist names later. Track tile sublabel uses `artistName` (present on `Track`). `playTracks([track],0)` plays the single track (defined on the store). `letterFor` is imported for parity though `buildLetterIndex` uses it internally — if biome flags it unused, drop the `letterFor` import.

- [ ] **Step 2: biome + typecheck + commit**

```bash
pnpm exec biome check --write packages/mobile && pnpm --filter @musex/mobile run typecheck
git add -A && git commit -m "feat(mobile): segmented tiled library browse + A–Z scrubber"
```

---

## Task 7: Action bars on Artist (`albums.tsx`) and Album (`tracks.tsx`)

**Files:** Modify `packages/mobile/app/(tabs)/library/albums.tsx`, `packages/mobile/app/(tabs)/library/tracks.tsx`.

- [ ] **Step 1: `albums.tsx`** — artist's albums as tiles + ActionBar over all the artist's tracks

```tsx
import type { Album } from "@musex/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, useWindowDimensions, View } from "react-native";
import { artUrl } from "../../../src/logic/art-url";
import { useStore } from "../../../src/state/store";
import { ActionBar } from "../../../src/ui/ActionBar";
import { theme } from "../../../src/ui/theme";
import { Tile } from "../../../src/ui/Tile";

export default function ArtistAlbums() {
  const { artistId } = useLocalSearchParams<{ artistId: string }>();
  const { state, gateway, session, artBaseFor, token } = useStore();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const tileSize = (width - 8) / 2;

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
  }, [state.library, state.token, artistId, gateway]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  return (
    <FlatList
      style={{ backgroundColor: theme.bg }}
      data={albums}
      numColumns={2}
      keyExtractor={(a) => a.id}
      ListHeaderComponent={
        <ActionBar
          session={session}
          getTracks={() =>
            state.library && state.token && artistId
              ? gateway.listArtistTracks(artistId, state.library, state.token)
              : []
          }
        />
      }
      renderItem={({ item }) => {
        const base = artBaseFor(item.serverId);
        const art = base && token ? artUrl(base, item.thumb, token) : null;
        return (
          <Tile art={art} size={tileSize} label={item.title} sublabel={item.year ? String(item.year) : undefined}
            onPress={() => router.push({ pathname: "/(tabs)/library/tracks", params: { albumId: item.id } })} />
        );
      }}
    />
  );
}
```

- [ ] **Step 2: `tracks.tsx`** — art header + ActionBar (album tracks) + track list

```tsx
import type { Track } from "@musex/core";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { artUrl } from "../../../src/logic/art-url";
import { useStore } from "../../../src/state/store";
import { ActionBar } from "../../../src/ui/ActionBar";
import { AlbumArt } from "../../../src/ui/AlbumArt";
import { theme } from "../../../src/ui/theme";

export default function AlbumTracks() {
  const { albumId } = useLocalSearchParams<{ albumId: string }>();
  const { state, gateway, session, playTracks, artBaseFor, token } = useStore();
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
  }, [state.library, state.token, albumId, gateway]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  const first = tracks[0];
  const base = first ? artBaseFor(first.serverId) : null;
  const headerArt = first && base && token ? artUrl(base, first.thumb, token) : null;

  return (
    <FlatList
      style={{ backgroundColor: theme.bg }}
      data={tracks}
      keyExtractor={(t) => t.id}
      ListHeaderComponent={
        <View>
          <View style={{ alignItems: "center", paddingVertical: theme.space(2) }}>
            <AlbumArt url={headerArt} size={200} />
            {first?.albumTitle ? (
              <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700", marginTop: 10 }}>{first.albumTitle}</Text>
            ) : null}
            {first ? <Text style={{ color: theme.textDim }}>{first.artistName}</Text> : null}
          </View>
          <ActionBar session={session} getTracks={() => tracks} />
        </View>
      }
      renderItem={({ item, index }) => (
        <Pressable
          onPress={() => void playTracks(tracks, index)}
          style={{ flexDirection: "row", gap: 12, padding: theme.space(1.5), borderBottomWidth: 1, borderBottomColor: theme.border }}
        >
          <Text style={{ color: theme.textDim, width: 22, textAlign: "right" }}>{item.trackNumber ?? index + 1}</Text>
          <Text style={{ color: theme.text, fontSize: 16, flex: 1 }} numberOfLines={1}>{item.title}</Text>
        </Pressable>
      )}
    />
  );
}
```

- [ ] **Step 3: biome + typecheck + commit**

```bash
pnpm exec biome check --write packages/mobile && pnpm --filter @musex/mobile run typecheck
git add -A && git commit -m "feat(mobile): action bars on artist + album screens; album tiles"
```

---

## Task 8: Full check + on-device verification + docs

- [ ] **Step 1: Full check** — `pnpm check` (EXIT 0; az-index + gateway tests pass).
- [ ] **Step 2: Build/run** — `pnpm --filter @musex/mobile exec expo run:ios > /tmp/run.log 2>&1 &` (no native deps added → fast incremental; reload suffices if Metro is up). Wait for `iOS Bundled`.
- [ ] **Step 3: Manual matrix:**
  1. Library tab: segmented Artists/Albums/Tracks switch; each a 2-col tile grid with art.
  2. A–Z bar: drag down → list jumps to the letter; green bubble shows the letter.
  3. Drill-down: tap artist tile → their album tiles; tap album → tracks; tap a track tile (in flat Tracks) → it plays.
  4. Action bars: on an album, Play / Shuffle / Add to Queue work; on an artist, the bar plays/shuffles/adds ALL their tracks.
  5. (Big library) All Tracks loads (may take a moment) and the scrubber jumps correctly.
- [ ] **Step 4: Update `CLAUDE.md`** — extend the mobile Phase 2 note: segmented flat browse (`index.tsx`), `Tile`/`SegmentedControl`/`AZScrubber`/`ActionBar`, `az-index` helper, the un-stubbed `listAllAlbums`/`listAllTracks` + new `listArtistTracks` (allLeaves), action-bar → `loadQueue`/`loadQueueShuffled`/`enqueueEnd`, and the A–Z `scrollToIndex`+`getItemLayout` approach (+ All-Tracks-size caveat).
- [ ] **Step 5: Commit** — `git add -A && git commit -m "docs: record Library Browse v2"`.

---

## Self-review (plan author)

**Spec coverage:** Flat segmented browse + 2-col tiles + A–Z scrubber → Tasks 2/3/4/6. Drill-down preserved → Task 6 (artist tile → albums) + Task 7. Action bars (album + artist) → Task 5/7. Gateway listAllAlbums/listAllTracks/listArtistTracks → Task 1. `az-index` + gateway tested → Tasks 1/2. Manual + docs → Task 8. Out-of-scope (per-row actions, All-Tracks pagination) respected.

**Placeholder scan:** No "TBD/handle edge cases." Honest notes remain (album sublabel left empty for v1 since `Album` has no artist name; `onScrollToIndexFailed` fallback; confirm lucide/PlaybackSession names) — each names the reason.

**Type consistency:** `listAllAlbums(library, sort, token)`/`listAllTracks(...)` match the `PlexGateway` interface; `listArtistTracks(artistId, library, token)` defined Task 1, used Task 7. `buildLetterIndex(items, keyFn)`/`letterFor` defined Task 2, used Task 6. `Tile({art,size,label,sublabel?,circular?,onPress})` defined Task 3, used Tasks 6/7. `AZScrubber({letters,onScrubTo})` Task 4 → Task 6. `ActionBar({session,getTracks})` Task 5 → Task 7. PlaybackSession `loadQueue`/`loadQueueShuffled`/`enqueueEnd`/`buildQueue` verified against core. `playTracks(tracks,index)` is the existing store method.
