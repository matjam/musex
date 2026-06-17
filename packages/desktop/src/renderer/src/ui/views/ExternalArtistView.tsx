import { Bell, BellRing, Download } from "lucide-react";
import { useEffect, useState } from "react";
import type { AcquirableAlbumDto } from "../../../../shared/ipc-contract";
import { useApp } from "../../state/app";
import { useMonitoring } from "../../state/monitoring";
import { ActionBar } from "../discovery/ActionBar";
import { useMonitorAction, useWatchAction } from "../discovery/MonitorButton";
import { MonitorStatusLine } from "../discovery/MonitorStatusLine";
import { GridCard } from "../GridCard";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; albums: AcquirableAlbumDto[] };

/** Discography of an artist we don't (fully) own, merged from acquisition
 *  providers and similar providers (last.fm). Owned albums navigate
 *  into the library; available ones get a hover Add (acquire) action;
 *  last.fm-only titles are shown dimmed as unavailable. */
export function ExternalArtistView({ artistName }: { artistName: string }) {
  const { dispatch } = useApp();
  const monitoring = useMonitoring();
  // "Monitor entire artist" (one-way acquire) + "Watch new releases" (toggle).
  const monitor = useMonitorAction(artistName);
  const watch = useWatchAction(artistName);
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    setFetch({ status: "loading" });
    let cancelled = false;
    window.musex
      .acquisitionDiscography(artistName)
      .then((albums) => {
        if (!cancelled) setFetch({ status: "ok", albums });
      })
      .catch((err: unknown) => {
        console.error("[acquisition] acquisitionDiscography failed:", err);
        if (!cancelled) {
          setFetch({
            status: "error",
            message: err instanceof Error ? err.message : "Failed to look up artist",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [artistName]);

  function openOwned(album: AcquirableAlbumDto) {
    if (!album.albumId || !album.serverId) return;
    dispatch({
      type: "navigate",
      view: {
        name: "album",
        album: {
          id: album.albumId,
          serverId: album.serverId,
          artistId: album.artistId ?? "",
          title: album.title,
          thumb: undefined,
        },
      },
    });
  }

  function acquire(album: AcquirableAlbumDto) {
    // Optimistic flip to "requested"; revert on failure. The plugin itself
    // toasts success/failure — no extra toast here.
    setFetch((prev) =>
      prev.status === "ok"
        ? {
            status: "ok",
            albums: prev.albums.map((a) =>
              a.providerId === album.providerId && a.providerRef === album.providerRef
                ? { ...a, state: "requested" as const }
                : a,
            ),
          }
        : prev,
    );
    window.musex
      .acquisitionAcquire({ providerId: album.providerId, providerRef: album.providerRef })
      .catch((err: unknown) => {
        console.error("[acquisition] acquire failed:", err);
        setFetch((prev) =>
          prev.status === "ok"
            ? {
                status: "ok",
                albums: prev.albums.map((a) =>
                  a.providerId === album.providerId && a.providerRef === album.providerRef
                    ? { ...a, state: "available" as const }
                    : a,
                ),
              }
            : prev,
        );
      });
  }

  return (
    <div className="browse-section external-artist-view">
      <div className="artist-header">
        <h3 className="browse-title">{artistName}</h3>
        {/* Monitoring the entire artist is ONE-WAY: there's no un-monitor IPC,
         *  so once on, the pill is shown lit + disabled (can't be undone here). */}
        <ActionBar
          monitor={
            monitor.supported
              ? {
                  on: monitor.on,
                  busy: monitor.busy || monitor.on,
                  onToggle: monitor.on ? () => {} : monitor.onToggle,
                }
              : undefined
          }
        >
          {watch.supported && (
            <button
              type="button"
              className="action-icon"
              disabled={watch.busy}
              title={
                watch.on
                  ? "Watching for new releases — click to stop"
                  : "Fetch new releases by this artist automatically"
              }
              onClick={() => void watch.onToggle()}
            >
              {watch.on ? <BellRing size={16} /> : <Bell size={16} />}
            </button>
          )}
        </ActionBar>
      </div>
      <MonitorStatusLine watching={monitoring.isWatched(artistName)} downloading={0} />
      <div className="browse-sub">
        Discography via last.fm + your download manager — albums you own open in your library;
        dimmed ones aren't available to fetch.
      </div>

      {fetch.status === "loading" && (
        <div className="content-placeholder">Looking up discography…</div>
      )}

      {fetch.status === "error" && (
        <div className="content-placeholder error-text">Error: {fetch.message}</div>
      )}

      {fetch.status === "ok" && fetch.albums.length === 0 && (
        <div className="content-placeholder">No acquisition source knows this artist.</div>
      )}

      {fetch.status === "ok" && fetch.albums.length > 0 && (
        <div className="browse-grid">
          {fetch.albums.map((album) => {
            const owned = album.state === "owned" && album.albumId && album.serverId;
            return (
              <GridCard
                key={`${album.providerId}:${album.providerRef}`}
                thumb={album.imageUrl}
                title={album.title}
                subtitle={album.year != null ? String(album.year) : undefined}
                state={album.state}
                dim={album.state === "unavailable"}
                onOpen={owned ? () => openOwned(album) : () => {}}
                actionIcon={album.state === "available" ? Download : undefined}
                actionTitle="Add album"
                onAction={album.state === "available" ? () => acquire(album) : undefined}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
