import type { DownloadMeta } from "./download-plan.js";

export type DownloadStatus = "queued" | "downloading" | "downloaded" | "failed" | "missing";
export type DownloadFormat = "original" | "mp3";

export interface StorageQuality {
  mode: "original" | "mp3";
  bitrateKbps: number;
}

export interface DownloadRecord {
  key: string;
  serverId: string;
  plexPath: string;
  trackId: string;
  format: DownloadFormat;
  state: DownloadStatus;
  bytes: number;
  addedAt: number;
  error?: string;
  meta: DownloadMeta;
}

/** On launch, mark any 'downloaded' record whose file vanished as 'missing'. Records
 *  still queued/downloading have no file yet, so they're left as-is. */
export function reconcileRecords(
  records: DownloadRecord[],
  presentKeys: ReadonlySet<string>,
): DownloadRecord[] {
  return records.map((r) =>
    r.state === "downloaded" && !presentKeys.has(r.key) ? { ...r, state: "missing" as const } : r,
  );
}

/** One album's worth of downloaded tracks, for the "On this device" grid. */
export interface DownloadAlbumGroup {
  albumId: string;
  albumTitle: string;
  artistName: string;
  /** First available track thumb (baked proxy URL), if any. */
  thumb?: string;
  /** Store keys of every track in this group (used to remove the whole album). */
  keys: string[];
  trackCount: number;
  /** Summed bytes across the group's tracks. */
  bytes: number;
}

/** Group downloaded records by album for tiled display. Records are bucketed by
 *  `meta.albumId`; the group's title/artist/thumb come from the first record in
 *  the bucket (thumb falls through to the first record that actually has one).
 *  Groups are returned sorted by album title (case-insensitive), then artist —
 *  a stable order so the grid doesn't reshuffle on refetch. Non-`downloaded`
 *  records are ignored. */
export function groupDownloadsByAlbum(records: DownloadRecord[]): DownloadAlbumGroup[] {
  const byAlbum = new Map<string, DownloadAlbumGroup>();
  for (const r of records) {
    if (r.state !== "downloaded") continue;
    const existing = byAlbum.get(r.meta.albumId);
    if (existing) {
      existing.keys.push(r.key);
      existing.trackCount += 1;
      existing.bytes += r.bytes;
      if (!existing.thumb && r.meta.thumb) existing.thumb = r.meta.thumb;
    } else {
      byAlbum.set(r.meta.albumId, {
        albumId: r.meta.albumId,
        albumTitle: r.meta.albumTitle ?? "Unknown Album",
        artistName: r.meta.artistName,
        thumb: r.meta.thumb,
        keys: [r.key],
        trackCount: 1,
        bytes: r.bytes,
      });
    }
  }
  return [...byAlbum.values()].sort(
    (a, b) =>
      a.albumTitle.localeCompare(b.albumTitle, undefined, { sensitivity: "base" }) ||
      a.artistName.localeCompare(b.artistName, undefined, { sensitivity: "base" }),
  );
}

/** Human-readable byte size (e.g. "1.4 GB"). Decimal (1000-based) units to
 *  match how disk space is commonly reported to users. */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}
