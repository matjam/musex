import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow } from "electron";
import { registerIpc } from "./ipc.js";
import { Runtime } from "./runtime.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

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
  const t0 = Date.now();
  const runtime = new Runtime();
  await runtime.init();
  console.log("[musex-startup] runtime.init", Date.now() - t0, "ms");
  const t1 = Date.now();
  await runtime.restore();
  console.log("[musex-startup] runtime.restore (token load)", Date.now() - t1, "ms");
  registerIpc(runtime);
  createWindow();
  console.log("[musex-startup] window created", Date.now() - t0, "ms total boot");
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
