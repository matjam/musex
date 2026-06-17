import { groupDownloadsByAlbum } from "@musex/core";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { DownloadDto } from "../../../../shared/ipc-contract";
import { formatBytes } from "../../util/format";
import { GridCard } from "../GridCard";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; records: DownloadDto[] };

/** Human label for an in-flight download record. */
const ACTIVE_LABEL: Partial<Record<DownloadDto["state"], string>> = {
  queued: "Queued",
  downloading: "Downloading",
};

/** "On this device" — the offline home. Shows downloads that are in flight
 *  (active strip) and finished (album-grouped tiles), with per-album removal
 *  and a total-storage figure. Live-updates from the download progress feed. */
export function OnDeviceView() {
  const [fetchState, setFetchState] = useState<FetchState>({ status: "loading" });

  const refresh = useCallback(() => {
    window.musex
      .downloadsList()
      .then((records) => setFetchState({ status: "ok", records }))
      .catch((err: unknown) => {
        console.error("[downloads] list failed:", err);
        // Keep the last good list; only surface the error before the first load.
        setFetchState((prev) =>
          prev.status === "ok"
            ? prev
            : {
                status: "error",
                message: err instanceof Error ? err.message : "Failed to load downloads",
              },
        );
      });
  }, []);

  useEffect(() => {
    refresh();
    // Each progress push (queue/state/bytes change) refetches the whole list —
    // simplest correct approach; the list is small (per-device downloads).
    return window.musex.onDownloadsProgress(() => refresh());
  }, [refresh]);

  async function removeAlbum(keys: string[]) {
    // allSettled (not a throwing loop): one failed key must not skip the rest.
    const results = await Promise.allSettled(keys.map((key) => window.musex.removeDownload(key)));
    for (const r of results) {
      if (r.status === "rejected") console.error("[downloads] remove failed:", r.reason);
    }
    refresh();
  }

  if (fetchState.status === "loading") {
    return <div className="content-placeholder">Loading downloads…</div>;
  }

  if (fetchState.status === "error") {
    return <div className="content-placeholder error-text">Error: {fetchState.message}</div>;
  }

  const { records } = fetchState;
  const active = records.filter((r) => r.state === "downloading" || r.state === "queued");
  const albums = groupDownloadsByAlbum(records);
  const totalBytes = records.reduce(
    (sum, r) => (r.state === "downloaded" ? sum + r.bytes : sum),
    0,
  );

  if (active.length === 0 && albums.length === 0) {
    return (
      <div className="browse-section on-device-view">
        <h3 className="browse-title">On this device</h3>
        <div className="content-placeholder">
          Nothing downloaded yet — pin an album or track for offline playback from its menu.
        </div>
      </div>
    );
  }

  return (
    <div className="browse-section on-device-view">
      <div className="browse-header">
        <h3 className="browse-title">On this device</h3>
        {albums.length > 0 && <div className="browse-sub">{formatBytes(totalBytes)} stored</div>}
      </div>

      {active.length > 0 && (
        <div className="dl-list on-device-active">
          {active.map((r) => (
            <div className="dl-row" key={r.key}>
              <div className="dl-row-main">
                <div className="dl-row-title">
                  {r.meta.title}
                  <span className="dl-row-artist">
                    {" — "}
                    {r.meta.artistName}
                  </span>
                </div>
              </div>
              <span className="dl-chip">{ACTIVE_LABEL[r.state] ?? r.state}</span>
            </div>
          ))}
        </div>
      )}

      {albums.length > 0 && (
        <div className="browse-grid">
          {albums.map((group) => (
            <GridCard
              key={group.albumId}
              thumb={group.thumb}
              title={group.albumTitle}
              subtitle={group.artistName}
              state="downloaded"
              actionIcon={Trash2}
              actionTitle={`Remove ${group.albumTitle} from this device`}
              // No offline album-detail view yet — the body click is a no-op;
              // removal is the explicit Trash2 hover action only.
              onOpen={() => {}}
              onAction={() => void removeAlbum(group.keys)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
