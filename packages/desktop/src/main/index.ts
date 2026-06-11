import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, Menu, shell } from "electron";
import { IPC, type NavigateToPayload } from "../shared/ipc-contract.js";
import { registerIpc } from "./ipc.js";
import { installConsoleTee, logBuffer } from "./logging.js";
import { buildAppMenu } from "./menu.js";
import { Runtime } from "./runtime.js";
import { setupAutoUpdater } from "./updater.js";

// First thing, before any startup code logs: tee main's console into the
// in-memory buffer behind Help → Show Logs.
installConsoleTee(logBuffer);

const __dirname = fileURLToPath(new URL(".", import.meta.url));

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    // "hidden" + explicit traffic-light position: vertically centered in the
    // 52px topbar, in line with the logo and search box (Spotify-style).
    titleBarStyle: "hidden",
    trafficLightPosition: { x: 18, y: 20 },
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
    // Live log streaming to the viewer. Buffer appends triggered by a
    // renderer logsAppend flow back out here — that's the unified view
    // (the viewer shows both processes), not a loop: nothing here logs.
    const offLogs = logBuffer.onAppend((entry) => {
      if (!win.isDestroyed()) win.webContents.send(IPC.logsEvent, entry);
    });
    win.on("closed", offLogs);
    runtime.mpv.setSink((e) => {
      // The playback monitor taps position ticks for scrobble accounting,
      // independent of (and before) the renderer forward.
      if (e.type === "position") runtime.playbackMonitor.handleEnginePosition(e.sec);
      if (!win.isDestroyed()) win.webContents.send(IPC.playbackEvent, e);
    });
    runtime.setPluginNotifySink((p) => {
      if (!win.isDestroyed()) win.webContents.send(IPC.pluginsNotify, p);
    });
    runtime.setLibraryChangedSink((lib) => {
      if (!win.isDestroyed()) win.webContents.send(IPC.libraryChanged, lib);
    });
    // Rebuilt per window so Help → Keyboard Shortcuts targets the current one
    // (setApplicationMenu is idempotent; stale closures would hit a destroyed
    // window after macOS re-activate).
    Menu.setApplicationMenu(
      buildAppMenu({
        showAbout: () => {
          const payload: NavigateToPayload = { view: "about" };
          if (!win.isDestroyed()) win.webContents.send(IPC.navigateTo, payload);
        },
        showSettings: () => {
          const payload: NavigateToPayload = { view: "settings" };
          if (!win.isDestroyed()) win.webContents.send(IPC.navigateTo, payload);
        },
        showShortcuts: () => {
          const payload: NavigateToPayload = { view: "settings", section: "shortcuts" };
          if (!win.isDestroyed()) win.webContents.send(IPC.navigateTo, payload);
        },
        showLogs: () => {
          const payload: NavigateToPayload = { view: "logs" };
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
  // Settings → General → "Check for Updates" — results surface as the same
  // native dialogs the menu item uses, so the renderer needs no result.
  ipcMain.handle(IPC.updaterCheck, () => updater.checkForUpdatesInteractive());
  wireEngineEvents(firstWindow);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) wireEngineEvents(createWindow());
  });
  app.on("will-quit", () => {
    runtime.expansion.dispose();
    runtime.libraryWatcher.dispose();
    void runtime.mpv.dispose();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
