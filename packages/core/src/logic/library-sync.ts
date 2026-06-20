import type { Track } from "../models/index.js";
import { downloadKey } from "./download-lookup.js";
import type { DownloadRecord, StorageQuality } from "./download-state.js";

/** The work needed to make the device mirror the library: tracks to download and
 *  download keys to remove. `toRemove` is ALWAYS empty unless the caller opts in
 *  via `allowRemovals` (see planLibrarySync). */
export interface SyncPlan {
  toDownload: Track[];
  /** Store keys (downloadKey) to delete — pass to DownloadManager.removeDownload. */
  toRemove: string[];
}

/** A track is considered "already handled" when there is a record for it that is
 *  downloaded or still in flight. `failed`/`missing` records are NOT counted, so
 *  the sync retries them. */
function alreadyHandledKeys(records: DownloadRecord[]): Set<string> {
  const keys = new Set<string>();
  for (const r of records) {
    if (r.state === "downloaded" || r.state === "queued" || r.state === "downloading") {
      keys.add(downloadKey(r.serverId, r.plexPath));
    }
  }
  return keys;
}

/**
 * Diff an authoritative library track list against the local download index.
 *
 * - `toDownload` = library tracks with no downloaded/in-flight record yet.
 * - `toRemove`   = **sync-origin** records whose track is no longer in the
 *   library — but ONLY when `opts.allowRemovals` is true.
 *
 * SAFETY: removals are gated behind `allowRemovals` so a caller can compute the
 * download set from any list, but only ever delete after a library fetch it
 * trusts (online + fully successful). With `allowRemovals: false`, `toRemove` is
 * always empty even if `libraryTracks` is empty — a partial/failed/offline fetch
 * can never wipe the device. Manual-origin records are never removed.
 */
export function planLibrarySync(
  libraryTracks: Track[],
  downloaded: DownloadRecord[],
  opts: { allowRemovals: boolean },
): SyncPlan {
  const handled = alreadyHandledKeys(downloaded);
  const toDownload = libraryTracks.filter(
    (t) => !handled.has(downloadKey(t.serverId, t.media.partKey)),
  );

  let toRemove: string[] = [];
  if (opts.allowRemovals) {
    const libraryKeys = new Set(libraryTracks.map((t) => downloadKey(t.serverId, t.media.partKey)));
    toRemove = downloaded
      .filter((r) => r.origin === "sync" && !libraryKeys.has(downloadKey(r.serverId, r.plexPath)))
      .map((r) => r.key);
  }

  return { toDownload, toRemove };
}

/** Ports the sync orchestration needs. Each surface supplies these over its own
 *  gateway / download manager; the decision logic stays here in core. */
export interface SyncPorts {
  /** Is the "sync entire library" toggle on? */
  isEnabled(): boolean;
  /** Fetch the authoritative full track list. MUST reject (not return partial)
   *  when offline or the fetch fails — a rejection makes the run additive-only. */
  listAllTracks(): Promise<Track[]>;
  /** Current local download index. */
  downloadedRecords(): DownloadRecord[];
  /** Enqueue these tracks as SYNC-origin downloads. */
  enqueue(tracks: Track[]): Promise<void>;
  /** Delete a download by store key. */
  remove(key: string): Promise<void>;
}

export interface SyncResult {
  downloaded: number;
  removed: number;
  /** False when the run was a no-op (disabled) or the fetch failed (additive
   *  skipped, nothing removed). */
  reconciled: boolean;
}

/**
 * One reconcile pass. No-ops when sync is disabled. Fetches the authoritative
 * library list; if that REJECTS (offline / error), returns without downloading
 * or removing anything — so a failed fetch can never delete downloads. Only on a
 * successful fetch does it enqueue the missing tracks and remove sync-origin
 * downloads that have left the library (allowRemovals: true).
 */
export async function runLibrarySync(ports: SyncPorts): Promise<SyncResult> {
  if (!ports.isEnabled()) return { downloaded: 0, removed: 0, reconciled: false };

  let tracks: Track[];
  try {
    tracks = await ports.listAllTracks();
  } catch {
    return { downloaded: 0, removed: 0, reconciled: false }; // offline/error → never removes
  }

  const plan = planLibrarySync(tracks, ports.downloadedRecords(), { allowRemovals: true });
  if (plan.toDownload.length > 0) await ports.enqueue(plan.toDownload);
  for (const key of plan.toRemove) await ports.remove(key);
  return { downloaded: plan.toDownload.length, removed: plan.toRemove.length, reconciled: true };
}

/** Estimate the on-disk bytes to download `tracks` at the given quality, for the
 *  "Download ~X GB?" confirm. AAC is exact-ish (duration × bitrate). For Original
 *  we use each track's known media bitrate, falling back to the configured
 *  bitrate as a conservative floor when a track has none (we can't know the true
 *  original size until it's downloaded). */
export function estimateSyncBytes(tracks: Track[], quality: StorageQuality): number {
  const bytes = tracks.reduce((sum, t) => {
    const seconds = t.durationMs / 1000;
    const kbps =
      quality.mode === "aac" ? quality.bitrateKbps : (t.media.bitrate ?? quality.bitrateKbps);
    return sum + seconds * ((kbps * 1000) / 8);
  }, 0);
  return Math.round(bytes);
}
