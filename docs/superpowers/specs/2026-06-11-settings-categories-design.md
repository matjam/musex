# Settings Categories — Design

**Date:** 2026-06-11
**Status:** Approved (user chose option A: sidebar-categorized modal)

## Goal

The Settings modal's five stacked sections become switchable category panes
behind a slim internal sidebar — same popup modal (⌘,, app menu, Escape/
backdrop dismissal unchanged), restructured inside.

## Layout

`.settings-modal` keeps its current size (`min(760px, 92vw)` × `80vh`). The
modal body becomes a flex row:

- **`.settings-nav`** — fixed ~170px column, vertical list of category
  buttons styled like the app sidebar's `nav-item` (icon + label, active
  state). Plugin sub-entries render indented under the Plugins item.
- **`.settings-pane`** — `flex: 1`, `overflow-y: auto`, hosts the selected
  category's sections (existing `settings-section`/`settings-row` markup
  unchanged inside).

## Categories

| id | label (icon) | contents |
|----|----|----|
| `general` | General (Settings2) | Account section (Plex server · library) + new App section: version (`__APP_VERSION__`) and a **Check for Updates** button |
| `playback` | Playback (Volume2) | the existing Audio section (leveling + EQ) |
| `library` | Library & Cache (HardDrive) | the existing Local Cache section |
| `discovery` | Discovery (Sparkles) | the existing Taste Expansion section |
| `plugins` | Plugins (Blocks) | install/reload row + the plugin list with enable toggles + status chips (no settings fields here) |
| `plugin:<id>` | one indented sub-entry per installed plugin (Puzzle) | that plugin's full card (enable toggle + its settings fields + actions) |

Default category: `general`. Selected category is component state (not
persisted — the modal is short-lived).

## Component restructure (`SettingsView.tsx`)

- `SettingsView` becomes the shell: nav + pane switch. It accepts
  `initialCategory?: string`.
- The inline Local Cache and Account JSX extract into `CacheSection` /
  `AccountSection` components (verbatim moves). `AudioSection` /
  `ExpansionSection` are already components.
- `PluginsSection` splits: the overview pane (reload + list, each row showing
  name/version/status chip/enable toggle — the enable toggle moves up from
  PluginCard so the overview is useful) and the existing `PluginCard` renders
  alone in each `plugin:<id>` pane. The plugin list for the NAV comes from the
  same `pluginsList()` fetch, lifted into `SettingsView` so the nav and panes
  share it.
- New `AppSection` (inside General): version row + Check for Updates button.

## Check for Updates from the renderer

New IPC channel `updaterCheck: "musex:updater:check"` → main calls the
existing `AutoUpdaterHandle.checkForUpdatesInteractive()` (its results
already surface as native dialogs — the renderer button needs no result
plumbing). The handler registers in `main/index.ts` right after
`setupAutoUpdater` (registerIpc runs earlier and doesn't know the updater).
Preload + `MusexApi.updaterCheck(): Promise<void>`.

## Deep-linking

`NavigateToPayload`'s settings variant widens from
`{ view: "settings"; section?: "shortcuts" }` to
`{ view: "settings"; section?: string }`. `App.tsx` keeps routing
`section === "shortcuts"` to the Shortcuts modal; any other value opens the
Settings modal with `initialCategory = section` (unknown ids fall back to
`general`). The app-menu wiring is unchanged. (Nothing sends category
deep-links yet — this just leaves the door open for "configure lidarr"
prompts.)

## Testing

Pure-logic surface is nil (UI restructure); `pnpm check` + live CDP
verification: every category renders its sections, plugin sub-entries show
their settings, Check for Updates triggers the existing dialog flow (dev
build shows the "not available in development" dialog — that existing branch
is the expected result), Escape/backdrop dismissal unchanged, ⌘, still opens.

## Out of scope

- Persisting the selected category across opens.
- Separate preferences window (option C), search-within-settings.
- Moving Shortcuts/About into the settings modal (they stay standalone).
