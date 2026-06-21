import type { DownloadRecord } from "./download-state.js";

/** "Keep played tracks offline" configuration. `capBytes: null` = Unlimited. */
export interface CacheConfig {
  enabled: boolean;
  capBytes: number | null;
}

/** A cache record's LRU timestamp: when it was last played, else when it landed. */
function lastAccess(r: DownloadRecord): number {
  return r.lastAccessMs ?? r.addedAt;
}

/**
 * Decide which CACHE-origin downloads to evict so the cache total fits `capBytes`.
 *
 * - Only `origin === "cache"` + `state === "downloaded"` records are eligible.
 *   Pinned downloads (manual/sync, or legacy undefined) are NEVER evicted and do
 *   NOT count toward the cap.
 * - `capBytes: null` (Unlimited) → evict nothing.
 * - Otherwise evict least-recently-played first until the cache total is ≤ cap.
 *
 * Returns the store keys to delete (oldest-first).
 */
export function planCacheEviction(records: DownloadRecord[], capBytes: number | null): string[] {
  if (capBytes === null) return [];
  const cache = records
    .filter((r) => r.origin === "cache" && r.state === "downloaded")
    .sort((a, b) => lastAccess(b) - lastAccess(a)); // most-recent first

  let total = cache.reduce((sum, r) => sum + r.bytes, 0);
  const evict: string[] = [];
  // Walk from the oldest end, dropping until within cap.
  for (let i = cache.length - 1; i >= 0 && total > capBytes; i--) {
    const r = cache[i];
    if (!r) continue;
    evict.push(r.key);
    total -= r.bytes;
  }
  return evict;
}

/** Total bytes held by cache-origin downloaded records (for the settings display). */
export function cacheBytes(records: DownloadRecord[]): number {
  return records
    .filter((r) => r.origin === "cache" && r.state === "downloaded")
    .reduce((sum, r) => sum + r.bytes, 0);
}
