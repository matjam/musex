import { statSync } from "node:fs";
import { delimiter, join } from "node:path";

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
  const dirs = (pathEnv ?? "").split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = join(dir, "mpv");
    if (isFile(candidate)) return candidate;
  }
  for (const p of COMMON_MPV_PATHS) {
    if (isFile(p)) return p;
  }
  return null;
}
