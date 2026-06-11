import { Disc3, Download, ExternalLink, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ArtistInfoDto } from "../../../shared/ipc-contract";
import { useApp } from "../state/app";
import { usePanel } from "../state/panel";

type FetchState = { status: "loading" } | { status: "ok"; info: ArtistInfoDto | null };

/** Right-hand panel: artist bio/stats from the similar providers (last.fm),
 *  with monitor + browse-albums actions. Only ever opened for artists NOT in
 *  the library (owned tiles navigate straight to the artist view). */
export function ArtistInfoPanel({ artistName }: { artistName: string }) {
  const { dispatch } = useApp();
  const { closePanel } = usePanel();
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });
  const [monitored, setMonitored] = useState(false);
  const [monitorBusy, setMonitorBusy] = useState(false);

  useEffect(() => {
    setFetch({ status: "loading" });
    setMonitored(false);
    let cancelled = false;
    window.musex
      .artistInfoGet(artistName)
      .then((info) => {
        if (!cancelled) setFetch({ status: "ok", info });
      })
      .catch(() => {
        if (!cancelled) setFetch({ status: "ok", info: null });
      });
    window.musex
      .acquisitionMonitoredArtists()
      .then((names) => {
        if (!cancelled && names.some((n) => n.toLowerCase() === artistName.toLowerCase())) {
          setMonitored(true);
        }
      })
      .catch(() => {
        // badge only — fine without it
      });
    return () => {
      cancelled = true;
    };
  }, [artistName]);

  function monitorArtist() {
    setMonitorBusy(true);
    window.musex
      .acquisitionAcquireArtistByName(artistName)
      .then(() => setMonitored(true))
      .catch((err: unknown) => {
        console.error("[acquisition] acquireArtistByName failed:", err);
      })
      .finally(() => setMonitorBusy(false));
  }

  function browseAlbums() {
    closePanel();
    dispatch({ type: "navigate", view: { name: "external-artist", artistName } });
  }

  const info = fetch.status === "ok" ? fetch.info : null;

  return (
    <aside className="detail-panel">
      <div className="detail-head">
        <span className="detail-head-label">{artistName}</span>
        <button
          type="button"
          className="detail-close"
          title="Close"
          onClick={() => closePanel("artist-info")}
        >
          <X size={16} />
        </button>
      </div>

      {fetch.status === "loading" && (
        <div className="detail-meta-row">
          <span>Looking up artist…</span>
        </div>
      )}

      {fetch.status === "ok" && (
        <>
          {info?.imageUrl && (
            <img className="artist-info-image" src={info.imageUrl} alt={artistName} />
          )}

          {(info?.listeners != null || info?.playCount != null) && (
            <div className="detail-meta">
              {info.listeners != null && info.playCount != null ? (
                <div className="detail-meta-row">
                  <span>Listeners</span>
                  <span>{info.listeners.toLocaleString()}</span>
                </div>
              ) : info.listeners != null ? (
                <div className="detail-meta-row">
                  <span>Listeners</span>
                  <span>{info.listeners.toLocaleString()}</span>
                </div>
              ) : null}
              {info.playCount != null && (
                <div className="detail-meta-row">
                  <span>Plays</span>
                  <span>{info.playCount.toLocaleString()}</span>
                </div>
              )}
            </div>
          )}

          {info?.bio && <p className="artist-info-bio">{info.bio}</p>}

          {!info && (
            <div className="detail-meta-row">
              <span>No artist info available.</span>
            </div>
          )}

          <div className="artist-info-actions">
            <button type="button" className="settings-btn" onClick={browseAlbums}>
              <Disc3 size={14} /> Browse albums
            </button>
            <button
              type="button"
              className="settings-btn"
              disabled={monitored || monitorBusy}
              onClick={monitorArtist}
            >
              <Download size={14} />
              {monitored ? "Monitoring" : monitorBusy ? "Monitoring…" : "Monitor artist"}
            </button>
            {info?.url && (
              <button
                type="button"
                className="settings-btn"
                onClick={() => void window.musex.openExternal(info.url as string)}
              >
                <ExternalLink size={14} /> View on last.fm
              </button>
            )}
          </div>
        </>
      )}
    </aside>
  );
}
