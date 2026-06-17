# Default-to-Owned Plex Library + In-App Switching — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Auto-connect to a library on the Plex server the account OWNS (skip the launch picker), persist it, and offer an owned-first library switcher in Settings — on desktop and mobile.

**Architecture:** Add `owned`/`sourceTitle` to the core `Server`/`Library` models + two pure picker helpers; capture `owned` in both gateways; persist + auto-select on mobile; switch via Settings on both surfaces.

**Tech Stack:** `@musex/core`, Expo/React Native, Electron/React, `@ctrl/plex`, AsyncStorage, vitest.

**Spec:** `docs/superpowers/specs/2026-06-16-owned-library-default-design.md`
**Branch:** `feature/mobile-home-taste-lockscreen` (stacked into PR #44).

## Reference (verified current code)

- Core `Server = { id, name, connections }`; `Library = { id, serverId, serverName, title, type, updatedAt? }`.
- Core barrel `packages/core/src/index.ts` re-exports logic via `export * from "./logic/<name>"` (alphabetical; `library-sort`, `library-watch` present).
- Mobile gateway `listMusicLibraries(server, token)` ends `return parseLibraries(json, server.id, server.name);` and resolves base URL lazily (so a restored library must call `listMusicLibraries` once to prime it).
- Mobile `parseServers` maps `id/name/connections` (drops `owned`); `parseLibraries(json, serverId, serverName)`.
- Mobile store: `signed-in` action carries `{token, servers}` (NO library); reducer `signed-in` sets phase/token/servers; `library-selected` sets `state.library`; bootstrap dispatches `signed-in` then routing sends signed-in+no-library → `/picker`. Library/home screens refetch on `state.library`.
- Mobile `Row` = `{ title, subtitle?, onPress }` (no selected indicator).
- Desktop gateway `listServers` maps without `owned` (but `@ctrl/plex` `ResourcesResponse.owned` is available as `r.owned`); `listMusicLibraries` maps sections without `owned`.
- Desktop `restoreSession` / `SignIn.tsx` pick `result.libraries[0]`. `selectLibrary(id)` IPC persists + sets the watcher. `discoverLibraries` IPC returns `{libraries, unreachable}` and sets `rt.libraries`.
- Desktop `useApp()` exposes `dispatch`. Reducer `library-updated` ignores a different-id change (same-id in-place refresh only). `EMPTY_HISTORY` from `@musex/core`. Settings rows use `.settings-row` / `.settings-row-text` / `.settings-row-label` / `.settings-row-desc` / `.settings-btn`; `AccountSection` renders under `category === "general"`.

---

## Task 1: Core — `owned`/`sourceTitle` on models + picker helpers

**Files:**
- Modify: `packages/core/src/models/index.ts`
- Create: `packages/core/src/logic/library-select.ts`
- Test: `packages/core/src/logic/library-select.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/src/logic/library-select.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { Library, Server } from "../index.js";
import { pickDefaultLibrary, pickDefaultServer } from "./library-select.js";

function srv(id: string, owned?: boolean): Server {
  return { id, name: id, connections: [], owned };
}
function lib(id: string, owned?: boolean): Library {
  return { id, serverId: "s", serverName: "s", title: id, type: "music", owned };
}

describe("pickDefaultServer", () => {
  it("prefers an owned server", () => {
    expect(pickDefaultServer([srv("a"), srv("b", true), srv("c")])?.id).toBe("b");
  });
  it("falls back to the first when none owned", () => {
    expect(pickDefaultServer([srv("a"), srv("b")])?.id).toBe("a");
  });
  it("returns null for an empty list", () => {
    expect(pickDefaultServer([])).toBeNull();
  });
});

describe("pickDefaultLibrary", () => {
  it("prefers an owned library", () => {
    expect(pickDefaultLibrary([lib("a"), lib("b", true)])?.id).toBe("b");
  });
  it("falls back to the first when none owned", () => {
    expect(pickDefaultLibrary([lib("a"), lib("b")])?.id).toBe("a");
  });
  it("returns null for an empty list", () => {
    expect(pickDefaultLibrary([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @musex/core test library-select`
Expected: FAIL (`Cannot find module './library-select.js'`).

- [ ] **Step 3: Extend the models**

In `packages/core/src/models/index.ts`, add two optional fields to `Server` (keep existing fields):

```typescript
export interface Server {
  id: string;
  name: string;
  connections: Connection[];
  owned?: boolean; // true if the authenticated account owns this server
  sourceTitle?: string; // for shared servers, the owner's display name
}
```

and two to `Library`:

```typescript
export interface Library {
  id: string; // section key
  serverId: string;
  serverName: string;
  title: string;
  type: "music";
  updatedAt?: number; // epoch ms
  owned?: boolean; // inherited from the server it lives on
  sourceTitle?: string; // owner's name when the server is shared
}
```

(Keep any existing comments. Both fields are optional so existing literals and persisted data stay valid.)

- [ ] **Step 4: Implement the helpers**

`packages/core/src/logic/library-select.ts`:

```typescript
import type { Library, Server } from "../models/index.js";

/** The server to default to: the one the account OWNS, else the first. */
export function pickDefaultServer(servers: Server[]): Server | null {
  return servers.find((s) => s.owned) ?? servers[0] ?? null;
}

/** The library to default to: the first OWNED one, else the first. */
export function pickDefaultLibrary(libraries: Library[]): Library | null {
  return libraries.find((l) => l.owned) ?? libraries[0] ?? null;
}
```

- [ ] **Step 5: Barrel export**

In `packages/core/src/index.ts`, add (alphabetically, just before the `./logic/library-sort` line):

```typescript
export * from "./logic/library-select";
```

- [ ] **Step 6: Run the test + full core suite**

Run: `pnpm --filter @musex/core test library-select` → PASS.
Run: `pnpm --filter @musex/core test` → all pass.
Run: `pnpm --filter @musex/core exec biome check --write src/logic/library-select.ts src/logic/library-select.test.ts && pnpm --filter @musex/core exec tsc --noEmit -p tsconfig.json` → clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(core): owned/sourceTitle on Server+Library + pickDefault helpers"
```

---

## Task 2: Mobile — capture `owned` in parsing

**Files:**
- Modify: `packages/mobile/src/logic/plex-parse.ts`
- Modify: `packages/mobile/src/adapters/plex-gateway.ts`
- Test: `packages/mobile/src/logic/plex-parse.test.ts` (append)

- [ ] **Step 1: Write the failing tests** (append to the existing `plex-parse.test.ts`; add `parseServers, parseLibraries` to its import from `./plex-parse`)

```typescript
describe("parseServers ownership", () => {
  it("maps owned + sourceTitle", () => {
    const servers = parseServers([
      { clientIdentifier: "a", name: "Mine", provides: "server", owned: true, connections: [] },
      { clientIdentifier: "b", name: "Friend", provides: "server", owned: false, sourceTitle: "Pat", connections: [] },
    ]);
    expect(servers[0]).toMatchObject({ id: "a", owned: true });
    expect(servers[1]).toMatchObject({ id: "b", owned: false, sourceTitle: "Pat" });
  });
});

describe("parseLibraries ownership", () => {
  const json = { MediaContainer: { Directory: [{ key: "3", title: "Music", type: "artist" }] } };
  it("stamps owned + sourceTitle from the server", () => {
    expect(parseLibraries(json, "srv", "Mine", true, undefined)[0]).toMatchObject({ id: "3", owned: true });
    expect(parseLibraries(json, "srv", "Friend", false, "Pat")[0]).toMatchObject({ owned: false, sourceTitle: "Pat" });
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @musex/mobile test plex-parse`
Expected: FAIL (`parseLibraries` arity / owned not mapped).

- [ ] **Step 3: Map owned in `parseServers`**

In `packages/mobile/src/logic/plex-parse.ts`, in `parseServers`'s `.map`, add `owned` + `sourceTitle` (keep the rest):

```typescript
    .map((r) => ({
      id: String(r.clientIdentifier),
      name: str(r.name) ?? "",
      owned: Boolean(r.owned),
      sourceTitle: str(r.sourceTitle),
      connections: arr(r.connections).map((c) => ({
        uri: str(c.uri) ?? "",
        local: Boolean(c.local),
        relay: Boolean(c.relay),
      })),
    }));
```

- [ ] **Step 4: Add owned params to `parseLibraries`**

Replace the `parseLibraries` signature + body in the same file with:

```typescript
export function parseLibraries(
  json: unknown,
  serverId: string,
  serverName: string,
  owned?: boolean,
  sourceTitle?: string,
): Library[] {
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
        owned,
        sourceTitle,
      };
    });
}
```

- [ ] **Step 5: Pass owned through the gateway**

In `packages/mobile/src/adapters/plex-gateway.ts`, change `listMusicLibraries`'s return to pass the server's ownership:

```typescript
    return parseLibraries(json, server.id, server.name, server.owned, server.sourceTitle);
```

- [ ] **Step 6: Run tests + check**

Run: `pnpm --filter @musex/mobile test plex-parse` → PASS.
Run: `pnpm --filter @musex/mobile test plex-gateway` → still PASS (existing tests use the 3-arg `parseLibraries` indirectly via `listMusicLibraries`; the new params are optional).
Run: `pnpm --filter @musex/mobile exec biome check --write src/logic/plex-parse.ts src/adapters/plex-gateway.ts && pnpm --filter @musex/mobile exec tsc --noEmit -p tsconfig.json` → clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(mobile): capture owned/sourceTitle in parseServers + parseLibraries"
```

---

## Task 3: Mobile — persist the selected library

**Files:**
- Create: `packages/mobile/src/adapters/selected-library-store.ts`
- Test: `packages/mobile/src/adapters/selected-library-store.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/mobile/src/adapters/selected-library-store.test.ts`:

```typescript
import type { Library } from "@musex/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
import { clearSelectedLibrary, loadSelectedLibrary, saveSelectedLibrary } from "./selected-library-store";

const lib: Library = { id: "3", serverId: "s", serverName: "Mine", title: "Music", type: "music", owned: true };

describe("selected-library-store", () => {
  beforeEach(() => {
    (AsyncStorage as unknown as { __store: Map<string, string> }).__store.clear();
  });
  it("round-trips a library", async () => {
    expect(await loadSelectedLibrary()).toBeNull();
    await saveSelectedLibrary(lib);
    expect(await loadSelectedLibrary()).toEqual(lib);
  });
  it("clears", async () => {
    await saveSelectedLibrary(lib);
    await clearSelectedLibrary();
    expect(await loadSelectedLibrary()).toBeNull();
  });
  it("returns null on malformed JSON", async () => {
    await AsyncStorage.setItem("musex.selected-library", "{bad");
    expect(await loadSelectedLibrary()).toBeNull();
  });
});
```

- [ ] **Step 2: Run, verify fail**

Run: `pnpm --filter @musex/mobile test selected-library-store` → FAIL (module missing).

- [ ] **Step 3: Implement**

`packages/mobile/src/adapters/selected-library-store.ts`:

```typescript
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { Library } from "@musex/core";

const KEY = "musex.selected-library";

/** The last library the user selected, or null if none/corrupt. Never throws. */
export async function loadSelectedLibrary(): Promise<Library | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Library) : null;
  } catch (err) {
    console.warn("[library] load failed", err);
    return null;
  }
}

export async function saveSelectedLibrary(library: Library): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(library));
  } catch (err) {
    console.warn("[library] save failed", err);
  }
}

export async function clearSelectedLibrary(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch (err) {
    console.warn("[library] clear failed", err);
  }
}
```

- [ ] **Step 4: Run + check**

Run: `pnpm --filter @musex/mobile test selected-library-store` → PASS.
Run: `pnpm --filter @musex/mobile exec biome check --write src/adapters/selected-library-store.ts src/adapters/selected-library-store.test.ts && pnpm --filter @musex/mobile exec tsc --noEmit -p tsconfig.json` → clean.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(mobile): persist the selected library (AsyncStorage)"
```

---

## Task 4: Mobile — auto-select owned at bootstrap + expose switching

**Files:** Modify `packages/mobile/src/state/store.tsx`

This is a surgical edit to the existing store. Apply each change; do not rewrite the file.

- [ ] **Step 1: Imports**

Change the `@musex/core` value import to add the helpers + discovery, and add the persistence import:

```typescript
import {
  buildQueue,
  discoverMusicLibraries,
  PlaybackSession,
  PlayMonitor,
  pickDefaultLibrary,
  pickDefaultServer,
} from "@musex/core";
```

and (with the other adapter imports):

```typescript
import { loadSelectedLibrary, saveSelectedLibrary } from "../adapters/selected-library-store";
```

- [ ] **Step 2: `signed-in` action carries the resolved library**

Change the `Action` union's `signed-in` member to:

```typescript
  | { type: "signed-in"; token: string; servers: Server[]; library: Library | null }
```

and the reducer `signed-in` case to set the library too:

```typescript
    case "signed-in":
      return {
        ...state,
        phase: "signed-in",
        token: action.token,
        servers: action.servers,
        library: action.library,
      };
```

- [ ] **Step 3: A ref to the current servers (for `selectLibrary` to find the Server)**

After `tokenRef`:

```typescript
  const serversRef = useRef<Server[]>([]);
  serversRef.current = state.servers;
```

- [ ] **Step 4: Resolve the library in bootstrap**

In the bootstrap effect, replace the `try { const servers = await gateway.listServers(token); ... }` block with one that resolves the library before dispatching `signed-in`:

```typescript
      try {
        const servers = await gateway.listServers(token);
        const library = await resolveLibrary(gateway, servers, token);
        if (library) await saveSelectedLibrary(library);
        if (alive) dispatch({ type: "signed-in", token, servers, library });
      } catch {
        // Bad/expired token -> signed out (never loop).
        await tokenStore.clear();
        if (alive) dispatch({ type: "bootstrapped", token: null });
      }
```

- [ ] **Step 5: Add the `resolveLibrary` helper** (module-level function, after `safeBaseUrl`)

```typescript
/** Resolve which library to open: a still-valid persisted choice (priming its
 *  server's base URL), else the owned server's first library. Returns null if no
 *  library is reachable (the picker fallback handles that). Per-server failures
 *  fall through rather than aborting. */
async function resolveLibrary(
  gateway: PlexGatewayImpl,
  servers: Server[],
  token: string,
): Promise<Library | null> {
  const persisted = await loadSelectedLibrary();
  if (persisted) {
    const srv = servers.find((s) => s.id === persisted.serverId);
    if (srv) {
      try {
        const libs = await gateway.listMusicLibraries(srv, token);
        return libs.find((l) => l.id === persisted.id) ?? pickDefaultLibrary(libs);
      } catch {
        // persisted server unreachable -> fall through to the default
      }
    }
  }
  const def = pickDefaultServer(servers);
  if (def) {
    try {
      return pickDefaultLibrary(await gateway.listMusicLibraries(def, token));
    } catch {
      return null;
    }
  }
  return null;
}
```

- [ ] **Step 6: Expose `selectLibrary` + `listAllLibraries`**

Add to the `Store` interface:

```typescript
  selectLibrary: (library: Library) => Promise<void>;
  listAllLibraries: () => Promise<Library[]>;
```

Create them in the provider (after `playTracks`):

```typescript
  const selectLibrary = useMemo(
    () => async (library: Library) => {
      const tok = tokenRef.current;
      const srv = serversRef.current.find((s) => s.id === library.serverId);
      if (tok && srv) {
        try {
          await gateway.listMusicLibraries(srv, tok); // prime the base URL
        } catch {
          // ignore — browse will surface a connection error if truly unreachable
        }
      }
      await saveSelectedLibrary(library);
      dispatch({ type: "library-selected", library });
    },
    [gateway],
  );

  const listAllLibraries = useMemo(
    () => async (): Promise<Library[]> => {
      const tok = tokenRef.current;
      if (!tok) return [];
      const { libraries } = await discoverMusicLibraries(gateway, tok);
      return libraries;
    },
    [gateway],
  );
```

and add both to the context `value` object:

```typescript
    taste,
    selectLibrary,
    listAllLibraries,
```

- [ ] **Step 7: Check**

Run: `pnpm --filter @musex/mobile exec biome check --write src/state/store.tsx && pnpm --filter @musex/mobile exec tsc --noEmit -p tsconfig.json` → clean.
Run: `pnpm --filter @musex/mobile test` → still 36 (no test changes).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(mobile): auto-select owned library on launch + expose switching"
```

---

## Task 5: Mobile — Settings library switcher

**Files:**
- Modify: `packages/mobile/src/ui/Row.tsx`
- Delete: `packages/mobile/app/(tabs)/settings.tsx`
- Create: `packages/mobile/app/(tabs)/settings/_layout.tsx`
- Create: `packages/mobile/app/(tabs)/settings/index.tsx`
- Create: `packages/mobile/app/(tabs)/settings/library.tsx`

- [ ] **Step 1: Add a `selected` indicator to `Row`**

Replace `packages/mobile/src/ui/Row.tsx` with:

```tsx
import { Check } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { theme } from "./theme";

export function Row({
  title,
  subtitle,
  selected = false,
  onPress,
}: {
  title: string;
  subtitle?: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: theme.space(2),
        paddingVertical: theme.space(1.5),
        borderBottomWidth: 1,
        borderBottomColor: theme.border,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontSize: 16 }}>{title}</Text>
        {subtitle ? <Text style={{ color: theme.textDim, fontSize: 13 }}>{subtitle}</Text> : null}
      </View>
      {selected ? <Check color={theme.accent} size={20} /> : null}
    </Pressable>
  );
}
```

(The existing `picker.tsx` usage still compiles — `selected` defaults to false.)

- [ ] **Step 2: Convert the settings screen into a stack**

Delete the old single screen:

```bash
git rm packages/mobile/app/\(tabs\)/settings.tsx
```

Create `packages/mobile/app/(tabs)/settings/_layout.tsx`:

```tsx
import { Stack } from "expo-router";
import { theme } from "../../../src/ui/theme";

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: theme.surface },
        headerTintColor: theme.text,
        contentStyle: { backgroundColor: theme.bg },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Settings" }} />
      <Stack.Screen name="library" options={{ title: "Library" }} />
    </Stack>
  );
}
```

- [ ] **Step 3: `settings/index.tsx`** (current content + a tappable Library row; sign-out also clears the persisted library)

`packages/mobile/app/(tabs)/settings/index.tsx`:

```tsx
import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text } from "react-native";
import { clearSelectedLibrary } from "../../../src/adapters/selected-library-store";
import { useStore } from "../../../src/state/store";
import { Row } from "../../../src/ui/Row";
import { theme } from "../../../src/ui/theme";

const APP_VERSION = Constants.expoConfig?.version ?? "0.0.1";

export default function SettingsIndex() {
  const { state, tokenStore, dispatch } = useStore();
  const router = useRouter();

  async function signOut() {
    await tokenStore.clear();
    await clearSelectedLibrary();
    dispatch({ type: "signed-out" });
    router.replace("/sign-in");
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.bg }}>
      <Text
        style={{
          color: theme.textDim,
          fontSize: 12,
          textTransform: "uppercase",
          paddingHorizontal: theme.space(2),
          paddingTop: theme.space(2),
          paddingBottom: 6,
        }}
      >
        Library
      </Text>
      <Row
        title={state.library?.title ?? "—"}
        subtitle={state.library?.serverName ?? "Tap to choose"}
        onPress={() => router.push("/(tabs)/settings/library")}
      />

      <Pressable
        onPress={signOut}
        style={{
          backgroundColor: theme.surface,
          borderRadius: 10,
          padding: theme.space(2),
          borderWidth: 1,
          borderColor: theme.border,
          margin: theme.space(2),
        }}
      >
        <Text style={{ color: "#ff6b6b", fontSize: 16 }}>Sign out</Text>
      </Pressable>

      <Text style={{ color: theme.textDim, fontSize: 12, paddingHorizontal: theme.space(2) }}>
        musex {APP_VERSION}
      </Text>
    </ScrollView>
  );
}
```

- [ ] **Step 4: `settings/library.tsx`** (the switcher)

`packages/mobile/app/(tabs)/settings/library.tsx`:

```tsx
import type { Library } from "@musex/core";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, FlatList, Text, View } from "react-native";
import { useStore } from "../../../src/state/store";
import { Row } from "../../../src/ui/Row";
import { theme } from "../../../src/ui/theme";

export default function LibrarySwitcher() {
  const { state, listAllLibraries, selectLibrary } = useStore();
  const router = useRouter();
  const [libs, setLibs] = useState<Library[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const all = await listAllLibraries();
        const sorted = all
          .slice()
          .sort((a, b) => Number(Boolean(b.owned)) - Number(Boolean(a.owned)));
        if (alive) setLibs(sorted);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [listAllLibraries]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.bg }}>
        <ActivityIndicator color={theme.accent} />
      </View>
    );
  }

  if (libs.length === 0) {
    return (
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: theme.bg }}>
        <Text style={{ color: theme.textDim, textAlign: "center" }}>No libraries found.</Text>
      </View>
    );
  }

  return (
    <FlatList
      style={{ flex: 1, backgroundColor: theme.bg }}
      data={libs}
      keyExtractor={(l) => `${l.serverId}-${l.id}`}
      renderItem={({ item }) => (
        <Row
          title={item.title}
          subtitle={
            item.owned
              ? item.serverName
              : `${item.serverName} · shared by ${item.sourceTitle ?? "someone"}`
          }
          selected={item.id === state.library?.id && item.serverId === state.library?.serverId}
          onPress={async () => {
            await selectLibrary(item);
            router.back();
          }}
        />
      )}
    />
  );
}
```

- [ ] **Step 5: Check**

Run: `pnpm --filter @musex/mobile exec biome check --write src/ui/Row.tsx "app/(tabs)/settings" && pnpm --filter @musex/mobile exec tsc --noEmit -p tsconfig.json` → clean.
Run: `pnpm --filter @musex/mobile test` → still 36.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(mobile): Settings library switcher (owned-first) + Row selected state"
```

---

## Task 6: Desktop — capture `owned` in the gateway

**Files:** Modify `packages/desktop/src/main/adapters/plex-gateway.ts`

- [ ] **Step 1: Map `owned` in `listServers`**

In `listServers`'s `.map`, add `owned` (and `sourceTitle` if the installed `@ctrl/plex` `ResourcesResponse` type has it — see note):

```typescript
      .map((r) => ({
        id: r.clientIdentifier,
        name: r.name,
        owned: Boolean(r.owned),
        sourceTitle: r.sourceTitle ?? undefined,
        connections: (r.connections ?? []).map((c) => ({
          uri: c.uri,
          local: Boolean(c.local),
          relay: false,
        })),
      }));
```

**If `tsc` reports `sourceTitle` is not on the resource type**, drop the `sourceTitle: r.sourceTitle ?? undefined` line (desktop will just label shared servers "Shared" without a name). `owned` is definitely present.

- [ ] **Step 2: Stamp `owned` onto libraries in `listMusicLibraries`**

In the section `.map`, add `owned` + `sourceTitle` from the server:

```typescript
      .map((s) => ({
        id: String(s.key),
        serverId: server.id,
        serverName: server.name,
        title: s.title,
        type: "music" as const,
        updatedAt: Math.max(s.updatedAt.getTime(), s.scannedAt.getTime()),
        owned: server.owned,
        sourceTitle: server.sourceTitle,
      }));
```

- [ ] **Step 3: Check**

Run: `pnpm --filter @musex/desktop exec biome check --write src/main/adapters/plex-gateway.ts && pnpm --filter @musex/desktop exec tsc --noEmit -p tsconfig.json` → clean.
Run: `pnpm --filter @musex/desktop test` → all pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(desktop): capture owned/sourceTitle from Plex resources"
```

---

## Task 7: Desktop — prefer the owned library by default

**Files:**
- Modify: `packages/desktop/src/main/ipc.ts`
- Modify: `packages/desktop/src/renderer/src/ui/SignIn.tsx`

- [ ] **Step 1: `ipc.ts` restoreSession**

Add `pickDefaultLibrary` to the `@musex/core` import in `ipc.ts`, and in the `restoreSession` handler replace:

```typescript
    const first = result.libraries[0] ?? null;
```

with:

```typescript
    const first = pickDefaultLibrary(result.libraries);
```

- [ ] **Step 2: `SignIn.tsx`**

Add `import { pickDefaultLibrary } from "@musex/core";` and replace:

```typescript
const lib = result.libraries[0];
```

with:

```typescript
const lib = pickDefaultLibrary(result.libraries);
```

- [ ] **Step 3: Check**

Run: `pnpm --filter @musex/desktop exec biome check --write src/main/ipc.ts src/renderer/src/ui/SignIn.tsx && pnpm --filter @musex/desktop exec tsc --noEmit -p tsconfig.json` → clean.
Run: `pnpm --filter @musex/desktop test` → all pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(desktop): default to the owned library on sign-in + restore"
```

---

## Task 8: Desktop — Settings Account switcher

**Files:**
- Modify: `packages/desktop/src/renderer/src/state/app.tsx`
- Modify: `packages/desktop/src/renderer/src/ui/views/SettingsView.tsx`

- [ ] **Step 1: Add the `library-switched` action**

In `app.tsx`, add to the `Action` union:

```typescript
  | { type: "library-switched"; library: Library }
```

and a reducer case (place near `library-updated`):

```typescript
    case "library-switched":
      return { ...s, library: a.library, view: { name: "home" }, history: EMPTY_HISTORY };
```

- [ ] **Step 2: Make `AccountSection` a switcher**

In `SettingsView.tsx`, add `import type { Library } from "@musex/core";` to the imports, and replace the whole `AccountSection` function with:

```tsx
function AccountSection() {
  const { library, dispatch } = useApp();
  const [libs, setLibs] = useState<Library[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    window.musex
      .discoverLibraries()
      .then((res) => {
        if (!alive) return;
        const sorted = res.libraries
          .slice()
          .sort((a, b) => Number(Boolean(b.owned)) - Number(Boolean(a.owned)));
        setLibs(sorted);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function choose(lib: Library) {
    if (busy || lib.id === library?.id) return;
    setBusy(true);
    try {
      await window.musex.selectLibrary(lib.id);
      dispatch({ type: "library-switched", library: lib });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">Account</div>
      {loading ? (
        <div className="settings-row">
          <div className="settings-row-desc">Finding your libraries…</div>
        </div>
      ) : (
        libs.map((lib) => {
          const current = lib.id === library?.id && lib.serverId === library?.serverId;
          return (
            <div className="settings-row" key={`${lib.serverId}-${lib.id}`}>
              <div className="settings-row-text">
                <div className="settings-row-label">
                  {lib.serverName} · {lib.title}
                </div>
                <div className="settings-row-desc">
                  {lib.owned ? "Your server" : `Shared${lib.sourceTitle ? ` by ${lib.sourceTitle}` : ""}`}
                </div>
              </div>
              <button
                type="button"
                className="settings-btn"
                disabled={busy || current}
                onClick={() => void choose(lib)}
              >
                {current ? "Current" : "Use"}
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
```

- [ ] **Step 3: Check**

Run: `pnpm --filter @musex/desktop exec biome check --write src/renderer/src/state/app.tsx src/renderer/src/ui/views/SettingsView.tsx && pnpm --filter @musex/desktop exec tsc --noEmit -p tsconfig.json` → clean.
Run: `pnpm --filter @musex/desktop test` → all pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(desktop): switch libraries from Settings (owned-first)"
```

---

## Task 9: Full check, docs, push, update PR #44

- [ ] **Step 1: Full CI-equivalent check**

Run: `pnpm check`
Expected: green (core + mobile + desktop typecheck, biome, tests). Fix any repo-wide biome with `pnpm exec biome check --write .` and re-run.

- [ ] **Step 2: Update `CLAUDE.md`** — add a bullet to the mobile/project section capturing: `Server`/`Library` now carry `owned?`/`sourceTitle?`; `pickDefaultServer`/`pickDefaultLibrary` in core; both gateways map `resource.owned`; mobile auto-selects the owned server's library at bootstrap and persists it (`musex.selected-library` via AsyncStorage), launch picker now only a zero-library fallback; mobile Settings is a stack with an owned-first library switcher; desktop `restoreSession`/`SignIn` use `pickDefaultLibrary` and the Settings Account pane switches libraries (new `library-switched` renderer action, resets to home). Note desktop `sourceTitle` is best-effort (depends on the `@ctrl/plex` type).

- [ ] **Step 3: Commit docs**

```bash
git add -A
git commit -m "docs: record owned-library default in CLAUDE.md"
```

- [ ] **Step 4: Push**

```bash
git push
```

- [ ] **Step 5: Broaden the PR #44 title + description**

The PR now also covers default-to-owned + library switching. Update the title to encompass both and append a section to the body:

```bash
gh pr edit 44 --title "feat: mobile Home/taste/lock-screen + default-to-owned Plex library with in-app switching"
```

Append to the PR body a "Default-to-owned Plex library (desktop + mobile)" section summarizing the behavior + the new on-device/desktop verification steps (owned library auto-selected, persists across launches, Settings switcher swaps without re-auth).

---

## Self-review (controller, before dispatching)

- **Spec coverage:** owned on models = T1; helpers = T1; mobile parse = T2; persistence = T3; mobile auto-select+switching API = T4; mobile switcher UI = T5; desktop owned = T6; desktop default pick = T7; desktop switcher = T8; docs/PR = T9. ✓
- **Type consistency:** `Server.owned?`/`Library.owned?`/`sourceTitle?` (T1) used by T2/T6 (stamping), T4/T8 (pick/sort). `signed-in` action gains `library` (T4) — reducer updated in the same step. `selectLibrary`/`listAllLibraries` added to `Store` (T4) used in T5. `library-switched` added to desktop reducer (T8). `pickDefaultLibrary`/`pickDefaultServer` (T1) used in T4/T7. ✓
- **No placeholders:** full code in every step; the one conditional (desktop `sourceTitle`) has an explicit fallback instruction. ✓
- **Risk note:** T4 is the delicate store edit — apply step-by-step, run tsc, do not rewrite the file.
