import { statSync } from "node:fs";
import { posix } from "node:path";

// findSystemMpv is the Linux-only branch (macOS/Windows bundle mpv), so it
// parses a POSIX `$PATH` (":"-delimited, "/"-joined). Use posix path ops
// explicitly so the logic is host-independent — on a Windows test runner the
// platform defaults would be ";" + "\", which don't match a Linux PATH.

/** Common absolute fallbacks if mpv isn't on PATH (login-shell PATH can differ
 *  from the GUI-launched process env). Pure + injectable for testing. */
export const COMMON_MPV_PATHS = ["/usr/bin/mpv", "/usr/local/bin/mpv", "/opt/homebrew/bin/mpv"];

function defaultIsFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

export function findSystemMpv(
  pathEnv: string | undefined,
  isFile: (p: string) => boolean = defaultIsFile,
): string | null {
  const dirs = (pathEnv ?? "").split(posix.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = posix.join(dir, "mpv");
    if (isFile(candidate)) return candidate;
  }
  for (const p of COMMON_MPV_PATHS) {
    if (isFile(p)) return p;
  }
  return null;
}
