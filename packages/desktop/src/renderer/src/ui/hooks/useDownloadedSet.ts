import { useEffect, useState } from "react";
import { downloadedContainerIds } from "../../util/downloaded-set";

/** Live set of container ids (album or artist) with ≥1 fully-downloaded track.
 *  Fetches `downloadsList()` on mount and refetches on every download-progress
 *  push (the list is small — per-device downloads). Unsubscribes on unmount. */
export function useDownloadedSet(key: "albumId" | "artistId"): Set<string> {
  const [ids, setIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    function refresh() {
      window.musex
        .downloadsList()
        .then((records) => {
          if (!cancelled) setIds(downloadedContainerIds(records, key));
        })
        .catch((err: unknown) => {
          // Non-fatal: leave the last good set; availability badges just won't
          // reflect the newest download until the next successful refresh.
          console.error("[downloads] availability set refresh failed:", err);
        });
    }
    refresh();
    const unsubscribe = window.musex.onDownloadsProgress(() => refresh());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [key]);

  return ids;
}
