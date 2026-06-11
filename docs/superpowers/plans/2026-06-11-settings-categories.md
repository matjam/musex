# Settings Categories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the Settings modal into a sidebar-categorized layout (General / Playback / Library & Cache / Discovery / Plugins + per-plugin sub-entries) with a Check for Updates button and a deep-linkable category.

**Architecture:** Pure UI restructure of `SettingsView.tsx` (existing sections become panes behind an internal nav; existing `settings-section` markup unchanged inside) + one new IPC channel (`musex:updater:check` → existing `checkForUpdatesInteractive`, registered in `main/index.ts` where the updater handle lives) + a widened `NavigateToPayload` settings `section` for deep-linking.

**Tech Stack:** React 19 renderer, lucide-react icons, existing typed IPC. Spec: `docs/superpowers/specs/2026-06-11-settings-categories-design.md`.

**Conventions:** repo root `/Users/matjam/src/musex`, branch `feature/settings-categories`; renderer imports no extensions, main/shared/preload use `.js`; `pnpm exec biome check --write .` then `pnpm check` (exit 0) before each commit; `git add -A`; push after commit; theme.css is biome-ignored.

---

### Task 1: IPC channel + deep-link plumbing

**Files:**
- Modify: `packages/desktop/src/shared/ipc-contract.ts`
- Modify: `packages/desktop/src/preload/index.ts`
- Modify: `packages/desktop/src/main/index.ts`
- Modify: `packages/desktop/src/renderer/src/App.tsx`
- Modify: `packages/desktop/src/renderer/src/ui/SettingsModal.tsx`

No unit test (plumbing; typecheck gates, live verify at the end).

- [ ] **Step 1: Contract.** In `ipc-contract.ts`:
(a) `IPC` const (near the other one-off channels): `updaterCheck: "musex:updater:check", // -> void (results surface as native dialogs in main)`
(b) `NavigateToPayload`'s settings variant: change `{ view: "settings"; section?: "shortcuts" }` to `{ view: "settings"; section?: string }` (the `"shortcuts"` literal generalizes; App.tsx still special-cases that string).
(c) `MusexApi`: `updaterCheck(): Promise<void>;`

- [ ] **Step 2: Preload.** `updaterCheck: () => ipcRenderer.invoke(IPC.updaterCheck),`

- [ ] **Step 3: Main handler.** In `main/index.ts`, right after `const updater = setupAutoUpdater({...})` (~line 105), add (import `ipcMain` from electron — check existing imports — and `IPC` from `../shared/ipc-contract.js` if not present):

```ts
  // Settings → General → "Check for Updates" — results surface as the same
  // native dialogs the menu item uses, so the renderer needs no result.
  ipcMain.handle(IPC.updaterCheck, () => updater.checkForUpdatesInteractive());
```

- [ ] **Step 4: Deep-link pass-through.** In `App.tsx`, the `onNavigateTo` effect: keep `section === "shortcuts"` → shortcuts modal; for other settings payloads store the section: add state `const [settingsSection, setSettingsSection] = useState<string | null>(null);`, set it (`setSettingsSection(p.section ?? null)`) before `setSettingsOpen(true)`, and pass `<SettingsModal initialCategory={settingsSection} onClose={...} />`. In `SettingsModal.tsx`, accept `initialCategory?: string | null` and forward to `<SettingsView initialCategory={initialCategory ?? undefined} />` (SettingsView gains the prop in Task 2 — to keep this task compiling, add the prop to SettingsView NOW as an unused-but-typed optional parameter: `export function SettingsView({ initialCategory: _initialCategory }: { initialCategory?: string } = {})` — Task 2 uses it).

- [ ] **Step 5: Verify + commit**

```bash
pnpm exec biome check --write . && pnpm check
git add -A && git commit -m "feat: updater-check IPC + settings deep-link plumbing" && git push
```

---

### Task 2: SettingsView restructure — nav + category panes

**Files:**
- Modify: `packages/desktop/src/renderer/src/ui/views/SettingsView.tsx`
- Modify: `packages/desktop/src/renderer/src/ui/theme.css`

READ `SettingsView.tsx` fully first. The existing section components/JSX move VERBATIM — only their grouping changes.

- [ ] **Step 1: Extract inline sections.** The Local Cache JSX (everything inside the `<div className="settings-section">` titled "Local Cache", including its state/handlers `state/stats/clearing/refreshStats/toggleCache/changeCap/clearCache`) moves into a new `CacheSection()` component; the Account JSX (titled "Account", uses `library` from `useApp`) into `AccountSection()`. Verbatim moves — no behavior edits.

- [ ] **Step 2: AppSection (new, rendered in General below AccountSection):**

```tsx
/** App version + manual update check. Results surface as native dialogs in
 *  main (same flow as the menu item), so no result plumbing here. */
function AppSection() {
  const [busy, setBusy] = useState(false);
  return (
    <div className="settings-section">
      <div className="settings-section-title">Application</div>
      <div className="settings-row">
        <div className="settings-row-text">
          <div className="settings-row-label">musex {__APP_VERSION__}</div>
          <div className="settings-row-desc">Updates install automatically when available.</div>
        </div>
        <button
          type="button"
          className="settings-btn"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void window.musex.updaterCheck().finally(() => setBusy(false));
          }}
        >
          {busy ? "Checking…" : "Check for Updates"}
        </button>
      </div>
    </div>
  );
}
```

(`__APP_VERSION__` is a vite define — see AboutModal for prior use; it's declared in `vite-env.d.ts`.)

- [ ] **Step 3: Split PluginsSection.** Lift the `plugins: PluginInfo[] | null` fetch + `refresh` into `SettingsView` (the nav needs the list too). The overview pane component `PluginsOverview({ plugins, reloading, onReload, onChanged })` renders: the existing install/reload row + per-plugin rows with name/version/status chip and the enable toggle (move the toggle row markup out of `PluginCard` — `PluginCard` keeps rendering it too; the duplication is two small JSX blocks sharing the `toggleEnabled` pattern, acceptable). Each `plugin:<id>` pane renders the existing `<PluginCard plugin={p} onChanged={refresh} />` unchanged.

- [ ] **Step 4: The shell.** `SettingsView({ initialCategory }: { initialCategory?: string })`:

```tsx
type CategoryId = "general" | "playback" | "library" | "discovery" | "plugins" | `plugin:${string}`;

const CATEGORIES: ReadonlyArray<{ id: CategoryId; label: string; icon: LucideIcon }> = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "playback", label: "Playback", icon: Volume2 },
  { id: "library", label: "Library & Cache", icon: HardDrive },
  { id: "discovery", label: "Discovery", icon: Sparkles },
  { id: "plugins", label: "Plugins", icon: Blocks },
];
```

State: `const [category, setCategory] = useState<string>(() => isKnownCategory(initialCategory) ? initialCategory : "general");` where `isKnownCategory` accepts the five ids plus `plugin:*`. Render:

```tsx
  return (
    <div className="settings-layout">
      <nav className="settings-nav">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className={`nav-item${category === c.id ? " active" : ""}`}
            onClick={() => setCategory(c.id)}
          >
            <c.icon size={16} />
            {c.label}
          </button>
        ))}
        {(plugins ?? []).map((p) => (
          <button
            key={p.id}
            type="button"
            className={`nav-item settings-nav-sub${category === `plugin:${p.id}` ? " active" : ""}`}
            onClick={() => setCategory(`plugin:${p.id}`)}
          >
            <Puzzle size={14} />
            {p.name}
          </button>
        ))}
      </nav>
      <div className="settings-pane">
        <div className="settings-page">
          {category === "general" && (
            <>
              <AccountSection />
              <AppSection />
            </>
          )}
          {category === "playback" && <AudioSection />}
          {category === "library" && <CacheSection />}
          {category === "discovery" && <ExpansionSection />}
          {category === "plugins" && (
            <PluginsOverview plugins={plugins} reloading={reloading} onReload={reload} onChanged={refresh} />
          )}
          {category.startsWith("plugin:") &&
            (() => {
              const p = (plugins ?? []).find((x) => `plugin:${x.id}` === category);
              return p ? (
                <div className="settings-section">
                  <div className="settings-section-title">{p.name}</div>
                  <PluginCard plugin={p} onChanged={refresh} />
                </div>
              ) : (
                <div className="content-placeholder">Plugin not found.</div>
              );
            })()}
        </div>
      </div>
    </div>
  );
```

(Adapt details to the real code — e.g. `reload`/`reloading` lift with the fetch; lucide imports at top. If a plugin is removed while its pane is open, the fallback placeholder shows.)

- [ ] **Step 5: CSS** (next to the existing `.settings-modal` rules):

```css
/* Categorized settings: internal sidebar + pane (same modal). */
.settings-layout {
  display: flex;
  height: 100%;
  min-height: 0;
}
.settings-nav {
  width: 170px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 8px;
  border-right: 1px solid var(--line);
  overflow-y: auto;
}
.settings-nav .settings-nav-sub {
  padding-left: 26px;
  font-size: 12.5px;
}
.settings-pane {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
}
```

and change `.settings-modal-body` to `overflow: hidden;` (the pane scrolls now, not the body — check the rule at ~line 2665).

- [ ] **Step 6: Verify + commit**

```bash
pnpm exec biome check --write . && pnpm check
git add -A && git commit -m "feat: categorized settings modal (internal sidebar + panes)" && git push
```

---

### Task 3: Live verify + docs + PR (controller)

- [ ] Live (CDP): ⌘, opens on General (account + version + Check for Updates → dev-build dialog); every category renders its sections; lastfm/lidarr sub-entries show their settings fields; Escape/backdrop still dismiss; nav within modal doesn't affect app navigation history.
- [ ] CLAUDE.md bullet (settings modal is categorized; deep-link via navigateTo section; updaterCheck IPC registered in index.ts beside the updater handle, NOT in registerIpc).
- [ ] Draft PR `feat: categorized settings with per-plugin panes and in-app update check`.
