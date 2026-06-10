import { app, Menu, type MenuItemConstructorOptions, shell } from "electron";

export interface AppMenuDeps {
  /** Navigate the current window to Settings → Keyboard Shortcuts. */
  showShortcuts: () => void;
  /** Reveal the app's logs/data folder in Finder. */
  openLogsFolder: () => void;
  /** Interactive update check (dialogs for result). */
  checkForUpdates: () => void;
}

/** Application menu: standard mac roles plus a Help submenu (shortcuts,
 *  GitHub, issues, logs). Dev-only entries (reload/devtools) are gated on
 *  `app.isPackaged`; keeping the default ⌘R reload accelerator in dev is
 *  deliberate — our repeat shortcut is ⌥R, so there's no conflict. */
export function buildAppMenu(deps: AppMenuDeps): Menu {
  const devViewItems: MenuItemConstructorOptions[] = app.isPackaged
    ? []
    : [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
      ];

  const template: MenuItemConstructorOptions[] = [
    // The appMenu role expanded by hand so "Check for Updates…" can sit
    // under About (same items/roles the built-in appMenu provides).
    {
      role: "appMenu",
      submenu: [
        { role: "about" },
        {
          label: "Check for Updates…",
          click: () => deps.checkForUpdates(),
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
      submenu: [
        {
          label: "Keyboard Shortcuts",
          accelerator: "CmdOrCtrl+/",
          click: () => deps.showShortcuts(),
        },
        { type: "separator" },
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
          label: "Open Logs Folder",
          click: () => deps.openLogsFolder(),
        },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}
