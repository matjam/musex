# iPad Desktop-Mirror Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** iPad renders a desktop-mirror layout (labeled sidebar in landscape / icon rail in portrait + full-width bottom player bar) while iPhone stays pixel-identical — spec `docs/superpowers/specs/2026-06-21-ipad-layout-design.md`.

**Architecture:** One `useLayoutMode()` hook drives all branching. The route tree is unchanged; `app/(tabs)/_layout.tsx` renders a two-column composition on iPad (sidebar + [content, offline banner, PlayerBar]) with the phone `TabList` hidden, using expo-router/ui `TabTrigger` switch-triggers in the sidebar. Grids derive columns from pane width.

**Tech Stack:** expo-router/ui headless Tabs (SDK 56), React Native 0.85, `@react-native-community/slider` (existing dep), lucide-react-native.

## Global Constraints

- **iPhone pixel-identical** — every change is gated on the layout mode; the phone branch must render the exact current tree.
- **`TabList` MUST remain a direct child of `Tabs`** (navigator scans direct children). Hide it with style on iPad; never unmount or wrap it.
- Verify expo-router/ui API claims against the installed package (`node_modules/expo-router/build/ui/`) — especially `TabTrigger` used OUTSIDE `TabList` as a switch-trigger (documented custom-tab-bar pattern: outside the list it takes `name` without `href`). If that doesn't hold in the installed version, fallback = style the real `TabList` as the sidebar (column flex) and move banner/PlayerBar composition accordingly; note the deviation.
- Icons: lucide-react-native only, no emoji. Styling: the `theme` object idiom (plain View/Text).
- `app.json` is externally managed (EAS/release-please) — keep its diff minimal.
- After each task: `pnpm exec biome check --write <files>`, root `pnpm check` exit 0, `git add -A`, commit, push (branch `feature/ipad-layout`).
- Native config changes (Task 5) need `expo prebuild`; CI `build-ios` will exercise them.

---

### Task 1: `useLayoutMode` (pure derivation + hook)

**Files:**
- Create: `packages/mobile/src/ui/layout-mode.ts` + `packages/mobile/src/ui/layout-mode.test.ts`

**Interfaces — Produces:**
```ts
export type LayoutMode = "phone" | "pad-portrait" | "pad-landscape";
export function deriveLayoutMode(input: { width: number; height: number; isPad: boolean }): LayoutMode;
export function useLayoutMode(): LayoutMode; // wraps useWindowDimensions + Platform.isPad ("pad" detection signal: Platform.OS === "ios" && Platform.isPad)
```
Rules: `!isPad → "phone"`; `isPad && width > height → "pad-landscape"`; else `"pad-portrait"`.

- [ ] **Step 1 — failing tests** (pure fn only; the hook is a thin untested wrapper):
```ts
import { describe, expect, it } from "vitest";
import { deriveLayoutMode } from "./layout-mode";
describe("deriveLayoutMode", () => {
  it("phone regardless of dimensions", () =>
    expect(deriveLayoutMode({ width: 900, height: 400, isPad: false })).toBe("phone"));
  it("pad landscape when wider than tall", () =>
    expect(deriveLayoutMode({ width: 1194, height: 834, isPad: true })).toBe("pad-landscape"));
  it("pad portrait when taller than wide (and square counts as portrait)", () => {
    expect(deriveLayoutMode({ width: 834, height: 1194, isPad: true })).toBe("pad-portrait");
    expect(deriveLayoutMode({ width: 800, height: 800, isPad: true })).toBe("pad-portrait");
  });
});
```
- [ ] **Step 2 — implement** (hook: `const { width, height } = useWindowDimensions(); return deriveLayoutMode({ width, height, isPad: Platform.OS === "ios" && (Platform as { isPad?: boolean }).isPad === true });` — check how `Platform.isPad` types in RN 0.85 and cast minimally). Tests pass.
- [ ] **Step 3 —** `pnpm check` → 0. Commit `feat(mobile): layout-mode hook (phone / pad-portrait / pad-landscape)`, push.

### Task 2: iPad sidebar + two-column tabs layout

**Files:**
- Create: `packages/mobile/src/ui/Sidebar.tsx`
- Modify: `packages/mobile/app/(tabs)/_layout.tsx` (read fully first — the current phone tree must survive verbatim in the phone branch)
- Modify: `packages/mobile/app/(tabs)/library/index.tsx` (accept a `segment` search param so the sidebar can deep-link Downloaded)

**Interfaces:**
- Consumes: `useLayoutMode` (Task 1); `useStore()` (`connectivity`, `state.library`, `state.token`, `gateway`, `downloadsList` — read `src/state/store.tsx` for exact names); `listValidator` from `@musex/core`.
- Produces: `<Sidebar mode={"pad-portrait" | "pad-landscape"} />`.

**Design (write it exactly):**
- `_layout.tsx`: `const mode = useLayoutMode()`. **Phone branch: the EXACT current JSX** (TabSlot, offline banner, MiniPlayer, TabList with the four triggers). **Pad branch** (both pad modes):
```tsx
<Tabs>
  <View style={{ flex: 1, flexDirection: "row" }}>
    <Sidebar mode={mode} />
    <View style={{ flex: 1 }}>
      <TabSlot />
      {/* offline banner (same JSX as phone) */}
      <PlayerBar />  {/* Task 3; render null placeholder until then */}
    </View>
  </View>
  <TabList style={{ display: "none" }}>{/* the four href-defining TabTriggers, unchanged */}</TabList>
</Tabs>
```
  CAUTION: `TabList` stays a DIRECT child of `Tabs` in BOTH branches; on pad it is `display:none` but still defines the tabs. Verify against installed expo-router that `<TabSlot/>` may be nested inside Views (it may — only TabList has the direct-child rule; confirm in `node_modules/expo-router/build/ui/Tabs.js`; if TabSlot must also be direct, restructure: row container holds Sidebar + a flex column that IS TabSlot's parent — adjust and note).
- `Sidebar.tsx`: width 220 (landscape) / 64 (portrait rail); `backgroundColor: theme.surface`, right hairline border; top safe-area padding. Content:
  1. Brand row: app name text (landscape) / a `Disc3` lucide glyph (portrait).
  2. Nav items: Home/Search/Library/Settings as `TabTrigger name="home" asChild` (NO href — switch-trigger form) wrapping a `SidebarItem` (Pressable: icon + label when landscape, icon-only centered when portrait; focused color `theme.accent` via `isFocused` from `TabTriggerSlotProps` — same pattern as the existing `TabButton`).
  3. **Downloaded**: a plain Pressable → `router.push("/(tabs)/library?segment=Downloaded")` (icon `HardDriveDownload`).
  4. **Playlists (landscape only):** header label "PLAYLISTS"; fetch via the cached gateway `listPlaylists(library, token, listValidator(library.updatedAt))` in a `useEffect` keyed on `library?.id` with try/catch (offline/uncached → empty; `OfflineUnavailable` tolerated); rows → `router.push({ pathname: "/(tabs)/home/playlist", params: { id, serverId, title, updatedAt } })` — READ `app/(tabs)/home/index.tsx` first to copy the exact params the playlist route expects (it threads updatedAt for the list cache); scrollable (`ScrollView`) below the fixed nav.
- `library/index.tsx`: `const params = useLocalSearchParams<{ segment?: string }>()`; an effect: when `params.segment` is one of the four segment values, `setSegment(params.segment as Segment)` (and clear the param via `router.setParams({ segment: undefined })` so re-taps re-trigger — verify the exact clearing idiom works; alternative: key the effect on a nonce param).

- [ ] **Step 1 —** read `_layout.tsx`, `home/index.tsx` (playlist nav params), `library/index.tsx`, and `node_modules/expo-router/build/ui/{Tabs,TabList,TabTrigger}.js|d.ts` (confirm switch-trigger-outside-TabList + TabSlot nesting). Note findings in the commit message.
- [ ] **Step 2 —** implement Sidebar + the pad branch + the segment deep-link. iPhone branch: diff against git HEAD must show the phone JSX unchanged (wrap-only refactors allowed if rendering is identical).
- [ ] **Step 3 —** boot an iPad simulator to verify: `pnpm --filter @musex/mobile exec expo run:ios --device "iPad Pro 11-inch (M4)"` (list sims with `xcrun simctl list devices available | grep iPad`; any available iPad works; prebuild first if `ios/` is stale). Screenshot landscape + portrait (`xcrun simctl io booted screenshot /tmp/ipad-{land,port}.png`; rotate with Cmd+arrow in the Simulator UI is manual — use `xcrun simctl` orientation if available, else verify by resizing... if rotation can't be automated, verify landscape only and note it). Also boot an iPhone sim and eyeball the tab bar unchanged.
- [ ] **Step 4 —** `pnpm check` → 0. Commit `feat(mobile): iPad sidebar layout (labeled landscape / icon rail portrait)`, push.

### Task 3: PlayerBar (iPad)

**Files:**
- Create: `packages/mobile/src/ui/PlayerBar.tsx`
- Modify: `packages/mobile/app/(tabs)/_layout.tsx` (replace the placeholder)

**Interfaces — Consumes:** read `src/ui/MiniPlayer.tsx` FIRST and mirror its store/session access exactly (it subscribes to playback state via the store; reuse the same hooks/fields — do not invent new state). `formatDuration` from `@musex/core`. Slider: `@react-native-community/slider` (existing dep; see `app/now-playing.tsx` for the configured usage — seek on `onSlidingComplete` via `session.seek`).

**Design:** a 64px-high bar, `theme.surface` + top hairline, bottom safe-area padding, hidden when no current track (return null — same emptiness rule as MiniPlayer). Row: [40px artwork (expo-image, `track.thumb`)] [title + artist, two lines, flex 1, Pressable → `router.push("/now-playing")`] [transport: `SkipBack`/`Play|Pause`/`SkipForward` lucide Pressables → `session.previous()/play()/pause()/next()`] [seek group, min-width 280: elapsed `formatDuration(positionSec*1000)`, Slider (value=positionSec, max=durationSec, onSlidingComplete → session.seek), total]. Portrait pad: keep everything (the bar is full-width; it fits); phone: component is never mounted.

- [ ] **Step 1 —** implement + wire into the pad branch. MiniPlayer remains phone-only (it already only renders in the phone branch after Task 2).
- [ ] **Step 2 —** iPad sim: play a track (or use the restore-paused state), screenshot the bar; tap artwork → Now Playing modal opens.
- [ ] **Step 3 —** `pnpm check` → 0. Commit `feat(mobile): iPad player bar (transport + seek + tap-to-now-playing)`, push.

### Task 4: pane-width grid columns

**Files:**
- Create: `packages/mobile/src/ui/grid-columns.ts` + `grid-columns.test.ts`
- Modify: `packages/mobile/app/(tabs)/library/index.tsx` (the 2-column FlatLists + the A–Z `getItemLayout`/`scrubTo` row math), `packages/mobile/app/(tabs)/search/index.tsx` (the Browse tile grid — read it first; apply the same helper if it hardcodes columns)

**Interfaces — Produces:** `export function gridColumns(paneWidth: number, minTile = 168): number` — `Math.max(2, Math.floor(paneWidth / minTile))`.

- [ ] **Step 1 — failing tests:** `gridColumns(390)` → 2; `gridColumns(768)` → 4; `gridColumns(1100)` → 6; `gridColumns(0)` → 2.
- [ ] **Step 2 —** implement. In `library/index.tsx`: measure the list container with `onLayout` (state `paneWidth`, default `Dimensions.get("window").width`), `const numCols = gridColumns(paneWidth)`, pass `numColumns={numCols}` + `key={numCols}` to each grid FlatList (numColumns can't change without a key remount) and use `numCols` in the existing row math (`scrubTo`, `getItemLayout`). Same treatment in search's Browse grid if applicable.
- [ ] **Step 3 —** iPad sim screenshot: library grid ~4–6 columns, no oversized tiles; iPhone still 2.
- [ ] **Step 4 —** `pnpm check` → 0. Commit `feat(mobile): pane-width-derived grid columns`, push.

### Task 5: native config + wrap

**Files:**
- Modify: `packages/mobile/app.json` (minimal diff), root `CLAUDE.md`

- [ ] **Step 1 —** `app.json`: `"supportsTablet": true`; add to `ios.infoPlist`: `"UISupportedInterfaceOrientations~ipad": ["UIInterfaceOrientationPortrait","UIInterfaceOrientationPortraitUpsideDown","UIInterfaceOrientationLandscapeLeft","UIInterfaceOrientationLandscapeRight"]`. The global `"orientation": "portrait"` stays (iPhone lock). Verify with `expo prebuild --platform ios` that the generated Info.plist carries both (grep it), and that the iPhone build still locks portrait.
- [ ] **Step 2 —** rebuild the iPad sim app (`expo run:ios --device <iPad>`) — rotation now works; verify portrait rail ↔ landscape sidebar transition + PlayerBar in both.
- [ ] **Step 3 —** CLAUDE.md arc bullet (layout-mode hook; sidebar mechanism actually used [switch-triggers vs fallback]; TabList direct-child + display:none; segment deep-link; gridColumns + key remount; ~ipad orientations with global portrait kept; MiniPlayer phone-only/PlayerBar pad-only).
- [ ] **Step 4 —** full `pnpm check` → 0; commit `feat(mobile): iPad support — supportsTablet + iPad orientations`, push. Do NOT open the PR (controller does).

---

## Self-review notes
- Spec coverage: layout mode (T1); sidebar/rail + playlists + Downloaded deep-link + hidden TabList (T2); player bar (T3); pane-width grids (T4); supportsTablet + ~ipad orientations + iPhone lock (T5); iPhone pixel-identical (T2 constraint + sim check); on-device acceptance beyond sim = user's.
- No placeholders: the one deliberately deferred decision (switch-trigger vs styled-TabList fallback) is a verification step with both paths specified.
- Consistency: `useLayoutMode`/`deriveLayoutMode`/`LayoutMode` (T1↔T2); `gridColumns` (T4); `Sidebar mode` prop matches `LayoutMode` pad values.
