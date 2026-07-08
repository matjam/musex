# iPad layout — desktop-mirror sidebar UI

**Date:** 2026-06-21
**Status:** Approved via visual-companion brainstorm (layout A "desktop mirror" + icon-rail portrait chosen by user); third sub-project of the iOS polish arc (Downloads v2 ✓ → iPad → CarPlay [entitlement-gated]).
**Goal:** the iOS app supports iPad with a layout resembling the desktop app; iPhone is untouched.

## Decisions (user-chosen)

- **Layout A — desktop mirror.** On iPad: a permanent **left sidebar** + **content pane** + a **full-width bottom player bar**. The phone's bottom tab bar does not appear on iPad.
- **Portrait = icon rail.** Landscape shows the full labeled sidebar (nav sections + Playlists list, like desktop); portrait collapses it to an icon-only rail (labels/tooltips off; playlists reachable via Home/Library in portrait).
- **Player bar, desktop-style:** full-width bottom bar with artwork, title/artist, inline transport (prev/play/next) and a seek bar + elapsed/total; tapping the artwork/title opens the existing Now Playing **modal** (unchanged from phone). The phone `MiniPlayer` remains phone-only.
- **Now Playing, queue, sheets, settings panes:** unchanged — the same routes/modals render in the wider content pane.
- **Orientation:** iPad supports portrait + landscape (both sidebar modes). **iPhone stays portrait-locked; iPhone landscape is OUT of scope** (its own later item on the roadmap).

## Architecture

### Size-class detection, one switch
A single `useLayoutMode()` hook (`src/ui/layout-mode.ts`): `"phone" | "pad-portrait" | "pad-landscape"` derived from `Platform.isPad` (or `useWindowDimensions` width ≥ 744 as the tablet threshold — pick ONE signal, document it) + orientation from `useWindowDimensions` (`width > height`). All layout branching keys off this hook; no scattered `isPad` checks.

### Navigation: the tabs stay, the tab bar becomes the sidebar
The route tree (`app/(tabs)/…` with nested stacks) is **unchanged** — this is a presentation swap, not a nav-model change. `app/(tabs)/_layout.tsx` uses expo-router/ui's headless `Tabs`/`TabList`/`TabTrigger`/`TabSlot`; the documented constraint is **`TabList` must remain a direct child of `Tabs`**. On iPad the same `TabList` renders as a **vertical sidebar/rail** (flex-row root: sidebar left, `TabSlot` + player bar in a right column) instead of a bottom bar; on phone the current column layout is untouched. The sidebar adds, below the tab triggers (Home/Search/Library/Settings):
- **Downloaded** — a nav link to the Library tab's Downloaded segment (deep-link with the segment param).
- **Playlists section (landscape only):** the user's playlists (from `listPlaylists`, cached gateway + `listValidator(library.updatedAt)`, offline-tolerant via the existing OfflineUnavailable catch pattern) as links into the existing `home/playlist?id=…` route.
If the direct-child constraint fights the two-column composition, the fallback (flagged in the plan, decided at implementation): keep `TabList` hidden (`display:none`) and render a custom sidebar of `TabTrigger`s — expo-router/ui supports custom triggers referencing tab names; verify against the installed expo-router before committing to either mechanism.

### Player bar
New `src/ui/PlayerBar.tsx` (iPad only): artwork + title/artist (tap → `router.push("/now-playing")`), prev/play-pause/next via the `PlaybackSession`, a seek slider (`@react-native-community/slider`, already a dep — seek on `onSlidingComplete`, same as Now Playing), elapsed/total via core `formatDuration`. Sits above the content bottom edge, full width of the right column (portrait + landscape). The offline banner keeps rendering above it (same slot as today's above-MiniPlayer position).

### Content pane behavior
- Grids already use `numColumns`/width-derived columns; ensure the column count derives from the PANE width, not the window (`onLayout`/container width), so the sidebar doesn't cause oversized tiles.
- The A–Z scrubber, virtualized lists, action bars, progress bars all render unchanged in the pane.
- Modals (Now Playing, sheets) present over the whole screen as today (`presentation:"modal"` on iPad renders as a centered sheet by default — acceptable; formSheet sizing is a polish follow-up).

### app config (native)
- `app.json`: `ios.supportsTablet: true`. Orientation: keep the global `"orientation": "portrait"` for iPhone and allow iPad rotation via `ios.infoPlist["UISupportedInterfaceOrientations~ipad"]` = all four (or portrait+landscape-both; include upside-down per iPad convention). This is an `app.json` edit — coordinate with its externally-managed churn (EAS/release-please), keep the diff minimal.
- **Native rebuild required** (`expo prebuild` + `expo run:ios` / EAS) — supportsTablet + plist changes are native-side.

## What does NOT change
iPhone layout (all modes), the route tree, playback/downloads/state, desktop, core (except: nothing — this is UI-only; any pure helpers land in `src/ui`/`src/logic` mobile-side since layout-mode is platform-coupled).

## Testing
- Pure: `useLayoutMode`'s derivation function (pure fn over `{width,height,isPad}` → mode) unit-tested; playlist-link building if extracted.
- `pnpm check` green; CI `build-ios` exercises the native config change.
- **On-device/simulator acceptance (user):** iPad simulator (e.g. iPad Pro 11") — landscape full sidebar w/ playlists; portrait icon rail; rotation transitions cleanly; player bar transport + seek + tap-to-Now-Playing; phone (simulator or device) pixel-identical to today; Downloaded deep-link; grids sized to the pane.

## Success criteria
iPad renders the desktop-mirror layout (labeled sidebar landscape / icon rail portrait, bottom player bar), navigation fully works from the sidebar, iPhone is visually unchanged, `supportsTablet` ships, `pnpm check` + `build-ios` green.

## Non-goals
iPhone landscape; per-screen master-detail splits (layout B — possible later polish); CarPlay; desktop changes; new features.
