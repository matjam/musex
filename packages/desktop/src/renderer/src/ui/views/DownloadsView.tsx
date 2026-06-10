import { useEffect, useState } from "react";
import type { AcquisitionStatusDto } from "../../../../shared/ipc-contract";

const REFRESH_MS = 10_000;

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; rows: AcquisitionStatusDto[] };

/** Status of requested/downloading albums across acquisition providers
 *  (Lidarr queue + monitored-but-missing). Auto-refreshes while open. */
export function DownloadsView() {
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    function refresh() {
      window.musex
        .acquisitionStatus()
        .then((rows) => {
          if (!cancelled) setFetch({ status: "ok", rows });
        })
        .catch((err: unknown) => {
          console.error("[acquisition] status failed:", err);
          // Keep showing the last good rows; only surface the error before
          // the first successful fetch.
          if (!cancelled) {
            setFetch((prev) =>
              prev.status === "ok"
                ? prev
                : {
                    status: "error",
                    message: err instanceof Error ? err.message : "Failed to load downloads",
                  },
            );
          }
        });
    }

    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <div className="browse-section downloads-view">
      <h3 className="browse-title">Downloads</h3>
      <div className="browse-sub">Albums requested through acquisition plugins.</div>

      {fetch.status === "loading" && <div className="content-placeholder">Loading…</div>}

      {fetch.status === "error" && (
        <div className="content-placeholder error-text">Error: {fetch.message}</div>
      )}

      {fetch.status === "ok" && fetch.rows.length === 0 && (
        <div className="content-placeholder">
          Nothing requested. Add albums from an external artist's page.
        </div>
      )}

      {fetch.status === "ok" && fetch.rows.length > 0 && (
        <div className="dl-list">
          {fetch.rows.map((row) => (
            <div className="dl-row" key={`${row.providerId}:${row.artistName}:${row.title}`}>
              <div className="dl-row-main">
                <div className="dl-row-title">
                  {row.title}
                  <span className="dl-row-artist"> — {row.artistName}</span>
                </div>
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
                {row.detail && <div className="dl-row-detail">{row.detail}</div>}
              </div>
              <span className={`dl-chip grid-card-badge--${row.state}`}>{row.state}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
