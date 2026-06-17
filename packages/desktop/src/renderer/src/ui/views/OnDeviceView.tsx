import type { Track } from "@musex/core";
import { formatBytes, groupDownloadsByAlbum } from "@musex/core";
import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { DownloadDto } from "../../../../shared/ipc-contract";
import { usePlayer } from "../../state/player";
import { groupTracksByAlbum } from "../../util/group-tracks-by-album";
import { ActionBar } from "../discovery/ActionBar";
import { GridCard } from "../GridCard";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; tracks: Track[]; records: DownloadDto[] };

/** Human label for an in-flight download record. */
const ACTIVE_LABEL: Partial<Record<DownloadDto["state"], string>> = {
  queued: "Queued",
  downloading: "Downloading",
};

/** "On this device" — the offline home, treated like a playlist. Shows downloads
 *  that are in flight (active strip) and finished (album-grouped tiles), with a
 *  Play all / Shuffle all header, per-album removal, and a total-storage figure.
 *  Live-updates from the download progress feed.
 *
 *  Two data sources, reconciled by albumId: the album tiles + all playback come
 *  from `downloadedTracks()` (play-ready Tracks with FRESH-baked thumbs), while
 *  the active strip, total size and per-album remove keys come from the raw
 *  `downloadsList()` records. */
export function OnDeviceView() {
  const { playTracks, playTracksShuffled } = usePlayer();
  const [fetchState, setFetchState] = useState<FetchState>({ status: "loading" });

  const refresh = useCallback(() => {
    // Both lists in one shot; a partial failure of either keeps the last good
    // state rather than tearing down the view.
    Promise.all([window.musex.downloadedTracks(), window.musex.downloadsList()])
      .then(([tracks, records]) => setFetchState({ status: "ok", tracks, records }))
      .catch((err: unknown) => {
        console.error("[downloads] on-device load failed:", err);
        // Keep the last good state; only surface the error before the first load.
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
    // Each progress push (queue/state/bytes change) refetches both lists —
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

  const { tracks, records } = fetchState;
  const active = records.filter((r) => r.state === "downloading" || r.state === "queued");
  const albums = groupTracksByAlbum(tracks);
  const totalBytes = records.reduce(
    (sum, r) => (r.state === "downloaded" ? sum + r.bytes : sum),
    0,
  );

  // albumId -> the download record keys to remove that album. The tiles are built
  // from playable tracks (for art + playback), but removal acts on the raw
  // download records; a downloaded album always appears in both sources.
  const removeKeysByAlbum = new Map(
    groupDownloadsByAlbum(records).map((g) => [g.albumId, g.keys] as const),
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
      <div className="browse-header on-device-header">
        <div className="on-device-heading">
          <h3 className="browse-title">On this device</h3>
          {albums.length > 0 && (
            <div className="browse-sub on-device-size">{formatBytes(totalBytes)} stored</div>
          )}
        </div>
        {tracks.length > 0 && (
          <ActionBar
            onPlay={() => playTracks(tracks, 0)}
            onShuffle={() => playTracksShuffled(tracks)}
          />
        )}
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
              // Tile click OR the hover Play overlay both play this album in order —
              // "navigate + play" the collection, like a playlist.
              onOpen={() => playTracks(group.tracks, 0)}
              onPlay={() => playTracks(group.tracks, 0)}
              onAction={() => void removeAlbum(removeKeysByAlbum.get(group.albumId) ?? [])}
            />
          ))}
        </div>
      )}
    </div>
  );
}
