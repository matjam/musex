import {
  type ContainerDownloadProgress,
  type DownloadRecord,
  downloadKey,
  downloadProgress,
  type Track,
} from "@musex/core";
import { useMemo } from "react";
import { useStore } from "./store";

/** Live download progress for a set of tracks (a container's contents).
 *  Recomputes on downloadsVersion bumps, so bars move as bytes land. */
export function useDownloadProgress(tracks: readonly Track[]): ContainerDownloadProgress {
  const { downloadsList, downloadsVersion } = useStore();
  // biome-ignore lint/correctness/useExhaustiveDependencies: downloadsVersion is the refresh trigger, not referenced in the body.
  return useMemo(
    () =>
      downloadProgress(
        downloadsList(),
        tracks.map((t) => downloadKey(t.serverId, t.media.partKey)),
      ),
    [tracks, downloadsList, downloadsVersion],
  );
}

/** Like useDownloadProgress, but keyed by the download index itself: aggregate
 *  progress over every record (optionally filtered — an artist's records, the
 *  whole collection). `filter` must be referentially stable (useCallback) or
 *  omitted, otherwise the memo recomputes every render. */
export function useRecordsProgress(
  filter?: (r: DownloadRecord) => boolean,
): ContainerDownloadProgress {
  const { downloadsList, downloadsVersion } = useStore();
  // biome-ignore lint/correctness/useExhaustiveDependencies: downloadsVersion is the refresh trigger, not referenced in the body.
  return useMemo(() => {
    const records = filter ? downloadsList().filter(filter) : downloadsList();
    return downloadProgress(
      records,
      records.map((r) => r.key),
    );
  }, [filter, downloadsList, downloadsVersion]);
}
