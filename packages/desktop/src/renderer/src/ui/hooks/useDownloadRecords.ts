import { buildDownloadLookup } from "@musex/core";
import { useEffect, useState } from "react";
import type { DownloadDto } from "../../../../shared/ipc-contract";

/** Live lookup of fully-downloaded records keyed by `serverId␟plexPath` (see
 *  `downloadKey`). Lets a track row decide Download vs Remove and recover the
 *  record's `key` (which the renderer can't compute). Fetches `downloadsList()`
 *  on mount and refetches on every download-progress push; unsubscribes on
 *  unmount. Mirrors `useDownloadedSet`. */
export function useDownloadRecords(): Map<string, DownloadDto> {
  const [lookup, setLookup] = useState<Map<string, DownloadDto>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    function refresh() {
      window.musex
        .downloadsList()
        .then((records) => {
          if (!cancelled) setLookup(buildDownloadLookup(records));
        })
        .catch((err: unknown) => {
          // Non-fatal: leave the last good lookup; the track menu just won't
          // reflect the newest download until the next successful refresh.
          console.error("[downloads] records lookup refresh failed:", err);
        });
    }
    refresh();
    const unsubscribe = window.musex.onDownloadsProgress(() => refresh());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return lookup;
}
