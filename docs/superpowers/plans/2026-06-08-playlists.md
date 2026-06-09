# Spec 2b — Playlists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Plex-backed playlists with full management — a Spotify-style sidebar rail, a playlist detail view, and a reusable track context menu (⋯ hover + right-click) to add tracks to playlists, plus create / rename / delete / remove.

**Architecture:** Core gains `Playlist` + `PlaylistTrack` models, `PlexGateway` playlist methods, and a `createPlaylist` use-case (title validation). The main process implements the playlist ops via `@ctrl/plex` v6 (`Playlist.create`, `library.playlists()`, `playlist.items/addItems/removeItems`, `Playlist.update`, `delete`) and extends the env-gated smoke test to verify a real round-trip. The renderer adds a `PlaylistsProvider` store, extends `TrackRow` with a menu trigger, and adds `TrackContextMenu`, `NewPlaylistDialog`, the sidebar rail, and `PlaylistView`.

**Tech Stack:** TypeScript 6, React 19, Vitest 4, Biome 2, `@ctrl/plex` 6.

**Spec:** `docs/superpowers/specs/2026-06-08-search-and-playlists-design.md` (this is part 2b of 2; search was 2a, shipped).

**Conventions (match existing code):**
- Core/main/logic source: relative imports end in `.js`. Test files & renderer files: no extension.
- Biome: double quotes, semicolons, 2-space indent, `import type` for types. `noUncheckedIndexedAccess` on.
- `git add -A`; commit directly to `main`; push after each commit (authorized).
- Each task ends by running the FULL bar `pnpm check` (typecheck both packages + all tests + Biome) — must be green before commit. Note: adding a port method to core (Task 1) makes the desktop adapter not compile until Task 2 implements it; that transient state across the Task 1→2 commits is expected, and Task 2 restores green.

**Scope note (vs. the mockup):** the context menu in this slice has **Add to playlist ▸** and (inside a playlist) **Remove from this playlist**. "Go to album / Go to artist" navigation is deferred — `Track` carries no `artistId`, and album navigation needs an `Album` object we don't have at a track row; both need extra id plumbing and are a follow-up. "Play next / Add to queue" remain deferred to the queue slice (per spec).

---

### Task 1: Core — playlist models, port, `createPlaylist` use-case, fake + tests

**Files:**
- Modify: `packages/core/src/models/index.ts`
- Modify: `packages/core/src/ports/plex-gateway.ts`
- Modify: `packages/core/src/testing/fakes.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/src/usecases/create-playlist.ts`
- Test: `packages/core/src/usecases/create-playlist.test.ts`

- [ ] **Step 1: Models**

In `packages/core/src/models/index.ts`, add after `SearchResults`:
```ts
export interface Playlist {
  id: string; // Plex playlist ratingKey
  serverId: string;
  title: string;
  trackCount: number;
  durationMs?: number;
  thumb?: string;
}
/** A track as it appears inside a playlist: the track plus its identity within
 *  that playlist (Plex playlistItemID), needed to remove the right row even when
 *  the same track appears more than once. */
export interface PlaylistTrack {
  track: Track;
  playlistItemId: string;
}
```

- [ ] **Step 2: Port methods**

In `packages/core/src/ports/plex-gateway.ts`, add `Playlist` and `PlaylistTrack` to the model import, then add to the `PlexGateway` interface (after `search`):
```ts
  listPlaylists(library: Library, token: string): Promise<Playlist[]>;
  listPlaylistTracks(playlistId: string, serverId: string, token: string): Promise<PlaylistTrack[]>;
  createPlaylist(library: Library, title: string, trackIds: string[], token: string): Promise<Playlist>;
  addToPlaylist(playlistId: string, serverId: string, trackIds: string[], token: string): Promise<void>;
  removeFromPlaylist(playlistId: string, serverId: string, playlistItemIds: string[], token: string): Promise<void>;
  renamePlaylist(playlistId: string, serverId: string, title: string, token: string): Promise<void>;
  deletePlaylist(playlistId: string, serverId: string, token: string): Promise<void>;
```

- [ ] **Step 3: Write the failing use-case test**

Create `packages/core/src/usecases/create-playlist.test.ts`:
```ts
import { describe, expect, it, vi } from "vitest";
import type { Library, PlexGateway, Playlist } from "../index";
import { createPlaylist } from "./create-playlist";

const library: Library = {
  id: "1", serverId: "s1", serverName: "Kraken", title: "Music", type: "music",
};
const made: Playlist = { id: "p1", serverId: "s1", title: "Road Trip", trackCount: 1 };

function gateway() {
  const createPlaylistFn = vi.fn(async () => made);
  const g = { createPlaylist: createPlaylistFn } as unknown as PlexGateway;
  return { g, createPlaylistFn };
}

describe("createPlaylist", () => {
  it("trims the title and delegates to the gateway", async () => {
    const { g, createPlaylistFn } = gateway();
    const out = await createPlaylist(g, library, "  Road Trip  ", ["t1"], "tok");
    expect(out).toEqual(made);
    expect(createPlaylistFn).toHaveBeenCalledWith(library, "Road Trip", ["t1"], "tok");
  });

  it("rejects a blank title without calling the gateway", async () => {
    const { g, createPlaylistFn } = gateway();
    await expect(createPlaylist(g, library, "   ", [], "tok")).rejects.toThrow(/title/i);
    expect(createPlaylistFn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: Run it, verify FAIL** — `pnpm --filter @musex/core exec vitest run src/usecases/create-playlist.test.ts` → `Cannot find module './create-playlist'`.

- [ ] **Step 5: Implement the use-case**

Create `packages/core/src/usecases/create-playlist.ts`:
```ts
import type { Library, Playlist } from "../models/index.js";
import type { PlexGateway } from "../ports/plex-gateway.js";

/** Create a playlist after validating the title. Trims; rejects empty titles. */
export async function createPlaylist(
  gateway: PlexGateway,
  library: Library,
  title: string,
  trackIds: string[],
  token: string,
): Promise<Playlist> {
  const trimmed = title.trim();
  if (trimmed === "") throw new Error("Playlist title is required");
  return gateway.createPlaylist(library, trimmed, trackIds, token);
}
```

- [ ] **Step 6: Export** — in `packages/core/src/index.ts`, export the use-case (match the barrel style) and ensure `Playlist` + `PlaylistTrack` are exported from the models barrel.

- [ ] **Step 7: Extend the fake**

In `packages/core/src/testing/fakes.ts`, implement all seven new methods on `FakePlexGateway` with an in-memory playlist store (read the file first for its existing structure/style). Suggested store: a `Map<string, { playlist: Playlist; items: PlaylistTrack[] }>` plus an id counter. Behaviour:
- `createPlaylist(lib, title, trackIds)` → make a `Playlist` (id = `pl-${n}`, serverId = lib.serverId, trackCount = trackIds.length), seed its items by resolving each trackId against the fake's seeded tracks (skip unknown), assign each a `playlistItemId` (e.g. `${plId}-${i}`), store, return the playlist.
- `listPlaylists(lib)` → playlists for that server.
- `listPlaylistTracks(id)` → that playlist's items (`PlaylistTrack[]`).
- `addToPlaylist(id, _server, trackIds)` → append resolved tracks as new items; bump trackCount.
- `removeFromPlaylist(id, _server, itemIds)` → drop items whose `playlistItemId` ∈ itemIds; update trackCount.
- `renamePlaylist(id, _server, title)` → set title.
- `deletePlaylist(id)` → remove from the store.

Import `Playlist` + `PlaylistTrack` into the file.

- [ ] **Step 8: Tests + typecheck** — `pnpm --filter @musex/core test && pnpm --filter @musex/core exec tsc --noEmit` → all pass.

- [ ] **Step 9: Commit**
```bash
git add -A
git commit -m "feat(core): playlist models, PlexGateway playlist ops, createPlaylist use-case"
git push origin main
```

---

### Task 2: Main — implement playlist ops in the Plex gateway adapter (+ smoke test)

**Files:**
- Modify: `packages/desktop/src/main/adapters/plex-gateway.ts`
- Modify: `packages/desktop/src/main/adapters/plex-gateway.smoke.test.ts`

**IMPORTANT — verify the API first.** Before writing, consult the **context7** docs for `@ctrl/plex` (playlist usage) AND the installed types at `node_modules/.pnpm/@ctrl+plex@6.0.0/node_modules/@ctrl/plex/dist/src/playlist.d.ts`, `library.d.ts`, `playlist.types.d.ts`. Confirm: how to list playlists (`(await server.library()).playlists()` and the `playlistType`/`leafCount`/`composite`/`duration` fields), `Playlist.create(server, title, { items })` shape, `playlist.items()`, `addItems`/`removeItems` (they take hydrated content objects), `Playlist.update(server, ratingKey, { title })` vs `edit`, `delete()`, and the `playlistItemID` field on playlist items. Adjust the code below to the verified API; report any deviation.

- [ ] **Step 1: Imports**

Add to `plex-gateway.ts`: `Playlist as PlexPlaylistCls` from `@ctrl/plex` (value import, alongside `PlexAlbumCls`/`PlexTrackCls`/`X_PLEX_IDENTIFIER`), and add `Playlist`, `PlaylistTrack` to the `@musex/core` type import. A `toPlaylist` mapper (below) lives in this file (small; not in the tested `logic/plex-mapping.ts` since it touches @ctrl/plex specifics).

- [ ] **Step 2: Helpers**

Add private helpers + a mapper:
```ts
  /** Fetch hydrated Track instances for the given ratingKeys (for add/create). */
  private async fetchTracksByIds(serverId: string, ids: string[], token: string): Promise<PlexTrack[]> {
    if (ids.length === 0) return [];
    const server = await this.connect(serverId, token);
    return fetchItems(server, `/library/metadata/${ids.join(",")}`, undefined, PlexTrackCls);
  }

  /** Find a hydrated Playlist instance by ratingKey via the library's playlist list. */
  private async findPlaylist(serverId: string, playlistId: string, token: string): Promise<PlexPlaylistCls> {
    const server = await this.connect(serverId, token);
    const lib = await server.library();
    const all = await lib.playlists();
    const found = all.find((p) => String(p.ratingKey) === playlistId);
    if (!found) throw new Error(`Playlist ${playlistId} not found`);
    return found as PlexPlaylistCls;
  }
```
```ts
function toPlaylistSafe(p: PlexPlaylistCls, serverId: string): Playlist {
  return {
    id: String(p.ratingKey ?? ""),
    serverId,
    title: p.title ?? "",
    trackCount: Number(p.leafCount ?? 0),
    durationMs: typeof p.duration === "number" ? p.duration : undefined,
    thumb: p.composite ?? p.thumb,
  };
}
```

- [ ] **Step 3: Implement the seven methods**

Add to `PlexapiGateway` (all wrapped in `try { … } catch (err) { asPlexAuthError(err); }` like the others):
```ts
  async listPlaylists(library: Library, token: string): Promise<Playlist[]> {
    try {
      const server = await this.connect(library.serverId, token);
      const lib = await server.library();
      const all = await lib.playlists();
      return all
        .filter((p) => p.playlistType === "audio")
        .map((p) => toPlaylistSafe(p as PlexPlaylistCls, library.serverId));
    } catch (err) { asPlexAuthError(err); }
  }

  async listPlaylistTracks(playlistId: string, serverId: string, token: string): Promise<PlaylistTrack[]> {
    try {
      const playlist = await this.findPlaylist(serverId, playlistId, token);
      const items = await playlist.items<PlexTrack>();
      return items.map((t) => ({
        track: toTrackSafe(t, serverId),
        playlistItemId: String((t as unknown as { playlistItemID?: number }).playlistItemID ?? ""),
      }));
    } catch (err) { asPlexAuthError(err); }
  }

  async createPlaylist(library: Library, title: string, trackIds: string[], token: string): Promise<Playlist> {
    try {
      const server = await this.connect(library.serverId, token);
      const items = await this.fetchTracksByIds(library.serverId, trackIds, token);
      const created = await PlexPlaylistCls.create(server, title, { items });
      return toPlaylistSafe(created, library.serverId);
    } catch (err) { asPlexAuthError(err); }
  }

  async addToPlaylist(playlistId: string, serverId: string, trackIds: string[], token: string): Promise<void> {
    try {
      const playlist = await this.findPlaylist(serverId, playlistId, token);
      const tracks = await this.fetchTracksByIds(serverId, trackIds, token);
      if (tracks.length > 0) await playlist.addItems(tracks);
    } catch (err) { asPlexAuthError(err); }
  }

  async removeFromPlaylist(playlistId: string, serverId: string, playlistItemIds: string[], token: string): Promise<void> {
    try {
      const playlist = await this.findPlaylist(serverId, playlistId, token);
      const items = await playlist.items<PlexTrack>();
      const targets = items.filter((t) =>
        playlistItemIds.includes(String((t as unknown as { playlistItemID?: number }).playlistItemID ?? "")),
      );
      if (targets.length > 0) await playlist.removeItems(targets);
    } catch (err) { asPlexAuthError(err); }
  }

  async renamePlaylist(playlistId: string, serverId: string, title: string, token: string): Promise<void> {
    try {
      const server = await this.connect(serverId, token);
      await PlexPlaylistCls.update(server, playlistId, { title });
    } catch (err) { asPlexAuthError(err); }
  }

  async deletePlaylist(playlistId: string, serverId: string, token: string): Promise<void> {
    try {
      const playlist = await this.findPlaylist(serverId, playlistId, token);
      await playlist.delete();
    } catch (err) { asPlexAuthError(err); }
  }
```
> Note on `as unknown as { playlistItemID?: number }`: the field exists on playlist item data (`playlist.types.d.ts`) but may not be on the public `Track` type surface; the cast is the documented escape hatch. If the installed types expose it directly, drop the cast.

- [ ] **Step 4: Extend the env-gated smoke test**

In `plex-gateway.smoke.test.ts` (inside the existing `MUSEX_PLEX_E2E` block), add a playlist round-trip: pick a known track id (from the existing browse assertions), `createPlaylist(lib, "musex-e2e-tmp", [trackId], token)`, assert it appears in `listPlaylists`, `listPlaylistTracks` returns 1 with a non-empty `playlistItemId`, `addToPlaylist` a second track → count 2, `removeFromPlaylist` the first item → count 1, `renamePlaylist` → reflected, then `deletePlaylist` and assert it's gone. This is the real verification of the `@ctrl/plex` mapping.

- [ ] **Step 5: Typecheck + full bar + lint**

Run: `pnpm check` (must be green; the smoke test stays **skipped** without `MUSEX_PLEX_E2E`). Then `pnpm exec biome check packages/desktop/src/main/adapters/plex-gateway.ts` (use `--write` if needed).

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat(plex): implement playlist CRUD (+ env-gated round-trip smoke test)"
git push origin main
```

---

### Task 3: IPC — playlist channels (contract + preload + handlers)

**Files:**
- Modify: `packages/desktop/src/shared/ipc-contract.ts`
- Modify: `packages/desktop/src/preload/index.ts`
- Modify: `packages/desktop/src/main/ipc.ts`

- [ ] **Step 1: Contract** — add `Playlist`, `PlaylistTrack` to the core import; add channels:
```ts
  listPlaylists: "musex:listPlaylists",       // (libraryId) -> Playlist[]
  listPlaylistTracks: "musex:listPlaylistTracks", // (playlistId, serverId) -> PlaylistTrack[]
  createPlaylist: "musex:createPlaylist",     // (libraryId, title, trackIds) -> Playlist
  addToPlaylist: "musex:addToPlaylist",       // (playlistId, serverId, trackIds) -> void
  removeFromPlaylist: "musex:removeFromPlaylist", // (playlistId, serverId, playlistItemIds) -> void
  renamePlaylist: "musex:renamePlaylist",     // (playlistId, serverId, title) -> void
  deletePlaylist: "musex:deletePlaylist",     // (playlistId, serverId) -> void
```
and `MusexApi` methods:
```ts
  listPlaylists(libraryId: string): Promise<Playlist[]>;
  listPlaylistTracks(playlistId: string, serverId: string): Promise<PlaylistTrack[]>;
  createPlaylist(libraryId: string, title: string, trackIds: string[]): Promise<Playlist>;
  addToPlaylist(playlistId: string, serverId: string, trackIds: string[]): Promise<void>;
  removeFromPlaylist(playlistId: string, serverId: string, playlistItemIds: string[]): Promise<void>;
  renamePlaylist(playlistId: string, serverId: string, title: string): Promise<void>;
  deletePlaylist(playlistId: string, serverId: string): Promise<void>;
```

- [ ] **Step 2: Preload** — add the seven arrow bridges (mirror existing style), e.g.:
```ts
  listPlaylists: (libraryId) => ipcRenderer.invoke(IPC.listPlaylists, libraryId),
  listPlaylistTracks: (playlistId, serverId) => ipcRenderer.invoke(IPC.listPlaylistTracks, playlistId, serverId),
  createPlaylist: (libraryId, title, trackIds) => ipcRenderer.invoke(IPC.createPlaylist, libraryId, title, trackIds),
  addToPlaylist: (playlistId, serverId, trackIds) => ipcRenderer.invoke(IPC.addToPlaylist, playlistId, serverId, trackIds),
  removeFromPlaylist: (playlistId, serverId, playlistItemIds) => ipcRenderer.invoke(IPC.removeFromPlaylist, playlistId, serverId, playlistItemIds),
  renamePlaylist: (playlistId, serverId, title) => ipcRenderer.invoke(IPC.renamePlaylist, playlistId, serverId, title),
  deletePlaylist: (playlistId, serverId) => ipcRenderer.invoke(IPC.deletePlaylist, playlistId, serverId),
```

- [ ] **Step 3: Handlers** — in `main/ipc.ts`, add (import the `createPlaylist` use-case from `@musex/core`). Bake art URLs on playlist covers and on each playlist track's thumb:
```ts
  ipcMain.handle(IPC.listPlaylists, async (_e, libraryId: string) => {
    const lib = rt.findLibrary(libraryId);
    await rt.ensureProxyEndpoint(lib.serverId);
    const playlists = await rt.gateway.listPlaylists(lib, rt.requireToken());
    return playlists.map((p) => ({ ...p, thumb: rt.proxy.artUrl(p.serverId, p.thumb) }));
  });
  ipcMain.handle(IPC.listPlaylistTracks, async (_e, playlistId: string, serverId: string) => {
    await rt.ensureProxyEndpoint(serverId);
    const items = await rt.gateway.listPlaylistTracks(playlistId, serverId, rt.requireToken());
    return items.map((it) => ({ ...it, track: { ...it.track, thumb: rt.proxy.artUrl(it.track.serverId, it.track.thumb) } }));
  });
  ipcMain.handle(IPC.createPlaylist, async (_e, libraryId: string, title: string, trackIds: string[]) => {
    const lib = rt.findLibrary(libraryId);
    const p = await createPlaylist(rt.gateway, lib, title, trackIds, rt.requireToken());
    return { ...p, thumb: rt.proxy.artUrl(p.serverId, p.thumb) };
  });
  ipcMain.handle(IPC.addToPlaylist, (_e, playlistId: string, serverId: string, trackIds: string[]) =>
    rt.gateway.addToPlaylist(playlistId, serverId, trackIds, rt.requireToken()),
  );
  ipcMain.handle(IPC.removeFromPlaylist, (_e, playlistId: string, serverId: string, itemIds: string[]) =>
    rt.gateway.removeFromPlaylist(playlistId, serverId, itemIds, rt.requireToken()),
  );
  ipcMain.handle(IPC.renamePlaylist, (_e, playlistId: string, serverId: string, title: string) =>
    rt.gateway.renamePlaylist(playlistId, serverId, title, rt.requireToken()),
  );
  ipcMain.handle(IPC.deletePlaylist, (_e, playlistId: string, serverId: string) =>
    rt.gateway.deletePlaylist(playlistId, serverId, rt.requireToken()),
  );
```

- [ ] **Step 4: Full bar** — `pnpm check` green (contract test covers the new channels); Biome clean.

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "feat(ipc): playlist channels (contract + preload + handlers with art baking)"
git push origin main
```

---

### Task 4: Renderer — playlist store, TrackRow menu trigger, TrackContextMenu

**Files:**
- Create: `packages/desktop/src/renderer/src/state/playlists.tsx`
- Modify: `packages/desktop/src/renderer/src/App.tsx` (wrap with `PlaylistsProvider`)
- Modify: `packages/desktop/src/renderer/src/ui/TrackRow.tsx` (menu trigger)
- Create: `packages/desktop/src/renderer/src/ui/TrackContextMenu.tsx`
- Modify: `packages/desktop/src/renderer/src/ui/theme.css`

- [ ] **Step 1: Playlist store (`state/playlists.tsx`)**

A context that loads the user's playlists once (when a library is present) and exposes them + mutation helpers that refresh afterward. Reads `library` from `useApp`.
```tsx
import type { Playlist } from "@musex/core";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { useApp } from "./app";

interface PlaylistsApi {
  playlists: Playlist[];
  refresh(): void;
  create(title: string, trackIds: string[]): Promise<Playlist>;
  addTo(playlistId: string, serverId: string, trackIds: string[]): Promise<void>;
  remove(playlistId: string, serverId: string, playlistItemIds: string[]): Promise<void>;
  rename(playlistId: string, serverId: string, title: string): Promise<void>;
  destroy(playlistId: string, serverId: string): Promise<void>;
}

const Ctx = createContext<PlaylistsApi | null>(null);

export function PlaylistsProvider({ children }: { children: ReactNode }) {
  const { library } = useApp();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);

  const refresh = useCallback(() => {
    if (!library) {
      setPlaylists([]);
      return;
    }
    window.musex
      .listPlaylists(library.id)
      .then(setPlaylists)
      .catch(() => setPlaylists([]));
  }, [library]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const api: PlaylistsApi = {
    playlists,
    refresh,
    create: async (title, trackIds) => {
      if (!library) throw new Error("No library");
      const p = await window.musex.createPlaylist(library.id, title, trackIds);
      refresh();
      return p;
    },
    addTo: async (playlistId, serverId, trackIds) => {
      await window.musex.addToPlaylist(playlistId, serverId, trackIds);
      refresh();
    },
    remove: async (playlistId, serverId, ids) => {
      await window.musex.removeFromPlaylist(playlistId, serverId, ids);
      refresh();
    },
    rename: async (playlistId, serverId, title) => {
      await window.musex.renamePlaylist(playlistId, serverId, title);
      refresh();
    },
    destroy: async (playlistId, serverId) => {
      await window.musex.deletePlaylist(playlistId, serverId);
      refresh();
    },
  };

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function usePlaylists(): PlaylistsApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlaylists must be used within PlaylistsProvider");
  return v;
}
```
In `App.tsx`, wrap the signed-in tree with `<PlaylistsProvider>` (inside `AppProvider`, around `Shell`/content; it depends on `useApp`). Place it so both the sidebar (in `Shell`) and views are inside it.

- [ ] **Step 2: `TrackContextMenu` (`ui/TrackContextMenu.tsx`)**

A small popover menu rendered at a screen position, with an "Add to playlist ▸" submenu (+ New playlist, then each playlist) and an optional "Remove from this playlist". Closes on outside-click / Esc.
```tsx
import type { Playlist } from "@musex/core";
import { useEffect, useRef, useState } from "react";
import { usePlaylists } from "../state/playlists";

export interface TrackMenuTarget {
  x: number;
  y: number;
  trackId: string;
  serverId: string;
  /** Provided only when the row is inside a playlist (enables Remove). */
  playlistContext?: { playlistId: string; playlistItemId: string };
}

interface Props {
  target: TrackMenuTarget;
  onClose: () => void;
  onNewPlaylist: (trackId: string) => void; // opens the NewPlaylistDialog seeded with this track
}

export function TrackContextMenu({ target, onClose, onNewPlaylist }: Props) {
  const { playlists, addTo, remove } = usePlaylists();
  const [submenu, setSubmenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  async function add(p: Playlist) {
    await addTo(p.id, p.serverId, [target.trackId]);
    onClose();
  }
  async function removeHere() {
    if (!target.playlistContext) return;
    await remove(target.playlistContext.playlistId, target.serverId, [target.playlistContext.playlistItemId]);
    onClose();
  }

  return (
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: target.x, top: target.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        className="ctx-item ctx-haschild"
        onMouseEnter={() => setSubmenu(true)}
        onMouseLeave={() => setSubmenu(false)}
      >
        <span>Add to playlist</span>
        <span className="ctx-arrow">▸</span>
        {submenu && (
          <div className="ctx-submenu">
            <button type="button" className="ctx-item ctx-accent" onClick={() => onNewPlaylist(target.trackId)}>
              + New playlist
            </button>
            {playlists.length > 0 && <div className="ctx-sep" />}
            {playlists.map((p) => (
              <button type="button" key={p.id} className="ctx-item" onClick={() => void add(p)}>
                {p.title}
              </button>
            ))}
          </div>
        )}
      </div>
      {target.playlistContext && (
        <>
          <div className="ctx-sep" />
          <button type="button" className="ctx-item" onClick={() => void removeHere()}>
            Remove from this playlist
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Extend `TrackRow` with a menu trigger**

Change `TrackRow` from a `<button>` to a `<div role="button">` (so it can contain a ⋯ `<button>` — button-in-button is invalid), preserving click-to-play + keyboard activation, and add an optional `onMenu(rect)` for the ⋯ button + right-click:
```tsx
import type { Track } from "@musex/core";
import type { KeyboardEvent, MouseEvent } from "react";
import { formatDuration } from "../util/format";

interface Props {
  track: Track;
  leading?: number | null;
  showSubtitle?: boolean;
  isPlaying: boolean;
  onPlay: () => void;
  /** When provided, the row shows a ⋯ button and opens a menu (also on right-click). */
  onMenu?: (pos: { x: number; y: number }) => void;
}

export function TrackRow({ track, leading, showSubtitle = false, isPlaying, onPlay, onMenu }: Props) {
  const subtitle =
    track.albumTitle != null ? `${track.artistName} · ${track.albumTitle}` : track.artistName;

  function activate(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPlay();
    }
  }
  function openMenuAt(e: MouseEvent) {
    onMenu?.({ x: e.clientX, y: e.clientY });
  }

  return (
    <div
      className={`track-row${isPlaying ? " playing" : ""}${onMenu ? " has-menu" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={activate}
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault();
              openMenuAt(e);
            }
          : undefined
      }
    >
      <span className="track-num">{isPlaying ? "▶" : (leading ?? "")}</span>
      <span className="track-main">
        <span className="track-title">{track.title}</span>
        {showSubtitle && <span className="track-rowsub">{subtitle}</span>}
      </span>
      {onMenu && (
        <button
          type="button"
          className="track-menu-btn"
          title="More"
          onClick={(e) => {
            e.stopPropagation();
            openMenuAt(e);
          }}
        >
          ⋯
        </button>
      )}
      <span className="track-duration">{formatDuration(track.durationMs)}</span>
    </div>
  );
}
```
Update the `.track-row` grid to add the menu column. In `theme.css`, change `.track-row` `grid-template-columns: 34px 1fr auto;` → `34px 1fr auto auto;` and add:
```css
.track-menu-btn {
  background: none;
  border: none;
  color: inherit;
  opacity: 0;
  cursor: pointer;
  font-size: 16px;
  padding: 0 6px;
}
.track-row:hover .track-menu-btn { opacity: 0.7; }
.track-menu-btn:hover { opacity: 1; }

/* Context menu */
.ctx-menu {
  position: fixed;
  z-index: 50;
  min-width: 200px;
  background: var(--panel);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 6px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
}
.ctx-item {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 6px;
  background: none;
  border: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.ctx-item:hover { background: rgba(255, 255, 255, 0.06); }
.ctx-accent { color: var(--green); }
.ctx-sep { height: 1px; background: rgba(255, 255, 255, 0.08); margin: 4px 8px; }
.ctx-arrow { opacity: 0.5; }
.ctx-submenu {
  position: absolute;
  left: 100%;
  top: 0;
  min-width: 190px;
  max-height: 280px;
  overflow: auto;
  background: var(--panel);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 10px;
  padding: 6px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
}
```
(The existing `.track-row.playing .track-num`/`.track-title` rules still apply since the classes are unchanged; switching the element to a `div` keeps the same classNames.)

- [ ] **Step 4: Full bar + lint** — `pnpm check` green. Album view still works (its `TrackRow` usage passes no `onMenu`, so no ⋯ and behaves as before, now as a `div role=button`).

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "feat(playlists): playlist store, TrackRow menu trigger, TrackContextMenu"
git push origin main
```

---

### Task 5: Renderer — sidebar rail + NewPlaylistDialog (create flow)

**Files:**
- Create: `packages/desktop/src/renderer/src/ui/NewPlaylistDialog.tsx`
- Modify: `packages/desktop/src/renderer/src/ui/Shell.tsx`
- Modify: `packages/desktop/src/renderer/src/state/app.tsx` (add `{ name: "playlist"; playlist }` view)
- Modify: `packages/desktop/src/renderer/src/ui/theme.css`

- [ ] **Step 1: `app.tsx`** — add `| { name: "playlist"; playlist: Playlist }` to the `View` union (import `Playlist` type).

- [ ] **Step 2: `NewPlaylistDialog`** — a themed modal prompting for a name; on submit calls `usePlaylists().create(title, seedTrackIds)` and (optionally) navigates to the new playlist.
```tsx
import { useState } from "react";
import { usePlaylists } from "../state/playlists";

interface Props {
  seedTrackIds: string[]; // [] for an empty playlist from the sidebar "+"
  onClose: () => void;
  onCreated?: (playlistId: string, serverId: string) => void;
}

export function NewPlaylistDialog({ seedTrackIds, onClose, onCreated }: Props) {
  const { create } = usePlaylists();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const t = title.trim();
    if (t === "") {
      setError("Please enter a name");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const p = await create(t, seedTrackIds);
      onCreated?.(p.id, p.serverId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create playlist");
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="modal-title">New playlist</h3>
        <input
          className="modal-input"
          // biome-ignore lint/a11y/noAutofocus: focus the only field in a just-opened dialog
          autoFocus
          placeholder="Playlist name"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
        />
        {error && <div className="modal-error">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="settings-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="modal-create" disabled={busy} onClick={() => void submit()}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Sidebar rail in `Shell.tsx`**

Use `usePlaylists()`; render a "Playlists" section header with a "+" that opens `NewPlaylistDialog` (seed `[]`), then the playlist titles (each a nav button → `navigate {name:'playlist', playlist}`), placed after the Library nav and before `lib-switch`. Add `case "playlist": return <PlaylistView playlist={view.playlist} />;` to `renderContent` (PlaylistView created in Task 6 — to keep this task compiling, either create a minimal `PlaylistView` stub here and flesh it out in Task 6, OR do Task 6 before wiring the route; pick one and keep `pnpm check` green at commit). **Recommended:** create the full `PlaylistView` in Task 6 first if you prefer; otherwise add a temporary stub returning a placeholder and replace it in Task 6. Mark the playlist nav active when `view.name === "playlist" && view.playlist.id === p.id`.

Manage dialog state locally in `Shell` (e.g. `const [newPlaylistSeed, setNewPlaylistSeed] = useState<string[] | null>(null)`); render `<NewPlaylistDialog seedTrackIds={newPlaylistSeed} ... />` when non-null.

- [ ] **Step 4: Theme — rail + modal**
```css
/* Sidebar playlist rail */
.playlist-rail { margin-top: 6px; display: flex; flex-direction: column; min-height: 0; overflow: auto; }
.playlist-rail-head {
  display: flex; align-items: center; justify-content: space-between;
  font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em;
  opacity: 0.5; padding: 10px 10px 4px;
}
.playlist-rail-add { background: none; border: none; color: inherit; cursor: pointer; opacity: 0.7; font-size: 14px; }
.playlist-rail-add:hover { opacity: 1; }

/* Modal */
.modal-backdrop {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.modal {
  background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  padding: 20px; width: 320px; box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
}
.modal-title { margin: 0 0 14px; font-size: 16px; }
.modal-input {
  width: 100%; background: var(--panel-2); border: 1px solid var(--line);
  color: var(--text); border-radius: 8px; padding: 9px 11px; font: inherit;
}
.modal-error { color: var(--red); font-size: 12px; margin-top: 8px; }
.modal-actions { display: flex; justify-content: flex-end; gap: 10px; margin-top: 16px; }
.modal-create {
  background: var(--green); color: #06281d; border: none; border-radius: 8px;
  padding: 8px 16px; font: inherit; font-weight: 650; cursor: pointer;
}
.modal-create:disabled { opacity: 0.5; cursor: default; }
```

- [ ] **Step 5: Full bar + lint** — `pnpm check` green.

- [ ] **Step 6: Commit**
```bash
git add -A
git commit -m "feat(playlists): sidebar rail + New Playlist dialog (create flow)"
git push origin main
```

---

### Task 6: Renderer — PlaylistView (play / remove / rename / delete) + wire the menu

**Files:**
- Create: `packages/desktop/src/renderer/src/ui/views/PlaylistView.tsx`
- Modify: `packages/desktop/src/renderer/src/ui/views/SearchView.tsx` (give song rows the context menu)
- Modify: `packages/desktop/src/renderer/src/ui/views/AlbumDetailView.tsx` (give track rows the context menu)
- Modify: `packages/desktop/src/renderer/src/ui/theme.css` (playlist header reuse)

- [ ] **Step 1: `PlaylistView`**

Fetches `listPlaylistTracks(playlist.id, playlist.serverId)`; renders an album-style header (cover, "Playlist" label, title, song count + total duration, green play button, a "⋯" actions button → rename/delete) and the track list via `TrackRow` with `onMenu` + a managed `TrackContextMenu` (playlistContext set so "Remove from this playlist" appears). Play loads the playlist's tracks as the queue. Reuses `.album-detail`/`.album-header`/`.track-list` classes. Rename uses a reuse of `NewPlaylistDialog`-like prompt or a simple inline prompt; delete navigates away (`navigate {name:'artists'}`) and calls `usePlaylists().destroy`. Manage the open menu target in local state; render one `TrackContextMenu` when a target is set; wire `onNewPlaylist` to open a `NewPlaylistDialog` seeded with the track.

Provide complete code following `AlbumDetailView`'s structure; key wiring:
```tsx
const { playlists, rename, destroy } = usePlaylists();
const [menu, setMenu] = useState<TrackMenuTarget | null>(null);
const [newSeed, setNewSeed] = useState<string[] | null>(null);
// rows:
<TrackRow
  key={pt.playlistItemId}
  track={pt.track}
  leading={i + 1}
  isPlaying={pt.track.id === playingTrackId}
  onPlay={() => playTracks(tracks, i)}
  onMenu={(pos) =>
    setMenu({
      ...pos,
      trackId: pt.track.id,
      serverId: pt.track.serverId,
      playlistContext: { playlistId: playlist.id, playlistItemId: pt.playlistItemId },
    })
  }
/>
// after removal/changes, re-fetch the playlist tracks (and the store refresh updates counts).
{menu && <TrackContextMenu target={menu} onClose={() => setMenu(null)} onNewPlaylist={(id) => { setNewSeed([id]); setMenu(null); }} />}
{newSeed && <NewPlaylistDialog seedTrackIds={newSeed} onClose={() => setNewSeed(null)} />}
```
Note: removing within a playlist should re-fetch the list so the row disappears; have the `TrackContextMenu`'s remove (which calls the store) trigger a local re-fetch — simplest is for `PlaylistView` to re-fetch on a small `version` counter bumped via an `onChanged` callback prop you pass into the menu, OR re-fetch when the store's playlist `trackCount` for this id changes. Pick the simplest that reliably refreshes; keep it explicit (no silent staleness).

- [ ] **Step 2: Wire the menu into SearchView + AlbumDetailView**

Give their `TrackRow`s an `onMenu` that opens a `TrackContextMenu` (no `playlistContext` → no Remove item) and a `NewPlaylistDialog` on "+ New playlist". Same managed-state pattern (`menu`, `newSeed`). This is what lets users add search results / album tracks to playlists.

- [ ] **Step 3: Full bar + lint** — `pnpm check` green.

- [ ] **Step 4: Commit**
```bash
git add -A
git commit -m "feat(playlists): PlaylistView + add-to-playlist menu across album/search/playlist"
git push origin main
```

---

### Task 7: Verification

- [ ] **Step 1: Full CI bar** — `pnpm check` (typecheck + all tests + Biome) green.

- [ ] **Step 2: Manual smoke (dev)** — quit, `pnpm --filter @musex/desktop dev`:
  1. Sidebar shows a **Playlists** rail (your Plex playlists) with a "+".
  2. "+" → dialog → create an empty playlist; it appears in the rail.
  3. Open a playlist → header (cover, count, duration, play) + tracks; play works; the queue is the playlist.
  4. On an album or search song row, hover → "⋯" appears; click it (and try right-click) → menu → **Add to playlist** → pick one (or "+ New playlist"); reopen the playlist → the track is there.
  5. Inside a playlist, a row's menu has **Remove from this playlist** → removes it (row disappears, count drops).
  6. Playlist "⋯" → rename (reflected in rail + header) and delete (navigates away, removed from rail).
  7. Changes persist across restart (Plex-backed) and the artwork shows.

- [ ] **Step 3: (If `MUSEX_PLEX_E2E` set)** run the smoke test to confirm the real Plex round-trip passes.

---

## Self-Review

- **Spec coverage (playlists):** Plex-backed CRUD ✓ (Tasks 1–3); sidebar rail ✓ (Task 5); detail view mirrors album ✓ (Task 6); context menu ⋯+right-click with Add-to-playlist ▸ (+New playlist) ✓ (Tasks 4/6) and Remove-in-playlist ✓; create/rename/delete/add/remove ✓; `PlaylistTrack { track, playlistItemId }` carries the removal id ✓; art baked through proxy ✓. Deferred (noted): Go to album/artist nav, play-next/add-to-queue, drag-reorder.
- **Type consistency:** `Playlist {id,serverId,title,trackCount,durationMs?,thumb?}` and `PlaylistTrack {track,playlistItemId}` identical across core/IPC/renderer; channel arg orders match across contract/preload/handlers; `usePlaylists` API names (`create/addTo/remove/rename/destroy/refresh`) used consistently.
- **Sequencing:** Task 1 (port) breaks desktop compile until Task 2 — expected, restored by Task 2. Task 5 routes to `PlaylistView` created in Task 6 — keep `pnpm check` green at each commit by stubbing PlaylistView in Task 5 or building Task 6's view first; do not commit a non-compiling tree.
- **Placeholders:** none material — Task 1 Step 7 / Task 6 Step 1 adapt to existing structures the implementer reads in-file; fix the `useCallback` import typo noted in Task 4.
