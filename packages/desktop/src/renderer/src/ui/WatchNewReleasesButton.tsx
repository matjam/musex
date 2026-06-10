import { Bell, BellRing } from "lucide-react";
import { useEffect, useState } from "react";

type WatchState = "unknown" | "unsupported" | "off" | "on" | "busy";

/** Per-artist "fetch new releases" toggle (artist pages, external artists).
 *  The acquisition provider is the source of truth; renders nothing when no
 *  provider supports watching. */
export function WatchNewReleasesButton({ artistName }: { artistName: string }) {
  const [state, setState] = useState<WatchState>("unknown");

  useEffect(() => {
    let cancelled = false;
    setState("unknown");
    window.musex
      .newReleaseWatchGet(artistName)
      .then((watching) => {
        if (!cancelled) setState(watching === null ? "unsupported" : watching ? "on" : "off");
      })
      .catch((err: unknown) => {
        console.error("[watch] state fetch failed:", err);
        if (!cancelled) setState("unsupported");
      });
    return () => {
      cancelled = true;
    };
  }, [artistName]);

  if (state === "unknown" || state === "unsupported") return null;

  async function toggle() {
    const next = state !== "on";
    setState("busy");
    try {
      await window.musex.newReleaseWatchSet(artistName, next);
      setState(next ? "on" : "off");
    } catch (err) {
      console.error("[watch] toggle failed:", err);
      setState(next ? "off" : "on");
    }
  }

  const on = state === "on";
  return (
    <button
      type="button"
      className={`shuffle-btn watch-btn${on ? " watch-btn--on" : ""}`}
      disabled={state === "busy"}
      title={
        on
          ? "Watching for new releases — click to stop"
          : "Fetch new releases by this artist automatically"
      }
      onClick={() => void toggle()}
    >
      {on ? <BellRing size={16} /> : <Bell size={16} />}
    </button>
  );
}
