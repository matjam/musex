import { useEffect, useState } from "react";
import { useApp } from "../../state/app";
import { buildAcquisitionMap } from "../../util/acquisition-map";
import type { AcquisitionBadgeState } from "../discovery/state-badge";

/** Same cadence the AcquiringView feed auto-refreshes on. */
const REFRESH_MS = 10_000;

/** Live `name → acquisition badge state` map for browse-grid overlays.
 *
 *  Fetches `acquisitionStatus()` (album-granular rows) once on mount and on a
 *  10s interval, building either an album-title map (`keyField: "title"`) or an
 *  artist-name rollup (`keyField: "artistName"`). Acquisition status needs the
 *  provider's network, so the fetch is SKIPPED while offline and degrades to an
 *  empty map on any error — acquiring badges/filter then simply show nothing. */
export function useAcquisitionMap(
  keyField: "title" | "artistName",
): Map<string, AcquisitionBadgeState> {
  const { connectivity } = useApp();
  const offline = connectivity === "offline";
  const [map, setMap] = useState<Map<string, AcquisitionBadgeState>>(() => new Map());

  useEffect(() => {
    if (offline) {
      // No provider reachability offline — clear any stale map so the badges
      // and Acquiring filter show nothing rather than a frozen snapshot.
      setMap(new Map());
      return;
    }
    let cancelled = false;
    function refresh() {
      window.musex
        .acquisitionStatus()
        .then((rows) => {
          if (!cancelled) setMap(buildAcquisitionMap(rows, keyField));
        })
        .catch((err: unknown) => {
          // Non-fatal: degrade to whatever we last had; the next tick retries.
          console.error("[acquisition] status overlay refresh failed:", err);
        });
    }
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [keyField, offline]);

  return map;
}
