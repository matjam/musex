import type { Track } from "../models/index.js";
import type { DownloadRecord } from "./download-state.js";

/** Composite key for a downloaded track: Plex server id + media part path,
 *  joined by U+241F (can't appear in either). The download store + the "is this
 *  track downloaded?" probe share this key. */
export function downloadKey(serverId: string, plexPath: string): string {
  return `${serverId}␟${plexPath}`;
}

/** Lookup of fully-downloaded records keyed by `downloadKey`. Only
 *  `state === "downloaded"` (others have no file on disk yet). */
export function buildDownloadLookup(records: DownloadRecord[]): Map<string, DownloadRecord> {
  const map = new Map<string, DownloadRecord>();
  for (const r of records) {
    if (r.state !== "downloaded") continue;
    map.set(downloadKey(r.serverId, r.plexPath), r);
  }
  return map;
}

/** The downloaded record for a track (by serverId + media.partKey), or undefined. */
export function downloadRecordFor(
  lookup: Map<string, DownloadRecord>,
  track: Track,
): DownloadRecord | undefined {
  return lookup.get(downloadKey(track.serverId, track.media.partKey));
}

/** Container ids (album or artist) with at least one fully-downloaded track. */
export function downloadedContainerIds(
  records: DownloadRecord[],
  key: "albumId" | "artistId",
): Set<string> {
  const ids = new Set<string>();
  for (const r of records) {
    if (r.state !== "downloaded") continue;
    const id = r.meta[key];
    if (id) ids.add(id);
  }
  return ids;
}

/** Container ids with at least one in-flight (queued|downloading) track. */
export function downloadingContainerIds(
  records: DownloadRecord[],
  key: "albumId" | "artistId",
): Set<string> {
  const ids = new Set<string>();
  for (const r of records) {
    if (r.state !== "downloading" && r.state !== "queued") continue;
    const id = r.meta[key];
    if (id) ids.add(id);
  }
  return ids;
}
