# Home/Navigation Polish + Discovery & Acquisition UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eleven UI/UX improvements in one PR — Home polish (label spacing, smart-mix collage art, playlist art fallback, hide empty playlists), sidebar (count badges, library order), open-on-Home, back/forward navigation history, and in-app discovery/acquisition (monitor from Discover tiles, artist-info side panel, merged last.fm∪Lidarr discography, missing-albums section on artist pages, monitored badges).

**Architecture:** Pure logic additions (`nav-history.ts`, `discography-merge.ts`, `smartMixThumbs`) tested in vitest; optional plugin-API methods (`artistInfo`, `listMonitoredArtists` — apiVersion stays 1) implemented by lastfm/lidarr; host fan-outs + three IPC channels; renderer extends the existing panel system with an `artist-info` panel and reuses GridCard/CardCollage vocabulary everywhere.

**Tech Stack:** React 19 renderer, Electron main plugin host, `@musex/plugin-api`, vitest, lucide-react icons (no emoji). Spec: `docs/superpowers/specs/2026-06-11-home-discover-polish-design.md`.

**Conventions for every task:** repo root `/Users/matjam/src/musex`, branch `feature/home-discover-polish`; main/shared/preload/logic imports use `.js` extensions, renderer imports use none; plugins are rebuilt by `pnpm build:plugins`; `pnpm check` must exit 0 before each commit — **run `pnpm exec biome check --write .` first** (it fixes import order, which broke a previous branch); commit with `git add -A` (never selective) and `git push` after each commit.

---

### Task 1: Quick wins — spacing, sidebar order, badges, open-on-home, empty playlists

**Files:**
- Modify: `packages/desktop/src/renderer/src/ui/theme.css`
- Modify: `packages/desktop/src/renderer/src/ui/Shell.tsx:164-246`
- Modify: `packages/desktop/src/renderer/src/state/app.tsx` (restore-done case)
- Modify: `packages/desktop/src/renderer/src/ui/views/HomeView.tsx:118`

No unit tests (CSS + JSX reorders); `pnpm check` is the gate, behavior verified live in the final task.

- [ ] **Step 1: Label spacing.** In `theme.css`, after the existing `.home-row` rule (~line 2034), add:

```css
/* Home section labels need air between the title and the tile grid. */
.home-row .browse-title {
  margin-bottom: 14px;
}
```

- [ ] **Step 2: Sidebar library order.** In `Shell.tsx`, inside the `SidebarSection title="Library"` block (lines 164–200), reorder the four buttons to: **Artists** (Mic2), **Albums** (Disc3), **Tracks** (Music), **Genres** (Tags). Move whole `<button>…</button>` blocks; change nothing inside them.

- [ ] **Step 3: Playlist count badges.** In `Shell.tsx`, the Playlists section button (lines 234–245) currently renders `{p.title}` bare. Change the button body to:

```tsx
              <span className="nav-label">{p.title}</span>
              <span className="nav-badge">{p.trackCount}</span>
```

and add to `theme.css` next to the existing `.nav-item` rules:

```css
.nav-item .nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.nav-item .nav-badge {
  margin-left: auto;
  font-size: 11px;
  color: var(--muted);
  flex-shrink: 0;
}
```

(Check the existing `.nav-item` rule — it is a flex row (it lays out icon + text); if it isn't, add `display: flex; align-items: center; gap` matching the current visual.)

- [ ] **Step 4: Open on Home.** In `state/app.tsx`, the `restore-done` case sets `view: { name: "albums" }` — change to `view: { name: "home" }`.

- [ ] **Step 5: Hide empty-playlist tiles.** In `HomeView.tsx` line 118, change:

```ts
  const topPlaylists = playlists.slice(0, 8);
```

to:

```ts
  const topPlaylists = playlists.filter((p) => p.trackCount > 0).slice(0, 8);
```

- [ ] **Step 6: Verify and commit**

```bash
pnpm exec biome check --write . && pnpm check && git add -A && git commit -m "feat: home/sidebar quick wins (spacing, order, badges, open on home, hide empty playlists)" && git push
```

---

### Task 2: Navigation history (pure logic + reducer + TopBar buttons + ⌘[/⌘])

**Files:**
- Create: `packages/desktop/src/logic/nav-history.ts`
- Test: `packages/desktop/src/logic/nav-history.test.ts`
- Modify: `packages/desktop/src/renderer/src/state/app.tsx`
- Modify: `packages/desktop/src/renderer/src/ui/TopBar.tsx`
- Modify: `packages/desktop/src/renderer/src/ui/KeyboardShortcuts.tsx` + `packages/desktop/src/renderer/src/ui/hooks/useKeyboardShortcuts.ts` + `packages/desktop/src/renderer/src/ui/ShortcutsModal.tsx`
- Modify: `packages/desktop/src/renderer/src/ui/theme.css`

- [ ] **Step 1: Write the failing test.** Create `packages/desktop/src/logic/nav-history.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { EMPTY_HISTORY, goBack, goForward, pushView, sameView } from "./nav-history";

type V = { name: string; id?: number };
const A: V = { name: "home" };
const B: V = { name: "albums" };
const C: V = { name: "artist", id: 7 };

describe("sameView", () => {
  it("structural equality", () => {
    expect(sameView({ name: "artist", id: 7 }, { name: "artist", id: 7 })).toBe(true);
    expect(sameView({ name: "artist", id: 7 }, { name: "artist", id: 8 })).toBe(false);
  });
});

describe("pushView", () => {
  it("pushes current onto back and clears forward", () => {
    const h1 = pushView(EMPTY_HISTORY, A);
    const h2 = pushView({ ...h1, forward: [C] }, B);
    expect(h2.back).toEqual([A, B]);
    expect(h2.forward).toEqual([]);
  });

  it("caps the back stack at 50 (oldest dropped)", () => {
    let h: { back: V[]; forward: V[] } = EMPTY_HISTORY;
    for (let i = 0; i < 60; i++) h = pushView(h, { name: "v", id: i });
    expect(h.back).toHaveLength(50);
    expect(h.back[0]).toEqual({ name: "v", id: 10 });
  });
});

describe("goBack / goForward", () => {
  it("round-trips", () => {
    const h = pushView(pushView(EMPTY_HISTORY, A), B); // back: [A, B], current is C
    const b = goBack(h, C);
    expect(b).not.toBeNull();
    expect(b?.view).toEqual(B);
    expect(b?.history.back).toEqual([A]);
    expect(b?.history.forward).toEqual([C]);
    const f = goForward(b!.history, b!.view);
    expect(f?.view).toEqual(C);
    expect(f?.history.back).toEqual([A, B]);
    expect(f?.history.forward).toEqual([]);
  });

  it("empty stacks are no-ops (null)", () => {
    expect(goBack(EMPTY_HISTORY, A)).toBeNull();
    expect(goForward(EMPTY_HISTORY, A)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @musex/desktop exec vitest run src/logic/nav-history.test.ts` — expect module-not-found FAIL.

- [ ] **Step 3: Implement.** Create `packages/desktop/src/logic/nav-history.ts`:

```ts
/** Pure back/forward navigation history. The app reducer owns the state;
 *  these helpers keep the arithmetic testable. Views are plain serializable
 *  objects, compared structurally. */

export interface NavHistory<V> {
  back: V[];
  forward: V[];
}

export const EMPTY_HISTORY: NavHistory<never> = { back: [], forward: [] };

const MAX_BACK = 50;

/** Structural view equality (views are small, serializable objects). */
export function sameView(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Record a navigation away from `current`: push it onto back, drop the
 *  forward stack (a new branch of history), cap the depth. */
export function pushView<V>(h: NavHistory<V>, current: V): NavHistory<V> {
  return { back: [...h.back, current].slice(-MAX_BACK), forward: [] };
}

export function goBack<V>(
  h: NavHistory<V>,
  current: V,
): { history: NavHistory<V>; view: V } | null {
  const view = h.back[h.back.length - 1];
  if (view === undefined) return null;
  return {
    view,
    history: { back: h.back.slice(0, -1), forward: [...h.forward, current] },
  };
}

export function goForward<V>(
  h: NavHistory<V>,
  current: V,
): { history: NavHistory<V>; view: V } | null {
  const view = h.forward[h.forward.length - 1];
  if (view === undefined) return null;
  return {
    view,
    history: { back: [...h.back, current], forward: h.forward.slice(0, -1) },
  };
}
```

- [ ] **Step 4: Tests pass.** Re-run the vitest command — PASS.

- [ ] **Step 5: Reducer integration.** In `state/app.tsx`:

(a) Import: `import { EMPTY_HISTORY, goBack, goForward, type NavHistory, pushView, sameView } from "../../../logic/nav-history";`

(b) `AppState` gains `history: NavHistory<View>;` and the `Action` union gains `| { type: "nav-back" } | { type: "nav-forward" }`.

(c) Initial reducer state and BOTH `signed-in`/`restore-done` cases set `history: EMPTY_HISTORY` (fresh session = fresh history).

(d) The `navigate` case becomes:

```ts
    case "navigate": {
      if (sameView(s.view, a.view)) return s;
      return { ...s, view: a.view, history: pushView(s.history, s.view) };
    }
```

(e) The `set-search` case: entering the search view from elsewhere is ONE history push; typing while already on search pushes nothing:

```ts
    case "set-search": {
      const entering = a.query.trim() !== "" && s.view.name !== "search";
      return {
        ...s,
        searchQuery: a.query,
        view: a.query.trim() ? { name: "search" } : s.view,
        history: entering ? pushView(s.history, s.view) : s.history,
      };
    }
```

(f) New cases:

```ts
    case "nav-back": {
      const r = goBack(s.history, s.view);
      return r ? { ...s, view: r.view, history: r.history } : s;
    }
    case "nav-forward": {
      const r = goForward(s.history, s.view);
      return r ? { ...s, view: r.view, history: r.history } : s;
    }
```

- [ ] **Step 6: TopBar buttons.** Replace `TopBar.tsx` content with:

```tsx
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useApp } from "../state/app";

/**
 * Persistent top bar. The whole bar is a macOS drag region (so the window can be
 * moved by grabbing it); interactive children opt out with `-webkit-app-region:
 * no-drag`. Left padding clears the traffic-light window controls. Hosts the
 * back/forward history buttons and the always-visible search box (Spotify-style).
 */
export function TopBar() {
  const { searchQuery, history, dispatch } = useApp();

  return (
    <header className="topbar">
      <div className="topbar-logo brand">
        mus<span>ex</span>
      </div>
      <div className="topbar-nav">
        <button
          type="button"
          className="topbar-nav-btn"
          title="Back (⌘[)"
          aria-label="Back"
          disabled={history.back.length === 0}
          onClick={() => dispatch({ type: "nav-back" })}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          type="button"
          className="topbar-nav-btn"
          title="Forward (⌘])"
          aria-label="Forward"
          disabled={history.forward.length === 0}
          onClick={() => dispatch({ type: "nav-forward" })}
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="topbar-search">
        <Search size={16} className="topbar-search-icon" />
        <input
          id="topbar-search-input"
          className="topbar-search-input"
          type="text"
          placeholder="What do you want to listen to?"
          value={searchQuery}
          onChange={(e) => dispatch({ type: "set-search", query: e.target.value })}
          aria-label="Search your library"
        />
      </div>
    </header>
  );
}
```

CSS (next to the existing `.topbar-search` rule — read it first; the search box is absolutely centered with `width: 38%; max-width: 360px`, so its left edge sits at `calc(50% - min(19%, 180px))`):

```css
/* Back/forward sit immediately left of the centered search box. */
.topbar-nav {
  position: absolute;
  right: calc(50% + min(19%, 180px) + 10px);
  display: flex;
  gap: 4px;
  -webkit-app-region: no-drag;
}
.topbar-nav-btn {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  color: var(--text);
  cursor: pointer;
}
.topbar-nav-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
}
.topbar-nav-btn:disabled {
  opacity: 0.35;
  cursor: default;
}
```

- [ ] **Step 7: Keyboard shortcuts.** `useKeyboardShortcuts.ts` takes callback params (see `openSettings`); add two more params `navBack: () => void, navForward: () => void` and, inside the `meta && !alt && !shift && !ctrl` block next to the `Comma` handler:

```ts
        if (e.code === "BracketLeft") {
          handled();
          navBack();
          return;
        }
        if (e.code === "BracketRight") {
          handled();
          navForward();
          return;
        }
```

`KeyboardShortcuts.tsx` passes them through (it has `useApp()` available or add it): `navBack={() => dispatch({ type: "nav-back" })}` etc. — match the existing prop-passing style (read the file; it forwards props into the hook call). Add the two shortcuts to `ShortcutsModal.tsx`'s list ("⌘[ Back", "⌘] Forward") following its existing row format.

- [ ] **Step 8: Verify and commit**

```bash
pnpm exec biome check --write . && pnpm check && git add -A && git commit -m "feat: navigation history with back/forward buttons and cmd-bracket shortcuts" && git push
```

---

### Task 3: Smart-mix tile collage art

**Files:**
- Modify: `packages/desktop/src/logic/smart-playlists.ts`
- Test: `packages/desktop/src/logic/smart-playlists.test.ts` (extend)
- Modify: `packages/desktop/src/renderer/src/ui/views/HomeView.tsx`
- Modify: `packages/desktop/src/renderer/src/ui/theme.css`

- [ ] **Step 1: Failing test.** In `smart-playlists.test.ts` add (match the file's existing fixture style — read it first; reuse its track-builder helpers if present, else build minimal `Track` literals the way the existing tests do):

```ts
describe("smartMixThumbs", () => {
  const t = (artist: string, title: string, thumb?: string, rating?: number) =>
    ({
      id: `${artist}-${title}`,
      serverId: "s",
      artistName: artist,
      title,
      thumb,
      userRating: rating,
      albumId: "al",
      artistId: "ar",
      durationMs: 1000,
    }) as unknown as Track;

  it("rule kinds: thumbs of the computed playlist, deduped, no undefineds", () => {
    const tracks = [
      t("a", "one", "art1.jpg", 10),
      t("a", "two", "art1.jpg", 9), // same album art → deduped
      t("b", "three", undefined, 8), // no art → dropped
      t("c", "four", "art2.jpg", 2), // below threshold → not in playlist
    ];
    expect(smartMixThumbs("top-rated", tracks, [], [], 0)).toEqual(["art1.jpg"]);
  });

  it("for-you approximates with top-taste artists' track art", () => {
    const tracks = [t("fav", "x", "fav.jpg"), t("other", "y", "other.jpg")];
    const scores = [{ name: "Fav", score: 5 }];
    expect(smartMixThumbs("for-you", tracks, [], scores, 0)).toEqual(["fav.jpg"]);
  });
});
```

(Add `smartMixThumbs` to the test file's import from `./smart-playlists`.)

- [ ] **Step 2: Run to verify failure**, then **Step 3: implement** in `smart-playlists.ts`:

```ts
/** Up to the first 8 top-taste artists feed the For You tile art. */
const FOR_YOU_ART_ARTISTS = 8;

function dedupedThumbs(thumbs: (string | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of thumbs) {
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Album-art candidates for a smart-mix tile collage. Rule-based kinds reuse
 *  the real playlist computation (track thumb = album art). "for-you"'s full
 *  composition is a multi-IPC fan-out — far too heavy for a Home tile — so it
 *  approximates with the top-taste artists' track art. */
export function smartMixThumbs(
  kind: SmartKind,
  tracks: Track[],
  stats: SmartTrackStat[],
  artistScores: { name: string; score: number }[],
  nowMs: number,
): string[] {
  if (kind === "for-you") {
    const top = new Set(
      artistScores.slice(0, FOR_YOU_ART_ARTISTS).map((a) => a.name.toLowerCase()),
    );
    return dedupedThumbs(
      tracks.filter((t) => top.has(t.artistName.toLowerCase())).map((t) => t.thumb),
    );
  }
  return dedupedThumbs(computeSmartPlaylist(kind, tracks, stats, artistScores, nowMs).map((t) => t.thumb));
}
```

- [ ] **Step 4: tests pass** (`pnpm --filter @musex/desktop exec vitest run src/logic/smart-playlists.test.ts`).

- [ ] **Step 5: HomeView wiring.** Add state `const [smartThumbs, setSmartThumbs] = useState<Map<SmartKind, string[]>>(new Map());` and a separate background effect (so the heavy all-tracks fetch never blocks the other rows):

```ts
  // Smart-mix tile art: compose each mix in the background (cheap pure rules
  // over the cached all-tracks list + taste snapshot) and collage its album art.
  useEffect(() => {
    if (!library) return;
    let cancelled = false;
    const validator = listValidator(library.updatedAt);
    Promise.all([
      window.musex.listAllTracks(library.id, "title", validator),
      window.musex.getTasteSnapshot(),
    ])
      .then(([tracks, taste]) => {
        if (cancelled) return;
        const stats = taste.stats.map((s) => ({
          key: s.key,
          plays: s.plays,
          lastPlayedMs: s.lastPlayedMs,
          decayedPlays: s.decayedPlays,
        }));
        setSmartThumbs(
          new Map(
            SMART_ORDER.map((kind) => [
              kind,
              sampleThumbs(
                smartMixThumbs(kind, tracks, stats, taste.topArtists, Date.now()),
                4,
                kind,
              ),
            ]),
          ),
        );
      })
      .catch(() => {
        // tile art is decoration — icon placeholder stays on failure
      });
    return () => {
      cancelled = true;
    };
  }, [library]);
```

(IMPORTANT: mirror the exact field names of `TasteSnapshotDto.stats` from `shared/ipc-contract.ts` — read it; `SmartPlaylistView.tsx` does this same mapping, copy its shape. Add `smartMixThumbs` to the smart-playlists import.)

Smart card render (lines 132–147) becomes:

```tsx
          {SMART_ORDER.map((kind) => {
            const Icon = SMART_ICONS[kind];
            const thumbs = smartThumbs.get(kind) ?? [];
            return (
              <button
                key={kind}
                type="button"
                className={`genre-card smart-card smart-card--${kind}`}
                onClick={() => dispatch({ type: "navigate", view: { name: "smart", kind } })}
              >
                {thumbs.length > 0 ? (
                  <div className="smart-card-art smart-card-art--collage">
                    <CardCollage thumbs={thumbs} className="genre-card-collage" />
                    <span className="smart-card-glyph">
                      <Icon size={14} />
                    </span>
                  </div>
                ) : (
                  <div className="smart-card-art">
                    <Icon size={42} strokeWidth={1.5} />
                  </div>
                )}
                <div className="genre-card-name">{SMART_TITLES[kind]}</div>
              </button>
            );
          })}
```

CSS:

```css
/* Smart cards with collage art keep a small kind-glyph chip for identity. */
.smart-card-art--collage {
  position: relative;
  padding: 0;
}
.smart-card-glyph {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: var(--text);
}
```

(Read the existing `.smart-card-art` rule first and keep the collage container the same box dimensions so the grid stays aligned.)

- [ ] **Step 6: Verify and commit**

```bash
pnpm exec biome check --write . && pnpm check && git add -A && git commit -m "feat: smart-mix tiles collage their album art (background-composed)" && git push
```

---

### Task 4: Playlist tile art fallback (collage from first tracks)

**Files:**
- Modify: `packages/desktop/src/renderer/src/ui/GridCard.tsx`
- Modify: `packages/desktop/src/renderer/src/ui/views/HomeView.tsx`

- [ ] **Step 1: GridCard collage prop.** Add to `Props`:

```ts
  /** Collage artwork (e.g. playlist fallback art) — wins over `thumb`. */
  collage?: string[];
```

and in the artwork area, render (import `CardCollage` from `./CardCollage`):

```tsx
        {collage && collage.length > 0 ? (
          <CardCollage thumbs={collage} className={`grid-card-art${round ? " artist-art" : ""}`} />
        ) : (
          <AlbumArt
            thumb={thumb}
            className={`grid-card-art${round ? " artist-art" : ""}`}
            label={title}
            kind={round ? "artist" : "album"}
          />
        )}
```

(Destructure `collage` in the function signature alongside `thumb`.)

- [ ] **Step 2: HomeView playlist fallback.** Add state `const [playlistArt, setPlaylistArt] = useState<Map<string, string[]>>(new Map());` and an effect:

```ts
  // Playlists without a Plex composite thumb (e.g. smart playlists like
  // "Recently Played") get a collage from their first few tracks.
  useEffect(() => {
    const missing = playlists.filter((p) => !p.thumb && p.trackCount > 0).slice(0, 8);
    if (missing.length === 0) return;
    let cancelled = false;
    for (const p of missing) {
      window.musex
        .listPlaylistTracksPage(p.id, p.serverId, 0, 8)
        .then((page) => {
          if (cancelled) return;
          const thumbs = sampleThumbs(
            page.items.map((it) => it.track.thumb),
            4,
            p.id,
          );
          if (thumbs.length > 0) {
            setPlaylistArt((prev) => new Map(prev).set(p.id, thumbs));
          }
        })
        .catch(() => {
          // art fallback is decoration — blank tile art stays on failure
        });
    }
    return () => {
      cancelled = true;
    };
  }, [playlists]);
```

and pass it in the Your-playlists row's GridCard: `collage={!p.thumb ? playlistArt.get(p.id) : undefined}`.

(Verify the exact return shape of `listPlaylistTracksPage` in `shared/ipc-contract.ts` — it returns `{ items, total }` with `items[].track.thumb`; adjust the accessor if the DTO differs.)

- [ ] **Step 3: Verify and commit**

```bash
pnpm exec biome check --write . && pnpm check && git add -A && git commit -m "feat: playlist tiles fall back to a track-art collage when Plex has no composite" && git push
```

---

### Task 5: Plugin surface — artistInfo, monitored artists, merged discography

**Files:**
- Modify: `packages/plugin-api/src/index.ts`
- Modify: `plugins/lastfm/src/index.ts`
- Modify: `plugins/lidarr/src/index.ts` (+ its test in the existing routed-HTTP style — read `plugins/lidarr/src/watch.test.ts` for the pattern)
- Create: `packages/desktop/src/logic/discography-merge.ts`
- Test: `packages/desktop/src/logic/discography-merge.test.ts`
- Modify: `packages/desktop/src/main/plugins/plugin-host.ts`
- Modify: `packages/desktop/src/shared/ipc-contract.ts`, `packages/desktop/src/main/ipc.ts`, `packages/desktop/src/preload/index.ts`

- [ ] **Step 1: Plugin API types** (`packages/plugin-api/src/index.ts`) — all optional, apiVersion STAYS 1:

To `SimilarProvider` add:

```ts
  /** Artist bio/stats for the in-app artist-info panel. null = unknown artist. */
  artistInfo?(artistName: string): Promise<ArtistInfo | null>;
```

New exported interface next to the other result types:

```ts
/** Returned by SimilarProvider.artistInfo (e.g. last.fm artist.getInfo). */
export interface ArtistInfo {
  name: string;
  /** Plain text (no HTML). */
  bio?: string;
  /** Provider page for the artist (e.g. last.fm URL). */
  url?: string;
  listeners?: number;
  playCount?: number;
  imageUrl?: string;
}
```

To `AcquisitionProvider` add:

```ts
  /** Names of artists currently monitored by the provider (tile badges). */
  listMonitoredArtists?(): Promise<string[]>;
```

- [ ] **Step 2: lastfm artistInfo.** In `plugins/lastfm/src/index.ts`, inside the `registerSimilarProvider` object (next to `topAlbums`), add — following the file's exact error-handling style:

```ts
    artistInfo: async (artistName) => {
      const s = await session();
      if (!s) return null; // needs API key + connected account
      try {
        const res = await s.client.call<ArtistInfoResponse>(
          "artist.getInfo",
          { artist: artistName, autocorrect: "1" },
          { signed: false }, // read method — api_key only
        );
        const a = res.artist;
        if (!a || typeof a.name !== "string") return null;
        // bio.summary carries a trailing "<a href=…>Read more…</a>" — strip
        // the link and any other tags; the UI renders plain text.
        const bio = a.bio?.summary
          ?.replace(/<a [^>]*>.*?<\/a>/gs, "")
          .replace(/<[^>]+>/g, "")
          .trim();
        const image = (Array.isArray(a.image) ? a.image : []).find(
          (i) => i.size === "extralarge" && i["#text"],
        );
        return {
          name: a.name,
          bio: bio || undefined,
          url: typeof a.url === "string" ? a.url : undefined,
          listeners: a.stats?.listeners ? Number(a.stats.listeners) : undefined,
          playCount: a.stats?.playcount ? Number(a.stats.playcount) : undefined,
          imageUrl: image?.["#text"],
        };
      } catch (err) {
        ctx.log(`artist.getInfo failed for "${artistName}":`, errText(err));
        return null;
      }
    },
```

with a response interface near the file's other response types:

```ts
interface ArtistInfoResponse {
  artist?: {
    name?: string;
    url?: string;
    image?: Array<{ size?: string; "#text"?: string }>;
    stats?: { listeners?: string; playcount?: string };
    bio?: { summary?: string };
  };
}
```

- [ ] **Step 3: lidarr listMonitoredArtists.** In `plugins/lidarr/src/index.ts`, in the `registerAcquisitionProvider` object, add (reusing the file's existing client and the artist-resource type it already declares for watch/monitor code — read it; there is a `LidarrArtist`-like interface with `artistName` and `monitored`):

```ts
    listMonitoredArtists: async () => {
      const c = await client();
      if (!c) return [];
      const artists = await c.get<LidarrArtistResource[]>("/api/v1/artist");
      return artists.filter((a) => a.monitored).map((a) => a.artistName);
    },
```

(Adapt `client()`/type names to the file's actual helpers — mirror how `listWatchedArtists` is implemented; it does exactly this kind of GET.) Add a routed-HTTP test pinning the request path `GET /api/v1/artist` and the monitored filter, in the same style as `watch.test.ts`.

- [ ] **Step 4: Pure merge logic.** Create `packages/desktop/src/logic/discography-merge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mergeDiscography } from "./discography-merge";

const lidarr = (title: string, state: string) => ({
  providerId: "lidarr",
  providerRef: `ref-${title}`,
  artistName: "Artist",
  title,
  state: state as never,
});

describe("mergeDiscography", () => {
  it("acquirable albums pass through; lastfm-only titles append as unavailable", () => {
    const merged = mergeDiscography(
      "Artist",
      [lidarr("Alpha", "available"), lidarr("Beta", "owned")],
      [{ title: "Alpha" }, { title: "Gamma" }],
    );
    expect(merged).toHaveLength(3);
    expect(merged[2]).toMatchObject({
      title: "Gamma",
      state: "unavailable",
      providerId: "external",
      providerRef: "title:gamma",
    });
  });

  it("title match is case-insensitive (no duplicate for 'ALPHA')", () => {
    const merged = mergeDiscography("Artist", [lidarr("Alpha", "available")], [
      { title: "ALPHA" },
    ]);
    expect(merged).toHaveLength(1);
  });

  it("no acquisition results at all: every known title is unavailable", () => {
    const merged = mergeDiscography("Artist", [], [{ title: "One" }, { title: "one" }]);
    expect(merged).toHaveLength(1); // deduped case-insensitively
    expect(merged[0]?.state).toBe("unavailable");
  });
});
```

Run to confirm FAIL, then create `packages/desktop/src/logic/discography-merge.ts`:

```ts
/** Merge "what can be fetched" (acquisition providers — authoritative
 *  per-album state) with "what exists in the world" (similar-provider top
 *  albums, e.g. last.fm). Titles only last.fm knows are appended as
 *  unavailable: visible, but not monitorable — if it's not on the
 *  acquisition side, it's not fetchable. */

interface AcquirableLike {
  providerId: string;
  providerRef: string;
  artistName: string;
  title: string;
  state: string;
  [key: string]: unknown;
}

export function mergeDiscography<T extends AcquirableLike>(
  artistName: string,
  acquirable: T[],
  knownTitles: { title: string }[],
): (T | AcquirableLike)[] {
  const have = new Set(acquirable.map((a) => a.title.trim().toLowerCase()));
  const out: (T | AcquirableLike)[] = [...acquirable];
  for (const k of knownTitles) {
    const key = k.title.trim().toLowerCase();
    if (key === "" || have.has(key)) continue;
    have.add(key); // dedupe within knownTitles too
    out.push({
      providerId: "external",
      providerRef: `title:${key}`,
      artistName,
      title: k.title,
      state: "unavailable",
    });
  }
  return out;
}
```

Run tests — PASS.

- [ ] **Step 5: Host fan-outs.** In `packages/desktop/src/main/plugins/plugin-host.ts` (import `mergeDiscography` from `../../logic/discography-merge.js` and `type ArtistInfo` from `@musex/plugin-api`):

```ts
  /** Artist bio/stats — first similar provider with a non-null answer. */
  async artistInfo(artistName: string): Promise<ArtistInfo | null> {
    const timeoutMs = this.deps.providerTimeoutMs ?? PROVIDER_TIMEOUT_MS;
    for (const p of this.registry.similarProviders) {
      if (p.provider.artistInfo === undefined) continue;
      try {
        const info = await withTimeout(p.provider.artistInfo(artistName), timeoutMs);
        if (info && typeof info.name === "string") return info;
      } catch (err) {
        console.error(`[plugins] ${p.pluginId} artistInfo failed:`, err);
      }
    }
    return null;
  }

  private monitoredCache: { at: number; names: string[] } | null = null;
  /** Union of monitored artists across providers; 60s cache — this backs
   *  tile badges, so it must be cheap to call repeatedly. */
  async listMonitoredArtists(): Promise<string[]> {
    if (this.monitoredCache && Date.now() - this.monitoredCache.at < 60_000) {
      return this.monitoredCache.names;
    }
    const timeoutMs = this.deps.providerTimeoutMs ?? ACQUISITION_TIMEOUT_MS;
    const names = new Set<string>();
    for (const p of this.registry.acquisitionProviders) {
      const list = p.provider.listMonitoredArtists;
      if (list === undefined) continue;
      try {
        const res = await withTimeout(list.call(p.provider), timeoutMs);
        for (const n of Array.isArray(res) ? res : []) {
          if (typeof n === "string" && n.length > 0) names.add(n);
        }
      } catch (err) {
        console.error(`[plugins] ${p.pluginId} listMonitoredArtists failed:`, err);
      }
    }
    const out = [...names];
    this.monitoredCache = { at: Date.now(), names: out };
    return out;
  }

  /** "What's fetchable" (acquisition lookup) ∪ "what exists" (topAlbums) —
   *  lastfm-only titles appended as unavailable. */
  async externalDiscography(
    artistName: string,
  ): Promise<(AcquirableAlbum & { providerId: string })[]> {
    const [albums, known] = await Promise.all([
      this.lookupArtistAlbums(artistName),
      this.topAlbums(artistName),
    ]);
    return mergeDiscography(artistName, albums, known) as (AcquirableAlbum & {
      providerId: string;
    })[];
  }
```

(Place the field declaration with the other private fields, methods near `lookupArtistAlbums`. The class already imports `AcquirableAlbum`.) NOTE: the host's monitored cache means a just-monitored artist can show an un-monitored badge for up to 60s — acceptable; the renderer flips its local state optimistically.

- [ ] **Step 6: IPC.** `shared/ipc-contract.ts`:

```ts
  artistInfoGet: "musex:artistInfo:get", // (artistName) -> ArtistInfoDto | null
  acquisitionMonitoredArtists: "musex:acquisition:monitoredArtists", // -> string[] (60s host cache)
  acquisitionDiscography: "musex:acquisition:discography", // (artistName) -> AcquirableAlbumDto[] incl. lastfm-only "unavailable" rows
```

DTO next to the other acquisition types: `export type ArtistInfoDto = { name: string; bio?: string; url?: string; listeners?: number; playCount?: number; imageUrl?: string };` (structural duplicate of plugin-api's ArtistInfo — the contract does not import plugin internals beyond its existing re-exports; follow whichever pattern the file already uses for `AcquirableAlbum`, which IS imported — if so, re-export the type the same way instead of duplicating).

`MusexApi`:

```ts
  artistInfoGet(artistName: string): Promise<ArtistInfoDto | null>;
  acquisitionMonitoredArtists(): Promise<string[]>;
  acquisitionDiscography(artistName: string): Promise<AcquirableAlbumDto[]>;
```

`main/ipc.ts` — next to the existing acquisition handlers, calling the SAME host object the `acquisitionLookupArtist` handler uses (read it; mirror exactly, including any image-URL/proxy enrichment it applies to lookup results — `acquisitionDiscography` must get the same enrichment so album art renders):

```ts
  ipcMain.handle(IPC.artistInfoGet, (_e, artistName: string) => /* host */.artistInfo(String(artistName)));
  ipcMain.handle(IPC.acquisitionMonitoredArtists, () => /* host */.listMonitoredArtists());
  ipcMain.handle(IPC.acquisitionDiscography, (_e, artistName: string) => /* same pipeline as lookupArtist, but over externalDiscography */);
```

(The placeholders above mean: copy the `acquisitionLookupArtist` handler body and swap the host call — do NOT invent a new enrichment path.)

`preload/index.ts` — three invoke wrappers next to the other acquisition ones.

- [ ] **Step 7: Build plugins, verify, commit**

```bash
pnpm build:plugins && pnpm exec biome check --write . && pnpm check && git add -A && git commit -m "feat: plugin surface for artist info, monitored artists, merged discography" && git push
```

---

### Task 6: Discover UX — artist-info side panel + monitor on tiles + monitored badges

**Files:**
- Modify: `packages/desktop/src/renderer/src/state/panel.tsx`
- Modify: `packages/desktop/src/renderer/src/ui/SidePanel.tsx`
- Create: `packages/desktop/src/renderer/src/ui/ArtistInfoPanel.tsx`
- Modify: `packages/desktop/src/renderer/src/ui/PluginSections.tsx`
- Modify: `packages/desktop/src/renderer/src/ui/theme.css`

- [ ] **Step 1: Panel state.** In `state/panel.tsx`: extend `PanelKind` to `"track" | "queue" | "artist-info"`, and add artist payload state:

```ts
interface PanelApi {
  panel: PanelKind | null;
  /** Payload for the artist-info panel (set by openArtistInfo). */
  artistInfoName: string | null;
  openPanel(kind: PanelKind): void;
  openArtistInfo(artistName: string): void;
  closePanel(kind?: PanelKind): void;
  togglePanel(kind: PanelKind): void;
}
```

Provider adds `const [artistInfoName, setArtistInfoName] = useState<string | null>(null);` and:

```ts
      openArtistInfo: (artistName) => {
        setArtistInfoName(artistName);
        setPanel("artist-info");
      },
```

(include `artistInfoName` in the memo value + deps).

- [ ] **Step 2: Panel host.** In `SidePanel.tsx`, also read `artistInfoName` from `usePanel()`; keep a `lastArtistRef` mirroring `lastPanelRef` so the exit animation has content:

```ts
  const lastArtistRef = useRef<string | null>(null);
  if (artistInfoName !== null) lastArtistRef.current = artistInfoName;
  const artistName = artistInfoName ?? lastArtistRef.current;
```

and in the content switch: `{content === "artist-info" && artistName !== null && <ArtistInfoPanel artistName={artistName} />}` — content key should become `` `${content ?? "none"}:${content === "artist-info" ? artistName : ""}` `` so switching artists re-runs the slide-in.

- [ ] **Step 3: ArtistInfoPanel.** Create `packages/desktop/src/renderer/src/ui/ArtistInfoPanel.tsx` (read `TrackDetailPanel.tsx` FIRST and reuse its header/section class names so the panel chrome matches — the class names below follow its conventions; adjust to the real ones found in the file):

```tsx
import { Disc3, Download, ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ArtistInfoDto } from "../../../shared/ipc-contract";
import { useApp } from "../state/app";
import { usePanel } from "../state/panel";

type FetchState =
  | { status: "loading" }
  | { status: "ok"; info: ArtistInfoDto | null };

/** Right-hand panel: artist bio/stats from the similar providers (last.fm),
 *  with monitor + browse-albums actions. Only ever opened for artists NOT in
 *  the library (owned tiles navigate straight to the artist view). */
export function ArtistInfoPanel({ artistName }: { artistName: string }) {
  const { dispatch } = useApp();
  const { closePanel } = usePanel();
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });
  const [monitored, setMonitored] = useState(false);
  const [monitorBusy, setMonitorBusy] = useState(false);

  useEffect(() => {
    setFetch({ status: "loading" });
    setMonitored(false);
    let cancelled = false;
    window.musex
      .artistInfoGet(artistName)
      .then((info) => {
        if (!cancelled) setFetch({ status: "ok", info });
      })
      .catch(() => {
        if (!cancelled) setFetch({ status: "ok", info: null });
      });
    window.musex
      .acquisitionMonitoredArtists()
      .then((names) => {
        if (!cancelled && names.some((n) => n.toLowerCase() === artistName.toLowerCase())) {
          setMonitored(true);
        }
      })
      .catch(() => {
        // badge only — fine without it
      });
    return () => {
      cancelled = true;
    };
  }, [artistName]);

  function monitorArtist() {
    setMonitorBusy(true);
    window.musex
      .acquisitionAcquireArtistByName(artistName)
      .then(() => setMonitored(true))
      .catch((err: unknown) => {
        console.error("[acquisition] acquireArtistByName failed:", err);
      })
      .finally(() => setMonitorBusy(false));
  }

  function browseAlbums() {
    closePanel();
    dispatch({ type: "navigate", view: { name: "external-artist", artistName } });
  }

  const info = fetch.status === "ok" ? fetch.info : null;

  return (
    <div className="artist-info-panel">
      <div className="panel-head">
        <div className="panel-title">{artistName}</div>
        <button type="button" className="panel-close" aria-label="Close" onClick={() => closePanel()}>
          <X size={16} />
        </button>
      </div>

      {fetch.status === "loading" && <div className="panel-muted">Looking up artist…</div>}

      {fetch.status === "ok" && (
        <>
          {info?.imageUrl && (
            <img className="artist-info-image" src={info.imageUrl} alt={artistName} />
          )}
          {(info?.listeners != null || info?.playCount != null) && (
            <div className="panel-muted">
              {info.listeners != null && `${info.listeners.toLocaleString()} listeners`}
              {info.listeners != null && info.playCount != null && " · "}
              {info.playCount != null && `${info.playCount.toLocaleString()} plays`}
            </div>
          )}
          {info?.bio && <p className="artist-info-bio">{info.bio}</p>}
          {!info && <div className="panel-muted">No artist info available.</div>}

          <div className="artist-info-actions">
            <button type="button" className="settings-btn" onClick={browseAlbums}>
              <Disc3 size={14} /> Browse albums
            </button>
            <button
              type="button"
              className="settings-btn"
              disabled={monitored || monitorBusy}
              onClick={monitorArtist}
            >
              <Download size={14} />
              {monitored ? "Monitoring" : monitorBusy ? "Monitoring…" : "Monitor artist"}
            </button>
            {info?.url && (
              <button
                type="button"
                className="settings-btn"
                onClick={() => void window.musex.openExternal(info.url as string)}
              >
                <ExternalLink size={14} /> View on last.fm
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
```

CSS (match the panel chrome variables used by TrackDetailPanel):

```css
.artist-info-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  overflow-y: auto;
}
.artist-info-image {
  width: 100%;
  border-radius: 10px;
  object-fit: cover;
}
.artist-info-bio {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--muted);
  white-space: pre-line;
}
.artist-info-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
```

(If TrackDetailPanel already defines `.panel-head`/`.panel-title`/`.panel-close`/`.panel-muted` use them as-is; otherwise add minimal equivalents alongside.)

- [ ] **Step 4: PluginSections — monitor action, badges, panel click.** Replace the component body so unowned items (when acquisition is available): click → `openArtistInfo(item.name)`; hover action Download → optimistic monitor; badge "monitored" (variant `monitored`) when in the monitored list, else keep "external":

```tsx
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import type { SectionDto, SectionItemDto } from "../../../shared/ipc-contract";
import { useApp } from "../state/app";
import { usePanel } from "../state/panel";
import { GridCard } from "./GridCard";
import { useAcquisitionAvailable } from "./hooks/useAcquisitionAvailable";

/** Rows of plugin-contributed sections (Discover view + Home). Library-matched
 *  items navigate to their artist page; external items open the artist-info
 *  side panel (with inline monitor) when an acquisition provider is
 *  registered, else link out via externalUrl (when present). */
export function PluginSections({ sections }: { sections: SectionDto[] }) {
  const { dispatch } = useApp();
  const { openArtistInfo } = usePanel();
  const acquisitionAvailable = useAcquisitionAvailable();
  const [monitored, setMonitored] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!acquisitionAvailable) return;
    let cancelled = false;
    window.musex
      .acquisitionMonitoredArtists()
      .then((names) => {
        if (!cancelled) setMonitored(new Set(names.map((n) => n.toLowerCase())));
      })
      .catch(() => {
        // badges only — sections render fine without them
      });
    return () => {
      cancelled = true;
    };
  }, [acquisitionAvailable]);

  function open(item: SectionItemDto) {
    if (item.artistId && item.serverId) {
      dispatch({
        type: "navigate",
        view: {
          name: "artist",
          artist: { id: item.artistId, serverId: item.serverId, name: item.name },
        },
      });
    } else if (acquisitionAvailable) {
      openArtistInfo(item.name);
    } else if (item.externalUrl) {
      void window.musex.openExternal(item.externalUrl);
    }
    // External item without a URL or acquisition provider: no-op.
  }

  function monitor(item: SectionItemDto) {
    // Optimistic badge flip; the plugin toasts success/failure.
    setMonitored((prev) => new Set(prev).add(item.name.toLowerCase()));
    window.musex.acquisitionAcquireArtistByName(item.name).catch((err: unknown) => {
      console.error("[acquisition] acquireArtistByName failed:", err);
      setMonitored((prev) => {
        const next = new Set(prev);
        next.delete(item.name.toLowerCase());
        return next;
      });
    });
  }

  return (
    <>
      {sections
        .filter((s) => s.items.length > 0)
        .map((s) => (
          <section className="home-row" key={`${s.pluginId}:${s.title}`}>
            <h3 className="browse-title">{s.title}</h3>
            <div className="browse-grid">
              {s.items.map((item) => {
                const external = Boolean(item.external);
                const isMonitored = external && monitored.has(item.name.toLowerCase());
                const canMonitor = external && acquisitionAvailable && !isMonitored;
                return (
                  <GridCard
                    key={item.name}
                    thumb={item.imageUrl}
                    title={item.name}
                    subtitle={item.artistName}
                    round
                    badge={isMonitored ? "monitored" : external ? "external" : undefined}
                    badgeVariant={isMonitored ? "monitored" : undefined}
                    onOpen={() => open(item)}
                    actionIcon={canMonitor ? Download : undefined}
                    actionTitle="Monitor artist — download their music"
                    onAction={canMonitor ? () => monitor(item) : undefined}
                  />
                );
              })}
            </div>
          </section>
        ))}
    </>
  );
}
```

Add the badge variant CSS next to the existing `grid-card-badge--*` variants (read them for the pattern):

```css
.grid-card-badge--monitored {
  background: color-mix(in srgb, var(--green) 25%, #0d0e12);
  color: var(--green);
}
```

(If the existing variants use plain rgba colors instead of color-mix, match their style.)

- [ ] **Step 5: Verify and commit**

```bash
pnpm exec biome check --write . && pnpm check && git add -A && git commit -m "feat: artist-info side panel + inline monitor and monitored badges on Discover" && git push
```

---

### Task 7: Merged discography view + missing albums on owned-artist pages

**Files:**
- Create: `packages/desktop/src/renderer/src/ui/acquisition-badges.ts`
- Modify: `packages/desktop/src/renderer/src/ui/views/ExternalArtistView.tsx`
- Create: `packages/desktop/src/renderer/src/ui/MissingAlbumsSection.tsx`
- Modify: `packages/desktop/src/renderer/src/ui/views/ArtistDetailView.tsx`

- [ ] **Step 1: Shared badge map.** Create `packages/desktop/src/renderer/src/ui/acquisition-badges.ts` by MOVING `badgeFor` out of `ExternalArtistView.tsx` verbatim (with its import of `AcquirableAlbumDto`), exported; update ExternalArtistView to import it.

- [ ] **Step 2: ExternalArtistView uses the merged discography + monitored chip.** In `ExternalArtistView.tsx`:
- Replace `window.musex.acquisitionLookupArtist(artistName)` with `window.musex.acquisitionDiscography(artistName)` (same DTO shape).
- Update the `browse-sub` copy to: `Discography via last.fm + your download manager — albums you own open in your library; dimmed ones aren't available to fetch.`
- Add monitored detection: a `const [artistMonitored, setArtistMonitored] = useState(false);` set in the same effect via `window.musex.acquisitionMonitoredArtists()` (case-insensitive match, `.catch(() => {})` with a comment), and when true render after the WatchNewReleasesButton:

```tsx
        {artistMonitored && <span className="grid-card-badge grid-card-badge--monitored">monitoring artist</span>}
```

and initialize the monitor button state from it (`disabled={monitorState === "busy" || monitorState === "done" || artistMonitored}`).

- [ ] **Step 3: MissingAlbumsSection.** Create `packages/desktop/src/renderer/src/ui/MissingAlbumsSection.tsx`:

```tsx
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import type { AcquirableAlbumDto } from "../../../shared/ipc-contract";
import { badgeFor } from "./acquisition-badges";
import { GridCard } from "./GridCard";
import { useAcquisitionAvailable } from "./hooks/useAcquisitionAvailable";

type FetchState = { status: "idle" } | { status: "ok"; albums: AcquirableAlbumDto[] };

/** "Not in your library" section for an owned artist's page: the merged
 *  external discography (last.fm ∪ acquisition providers) minus owned albums,
 *  with per-album monitor actions. Hidden entirely when no acquisition
 *  provider is enabled or nothing is missing. */
export function MissingAlbumsSection({ artistName }: { artistName: string }) {
  const acquisitionAvailable = useAcquisitionAvailable();
  const [fetch, setFetch] = useState<FetchState>({ status: "idle" });

  useEffect(() => {
    if (!acquisitionAvailable) return;
    let cancelled = false;
    setFetch({ status: "idle" });
    window.musex
      .acquisitionDiscography(artistName)
      .then((albums) => {
        if (cancelled) return;
        setFetch({ status: "ok", albums: albums.filter((a) => a.state !== "owned") });
      })
      .catch(() => {
        // discovery section is best-effort — hidden on failure
      });
    return () => {
      cancelled = true;
    };
  }, [artistName, acquisitionAvailable]);

  if (fetch.status !== "ok" || fetch.albums.length === 0) return null;

  function acquire(album: AcquirableAlbumDto) {
    // Optimistic flip to "requested"; revert on failure (plugin toasts).
    setFetch((prev) =>
      prev.status === "ok"
        ? {
            status: "ok",
            albums: prev.albums.map((a) =>
              a.providerId === album.providerId && a.providerRef === album.providerRef
                ? { ...a, state: "requested" as const }
                : a,
            ),
          }
        : prev,
    );
    window.musex
      .acquisitionAcquire({ providerId: album.providerId, providerRef: album.providerRef })
      .catch((err: unknown) => {
        console.error("[acquisition] acquire failed:", err);
        setFetch((prev) =>
          prev.status === "ok"
            ? {
                status: "ok",
                albums: prev.albums.map((a) =>
                  a.providerId === album.providerId && a.providerRef === album.providerRef
                    ? { ...a, state: "available" as const }
                    : a,
                ),
              }
            : prev,
        );
      });
  }

  return (
    <section className="home-row">
      <h3 className="browse-title">Not in your library</h3>
      <div className="browse-grid">
        {fetch.albums.map((album) => {
          const chip = badgeFor(album);
          return (
            <GridCard
              key={`${album.providerId}:${album.providerRef}`}
              thumb={album.imageUrl}
              title={album.title}
              subtitle={album.year != null ? String(album.year) : undefined}
              badge={chip?.badge}
              badgeVariant={chip?.variant}
              dim={album.state === "unavailable"}
              onOpen={() => {}}
              actionIcon={album.state === "available" ? Download : undefined}
              actionTitle="Monitor album — download it"
              onAction={album.state === "available" ? () => acquire(album) : undefined}
            />
          );
        })}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Mount it.** In `ArtistDetailView.tsx`, render `<MissingAlbumsSection artistName={artist.name} />` AFTER the owned-albums grid (read the file to find the end of the grid; the section hides itself when empty/unavailable).

- [ ] **Step 5: Verify and commit**

```bash
pnpm exec biome check --write . && pnpm check && git add -A && git commit -m "feat: merged discography view + missing-albums section on artist pages" && git push
```

---

### Task 8: Live verification + docs + PR (controller runs this, not a subagent)

- [ ] **Step 1: Live e2e** (`pnpm dev` + CDP): Home opens on launch with spaced labels, smart-mix collages (plus glyph chip), playlist fallback art for thumbless playlists, no empty-playlist tiles; sidebar order Artists/Albums/Tracks/Genres with count badges; back/forward buttons + ⌘[/⌘] step through history; Discover unowned tile → artist-info panel (bio, stats, last.fm link, Browse albums → merged discography incl. dimmed unavailable rows); monitor action flips badge to "monitored"; owned-artist page shows "Not in your library" when albums are missing. (Be careful in the live app: do NOT actually monitor an artist/album unless using something already monitored — verification of the buttons' wiring can stop at observing the IPC round-trip/optimistic state, no real Lidarr mutations.)

- [ ] **Step 2: CLAUDE.md** — append an Architecture bullet: home/nav/discover polish (spec link); nav history is pure `logic/nav-history.ts` in the app reducer (`history` + `nav-back/forward`, ⌘[/⌘]); panel system gained `artist-info` kind with `openArtistInfo(name)` payload; plugin API additions (optional, apiVersion 1): `SimilarProvider.artistInfo`, `AcquisitionProvider.listMonitoredArtists`; host `externalDiscography` = lookup ∪ topAlbums via pure `logic/discography-merge.ts` (lastfm-only titles → state "unavailable", providerId "external"); `listMonitoredArtists` host-cached 60s; smart-mix tile art via `smartMixThumbs` (for-you approximates with top-taste artists).

- [ ] **Step 3: PR**

```bash
git add -A && git commit -m "docs: record home/nav/discover architecture" && git push
gh pr create --draft --title "feat: home and navigation polish, in-app artist discovery and acquisition" --body "(summary of all eleven items + verification notes)

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

(Write the real PR body at execution time — list every shipped item and what was verified live. Conventional title required — squash subject feeds release-please.)
