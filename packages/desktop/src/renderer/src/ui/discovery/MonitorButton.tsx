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
    // One-way: there is no un-monitor IPC, so once an artist is monitored the
    // pill is shown lit + disabled (busy) rather than offering a broken
    // toggle-off that would silently re-acquire. Centralised here so every
    // consumer (ExternalArtistView, EntityPanel) is safe.
    busy: busy || on,
    onToggle: async () => {
      if (on) return;
      setBusy(true);
      try {
        await mon.setMonitored(artistName, true);
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

/** Store-backed "watch new releases" toggle for an artist — the toggleable
 *  ongoing relationship for an artist you already own (vs. useMonitorAction's
 *  one-way "acquire entire artist" for unowned artists). Returns the props the
 *  `ActionBar` `monitor` pill expects. `supported` is false when the provider
 *  doesn't support watching (per-artist probe, matching the old behaviour). */
export function useWatchAction(artistName: string) {
  const mon = useMonitoring();
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // newReleaseWatchGet returns null when no provider supports watching.
    window.musex
      .newReleaseWatchGet(artistName)
      .then((v) => {
        if (!cancelled) setSupported(v !== null);
      })
      .catch(() => {
        if (!cancelled) setSupported(false);
      });
    return () => {
      cancelled = true;
    };
  }, [artistName]);

  const on = mon.isWatched(artistName);
  return {
    supported,
    on,
    busy,
    onToggle: async () => {
      setBusy(true);
      try {
        await mon.setWatched(artistName, !on);
      } catch (err) {
        // The store already reverted the optimistic toggle.
        console.error("[watch] toggle failed:", err);
        // TODO: toast — no renderer-side toast mechanism yet (Toasts is plugin-notify only).
      } finally {
        setBusy(false);
      }
    },
  };
}
