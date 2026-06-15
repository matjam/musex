import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";
import type { MpvPaths } from "./mpv-controller.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/** Common absolute fallbacks if mpv isn't on PATH (login-shell PATH can differ
 *  from the GUI-launched process env). Pure + injectable for testing. */
const COMMON_MPV_PATHS = ["/usr/bin/mpv", "/usr/local/bin/mpv", "/opt/homebrew/bin/mpv"];

export function findSystemMpv(
  pathEnv: string | undefined,
  exists: (p: string) => boolean = existsSync,
): string | null {
  const dirs = (pathEnv ?? "").split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = join(dir, "mpv");
    if (exists(candidate)) return candidate;
  }
  for (const p of COMMON_MPV_PATHS) {
    if (exists(p)) return p;
  }
  return null;
}

/** mpv requirement message shown when the binary can't be located. */
const LINUX_MPV_HELP =
  "mpv is required for playback. Install it with your package manager — e.g. `sudo apt install mpv` (or dnf/pacman). mpv 0.34 or newer is recommended.";

/** Locate the mpv binary + IPC socket path. macOS uses the vendored bundle;
 *  Linux uses system mpv (a deliberate Linux-only exception to the bundle
 *  rule). Throws a clear, user-facing Error when mpv can't be found — the
 *  Runtime catches it so startup survives and playback reports the reason. */
export function resolveMpvPaths(): MpvPaths {
  const socketPath = join(app.getPath("userData"), "mpv.sock");

  if (process.platform === "darwin") {
    const binaryPath = app.isPackaged
      ? join(process.resourcesPath, "mpv", "mpv.app/Contents/MacOS/mpv")
      : // out/main → repo root is 4 up.
        join(__dirname, "../../../../vendor/mpv/darwin-arm64/mpv.app/Contents/MacOS/mpv");
    if (!existsSync(binaryPath)) throw new Error("mpv binary not found — run 'pnpm vendor'");
    return { binaryPath, socketPath };
  }

  if (process.platform === "linux") {
    const binaryPath = findSystemMpv(process.env.PATH);
    if (!binaryPath) throw new Error(LINUX_MPV_HELP);
    return { binaryPath, socketPath };
  }

  // win32: future — vendored mpv.exe + a named-pipe socket
  // (\\.\pipe\musex-…). Not implemented; subprocess model otherwise applies.
  throw new Error(`unsupported platform for mpv: ${process.platform}`);
}
