import { app, Menu, type MenuItemConstructorOptions, shell } from "electron";

export interface AppMenuDeps {
  /** Navigate the current window to Settings → Keyboard Shortcuts. */
  showShortcuts: () => void;
  /** Reveal the app's logs/data folder in Finder. */
  openLogsFolder: () => void;
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
    { role: "appMenu" },
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
