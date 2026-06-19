import { randomUUID } from "node:crypto";
import { join } from "node:path";

/** mpv `--input-ipc-server` target: a unix socket file on macOS/Linux, a named
 *  pipe on Windows (per-launch unique to avoid multi-instance collisions). */
export function mpvSocketPath(
  platform: NodeJS.Platform,
  userDataDir: string,
  uuid: string = randomUUID(),
): string {
  return platform === "win32" ? `\\\\.\\pipe\\musex-mpv-${uuid}` : join(userDataDir, "mpv.sock");
}
