# Discovery UI Consistency Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make artist/album/song navigation, monitoring/acquisition state, the side panel, and action buttons consistent across every discovery view by introducing four shared building blocks and adopting them everywhere.

**Architecture:** Four new shared renderer pieces — `ActionBar`, `StateBadge`, `EntityLink`, and a reactive `MonitoringProvider` store — plus a unified `EntityPanel` that replaces the separate track/artist-info panels. Pure mappings (badge state, nav-target resolution, the monitoring reducer) are extracted into testable functions; React components compose them. Views are then refactored to use the shared pieces, and superseded classes/components are retired.

**Tech Stack:** React 19, TypeScript 6, Vite, lucide-react icons, plain CSS (`theme.css`), vitest 4. All work is in `packages/desktop/src/renderer/src`. Spec: `docs/superpowers/specs/2026-06-15-discovery-ui-consistency-design.md`.

**Conventions:** Icons are always `lucide-react` (no emoji). Theme color tokens in `theme.css` (`--green #54d2a0`, `--purple`, `--red`, `--yellow`, `--muted`, `--line`, `--panel-2`). Run `pnpm check` (typecheck + biome + tests) before each commit; use `npx pnpm@11.5.2` if `pnpm` isn't on PATH. Conventional-commit messages; commit after each task.

---

## File Structure

**New files:**
- `packages/desktop/src/renderer/src/ui/discovery/StateBadge.tsx` — acquisition-state badge component.
- `packages/desktop/src/renderer/src/ui/discovery/state-badge.ts` — pure `acquisitionBadge()` mapping.
- `packages/desktop/src/renderer/src/ui/discovery/state-badge.test.ts`
- `packages/desktop/src/renderer/src/ui/discovery/ActionBar.tsx` — shared entity action bar.
- `packages/desktop/src/renderer/src/ui/discovery/EntityLink.tsx` — navigable name component.
- `packages/desktop/src/renderer/src/ui/discovery/entity-target.ts` — pure nav-target resolution.
- `packages/desktop/src/renderer/src/ui/discovery/entity-target.test.ts`
- `packages/desktop/src/renderer/src/ui/discovery/EntityPanel.tsx` — unified artist/album/song panel.
- `packages/desktop/src/renderer/src/ui/discovery/MonitorButton.tsx` — monitor toggle + watch, store-backed.
- `packages/desktop/src/renderer/src/ui/discovery/MonitorStatusLine.tsx` — "● Watching… · N downloading".
- `packages/desktop/src/renderer/src/state/monitoring.tsx` — `MonitoringProvider` + `useMonitoring`.
- `packages/desktop/src/renderer/src/state/monitoring-reducer.ts` — pure store reducer.
- `packages/desktop/src/renderer/src/state/monitoring-reducer.test.ts`

**Modified (adoption):** `ui/views/ArtistDetailView.tsx`, `AlbumDetailView.tsx`, `GenreView.tsx`, `MixView.tsx`, `ExternalArtistView.tsx`, `SearchView.tsx`, `SimilarView.tsx`, `DownloadsView.tsx`, `HomeView.tsx`, `ui/GridCard.tsx`, `ui/TrackRow.tsx`, `ui/SidePanel.tsx`, `state/panel.tsx`, `state/app.tsx` (wrap `MonitoringProvider`), `ui/theme.css`.

**Retired after adoption:** `ui/WatchNewReleasesButton.tsx`, `ui/TrackDetailPanel.tsx`, `ui/ArtistInfoPanel.tsx`, and CSS classes `.play-btn`, `.shuffle-btn`, `.album-more-btn`, `.detail-secondary`, `.watch-btn*`, `.expansion-chip--*` (folded into the new classes).

---

## Task 1: CSS primitives for the action bar

**Files:** Modify `packages/desktop/src/renderer/src/ui/theme.css` (append a new section near the existing `.play-btn` block).

- [ ] **Step 1: Add the shared action-bar classes**

Append to `theme.css`:

```css
/* ---- Shared discovery action bar (one icon-button size everywhere) ---- */
:root { --icon-btn: 40px; }
.action-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.action-play {
  width: 46px; height: 46px; border-radius: 50%; border: none;
  background: var(--green); color: #0d0e12; display: grid; place-items: center;
  cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,.35);
  transition: transform .12s ease, opacity .12s ease;
}
.action-play:hover { transform: scale(1.05); }
.action-icon {
  width: var(--icon-btn); height: var(--icon-btn); border-radius: 50%;
  background: transparent; border: 1px solid var(--line); color: var(--text);
  display: grid; place-items: center; cursor: pointer; transition: all .12s ease;
}
.action-icon:hover { border-color: var(--green); color: var(--green); }
.action-pill {
  height: 34px; padding: 0 14px; border-radius: 18px; border: 1px solid var(--line);
  background: transparent; color: var(--text); display: inline-flex; align-items: center;
  gap: 7px; font-size: 13px; cursor: pointer; transition: all .12s ease;
}
.action-pill:hover { border-color: var(--green); }
.action-pill--on { border-color: var(--green); color: var(--green); background: rgba(84,210,160,.12); }
.action-pill:disabled, .action-icon:disabled { opacity: .5; cursor: default; }
.monitor-status { margin-top: 11px; font-size: 12px; color: var(--green); display: flex; align-items: center; gap: 6px; }
```

- [ ] **Step 2: Add the unified state-badge classes**

Append to `theme.css`:

```css
/* ---- Unified acquisition state badge (replaces grid-card-badge--* / expansion-chip--*) ---- */
.state-badge {
  font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 999px;
  display: inline-flex; align-items: center; gap: 5px; white-space: nowrap;
}
.state-badge--owned { background: var(--green); color: #0d0e12; }
.state-badge--downloaded { background: rgba(0,0,0,.5); border: 1px solid var(--green); color: var(--green); }
.state-badge--downloading { background: rgba(0,0,0,.5); border: 1px solid var(--yellow); color: var(--yellow); }
.state-badge--requested { background: rgba(0,0,0,.5); border: 1px solid var(--purple); color: #b9a8ff; }
.state-badge--available { background: rgba(84,210,160,.14); border: 1px solid var(--green); color: var(--green); }
.state-badge--unavailable { background: rgba(0,0,0,.5); border: 1px solid rgba(255,95,87,.6); color: #ff8a84; }
/* small bell corner-marker on monitored artist cards */
.card-monitored { position: absolute; top: 7px; right: 7px; width: 22px; height: 22px; border-radius: 50%; background: rgba(0,0,0,.6); border: 1px solid var(--green); color: var(--green); display: grid; place-items: center; }
```

- [ ] **Step 3: Verify the stylesheet still parses**

Run: `npx pnpm@11.5.2 --filter @musex/desktop run build`
Expected: build succeeds (CSS is bundled by Vite). No `*/`-in-comment hazards introduced (see CLAUDE.md CSS gotcha).

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/src/ui/theme.css
git commit -m "feat(ui): shared action-bar + state-badge CSS primitives"
```

---

## Task 2: `StateBadge` component + pure mapping (TDD)

**Files:**
- Create `ui/discovery/state-badge.ts`, `ui/discovery/state-badge.test.ts`, `ui/discovery/StateBadge.tsx`

The acquisition state enum already used across views is: `"owned" | "downloaded" | "downloading" | "requested" | "available" | "unavailable"` (see `ExternalArtistView` `badgeFor()` and `AcquisitionState` in `@musex/plugin-api`). `downloading` may carry a percent.

- [ ] **Step 1: Write the failing test**

`ui/discovery/state-badge.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { acquisitionBadge } from "./state-badge";

describe("acquisitionBadge", () => {
  it("maps owned to the In library label + variant", () => {
    expect(acquisitionBadge("owned")).toEqual({ label: "In library", variant: "owned" });
  });
  it("includes percent for downloading when provided", () => {
    expect(acquisitionBadge("downloading", 45)).toEqual({ label: "Downloading 45%", variant: "downloading" });
  });
  it("downloading without percent omits it", () => {
    expect(acquisitionBadge("downloading")).toEqual({ label: "Downloading", variant: "downloading" });
  });
  it("maps available to Get", () => {
    expect(acquisitionBadge("available")).toEqual({ label: "Get", variant: "available" });
  });
  it("returns null for an unknown state", () => {
    expect(acquisitionBadge("bogus" as never)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `npx pnpm@11.5.2 --filter @musex/desktop exec vitest run src/renderer/src/ui/discovery/state-badge.test.ts`
Expected: FAIL (`acquisitionBadge` not defined).

- [ ] **Step 3: Implement the mapping**

`ui/discovery/state-badge.ts`:

```ts
export type AcquisitionBadgeState =
  | "owned" | "downloaded" | "downloading" | "requested" | "available" | "unavailable";

const LABELS: Record<AcquisitionBadgeState, string> = {
  owned: "In library",
  downloaded: "Downloaded",
  downloading: "Downloading",
  requested: "Requested",
  available: "Get",
  unavailable: "Unavailable",
};

export interface BadgeInfo { label: string; variant: AcquisitionBadgeState }

/** Pure: acquisition state (+ optional download percent) → badge label + variant.
 *  Returns null for unknown states so callers render nothing. */
export function acquisitionBadge(state: AcquisitionBadgeState, percent?: number): BadgeInfo | null {
  const base = LABELS[state];
  if (!base) return null;
  if (state === "downloading" && typeof percent === "number") {
    return { label: `Downloading ${Math.round(percent)}%`, variant: state };
  }
  return { label: base, variant: state };
}
```

- [ ] **Step 4: Run the test, verify pass**

Run: `npx pnpm@11.5.2 --filter @musex/desktop exec vitest run src/renderer/src/ui/discovery/state-badge.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the component**

`ui/discovery/StateBadge.tsx`:

```tsx
import { Check, Download, CircleDot, Plus, X } from "lucide-react";
import { acquisitionBadge, type AcquisitionBadgeState } from "./state-badge";

const ICON = {
  owned: Check, downloaded: Check, downloading: Download,
  requested: CircleDot, available: Plus, unavailable: X,
} as const;

/** One acquisition-state badge, used on every album/track card, row, and feed. */
export function StateBadge({ state, percent }: { state: AcquisitionBadgeState; percent?: number }) {
  const info = acquisitionBadge(state, percent);
  if (!info) return null;
  const Icon = ICON[info.variant];
  return (
    <span className={`state-badge state-badge--${info.variant}`}>
      <Icon size={11} />
      {info.label}
    </span>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/src/ui/discovery/state-badge.ts packages/desktop/src/renderer/src/ui/discovery/state-badge.test.ts packages/desktop/src/renderer/src/ui/discovery/StateBadge.tsx
git commit -m "feat(ui): StateBadge component + acquisitionBadge mapping"
```

---

## Task 3: `ActionBar` component

**Files:** Create `ui/discovery/ActionBar.tsx`.

Props are an explicit action set so each view passes only what applies. Uses lucide icons (Play, Shuffle, Sparkles for Similar, MoreHorizontal for overflow). Overflow menu reuses the existing `.more-dropdown`/`.ctx-item` pattern — pass items through to it.

- [ ] **Step 1: Write the component**

`ui/discovery/ActionBar.tsx`:

```tsx
import { MoreHorizontal, Play, Shuffle, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

export interface ActionBarProps {
  onPlay?: () => void;          // primary; omit to hide
  onShuffle?: () => void;
  onSimilar?: () => void;       // labeled "Similar" pill
  /** Monitor pill: omit to hide. `on` lights it green and flips the label. */
  monitor?: { on: boolean; busy?: boolean; onToggle: () => void };
  /** Overflow ⋯ menu trigger; render the menu yourself via `overflow`. */
  overflow?: ReactNode;         // a <button class="action-icon"> that opens a menu
  /** Extra trailing content (e.g. a Watch bell) rendered after the pills. */
  children?: ReactNode;
}

export function ActionBar({ onPlay, onShuffle, onSimilar, monitor, overflow, children }: ActionBarProps) {
  return (
    <div className="action-bar">
      {onPlay && (
        <button type="button" className="action-play" title="Play" aria-label="Play" onClick={onPlay}>
          <Play size={18} />
        </button>
      )}
      {onShuffle && (
        <button type="button" className="action-icon" title="Shuffle" aria-label="Shuffle" onClick={onShuffle}>
          <Shuffle size={16} />
        </button>
      )}
      {onSimilar && (
        <button type="button" className="action-pill" onClick={onSimilar}>
          <Sparkles size={15} /> Similar
        </button>
      )}
      {monitor && (
        <button
          type="button"
          className={`action-pill${monitor.on ? " action-pill--on" : ""}`}
          disabled={monitor.busy}
          onClick={monitor.onToggle}
        >
          {monitor.on ? "Monitoring" : "Monitor"}
        </button>
      )}
      {children}
      {overflow}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `npx pnpm@11.5.2 --filter @musex/desktop run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/src/ui/discovery/ActionBar.tsx
git commit -m "feat(ui): shared ActionBar component"
```

---

## Task 4: `EntityLink` + pure target resolution (TDD)

**Files:** Create `ui/discovery/entity-target.ts`, `entity-target.test.ts`, `EntityLink.tsx`.

Navigation uses the `View` union (`state/app.tsx`). An entity link resolves to a `View` (owned artist/album), the `external-artist` view (unowned, with provider), or `null` (caller falls back to an external URL or plain text).

- [ ] **Step 1: Write the failing test**

`ui/discovery/entity-target.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveEntityTarget } from "./entity-target";

describe("resolveEntityTarget", () => {
  it("owned artist → artist view", () => {
    expect(resolveEntityTarget({ kind: "artist", artistId: "a1", serverId: "s1", name: "Bonobo" }))
      .toEqual({ name: "artist", artist: { id: "a1", serverId: "s1", name: "Bonobo" } });
  });
  it("artist without id but with provider → external-artist view", () => {
    expect(resolveEntityTarget({ kind: "artist", name: "Bonobo", hasProvider: true }))
      .toEqual({ name: "external-artist", artistName: "Bonobo" });
  });
  it("artist without id and no provider → null", () => {
    expect(resolveEntityTarget({ kind: "artist", name: "Bonobo" })).toBeNull();
  });
  it("owned album → album view", () => {
    const r = resolveEntityTarget({ kind: "album", albumId: "al1", serverId: "s1", artistId: "a1", title: "Migration" });
    expect(r).toEqual({ name: "album", album: { id: "al1", serverId: "s1", artistId: "a1", title: "Migration", thumb: undefined } });
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `npx pnpm@11.5.2 --filter @musex/desktop exec vitest run src/renderer/src/ui/discovery/entity-target.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`ui/discovery/entity-target.ts`:

```ts
import type { View } from "../../state/app";

export type EntityRef =
  | { kind: "artist"; name: string; artistId?: string; serverId?: string; hasProvider?: boolean }
  | { kind: "album"; albumId?: string; serverId?: string; artistId?: string; title?: string; thumb?: string };

/** Pure: resolve an entity reference to a navigation View, or null when it
 *  isn't navigable in-app (caller opens an external URL or renders plain text). */
export function resolveEntityTarget(ref: EntityRef): View | null {
  if (ref.kind === "artist") {
    if (ref.artistId && ref.serverId) {
      return { name: "artist", artist: { id: ref.artistId, serverId: ref.serverId, name: ref.name } };
    }
    if (ref.hasProvider) return { name: "external-artist", artistName: ref.name };
    return null;
  }
  if (ref.albumId && ref.serverId && ref.artistId) {
    return {
      name: "album",
      album: { id: ref.albumId, serverId: ref.serverId, artistId: ref.artistId, title: ref.title ?? "", thumb: ref.thumb },
    };
  }
  return null;
}
```

> Note: the `artist`/`album` View payloads use the `@musex/core` `Artist`/`Album` types. If those types carry required fields beyond what's set here, the executing engineer must read `state/app.tsx` imports and include them (read the `Artist`/`Album` interfaces before implementing). Adjust the test's expected objects to match.

- [ ] **Step 4: Run the test, verify pass**

Run: `npx pnpm@11.5.2 --filter @musex/desktop exec vitest run src/renderer/src/ui/discovery/entity-target.test.ts`
Expected: PASS.

- [ ] **Step 5: Write `EntityLink.tsx`**

```tsx
import { useApp } from "../../state/app";
import { type EntityRef, resolveEntityTarget } from "./entity-target";

/** A consistent, navigable name. Owned → detail view; unowned-with-provider →
 *  external-artist; otherwise renders plain text (no dead links). */
export function EntityLink({ ref, children }: { ref: EntityRef; children: React.ReactNode }) {
  const { dispatch } = useApp();
  const target = resolveEntityTarget(ref);
  if (!target) return <span>{children}</span>;
  return (
    <button type="button" className="link-quiet" onClick={() => dispatch({ type: "navigate", view: target })}>
      {children}
    </button>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/src/ui/discovery/entity-target.ts packages/desktop/src/renderer/src/ui/discovery/entity-target.test.ts packages/desktop/src/renderer/src/ui/discovery/EntityLink.tsx
git commit -m "feat(ui): EntityLink + resolveEntityTarget"
```

---

## Task 5: Reactive monitoring store (TDD)

**Files:** Create `state/monitoring-reducer.ts`, `monitoring-reducer.test.ts`, `state/monitoring.tsx`.

The store holds a set of monitored artist names (lowercased) and watched artist names, seeded from `acquisitionMonitoredArtists()` and `newReleaseWatchList()` (see `window.musex` in preload). Optimistic updates on toggle; revert handled by the caller re-dispatching on error.

- [ ] **Step 1: Write the failing test**

`state/monitoring-reducer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { type MonitoringState, monitoringReducer, isMonitored, isWatched } from "./monitoring-reducer";

const empty: MonitoringState = { monitored: new Set(), watched: new Set() };

describe("monitoringReducer", () => {
  it("seeds from server lists (case-insensitive)", () => {
    const s = monitoringReducer(empty, { type: "seed", monitored: ["Bonobo"], watched: ["Tycho"] });
    expect(isMonitored(s, "bonobo")).toBe(true);
    expect(isWatched(s, "TYCHO")).toBe(true);
  });
  it("setMonitored adds/removes optimistically", () => {
    let s = monitoringReducer(empty, { type: "setMonitored", name: "Bonobo", value: true });
    expect(isMonitored(s, "bonobo")).toBe(true);
    s = monitoringReducer(s, { type: "setMonitored", name: "Bonobo", value: false });
    expect(isMonitored(s, "bonobo")).toBe(false);
  });
  it("setWatched toggles watched independently", () => {
    const s = monitoringReducer(empty, { type: "setWatched", name: "Bonobo", value: true });
    expect(isWatched(s, "bonobo")).toBe(true);
    expect(isMonitored(s, "bonobo")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify failure**

Run: `npx pnpm@11.5.2 --filter @musex/desktop exec vitest run src/renderer/src/state/monitoring-reducer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the reducer**

`state/monitoring-reducer.ts`:

```ts
export interface MonitoringState { monitored: Set<string>; watched: Set<string> }

export type MonitoringAction =
  | { type: "seed"; monitored: string[]; watched: string[] }
  | { type: "setMonitored"; name: string; value: boolean }
  | { type: "setWatched"; name: string; value: boolean };

const k = (s: string) => s.trim().toLowerCase();
const withToggle = (set: Set<string>, name: string, value: boolean): Set<string> => {
  const next = new Set(set);
  if (value) next.add(k(name));
  else next.delete(k(name));
  return next;
};

export function monitoringReducer(state: MonitoringState, a: MonitoringAction): MonitoringState {
  switch (a.type) {
    case "seed":
      return { monitored: new Set(a.monitored.map(k)), watched: new Set(a.watched.map(k)) };
    case "setMonitored":
      return { ...state, monitored: withToggle(state.monitored, a.name, a.value) };
    case "setWatched":
      return { ...state, watched: withToggle(state.watched, a.name, a.value) };
  }
}

export const isMonitored = (s: MonitoringState, name: string) => s.monitored.has(k(name));
export const isWatched = (s: MonitoringState, name: string) => s.watched.has(k(name));
```

- [ ] **Step 4: Run the test, verify pass**

Run: `npx pnpm@11.5.2 --filter @musex/desktop exec vitest run src/renderer/src/state/monitoring-reducer.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the provider**

`state/monitoring.tsx` — a context exposing `{ isMonitored(name), isWatched(name), setMonitored(name, value), setWatched(name, value), refresh() }`. On mount, `refresh()` calls `window.musex.acquisitionMonitoredArtists()` and `window.musex.newReleaseWatchList()` and dispatches `seed`. `setMonitored`/`setWatched` optimistically dispatch, call the IPC (`acquisitionAcquireArtistByName` / `newReleaseWatchSet`), and on error re-dispatch the inverse + surface a toast via the existing toast mechanism. Read `state/app.tsx` and an existing optimistic caller (e.g. the audio-prefs Settings handler) for the toast pattern before implementing.

```tsx
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useReducer } from "react";
import { isMonitored, isWatched, monitoringReducer } from "./monitoring-reducer";

interface MonitoringApi {
  isMonitored(name: string): boolean;
  isWatched(name: string): boolean;
  setMonitored(name: string, value: boolean): Promise<void>;
  setWatched(name: string, value: boolean): Promise<void>;
  refresh(): void;
}
const Ctx = createContext<MonitoringApi | null>(null);

export function MonitoringProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(monitoringReducer, { monitored: new Set(), watched: new Set() });
  const refresh = () => {
    void Promise.all([window.musex.acquisitionMonitoredArtists(), window.musex.newReleaseWatchList()])
      .then(([monitored, watched]) =>
        dispatch({ type: "seed", monitored: monitored ?? [], watched: (watched ?? []).map((w) => w.artistName ?? w) }))
      .catch((err) => console.error("[monitoring] seed failed:", err));
  };
  useEffect(refresh, []);
  const api = useMemo<MonitoringApi>(() => ({
    isMonitored: (n) => isMonitored(state, n),
    isWatched: (n) => isWatched(state, n),
    async setMonitored(name, value) {
      dispatch({ type: "setMonitored", name, value });
      try { await window.musex.acquisitionAcquireArtistByName(name); }
      catch (err) { dispatch({ type: "setMonitored", name, value: !value }); throw err; }
    },
    async setWatched(name, value) {
      dispatch({ type: "setWatched", name, value });
      try { await window.musex.newReleaseWatchSet(name, value); }
      catch (err) { dispatch({ type: "setWatched", name, value: !value }); throw err; }
    },
    refresh,
  }), [state]);
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useMonitoring(): MonitoringApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("useMonitoring must be used within MonitoringProvider");
  return v;
}
```

> Note: confirm the shape returned by `newReleaseWatchList()` (array of strings vs objects with `artistName`) by reading `ipc-contract.ts`; adjust the `.map` accordingly. `acquisitionAcquireArtistByName` is the existing "monitor entire artist" IPC.

- [ ] **Step 6: Run typecheck + the reducer test**

Run: `npx pnpm@11.5.2 --filter @musex/desktop run typecheck && npx pnpm@11.5.2 --filter @musex/desktop exec vitest run src/renderer/src/state/monitoring-reducer.test.ts`
Expected: PASS.

- [ ] **Step 7: Wrap the app in `MonitoringProvider`**

Modify `state/app.tsx` (or wherever `PanelProvider` wraps the tree — read it first) to nest `<MonitoringProvider>` alongside the other providers.

- [ ] **Step 8: Commit**

```bash
git add packages/desktop/src/renderer/src/state/monitoring-reducer.ts packages/desktop/src/renderer/src/state/monitoring-reducer.test.ts packages/desktop/src/renderer/src/state/monitoring.tsx packages/desktop/src/renderer/src/state/app.tsx
git commit -m "feat(ui): reactive monitoring store (live monitor/watch state)"
```

---

## Task 6: `MonitorButton` + `MonitorStatusLine`

**Files:** Create `ui/discovery/MonitorButton.tsx`, `ui/discovery/MonitorStatusLine.tsx`.

- [ ] **Step 1: `MonitorButton.tsx`** — store-backed monitor toggle, returns the props the `ActionBar` `monitor` prop expects, plus an internal busy state and a catch that toasts on failure. It renders nothing (returns `null` for the pill) when no acquisition provider supports monitoring (check via `window.musex.acquisitionAvailable()` once, like `WatchNewReleasesButton` does for watch). Expose it as a hook `useMonitorAction(artistName)` returning `{ on, busy, onToggle, supported }` so `ActionBar` callers spread it into `monitor`.

```tsx
import { useEffect, useState } from "react";
import { useMonitoring } from "../../state/monitoring";

export function useMonitorAction(artistName: string) {
  const mon = useMonitoring();
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void window.musex.acquisitionAvailable().then(setSupported).catch(() => setSupported(false)); }, []);
  const on = mon.isMonitored(artistName);
  return {
    supported,
    on,
    busy,
    onToggle: async () => {
      setBusy(true);
      try { await mon.setMonitored(artistName, !on); }
      catch (err) { console.error("[monitor] toggle failed:", err); /* toast via existing mechanism */ }
      finally { setBusy(false); }
    },
  };
}
```

- [ ] **Step 2: `MonitorStatusLine.tsx`** — given `artistName` + a count of in-flight downloads (from `acquisitionStatus()` filtered to this artist, or passed in by the view), renders `● Watching for new releases · N downloading` when monitored/watched, else nothing. Use `.monitor-status`. Keep it presentational: accept `{ watching: boolean; downloading: number }` props; the view computes them.

```tsx
export function MonitorStatusLine({ watching, downloading }: { watching: boolean; downloading: number }) {
  if (!watching && downloading === 0) return null;
  const parts: string[] = [];
  if (watching) parts.push("Watching for new releases");
  if (downloading > 0) parts.push(`${downloading} downloading`);
  return <div className="monitor-status">● {parts.join(" · ")}</div>;
}
```

- [ ] **Step 3: Typecheck + commit**

Run: `npx pnpm@11.5.2 --filter @musex/desktop run typecheck`

```bash
git add packages/desktop/src/renderer/src/ui/discovery/MonitorButton.tsx packages/desktop/src/renderer/src/ui/discovery/MonitorStatusLine.tsx
git commit -m "feat(ui): store-backed MonitorButton + MonitorStatusLine"
```

---

## Task 7: Panel state — add unified `entity` kind

**Files:** Modify `state/panel.tsx`.

- [ ] **Step 1: Extend `PanelKind` + payload**

Add `"entity"` to `PanelKind`. Add a payload type and opener:

```ts
export type EntityPanelPayload =
  | { kind: "artist"; artistName: string; artistId?: string; serverId?: string; thumb?: string }
  | { kind: "album"; album: import("@musex/core").Album }
  | { kind: "song"; track: import("@musex/core").Track };
```

Add to `PanelApi`: `entityPayload: EntityPanelPayload | null;` and `openEntity(payload: EntityPanelPayload): void;`. Implement with a `useState` like `artistInfoName`, setting `panel` to `"entity"`. Keep `openArtistInfo` as a thin wrapper that calls `openEntity({ kind: "artist", artistName })` during migration, OR remove it once views are migrated (Task 9/11). Keep `"track"` working until `EntityPanel` replaces it (Task 8). The `"queue"` kind is unchanged.

- [ ] **Step 2: Typecheck + commit**

Run: `npx pnpm@11.5.2 --filter @musex/desktop run typecheck`

```bash
git add packages/desktop/src/renderer/src/state/panel.tsx
git commit -m "feat(ui): panel state gains unified entity kind"
```

---

## Task 8: `EntityPanel` + SidePanel wiring

**Files:** Create `ui/discovery/EntityPanel.tsx`; modify `ui/SidePanel.tsx`.

Read `ui/TrackDetailPanel.tsx` and `ui/ArtistInfoPanel.tsx` fully first — `EntityPanel` must preserve their behavior (album art / artist image, breadcrumb links, Play, Similar, metadata, listening stats, plugin detail sections via `trackDetailGet`, artist bio via `artistInfoGet`).

- [ ] **Step 1: Build `EntityPanel.tsx`** — switches on `payload.kind`:
  - Header: `.detail-head` with kind label ("Artist"/"Album"/"Song") + close button (reuse `.detail-close`).
  - Hero artwork: full-width `.detail-art`; round for artist (add `artist-art`), square otherwise.
  - Title + breadcrumb built from `EntityLink`s (artist→album for songs; nothing above artist).
  - "Now playing" cue (lucide `AudioLines` or the existing eq icon) when `payload.kind==="song"` and the track matches the currently-playing track (read how `TrackRow` detects `playing`).
  - `ActionBar` with the applicable subset (song: Play + Similar; album: Play + Shuffle + Similar?; artist: Play + Similar + Monitor via `useMonitorAction`).
  - Details: reuse the metadata/stats markup from `TrackDetailPanel`.
  - About: render `artistInfoGet` bio (artist) / plugin `trackDetailGet` sections (song); omit when empty (the panel already handles null today).

- [ ] **Step 2: Wire `SidePanel.tsx`** — when `panel === "entity"`, render `<EntityPanel payload={entityPayload!} />`; keep `"queue"`. Remove the `"track"` and `"artist-info"` branches once their openers are migrated (Tasks 9/11/14). Selecting a track now calls `openEntity({ kind: "song", track })`.

- [ ] **Step 3: Typecheck + build + manual**

Run: `npx pnpm@11.5.2 --filter @musex/desktop run typecheck`
Then `pnpm dev` and verify: selecting a track opens the song panel with hero art + About; opening an artist shows round art + bio + Monitor.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/src/ui/discovery/EntityPanel.tsx packages/desktop/src/renderer/src/ui/SidePanel.tsx
git commit -m "feat(ui): unified EntityPanel (artist/album/song) with hero art + About"
```

---

## Task 9: Adopt ActionBar/Monitor in ArtistDetailView

**Files:** Modify `ui/views/ArtistDetailView.tsx`. Read it first.

- [ ] **Step 1:** Replace the header's `.play-btn`/`.shuffle-btn`/Similar-icon/`WatchNewReleasesButton`/`.more-dropdown` with a single `<ActionBar>`: `onPlay`=play all, `onShuffle`=shuffle all, `onSimilar`=navigate to `{name:"similar", target:{...artist}}`, `monitor`=`useMonitorAction(artist.name)` (only when `.supported`), `overflow`=the existing more-menu trigger. Add `<MonitorStatusLine watching={mon.isWatched(name)} downloading={n} />` under the bar (compute `n` from `acquisitionStatus()` for this artist, or pass 0 for now and refine in Task 13).
- [ ] **Step 2:** Make the album grid cards' titles and the artist name use `EntityLink` where applicable (album cards already navigate via `onOpen`; keep that).
- [ ] **Step 3:** Typecheck, `pnpm dev` verify the artist header, commit.

```bash
git commit -am "refactor(ui): ArtistDetailView uses shared ActionBar + monitoring store"
```

---

## Task 10: Adopt ActionBar in Album / Genre / Mix views

**Files:** Modify `ui/views/AlbumDetailView.tsx`, `GenreView.tsx`, `MixView.tsx`. Read each first.

- [ ] **Step 1:** Replace each header's `.play-btn`/`.shuffle-btn`/`.album-more-btn` cluster with `<ActionBar onPlay onShuffle overflow={...} />` (no Monitor for these). Album view: artist name in the header becomes an `EntityLink`.
- [ ] **Step 2:** Typecheck, `pnpm dev` verify all three headers, commit.

```bash
git commit -am "refactor(ui): Album/Genre/Mix headers use shared ActionBar"
```

---

## Task 11: Adopt in ExternalArtistView + Search external section

**Files:** Modify `ui/views/ExternalArtistView.tsx`, `SearchView.tsx`. Read first.

- [ ] **Step 1: ExternalArtistView:** replace the "Monitor entire artist" `.shuffle-btn` + inline text + separate badge with one `<ActionBar>` carrying the `monitor` action (store-backed) + `MonitorStatusLine`. Album discography cards use `<StateBadge>` for their state and a `+ Get` action when available.
- [ ] **Step 2: SearchView "Not in your library":** external artist cards show the small `.card-monitored` bell when `useMonitoring().isMonitored(name)` (live), and a Monitor hover action when not. Drop the one-off `badgeVariant="monitored"`.
- [ ] **Step 3:** Typecheck, `pnpm dev` verify monitoring an artist in Search reflects immediately in the external-artist view (live store), commit.

```bash
git commit -am "refactor(ui): External artist + Search adopt ActionBar/StateBadge/monitoring"
```

---

## Task 12: GridCard → StateBadge + monitored marker

**Files:** Modify `ui/GridCard.tsx`; update callers passing `badge`/`badgeVariant` (`SimilarView`, `SearchView`, `HomeView`, `ExternalArtistView`).

- [ ] **Step 1:** Add optional props `state?: AcquisitionBadgeState; statePercent?: number; monitored?: boolean` to `GridCard`. When `state` is set, render `<StateBadge>` in the corner (replacing the raw `badge`/`badgeVariant` path); when `monitored`, render the `.card-monitored` bell. Keep `badge` for the legacy "external" text chip during migration, then remove once all callers pass `state`.
- [ ] **Step 2:** Update `SimilarView`/`SearchView` to pass `state="available"`/`monitored` instead of ad-hoc badges; unify the "external" indicator.
- [ ] **Step 3:** Typecheck, `pnpm dev` verify cards across Home/Search/Similar/External, commit.

```bash
git commit -am "refactor(ui): GridCard renders StateBadge + monitored marker"
```

---

## Task 13: Downloads view → StateBadge + status counts

**Files:** Modify `ui/views/DownloadsView.tsx`. Read first.

- [ ] **Step 1:** Replace `.expansion-chip--*` and `grid-card-badge--*` chips with `<StateBadge>` (map expansion states: suggested→requested-style, landed→downloaded, etc. — pick the closest variant; if a state has no badge equivalent, keep a minimal `.dl-chip` but restyle to match `.state-badge`). The watched-artists list reads from `useMonitoring()` and unwatch updates the store live.
- [ ] **Step 2:** Export a small helper the artist views use for the `MonitorStatusLine` download count (downloads for a given artist from `acquisitionStatus()`), wiring the `n` left as 0 in Task 9.
- [ ] **Step 3:** Typecheck, `pnpm dev` verify, commit.

```bash
git commit -am "refactor(ui): Downloads view uses StateBadge + live watched list"
```

---

## Task 14: EntityLink everywhere + single Similar entry point

**Files:** Modify `ui/TrackRow.tsx` (and `TrackSubLinks` if separate), `EntityPanel.tsx`, `SearchView.tsx`, `SimilarView.tsx`, context menus (`TrackContextMenu`). Read each first.

- [ ] **Step 1:** Wrap artist/album names in track rows/subtitles, search results, similar results, and the panel breadcrumb in `<EntityLink>` (using `resolveEntityTarget`). Remove any plain-text-only names.
- [ ] **Step 2:** Ensure the only "Similar" affordance is the ActionBar pill + a "Find similar" context-menu item (remove the old artist-header Sparkles icon button — now handled by the pill in Task 9).
- [ ] **Step 3:** Typecheck, `pnpm dev` verify every name navigates, commit.

```bash
git commit -am "refactor(ui): navigable EntityLink names + single Similar entry point"
```

---

## Task 15: Retire superseded components/classes

**Files:** Delete `ui/WatchNewReleasesButton.tsx`, `ui/TrackDetailPanel.tsx`, `ui/ArtistInfoPanel.tsx` (once no imports remain). Remove dead CSS: `.play-btn`, `.shuffle-btn`, `.album-more-btn`, `.detail-secondary`, `.watch-btn*`, `.expansion-chip--*`, and the old `grid-card-badge--*` variants now unused.

- [ ] **Step 1:** `grep -rn "WatchNewReleasesButton\|TrackDetailPanel\|ArtistInfoPanel\|play-btn\|shuffle-btn\|album-more-btn\|expansion-chip\|grid-card-badge--" packages/desktop/src/renderer` — confirm no remaining references (except in the new code/CSS). Remove files/classes with zero references.
- [ ] **Step 2:** Typecheck + build + biome.

Run: `npx pnpm@11.5.2 --filter @musex/desktop run typecheck && npx pnpm@11.5.2 run check`

- [ ] **Step 3:** Commit.

```bash
git commit -am "refactor(ui): retire superseded panels/buttons and dead CSS"
```

---

## Task 16: Final verification

- [ ] **Step 1:** `npx pnpm@11.5.2 run check` — typecheck + biome + all tests pass (incl. the 3 new pure-logic suites).
- [ ] **Step 2:** `pnpm dev` — manual pass: Artist → Album → Song navigation; every name clickable; Similar from artist and song; Monitor an artist and watch it update in Search/External/Downloads live; panel slides in with hero art + About for each entity type; badges consistent on every card/row/feed.
- [ ] **Step 3:** Push the branch; open the PR (`feat: consistent discovery UI — shared action bar, badges, sliding entity panel, navigable names`).

---

## Self-Review notes

- **Spec coverage:** ActionBar (§1→T1,3,9,10,11), StateBadge (§2→T1,2,12,13), monitoring subtle+live (§3→T5,6,9,11,13), EntityPanel hero+About (§4→T7,8), EntityLink + single Similar (§5→T4,14), retire superseded (scope→T15), verification/tests (testing→T2,4,5,16). All covered.
- **Type consistency:** `AcquisitionBadgeState` (state-badge.ts) reused by GridCard/StateBadge; `EntityRef`/`resolveEntityTarget` reused by EntityLink/Task 14; `MonitoringState`/`useMonitoring` reused by MonitorButton/views; `EntityPanelPayload` reused by panel.tsx/EntityPanel/SidePanel.
- **Known read-before-implement points (flagged in tasks):** exact `Artist`/`Album` core type fields (T4), `newReleaseWatchList()` return shape (T5), toast mechanism (T5/T6), `TrackRow` playing-detection (T8), current view file contents (T9–T14). These are existing-code lookups, not undefined design.
