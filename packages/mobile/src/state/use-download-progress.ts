import {
  type ContainerDownloadProgress,
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
