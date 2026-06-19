import { ArrowDownToLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AcquisitionStatusDto } from "../../../shared/ipc-contract";
import { useApp } from "../state/app";
import { useAcquisitionAvailable } from "./hooks/useAcquisitionAvailable";

const POLL_MS = 5_000;

/** A row is "in flight" while the provider is actively fetching or has it
 *  queued — the same `acquisitionStatus()` feed ActivityView consumes. */
function isInFlight(row: AcquisitionStatusDto): boolean {
  return row.state === "downloading" || row.state === "requested";
}

/** Conditional top-bar acquisition activity pill. Subscribes to the existing
 *  `acquisitionStatus()` feed (the same one ActivityView shows) and renders
 *  ONLY while there are in-flight items; idle = nothing. Clicking opens a
 *  popover listing the in-flight items + progress, with a "View all" that
 *  navigates to the Activity view. */
export function ActivityPill() {
  const { connectivity, dispatch } = useApp();
  const acquisitionAvailable = useAcquisitionAvailable();
  const [rows, setRows] = useState<AcquisitionStatusDto[]>([]);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Poll the acquisition feed. Skipped when no acquisition provider exists (the
  // feed is always empty) and offline (the provider is unreachable); either way
  // the feed clears so the pill hides.
  useEffect(() => {
    if (!acquisitionAvailable || connectivity === "offline") {
      setRows([]);
      return;
    }
    let cancelled = false;
    function poll() {
      window.musex
        .acquisitionStatus()
        .then((r) => {
          if (!cancelled) setRows(r);
        })
        .catch((err: unknown) => {
          // Non-fatal: the pill just stays hidden if the feed errors.
          console.error("[acquisition] pill status failed:", err);
        });
    }
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connectivity, acquisitionAvailable]);

  // Close the popover on an outside click.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const inFlight = rows.filter(isInFlight);
  // Conditional: render nothing when idle.
  if (inFlight.length === 0) return null;

  return (
    <div className="topbar-activity" ref={wrapRef}>
      <button
        type="button"
        className="topbar-activity-pill"
        title={`Acquiring ${inFlight.length} item${inFlight.length !== 1 ? "s" : ""}`}
        onClick={() => setOpen((o) => !o)}
      >
        <ArrowDownToLine size={12} />
        Acquiring {inFlight.length}
      </button>
      {open && (
        <div className="topbar-activity-popover" role="menu">
          <div className="topbar-activity-list">
            {inFlight.map((row) => (
              <div
                className="topbar-activity-row"
                key={`${row.providerId}:${row.artistName}:${row.title}`}
              >
                <div className="topbar-activity-main">
                  <div className="topbar-activity-title">{row.title}</div>
                  <div className="topbar-activity-artist">{row.artistName}</div>
                  {row.progress != null && (
                    <div className="dl-progress">
                      <div
                        className="dl-progress-fill"
                        style={{
                          width: `${Math.round(Math.min(1, Math.max(0, row.progress)) * 100)}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="topbar-activity-viewall"
            onClick={() => {
              setOpen(false);
              dispatch({ type: "navigate", view: { name: "activity" } });
            }}
          >
            View all
          </button>
        </div>
      )}
    </div>
  );
}
