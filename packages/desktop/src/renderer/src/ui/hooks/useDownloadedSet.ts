import { downloadedContainerIds, downloadingContainerIds } from "@musex/core";
import { useEffect, useState } from "react";
import type { DownloadDto } from "../../../../shared/ipc-contract";

type ContainerKey = "albumId" | "artistId";

/** Shared live-records subscription: fetches `downloadsList()` on mount and
 *  refetches on every download-progress push (the list is small — per-device
 *  downloads), derives a Set via `derive`, and unsubscribes on unmount. */
function useContainerIds(
  key: ContainerKey,
  derive: (records: DownloadDto[], key: ContainerKey) => Set<string>,
): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    function refresh() {
      window.musex
        .downloadsList()
        .then((records) => {
          if (!cancelled) setIds(derive(records, key));
        })
        .catch((err: unknown) => {
          // Non-fatal: leave the last good set; badges just won't reflect the
          // newest download until the next successful refresh.
          console.error("[downloads] availability set refresh failed:", err);
        });
    }
    refresh();
    const unsubscribe = window.musex.onDownloadsProgress(() => refresh());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [key, derive]);

  return ids;
}

/** Live set of container ids (album or artist) with ≥1 fully-downloaded track. */
export function useDownloadedSet(key: ContainerKey): Set<string> {
  return useContainerIds(key, downloadedContainerIds);
}

/** Live set of container ids (album or artist) with ≥1 in-flight (queued or
 *  downloading) track — drives the `"downloading"` card badge. */
export function useDownloadingSet(key: ContainerKey): Set<string> {
  return useContainerIds(key, downloadingContainerIds);
}
