import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, protocol } from "electron";
import { registerIpc } from "./ipc.js";
import { Runtime } from "./runtime.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Must run synchronously, before app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "musex-stream",
    // corsEnabled: gapless-5/hls.js load audio via XHR/fetch; without it Chromium
    // rejects cross-origin requests to a custom scheme ("only supported for
    // chrome/http/https…"). supportFetchAPI + corsEnabled make XHR/fetch work.
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

function createWindow(): void {
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
}

app.whenReady().then(async () => {
  const runtime = new Runtime();
  runtime.init();
  await runtime.restore();
  registerIpc(runtime);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
