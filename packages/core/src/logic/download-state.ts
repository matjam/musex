import type { Track } from "../models/index.js";
import type { DownloadMeta } from "./download-plan.js";

export type DownloadStatus = "queued" | "downloading" | "downloaded" | "failed" | "missing";
export type DownloadFormat = "original" | "aac";

export interface StorageQuality {
  mode: "original" | "aac";
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

/** Rebuild a playable Track from a download record. `media` is assembled from
 *  the meta fields stored at enqueue time; the record's `plexPath` is the
 *  partKey the stream proxy serves the downloaded file by. Records written
 *  before the media fields existed fall back to empty strings — playback still
 *  works (the proxy serves by cacheKey(serverId, plexPath), not codec).
 *
 *  NOTE: `thumb` is whatever the record stored — a STALE baked proxy URL with a
 *  past launch's secret. Re-baking it with the current secret is the host's
 *  job (the desktop downloadedTracks IPC); this pure helper passes it through. */
export function recordToTrack(record: DownloadRecord): Track {
  const { meta } = record;
  return {
    id: record.trackId,
    serverId: record.serverId,
    albumId: meta.albumId,
    artistId: meta.artistId,
    artistName: meta.artistName,
    albumTitle: meta.albumTitle,
    title: meta.title,
    durationMs: meta.durationMs,
    trackNumber: meta.trackNumber,
    thumb: meta.thumb,
    media: {
      container: meta.container ?? "",
      audioCodec: meta.audioCodec ?? "",
      bitrate: meta.bitrate,
      partId: meta.partId ?? "",
      partKey: record.plexPath,
    },
  };
}

/** Reconstruct playable Tracks from the `downloaded` records only, sorted album
 *  by album (album title, locale case-insensitive) then by track number
 *  (undefined last), so the collection plays in a sensible order offline. */
export function recordsToTracks(records: DownloadRecord[]): Track[] {
  return records
    .filter((r) => r.state === "downloaded")
    .map(recordToTrack)
    .sort((a, b) => {
      const byAlbum = (a.albumTitle ?? "").localeCompare(b.albumTitle ?? "", undefined, {
        sensitivity: "base",
      });
      if (byAlbum !== 0) return byAlbum;
      const an = a.trackNumber ?? Number.POSITIVE_INFINITY;
      const bn = b.trackNumber ?? Number.POSITIVE_INFINITY;
      return an - bn;
    });
}
