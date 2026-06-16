# Mobile UI Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Phase 1 browse/play proof into a real music UI — album art, tab nav, a fullscreen Now Playing with an inline queue, background audio + lock-screen controls — and fix the overlapping-tracks bug.

**Architecture:** All in `packages/mobile`. expo-router `Tabs` (Library + Settings) with a custom `tabBar` hosting a persistent mini-player that opens a `now-playing` modal route. Album art via a pure `artUrl` helper + an `<AlbumArt>` (`expo-image`) component. The `ExpoAudioEngine` gains background-audio config, a lock-screen `setNowPlaying`, and the bug fix (stop before releasing the old player). The store pushes now-playing metadata on track change.

**Tech Stack:** Expo SDK 56, expo-router 56, `expo-image`, `@react-native-community/slider`, `expo-audio` (lock-screen API), `@musex/core` `PlaybackSession`.

**Spec:** `docs/superpowers/specs/2026-06-16-mobile-ui-phase2-design.md`

**Conventions:** `git add -A`, conventional commits, commit per task, DO NOT push (controller pushes after review). Run `pnpm check` before each commit. Always `expo install <pkg>` (never hand-pin). Biome lints `.ts/.tsx/.json`; `_`-prefixed unused params are ignored. UI screens are verified manually on the simulator/device (project convention — core/logic is the unit-test target); pure logic IS unit-tested.

---

## File structure

```
packages/mobile/
  src/
    logic/art-url.ts              # NEW pure: thumb -> loadable Plex art URL (+ test)
    adapters/audio-engine.ts      # MODIFY: bg audio + lock screen + bug fix + setNowPlaying
    state/store.tsx               # MODIFY: push now-playing metadata; expose artBase/token
    ui/AlbumArt.tsx               # NEW: expo-image wrapper (square/circular + placeholder)
    ui/MiniPlayer.tsx             # MODIFY: art + tap-to-expand to /now-playing
    ui/theme.ts                   # (unchanged)
  app/
    _layout.tsx                   # MODIFY: root Stack = (tabs) group + now-playing modal
    index.tsx                     # MODIFY: gate -> /(tabs)/library or /sign-in
    sign-in.tsx                   # (unchanged; still a root route)
    (tabs)/_layout.tsx            # NEW: Tabs(library, settings) + custom tabBar w/ MiniPlayer
    (tabs)/library/_layout.tsx    # NEW: Stack(index, albums, tracks)
    (tabs)/library/index.tsx      # MOVED from app/artists.tsx (+ circular art) — also picker logic
    (tabs)/library/albums.tsx     # MOVED from app/albums.tsx (-> 2-col cover grid)
    (tabs)/library/tracks.tsx     # MOVED from app/tracks.tsx (+ album-art header)
    (tabs)/settings.tsx           # NEW: sign out, server/library, version
    now-playing.tsx               # NEW: fullscreen modal — art, scrubber, transport, Up Next
  app/picker.tsx                  # KEEP (server/library picker; reached pre-tabs)
```

Note: Phase 1 had `app/{artists,albums,tracks,picker}.tsx`. This plan moves the browse trio under `app/(tabs)/library/` and adds the tab group. `picker` stays a root route (shown after sign-in when multiple servers/libraries, before entering the tabs).

---

## Task 1: Install deps (expo-image, slider)

**Files:** Modify `packages/mobile/package.json` + lockfile.

- [ ] **Step 1: Install via expo (SDK-correct versions)**

Run (repo root):
```bash
pnpm --filter @musex/mobile exec expo install expo-image @react-native-community/slider
```

- [ ] **Step 2: Verify check still green**

Run: `pnpm check`
Expected: EXIT 0 (no source uses them yet; lockfile updated). If `pnpm install --frozen-lockfile` parity matters, the lockfile change is committed in Step 3.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(mobile): add expo-image + slider for Phase 2 UI"
```

---

## Task 2: `art-url.ts` — pure album-art URL helper (TDD)

**Files:** Create `packages/mobile/src/logic/art-url.ts`, `packages/mobile/src/logic/art-url.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { artUrl } from "./art-url";

describe("artUrl", () => {
  it("builds a tokenized Plex art URL from a thumb path", () => {
    expect(artUrl("https://pms.example:32400", "/library/metadata/10/thumb/123", "TOK")).toBe(
      "https://pms.example:32400/library/metadata/10/thumb/123?X-Plex-Token=TOK",
    );
  });
  it("returns null when thumb is missing", () => {
    expect(artUrl("https://pms.example:32400", undefined, "TOK")).toBeNull();
    expect(artUrl("https://pms.example:32400", "", "TOK")).toBeNull();
  });
  it("encodes the token", () => {
    expect(artUrl("https://b", "/t", "a b")).toBe("https://b/t?X-Plex-Token=a%20b");
  });
});
```

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm --filter @musex/mobile exec vitest run src/logic/art-url.test.ts`
Expected: FAIL — cannot find `./art-url`.

- [ ] **Step 3: Implement**

```ts
/** Builds a loadable Plex artwork URL from a `thumb` path (as parsed from PMS).
 *  Returns null when there is no thumb. Mirrors logic/stream-ref's direct URL. */
export function artUrl(
  serverBaseUrl: string,
  thumb: string | undefined,
  token: string,
): string | null {
  if (!thumb) return null;
  return `${serverBaseUrl}${thumb}?X-Plex-Token=${encodeURIComponent(token)}`;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @musex/mobile exec vitest run src/logic/art-url.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(mobile): pure album-art URL helper"
```

---

## Task 3: `ExpoAudioEngine` — bug fix + background audio + lock-screen metadata

**Files:** Modify `packages/mobile/src/adapters/audio-engine.ts`.

Context: three changes. (1) **Bug fix** — `teardownPlayer()` releases the old player with `remove()` but doesn't stop it first, so a rapid second track overlaps; **pause before remove**. (2) **Background audio** — `init()` sets `shouldPlayInBackground: true` and `interruptionMode: "doNotMix"` (required for lock-screen). (3) **Lock screen** — a mobile-only `setNowPlaying(meta)` driving `expo-audio`'s `setActiveForLockScreen` / `updateLockScreenMetadata` (the core `PlaybackEngine` port stays unchanged; the store calls this on track change). Verified against installed `expo-audio` typings: `AudioPlayer.setActiveForLockScreen(active, metadata?, options?)`, `updateLockScreenMetadata(metadata)`, `clearLockScreenControls()`, `AudioMetadata` ({ title, artist, album, artwork }).

- [ ] **Step 1: Update `init()` for background + lock-screen-compatible audio mode**

Replace the existing `init()`:
```ts
  async init(): Promise<void> {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: "doNotMix",
    });
  }
```

- [ ] **Step 2: Fix `teardownPlayer()` — stop before releasing (the overlap bug)**

```ts
  private teardownPlayer(): void {
    this.sub?.remove();
    this.sub = null;
    // Pause BEFORE remove: expo-audio's remove() doesn't reliably halt the
    // native player synchronously, so a rapid next-load otherwise overlaps.
    try {
      this.player?.pause();
    } catch {
      // player may already be released; ignore
    }
    this.player?.remove();
    this.player = null;
  }
```

- [ ] **Step 3: Add lock-screen metadata type + `setNowPlaying`**

Add the import and a mobile-only method (NOT part of the core port):
```ts
import { type AudioMetadata } from "expo-audio";
```
```ts
  /** Mobile-only: push now-playing metadata to the lock screen / Control Center.
   *  Called by the store on track change. No-op if no player is loaded. */
  setNowPlaying(meta: { title: string; artist: string; album?: string; artwork?: string }): void {
    const player = this.player;
    if (!player) return;
    const md: AudioMetadata = {
      title: meta.title,
      artist: meta.artist,
      album: meta.album,
      artwork: meta.artwork ? { uri: meta.artwork } : undefined,
    };
    try {
      player.setActiveForLockScreen(true, md);
    } catch {
      // lock screen optional; never break playback over it
    }
  }
```
Note: confirm the `AudioMetadata.artwork` shape against the installed typings (`{ uri: string }` expected). If `setActiveForLockScreen` must be called once then updated, use `updateLockScreenMetadata(md)` on subsequent calls — keep a `lockScreenActive` boolean and branch. Keep all lock-screen calls in try/catch so they never break playback.

- [ ] **Step 4: Clear lock screen on dispose**

In `dispose()` (and acceptable in `teardownPlayer`), best-effort clear:
```ts
  dispose(): void {
    try {
      this.player?.clearLockScreenControls();
    } catch {
      // ignore
    }
    this.teardownPlayer();
  }
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @musex/mobile run typecheck`
Expected: PASS. (Adjust `AudioMetadata`/`artwork` to the real typings if tsc complains — structure stays the same.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "fix(mobile): stop overlapping tracks; add background audio + lock-screen metadata"
```

Verification of the bug fix is manual (Task 10): tap a second track while the first plays → only one stream.

---

## Task 4: Store — push now-playing metadata; expose art base + token

**Files:** Modify `packages/mobile/src/state/store.tsx`.

Context: the store hosts the one `PlaybackSession` and subscribes to its state. On current-track change, build art URL + call `engine.setNowPlaying`. Also expose `artBaseFor(serverId)` + `token` so screens can build art URLs via the helper.

- [ ] **Step 1: Track current-track changes in the subscribe handler**

Replace the `useEffect(() => session.subscribe(...))` block:
```tsx
  // Mirror session state into the reducer + push lock-screen metadata on track change.
  const lastTrackId = useRef<string | null>(null);
  useEffect(
    () =>
      session.subscribe((s) => {
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
    [session, engine, gateway],
  );
```
Add a helper near the top of the module (gateway.baseUrlFor throws if not connected — guard it):
```tsx
function safeBaseUrl(gateway: PlexGatewayImpl, serverId: string): string | null {
  try {
    return gateway.baseUrlFor(serverId);
  } catch {
    return null;
  }
}
```
Add imports: `import { artUrl } from "../logic/art-url";`

- [ ] **Step 2: Expose art base + token on the store value**

Add to the `Store` interface and the value:
```tsx
  // in interface Store:
  artBaseFor: (serverId: string) => string | null;
  token: string | null;
```
```tsx
  // in value:
  const value: Store = {
    state, gateway, tokenStore, dispatch, playTracks, session,
    artBaseFor: (sid) => safeBaseUrl(gateway, sid),
    token: state.token,
  };
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @musex/mobile run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(mobile): push now-playing metadata + expose art base/token from store"
```

---

## Task 5: `AlbumArt` component

**Files:** Create `packages/mobile/src/ui/AlbumArt.tsx`.

Context: a reusable art view (`expo-image`) with a neutral placeholder and square/circular variants. Takes a resolved URL (caller builds it via `artUrl` + the store's `artBaseFor`/`token`).

- [ ] **Step 1: Implement**

```tsx
import { Image } from "expo-image";
import { View } from "react-native";
import { theme } from "./theme";

export function AlbumArt({
  url,
  size,
  circular = false,
}: {
  url: string | null;
  size: number;
  circular?: boolean;
}) {
  const radius = circular ? size / 2 : Math.max(4, size * 0.08);
  if (!url) {
    return (
      <View
        style={{ width: size, height: size, borderRadius: radius, backgroundColor: theme.border }}
      />
    );
  }
  return (
    <Image
      source={{ uri: url }}
      style={{ width: size, height: size, borderRadius: radius, backgroundColor: theme.border }}
      contentFit="cover"
      transition={150}
    />
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @musex/mobile run typecheck`
Expected: PASS. (If `expo-image`'s `transition` prop differs in SDK 56, drop it — `source`/`style`/`contentFit` are stable.)

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(mobile): AlbumArt component (expo-image)"
```

---

## Task 6: Tab navigation shell + nested library stack + now-playing modal route

**Files:** Create `app/(tabs)/_layout.tsx`, `app/(tabs)/library/_layout.tsx`; modify `app/_layout.tsx`, `app/index.tsx`; create `app/now-playing.tsx` (placeholder, filled in Task 8). Move screens in Task 7.

Context: expo-router `Tabs` with a custom `tabBar` that stacks the mini-player above the default bottom tab bar. Verify expo-router 56's `Tabs`/`tabBar` prop + `BottomTabBar` import against current docs; the shape below is the standard pattern.

- [ ] **Step 1: Root layout — `app/_layout.tsx`**

```tsx
import { Stack } from "expo-router";
import { StatusBar } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { StoreProvider } from "../src/state/store";
import { theme } from "../src/ui/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <StatusBar barStyle="light-content" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="picker" options={{ headerShown: true, title: "Choose library" }} />
          <Stack.Screen name="now-playing" options={{ presentation: "modal" }} />
        </Stack>
      </StoreProvider>
    </SafeAreaProvider>
  );
}
```

- [ ] **Step 2: Gate — `app/index.tsx`** (redirect target moves under tabs)

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
  if (state.phase !== "signed-in") return <Redirect href="/sign-in" />;
  return <Redirect href={state.library ? "/(tabs)/library" : "/picker"} />;
}
```

- [ ] **Step 3: Tabs layout with persistent mini-player — `app/(tabs)/_layout.tsx`**

```tsx
import { BottomTabBar } from "@react-navigation/bottom-tabs";
import { Tabs } from "expo-router";
import { Cog, Library } from "lucide-react-native";
import { View } from "react-native";
import { MiniPlayer } from "../../src/ui/MiniPlayer";
import { theme } from "../../src/ui/theme";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textDim,
        tabBarStyle: { backgroundColor: theme.surface, borderTopColor: theme.border },
        sceneStyle: { backgroundColor: theme.bg },
      }}
      tabBar={(props) => (
        <View style={{ backgroundColor: theme.surface }}>
          <MiniPlayer />
          <BottomTabBar {...props} />
        </View>
      )}
    >
      <Tabs.Screen
        name="library"
        options={{ title: "Library", tabBarIcon: ({ color, size }) => <Library color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: "Settings", tabBarIcon: ({ color, size }) => <Cog color={color} size={size} /> }}
      />
    </Tabs>
  );
}
```
Note: `BottomTabBar` comes from `@react-navigation/bottom-tabs` (an expo-router dep). Confirm it's resolvable (`node -e "require.resolve('@react-navigation/bottom-tabs')"`); if not, `expo install @react-navigation/bottom-tabs`. If the custom-`tabBar` composition misbehaves in SDK 56, fall back to rendering `<MiniPlayer/>` absolutely-positioned above `tabBarStyle` height — note the chosen approach in the commit.

- [ ] **Step 4: Library nested stack — `app/(tabs)/library/_layout.tsx`**

```tsx
import { Stack } from "expo-router";
import { theme } from "../../../src/ui/theme";

export default function LibraryLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.text,
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Artists" }} />
      <Stack.Screen name="albums" options={{ title: "Albums" }} />
      <Stack.Screen name="tracks" options={{ title: "Tracks" }} />
    </Stack>
  );
}
```

- [ ] **Step 5: Temporary `app/now-playing.tsx`** (filled in Task 8 — stub so the route resolves)

```tsx
import { Text, View } from "react-native";
import { theme } from "../src/ui/theme";

export default function NowPlaying() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.bg }}>
      <Text style={{ color: theme.text }}>Now Playing</Text>
    </View>
  );
}
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @musex/mobile run typecheck`
Expected: PASS (library screens don't exist yet under `(tabs)/library/` — Task 7 moves them; if expo-router type-gen complains about missing routes, proceed — Task 7 adds them before any run).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(mobile): tab nav shell + nested library stack + now-playing modal route"
```

---

## Task 7: Move + restyle library screens with album art (presentation B)

**Files:** Move `app/artists.tsx`→`app/(tabs)/library/index.tsx`, `app/albums.tsx`→`app/(tabs)/library/albums.tsx`, `app/tracks.tsx`→`app/(tabs)/library/tracks.tsx`. Delete the originals. (Keep `app/picker.tsx`.) Update import depths (`../../../src/...`) and add art.

- [ ] **Step 1: `app/(tabs)/library/index.tsx`** — artists as rows with circular art

```tsx
import type { Artist } from "@musex/core";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { AlbumArt } from "../../../src/ui/AlbumArt";
import { useStore } from "../../../src/state/store";
import { artUrl } from "../../../src/logic/art-url";
import { theme } from "../../../src/ui/theme";

export default function Artists() {
  const { state, gateway, artBaseFor, token } = useStore();
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
  }, [state.library, state.token, gateway]);

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
      data={artists}
      keyExtractor={(a) => a.id}
      renderItem={({ item }) => {
        const base = artBaseFor(item.serverId);
        const url = base && token ? artUrl(base, item.thumb, token) : null;
        return (
          <Pressable
            onPress={() => router.push({ pathname: "/(tabs)/library/albums", params: { artistId: item.id } })}
            style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: theme.space(1.5), borderBottomWidth: 1, borderBottomColor: theme.border }}
          >
            <AlbumArt url={url} size={44} circular />
            <Text style={{ color: theme.text, fontSize: 16 }}>{item.name}</Text>
          </Pressable>
        );
      }}
    />
  );
}
```

- [ ] **Step 2: `app/(tabs)/library/albums.tsx`** — 2-column cover grid

```tsx
import type { Album } from "@musex/core";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { AlbumArt } from "../../../src/ui/AlbumArt";
import { artUrl } from "../../../src/logic/art-url";
import { useStore } from "../../../src/state/store";
import { theme } from "../../../src/ui/theme";

export default function Albums() {
  const { artistId } = useLocalSearchParams<{ artistId: string }>();
  const { state, gateway, artBaseFor, token } = useStore();
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
      contentContainerStyle={{ padding: theme.space(1) }}
      data={albums}
      keyExtractor={(a) => a.id}
      numColumns={2}
      renderItem={({ item }) => {
        const base = artBaseFor(item.serverId);
        const url = base && token ? artUrl(base, item.thumb, token) : null;
        return (
          <Pressable
            onPress={() => router.push({ pathname: "/(tabs)/library/tracks", params: { albumId: item.id } })}
            style={{ flex: 1, padding: theme.space(1), maxWidth: "50%" }}
          >
            <AlbumArt url={url} size={170} />
            <Text numberOfLines={1} style={{ color: theme.text, fontSize: 14, marginTop: 6 }}>
              {item.title}
            </Text>
            {item.year ? (
              <Text style={{ color: theme.textDim, fontSize: 12 }}>{item.year}</Text>
            ) : null}
          </Pressable>
        );
      }}
    />
  );
}
```
Note: `size={170}` is a placeholder for layout; for a true responsive 2-col grid, compute from `useWindowDimensions()` width (`(width - padding) / 2`). Use a fixed size first; refine if columns overflow.

- [ ] **Step 3: `app/(tabs)/library/tracks.tsx`** — large album-art header + track rows

```tsx
import type { Track } from "@musex/core";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { AlbumArt } from "../../../src/ui/AlbumArt";
import { artUrl } from "../../../src/logic/art-url";
import { useStore } from "../../../src/state/store";
import { theme } from "../../../src/ui/theme";

export default function Tracks() {
  const { albumId } = useLocalSearchParams<{ albumId: string }>();
  const { state, gateway, playTracks, artBaseFor, token } = useStore();
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
  const headerUrl = first && base && token ? artUrl(base, first.thumb, token) : null;

  return (
    <FlatList
      style={{ backgroundColor: theme.bg }}
      data={tracks}
      keyExtractor={(t) => t.id}
      ListHeaderComponent={
        <View style={{ alignItems: "center", paddingVertical: theme.space(2) }}>
          <AlbumArt url={headerUrl} size={200} />
          {first?.albumTitle ? (
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: "700", marginTop: 10 }}>
              {first.albumTitle}
            </Text>
          ) : null}
          {first ? <Text style={{ color: theme.textDim }}>{first.artistName}</Text> : null}
        </View>
      }
      renderItem={({ item, index }) => (
        <Pressable
          onPress={() => void playTracks(tracks, index)}
          style={{ flexDirection: "row", gap: 12, padding: theme.space(1.5), borderBottomWidth: 1, borderBottomColor: theme.border }}
        >
          <Text style={{ color: theme.textDim, width: 22, textAlign: "right" }}>
            {item.trackNumber ?? index + 1}
          </Text>
          <Text style={{ color: theme.text, fontSize: 16, flex: 1 }} numberOfLines={1}>
            {item.title}
          </Text>
        </Pressable>
      )}
    />
  );
}
```

- [ ] **Step 4: Delete the old root screens**

```bash
git rm packages/mobile/app/artists.tsx packages/mobile/app/albums.tsx packages/mobile/app/tracks.tsx
```
Update `app/picker.tsx`'s post-pick navigation: it currently `router.replace("/artists")` / `router.push("/artists")` — change those to `"/(tabs)/library"`.

- [ ] **Step 5: Typecheck + biome**

Run: `pnpm exec biome check --write packages/mobile && pnpm --filter @musex/mobile run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(mobile): album art across library (circular artists, album grid, art header)"
```

---

## Task 8: Now Playing screen (layout C + controls A + inline queue)

**Files:** Replace `app/now-playing.tsx`.

Context: reads `state.playback` (`queue`, `status`, `positionSec`, `durationSec`); calls `session` methods. Up Next = tracks after the current index. Tap a row → `session.jumpTo(absoluteIndex)`; swipe → `session.removeAt(absoluteIndex)` (use `Swipeable` from `react-native-gesture-handler`, already an RN/Expo dep; if not present, `expo install react-native-gesture-handler` and wrap the row — or ship tap-to-jump first and add swipe in a follow-up commit). Scrubber via `@react-native-community/slider`.

- [ ] **Step 1: Implement `app/now-playing.tsx`**

```tsx
import Slider from "@react-native-community/slider";
import { useRouter } from "expo-router";
import { ChevronDown, Pause, Play, Repeat, Shuffle, SkipBack, SkipForward } from "lucide-react-native";
import { FlatList, Pressable, Text, View } from "react-native";
import { AlbumArt } from "../src/ui/AlbumArt";
import { artUrl } from "../src/logic/art-url";
import { useStore } from "../src/state/store";
import { theme } from "../src/ui/theme";

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export default function NowPlaying() {
  const { state, session, artBaseFor, token } = useStore();
  const router = useRouter();
  const pb = state.playback;
  const queue = pb?.queue ?? null;
  const current = queue ? queue.tracks[queue.index] : undefined;
  if (!pb || !queue || !current) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: theme.bg }}>
        <Text style={{ color: theme.textDim }}>Nothing playing</Text>
      </View>
    );
  }

  const playing = pb.status === "playing";
  const base = artBaseFor(current.serverId);
  const artUri = base && token ? artUrl(base, current.thumb, token) : null;
  const dur = pb.durationSec || current.durationMs / 1000;
  const upNext = queue.tracks.slice(queue.index + 1);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <Pressable onPress={() => router.back()} style={{ padding: theme.space(1.5), alignSelf: "flex-start" }}>
        <ChevronDown color={theme.text} size={28} />
      </Pressable>

      <FlatList
        data={upNext}
        keyExtractor={(t, i) => `${t.id}-${i}`}
        ListHeaderComponent={
          <View style={{ alignItems: "center", paddingHorizontal: theme.space(3) }}>
            <AlbumArt url={artUri} size={240} />
            <Text style={{ color: theme.text, fontSize: 20, fontWeight: "700", marginTop: 18 }} numberOfLines={1}>
              {current.title}
            </Text>
            <Text style={{ color: theme.textDim, fontSize: 15 }} numberOfLines={1}>
              {current.artistName}
            </Text>

            <Slider
              style={{ width: "100%", marginTop: 18 }}
              minimumValue={0}
              maximumValue={dur}
              value={pb.positionSec}
              minimumTrackTintColor={theme.accent}
              maximumTrackTintColor={theme.border}
              thumbTintColor={theme.text}
              onSlidingComplete={(v) => session.seek(v)}
            />
            <View style={{ flexDirection: "row", justifyContent: "space-between", width: "100%" }}>
              <Text style={{ color: theme.textDim, fontSize: 12 }}>{fmt(pb.positionSec)}</Text>
              <Text style={{ color: theme.textDim, fontSize: 12 }}>{fmt(dur)}</Text>
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 28, marginVertical: 18 }}>
              <Pressable onPress={() => session.setShuffle(!queue.shuffle)} hitSlop={10}>
                <Shuffle color={queue.shuffle ? theme.accent : theme.textDim} size={22} />
              </Pressable>
              <Pressable onPress={() => void session.previous()} hitSlop={10}>
                <SkipBack color={theme.text} size={30} />
              </Pressable>
              <Pressable onPress={() => (playing ? session.pause() : session.play())} hitSlop={10}>
                {playing ? <Pause color={theme.accent} size={44} /> : <Play color={theme.accent} size={44} />}
              </Pressable>
              <Pressable onPress={() => void session.next()} hitSlop={10}>
                <SkipForward color={theme.text} size={30} />
              </Pressable>
              <Pressable onPress={() => session.cycleRepeat()} hitSlop={10}>
                <Repeat color={queue.repeat === "none" ? theme.textDim : theme.accent} size={22} />
              </Pressable>
            </View>

            {upNext.length > 0 ? (
              <Text style={{ color: theme.textDim, fontSize: 11, textTransform: "uppercase", alignSelf: "flex-start", marginBottom: 6 }}>
                Up Next
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => {
          const abs = queue.index + 1 + index;
          const b = artBaseFor(item.serverId);
          const u = b && token ? artUrl(b, item.thumb, token) : null;
          return (
            <Pressable
              onPress={() => void session.jumpTo(abs)}
              style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, paddingHorizontal: theme.space(3) }}
            >
              <AlbumArt url={u} size={36} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text }} numberOfLines={1}>{item.title}</Text>
                <Text style={{ color: theme.textDim, fontSize: 12 }} numberOfLines={1}>{item.artistName}</Text>
              </View>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
```
Note: this ships **tap-to-jump** for Up Next. **Swipe-to-remove**: wrap the `renderItem` row in `Swipeable` (`react-native-gesture-handler`) with a right action calling `session.removeAt(abs)`; add as a follow-up step/commit once tap-to-jump is verified, so a gesture-handler setup issue doesn't block the screen. `repeat === "one"` could use a distinct icon later. Confirm `Slider` prop names against the installed `@react-native-community/slider`.

- [ ] **Step 2: Typecheck + biome**

Run: `pnpm exec biome check --write packages/mobile && pnpm --filter @musex/mobile run typecheck`
Expected: PASS. Verify `PlaybackSession` has `setShuffle(boolean)`, `cycleRepeat()`, `jumpTo(index)`, `seek(sec)`, `previous()`, `next()`, `play()`, `pause()` (it does — `packages/core/src/playback/playback-session.ts`).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(mobile): fullscreen Now Playing — art, scrubber, transport, inline Up Next"
```

---

## Task 9: Mini-player (art + expand) and Settings screen

**Files:** Modify `packages/mobile/src/ui/MiniPlayer.tsx`; create `app/(tabs)/settings.tsx`.

- [ ] **Step 1: Update `MiniPlayer.tsx`** — add art + tap-to-expand

```tsx
import { useRouter } from "expo-router";
import { Pause, Play, SkipForward } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { AlbumArt } from "./AlbumArt";
import { artUrl } from "../logic/art-url";
import { useStore } from "../state/store";
import { theme } from "./theme";

export function MiniPlayer() {
  const { state, session, artBaseFor, token } = useStore();
  const router = useRouter();
  const pb = state.playback;
  const current = pb?.queue ? pb.queue.tracks[pb.queue.index] : undefined;
  if (!pb || !current) return null;

  const playing = pb.status === "playing";
  const base = artBaseFor(current.serverId);
  const url = base && token ? artUrl(base, current.thumb, token) : null;

  return (
    <Pressable
      onPress={() => router.push("/now-playing")}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        backgroundColor: theme.surface,
        borderTopWidth: 1,
        borderTopColor: theme.border,
        paddingHorizontal: theme.space(1.5),
        paddingVertical: theme.space(1),
      }}
    >
      <AlbumArt url={url} size={40} />
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={{ color: theme.text, fontWeight: "600" }}>{current.title}</Text>
        <Text numberOfLines={1} style={{ color: theme.textDim, fontSize: 12 }}>{current.artistName}</Text>
      </View>
      <Pressable onPress={() => (playing ? session.pause() : session.play())} hitSlop={10}>
        {playing ? <Pause color={theme.accent} size={26} /> : <Play color={theme.accent} size={26} />}
      </Pressable>
      <Pressable onPress={() => void session.next()} hitSlop={10} style={{ marginLeft: 6 }}>
        <SkipForward color={theme.text} size={22} />
      </Pressable>
    </Pressable>
  );
}
```
Note: nested `Pressable`s (play/next inside the expand-Pressable) — the inner ones `stopPropagation` by default on press in RN; if taps bubble to expand, add `onStartShouldSetResponder` guards or split layout. Verify on device.

- [ ] **Step 2: Create `app/(tabs)/settings.tsx`**

```tsx
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { useStore } from "../../src/state/store";
import { theme } from "../../src/ui/theme";

const APP_VERSION = "0.10.0"; // mirror packages/mobile/app.json expo.version when bumped

export default function Settings() {
  const { state, tokenStore, dispatch } = useStore();
  const router = useRouter();

  async function signOut() {
    await tokenStore.clear();
    dispatch({ type: "signed-out" });
    router.replace("/sign-in");
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, padding: theme.space(2) }}>
      <Text style={{ color: theme.textDim, fontSize: 12, textTransform: "uppercase", marginBottom: 6 }}>
        Library
      </Text>
      <Text style={{ color: theme.text, fontSize: 16 }}>{state.library?.title ?? "—"}</Text>
      <Text style={{ color: theme.textDim, fontSize: 13, marginBottom: theme.space(3) }}>
        {state.library?.serverName ?? ""}
      </Text>

      <Pressable
        onPress={signOut}
        style={{ backgroundColor: theme.surface, borderRadius: 10, padding: theme.space(2), borderWidth: 1, borderColor: theme.border }}
      >
        <Text style={{ color: "#ff6b6b", fontSize: 16 }}>Sign out</Text>
      </Pressable>

      <Text style={{ color: theme.textDim, fontSize: 12, marginTop: theme.space(3) }}>
        musex {APP_VERSION}
      </Text>
    </View>
  );
}
```

- [ ] **Step 3: Typecheck + biome**

Run: `pnpm exec biome check --write packages/mobile && pnpm --filter @musex/mobile run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(mobile): mini-player art + expand; Settings tab (sign out, library, version)"
```

---

## Task 10: Full check + on-device verification + docs

**Files:** `CLAUDE.md` (mobile section).

- [ ] **Step 1: Full check**

Run: `pnpm check`
Expected: EXIT 0 (typecheck + biome + vitest; art-url test passes; nothing else regressed).

- [ ] **Step 2: Build + run on the simulator**

Run:
```bash
pnpm --filter @musex/mobile exec expo run:ios > /tmp/musex-ios-run.log 2>&1 &
```
(Redirect to a log — `run:ios` stays alive serving Metro; do NOT pipe through `tail`.) Wait for `iOS Bundled`.

- [ ] **Step 3: Manual verification matrix** (the real acceptance test)

1. Tabs: Library + Settings switch; mini-player persists above the tab bar on both.
2. Library: artists rows with circular art → albums **2-col cover grid** → tracks with album-art header. Art loads (not all placeholders).
3. Tap a track → plays; mini-player shows art + title.
4. Tap mini-player → fullscreen Now Playing; art, scrubber moves, transport works, shuffle/repeat toggle, **drag the scrubber → seeks**, Up Next lists remaining tracks, tap an Up Next row → jumps.
5. **Bug fixed:** play a track, then tap a different track → only ONE stream (the first stops). Try it rapidly a few times.
6. **Background audio:** start playback, swipe to another app / lock the phone → audio **keeps playing**; lock screen shows title/artist/art + works (on a device; simulator lock-screen is limited).
7. Settings → Sign out → returns to sign-in; relaunch stays signed out.

Capture any failure; fix before marking done.

- [ ] **Step 4: Update `CLAUDE.md`** — append to the mobile section: tab nav structure (`(tabs)` + custom tabBar mini-player + now-playing modal), `art-url` + `AlbumArt` (expo-image), the engine's background-audio config (`shouldPlayInBackground` + `interruptionMode: doNotMix`) + lock-screen `setNowPlaying`, the overlap-bug fix (pause before remove), and that Now Playing ships tap-to-jump (swipe-remove/drag-reorder status).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: record mobile UI Phase 2 (tabs, art, now-playing, background audio)"
```

---

## Self-review (plan author)

**Spec coverage:** Nav shell/tabs → Task 6. Mini-player → Tasks 6/9. Fullscreen Now Playing (C+A) + inline queue tap/swipe → Task 8. Album art (helper + component + presentation B) → Tasks 2/5/7. Background audio + lock screen → Task 3 (+ store push Task 4). Overlap bug → Task 3. Settings tab → Task 9. Testing (art-url unit, manual matrix) → Tasks 2/10. Out-of-scope (drag-reorder, Search/Home, desktop) respected.

**Placeholder scan:** No "TBD/handle edge cases". Honest "verify against installed typings/docs" notes remain for the genuinely version-sensitive bits (expo-router `Tabs` custom `tabBar`/`BottomTabBar` import; `expo-image` `transition`; `Slider` props; `AudioMetadata.artwork` shape; `Swipeable`). Each names the authoritative source + a fallback.

**Type consistency:** `artUrl(base, thumb, token)` defined Task 2, used identically in Tasks 4/7/8/9. Store additions `artBaseFor(serverId)`/`token` defined Task 4, used in Tasks 7/8/9. `engine.setNowPlaying({title,artist,album?,artwork?})` defined Task 3, called Task 4. `AlbumArt({url,size,circular?})` defined Task 5, used Tasks 7/8/9. PlaybackSession methods (`seek/setShuffle/cycleRepeat/jumpTo/removeAt/next/previous/play/pause`) verified against core.

**Deferred (explicit, not gaps):** swipe-to-remove and drag-reorder for Up Next (tap-to-jump ships first; swipe is a follow-up commit in Task 8); lock-screen controls degrade gracefully if SDK 56's API differs (try/catch, never breaks playback).
