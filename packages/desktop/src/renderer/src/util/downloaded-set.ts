import type { DownloadDto } from "../../../shared/ipc-contract";

/** Derive the set of container ids (album or artist) that have at least one
 *  fully-downloaded track on disk. Only `state === "downloaded"` records count —
 *  queued/downloading/failed/missing are not yet present locally. */
export function downloadedContainerIds(
  records: DownloadDto[],
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

/** Derive the set of container ids (album or artist) with at least one
 *  in-flight (queued or downloading) track — i.e. a local download is on the
 *  way but not yet on disk. Drives the `"downloading"` card badge; downloaded
 *  containers (see {@link downloadedContainerIds}) take precedence on a card. */
export function downloadingContainerIds(
  records: DownloadDto[],
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
