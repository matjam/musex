import { useEffect, useState } from "react";
import { useMonitoring } from "../../state/monitoring";

/** Store-backed monitor toggle for an artist. Returns the props the `ActionBar`
 *  `monitor` prop expects (`on`/`busy`/`onToggle`) plus `supported` so callers
 *  hide the pill when no acquisition provider supports monitoring. */
export function useMonitorAction(artistName: string) {
  const mon = useMonitoring();
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.musex
      .acquisitionAvailable()
      .then((v) => {
        if (!cancelled) setSupported(v);
      })
      .catch(() => {
        if (!cancelled) setSupported(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const on = mon.isMonitored(artistName);
  return {
    supported,
    on,
    busy,
    onToggle: async () => {
      setBusy(true);
      try {
        await mon.setMonitored(artistName, !on);
      } catch (err) {
        // The store already reverted the optimistic toggle.
        console.error("[monitor] toggle failed:", err);
        // TODO: toast — no renderer-side toast mechanism yet (Toasts is plugin-notify only).
      } finally {
        setBusy(false);
      }
    },
  };
}
