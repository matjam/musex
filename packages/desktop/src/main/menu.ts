import { app, Menu, type MenuItemConstructorOptions, shell } from "electron";

export interface AppMenuDeps {
  /** Open the custom About window (version + dependency attribution). */
  showAbout: () => void;
  /** Navigate the current window to the Settings view. */
  showSettings: () => void;
  /** Navigate the current window to Settings → Keyboard Shortcuts. */
  showShortcuts: () => void;
  /** Open the unified log viewer (main + renderer console output). */
  showLogs: () => void;
  /** Reveal the app's logs/data folder in Finder. */
  openLogsFolder: () => void;
  /** Interactive update check (dialogs for result). */
  checkForUpdates: () => void;
}

/** Application menu: standard mac roles plus a Help submenu (shortcuts,
 *  GitHub, issues, logs). Dev-only entries (reload/devtools) are gated on
 *  `app.isPackaged`; keeping the default ⌘R reload accelerator in dev is
 *  deliberate — our repeat shortcut is ⌥R, so there's no conflict.
 *
 *  macOS gets the standard appMenu role (with traffic-light, Services,
 *  Hide/HideOthers). Non-mac gets a plain File menu — no mac-only roles. */
export function buildAppMenu(deps: AppMenuDeps): Menu {
  const isMac = process.platform === "darwin";

  const devViewItems: MenuItemConstructorOptions[] = app.isPackaged
    ? []
    : [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
      ];

  const helpSubmenu: MenuItemConstructorOptions[] = [
    ...(isMac
      ? []
      : [
          { label: "About musex", click: () => deps.showAbout() },
          {
            label: "Keyboard Shortcuts",
            accelerator: "CmdOrCtrl+/",
            click: () => deps.showShortcuts(),
          },
          { type: "separator" as const },
        ]),
    ...(isMac
      ? [
          {
            label: "Keyboard Shortcuts",
            accelerator: "CmdOrCtrl+/",
            click: () => deps.showShortcuts(),
          },
          { type: "separator" as const },
        ]
      : []),
    {
      label: "musex on GitHub",
      click: () => void shell.openExternal("https://github.com/matjam/musex"),
    },
    {
      label: "Report an Issue",
      click: () => void shell.openExternal("https://github.com/matjam/musex/issues"),
    },
    { type: "separator" },
    {
      label: "Show Logs",
      click: () => deps.showLogs(),
    },
    {
      label: "Open Logs Folder",
      click: () => deps.openLogsFolder(),
    },
  ];

  const macTemplate: MenuItemConstructorOptions[] = [
    // The appMenu role expanded by hand so "Check for Updates…" can sit
    // under About (same items/roles the built-in appMenu provides).
    {
      role: "appMenu",
      submenu: [
        // Custom About (renderer modal) instead of the native panel: it holds
        // the scrollable dependency-attribution list the native one can't.
        { label: "About musex", click: () => deps.showAbout() },
        {
          label: "Check for Updates…",
          click: () => deps.checkForUpdates(),
        },
        { type: "separator" },
        {
          label: "Settings…",
          accelerator: "CmdOrCtrl+,",
          click: () => deps.showSettings(),
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    // editMenu is required so ⌘C/⌘V/⌘X/⌘A keep working in inputs.
    { role: "editMenu" },
    {
      label: "View",
      submenu: [...devViewItems, { role: "togglefullscreen" }],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: helpSubmenu,
    },
  ];

  const nonMacTemplate: MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "Settings…",
          accelerator: "CmdOrCtrl+,",
          click: () => deps.showSettings(),
        },
        { type: "separator" },
        {
          label: "Check for Updates…",
          click: () => deps.checkForUpdates(),
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    // editMenu is required so Ctrl+C/V/X/A keep working in inputs.
    { role: "editMenu" },
    {
      label: "View",
      submenu: [...devViewItems, { role: "togglefullscreen" }],
    },
    {
      label: "Help",
      submenu: helpSubmenu,
    },
  ];

  const template = isMac ? macTemplate : nonMacTemplate;
  return Menu.buildFromTemplate(template);
}
