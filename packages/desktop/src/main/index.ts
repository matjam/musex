import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { IPC } from "../shared/ipc-contract.js";
import { registerIpc } from "./ipc.js";
import { Runtime } from "./runtime.js";

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

  // Engine events flow to whichever window is current; guard against a
  // closed-but-not-yet-GCed window (macOS keeps the app alive windowless).
  const wireEngineEvents = (win: BrowserWindow): void => {
    runtime.mpv.setSink((e) => {
      // TEMP DIAGNOSTIC (playback-stall investigation): engine events with
      // timestamps, in the same stream as the ui/proxy logs (positions omitted).
      if (e.type !== "position") {
        const ts = new Date().toISOString().slice(11, 23);
        console.log(
          `[musex mpv ${ts}] event: ${e.type}${e.type === "error" ? ` ${e.message}` : ""}`,
        );
      }
      if (!win.isDestroyed()) win.webContents.send(IPC.playbackEvent, e);
    });
  };

  wireEngineEvents(createWindow());
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
