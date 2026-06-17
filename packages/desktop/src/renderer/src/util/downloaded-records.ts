import type { Track } from "@musex/core";
import type { DownloadDto } from "../../../shared/ipc-contract";

/** Composite key for a downloaded track: a downloaded file is identified by its
 *  Plex server id + the media part path. Used both to key the lookup map and to
 *  probe a Track's download state. The separator (␟ / U+241F) is the same
 *  unit-separator glyph used elsewhere for composite keys, and can't appear in a
 *  serverId or Plex part path. */
export function downloadKey(serverId: string, plexPath: string): string {
  return `${serverId}␟${plexPath}`;
}

/** Build a lookup of fully-downloaded records keyed by `downloadKey`. Only
 *  `state === "downloaded"` records are included — queued/downloading/failed/
 *  missing records have no removable file on disk yet, and the "is this track
 *  downloaded?" question is exactly `state === "downloaded"`. */
export function buildDownloadLookup(records: DownloadDto[]): Map<string, DownloadDto> {
  const map = new Map<string, DownloadDto>();
  for (const r of records) {
    if (r.state !== "downloaded") continue;
    map.set(downloadKey(r.serverId, r.plexPath), r);
  }
  return map;
}

/** The downloaded record for a track, or undefined when the track isn't
 *  downloaded. Matches on `track.serverId` + `track.media.partKey` against the
 *  record's `serverId` + `plexPath`. */
export function downloadRecordFor(
  lookup: Map<string, DownloadDto>,
  track: Track,
): DownloadDto | undefined {
  return lookup.get(downloadKey(track.serverId, track.media.partKey));
}
