export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const total = Math.floor(ms / 1000);
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

/** Coarse human relative time: "just now" under a minute, then the largest
 *  whole unit ("3 days ago"). Future/invalid times clamp to "just now". */
export function relativeTime(thenMs: number, nowMs: number): string {
  const sec = Math.floor((nowMs - thenMs) / 1000);
  if (!Number.isFinite(sec) || sec < 60) return "just now";
  const minutes = Math.floor(sec / 60);
  if (minutes < 60) return ago(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return ago(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 7) return ago(days, "day");
  if (days < 30) return ago(Math.floor(days / 7), "week");
  return ago(Math.floor(days / 30), "month");
}

function ago(n: number, unit: string): string {
  return `${n} ${unit}${n !== 1 ? "s" : ""} ago`;
}

/** Human-readable byte size (binary units, e.g. "5 GB"). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const decimals = value >= 10 || Number.isInteger(value) ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[i] ?? "TB"}`;
}
