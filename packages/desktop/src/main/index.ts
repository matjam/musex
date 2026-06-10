import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, Menu, shell } from "electron";
import { IPC, type NavigateToPayload } from "../shared/ipc-contract.js";
import { registerIpc } from "./ipc.js";
import { buildAppMenu } from "./menu.js";
import { Runtime } from "./runtime.js";
import { setupAutoUpdater } from "./updater.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0d0e12",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return win;
}

app.whenReady().then(async () => {
  const runtime = new Runtime();
  await runtime.init();
  await runtime.restore();
  registerIpc(runtime);

  // Engine events + plugin notifications flow to whichever window is current;
  // guard against a closed-but-not-yet-GCed window (macOS keeps the app alive
  // windowless).
  const wireEngineEvents = (win: BrowserWindow): void => {
    runtime.mpv.setSink((e) => {
      // The playback monitor taps position ticks for scrobble accounting,
      // independent of (and before) the renderer forward.
      if (e.type === "position") runtime.playbackMonitor.handleEnginePosition(e.sec);
      if (!win.isDestroyed()) win.webContents.send(IPC.playbackEvent, e);
    });
    runtime.setPluginNotifySink((p) => {
      if (!win.isDestroyed()) win.webContents.send(IPC.pluginsNotify, p);
    });
    // Rebuilt per window so Help → Keyboard Shortcuts targets the current one
    // (setApplicationMenu is idempotent; stale closures would hit a destroyed
    // window after macOS re-activate).
    Menu.setApplicationMenu(
      buildAppMenu({
        showShortcuts: () => {
          const payload: NavigateToPayload = { view: "settings", section: "shortcuts" };
          if (!win.isDestroyed()) win.webContents.send(IPC.navigateTo, payload);
        },
        openLogsFolder: () => void shell.openPath(app.getPath("userData")),
        checkForUpdates: updater.checkForUpdatesInteractive,
      }),
    );
  };

  const firstWindow = createWindow();
  // After window creation: kicks off the silent update check (launch + every
  // 4h) and provides the menu's interactive "Check for Updates…" handler.
  // Dialogs parent on the current window (getWindow handles none-open).
  const updater = setupAutoUpdater({
    getWindow: () => BrowserWindow.getAllWindows()[0] ?? null,
  });
  wireEngineEvents(firstWindow);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) wireEngineEvents(createWindow());
  });
  app.on("will-quit", () => {
    void runtime.mpv.dispose();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
