import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import type { MpvPaths } from "./mpv-controller.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/** Locate the vendored mpv binary + the IPC socket path.
 *  Requires `app` to be ready (userData) and throws if mpv isn't vendored —
 *  which is why the controller takes paths by injection instead of calling
 *  this itself (tests pass plain paths with no Electron at all). */
export function resolveMpvPaths(): MpvPaths {
  const binaryPath = app.isPackaged
    ? join(process.resourcesPath, "mpv", "mpv.app/Contents/MacOS/mpv")
    : // electron-vite bundles all main files into packages/desktop/out/main/index.js,
      // so __dirname here is packages/desktop/out/main/ → repo root is 4 levels up.
      join(__dirname, "../../../../vendor/mpv/darwin-arm64/mpv.app/Contents/MacOS/mpv");
  if (!existsSync(binaryPath)) {
    throw new Error("mpv binary not found — run 'pnpm vendor'");
  }
  // macOS unix-socket paths must stay under ~104 bytes; userData is short enough.
  return { binaryPath, socketPath: join(app.getPath("userData"), "mpv.sock") };
}
