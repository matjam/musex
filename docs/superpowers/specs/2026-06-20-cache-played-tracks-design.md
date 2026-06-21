# Cache played tracks (offline library by listening) — design

**Date:** 2026-06-20
**Status:** approved — build (stacked on the incremental-sync fixes).
**Surfaces:** iOS + desktop, shared logic in `@musex/core`.

## Goal

Playing a track automatically saves it offline, so your local library fills as
you listen. "Available offline" becomes one concept: **pinned (manual/sync) ∪
cached-on-play**. On by default; respects the AAC/Original storage-quality
setting; evicts cache under a size cap (or "Unlimited", never evicts).

## Decisions

- **On by default.**
- **Respects the AAC/Original setting** (cache downloads use the same transcode
  path as pinned downloads).
- Cached tracks appear in the Downloaded list and as "downloaded" badges, exactly
  like pinned downloads (they ARE downloads, just a different origin).

## Model

Add a third **origin** to `DownloadRecord`/`DownloadJob`:
`"manual" | "sync" | "cache"`.

- **manual** — explicit user pin. Never evicts.
- **sync** — library mirror. Never evicts.
- **cache** — auto-saved because you played it. Evicts LRU under the cap.

"Available offline" = any `downloaded` record, any origin. Pinned origins are
excluded from the cache cap and from eviction.

## Trigger (when to cache)

Reuse the existing play classification so we don't cache rapid skips: when a
track has played past the "real listen" threshold the play-monitor already uses
(`classifyPlay` → not a skip; ≈ played ≥ 15s or a meaningful fraction), enqueue
it as a **cache-origin** download (deduped — if it's already downloaded/queued,
no-op). The byte fetch then runs in the background while you keep listening.

`DownloadRecord` gains **`lastAccessMs`** (updated to "now" each time the track
is played) so eviction is true LRU. Defaults to `addedAt` when absent.

## Eviction (pure core)

`logic/cache-eviction.ts`:

```ts
export interface CacheConfig { enabled: boolean; capBytes: number | null; } // null = Unlimited
// Returns cache-origin keys to delete, least-recently-played first, until the
// cache-origin total is within capBytes. Pinned (manual/sync) records are never
// returned and don't count toward the cap.
export function planCacheEviction(records: DownloadRecord[], capBytes: number | null): string[];
```

Run after each cache download completes (and on launch). `capBytes: null` →
returns `[]` (never evicts).

## Per-surface implementation

Both surfaces enqueue a **cache-origin download via the existing DownloadManager**
(respecting quality) — so the logic, dedup, and UI surfacing are shared.

- **Mobile:** the store's play-monitor loop already classifies plays; on a
  non-skip, `enqueue([buildJob(track, "cache")])`. After completion, run
  `planCacheEviction` and remove the returned keys. Update `lastAccessMs` on play.
- **Desktop:** the `PlaybackMonitor` already feeds play events; on a non-skip,
  `enqueueDownloads([track], "cache")`. Eviction in `Runtime` after completion.
  **Cache-on-play supersedes the LRU `MediaCache` write-through:** when caching is
  enabled, the proxy's write-through is disabled (played tracks become cache
  downloads instead; serve order already checks downloads first). The MediaCache
  class stays for the disabled-cache case; fully retiring it is a follow-up.

## Contention (playing while downloading)

The DownloadManager is already concurrency-1. To keep a live stream from
stuttering on a poor connection, **defer cache/sync downloads while the current
track is still actively buffering** (a short grace window after a track starts),
and prioritize the currently-playing track if it's itself being cached. A
future "download on Wi-Fi only" option is noted, not built.

## Settings / config

Replace/extend the existing local-cache setting:

- A **"Keep played tracks offline"** toggle (default ON).
- A **cache size cap** select with an **Unlimited** option (default e.g. 8 GB on
  mobile; Unlimited acceptable on desktop).
- Persisted: mobile async-storage `musex.cache-config`; desktop electron-store
  `cacheConfig`. Pinned (sync/manual) downloads are shown/managed separately
  (the existing Library Sync + Remove-all controls).

## Testing

- Core: `planCacheEviction` — evicts cache-origin LRU to the cap; never evicts
  manual/sync; `null` cap evicts nothing; pinned excluded from the cap total.
- Mobile: play-threshold enqueues a cache job; a skip does not; eviction removes
  the LRU cache key over cap.

## Non-goals

- No background AAC caching beyond what foreground/while-playing already gives
  (see the native-background spike).
- No cross-device cache sync. No per-album cache pinning UI (pinning is the
  existing Download action).

## Risks

- **Desktop double-caching** if MediaCache write-through isn't disabled when
  cache-on-play is on — addressed by superseding it.
- **Caching everything you skip-play** — mitigated by the play-threshold trigger.
- **Cache churn** on a small cap (download then evict) — acceptable; the cap is
  user-set and defaults generous.
