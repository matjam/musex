import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import type { AcquirableAlbumDto } from "../../../../shared/ipc-contract";
import { useApp } from "../../state/app";
import { badgeFor } from "../acquisition-badges";
import { GridCard } from "../GridCard";
import { WatchNewReleasesButton } from "../WatchNewReleasesButton";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; albums: AcquirableAlbumDto[] };

/** Discography of an artist we don't (fully) own, merged from acquisition
 *  providers (Lidarr) and similar providers (last.fm). Owned albums navigate
 *  into the library; available ones get a hover Add (acquire) action;
 *  last.fm-only titles are shown dimmed as unavailable. */
export function ExternalArtistView({ artistName }: { artistName: string }) {
  const { dispatch } = useApp();
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });
  const [monitorState, setMonitorState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [monitorError, setMonitorError] = useState<string | null>(null);
  const [artistMonitored, setArtistMonitored] = useState(false);

  useEffect(() => {
    setFetch({ status: "loading" });
    setMonitorState("idle");
    setMonitorError(null);
    setArtistMonitored(false);
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
    window.musex
      .acquisitionMonitoredArtists()
      .then((names) => {
        if (!cancelled && names.some((n) => n.toLowerCase() === artistName.toLowerCase())) {
          setArtistMonitored(true);
        }
      })
      .catch(() => {
        // badge only — fine without it
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

  // Monitor the WHOLE artist (downloads everything). No optimistic state on
  // the album grid — states refresh on the next visit; the plugin toasts.
  function monitorEntireArtist() {
    setMonitorState("busy");
    setMonitorError(null);
    window.musex
      .acquisitionAcquireArtistByName(artistName)
      .then(() => setMonitorState("done"))
      .catch((err: unknown) => {
        console.error("[acquisition] acquireArtistByName failed:", err);
        setMonitorState("error");
        setMonitorError(err instanceof Error ? err.message : "Failed to monitor artist");
      });
  }

  return (
    <div className="browse-section external-artist-view">
      <div className="artist-header">
        <h3 className="browse-title">{artistName}</h3>
        <button
          type="button"
          className="shuffle-btn"
          title="Monitor entire artist — download everything"
          disabled={monitorState === "busy" || monitorState === "done" || artistMonitored}
          onClick={monitorEntireArtist}
        >
          <Download size={16} />
        </button>
        <span className="album-meta-muted">
          {monitorState === "busy"
            ? "Monitoring…"
            : monitorState === "done"
              ? "Monitoring entire artist"
              : "Monitor entire artist"}
        </span>
        <WatchNewReleasesButton artistName={artistName} />
        {artistMonitored && (
          <span className="grid-card-badge grid-card-badge--monitored">monitoring artist</span>
        )}
      </div>
      <div className="browse-sub">
        Discography via last.fm + your download manager — albums you own open in your library;
        dimmed ones aren't available to fetch.
      </div>
      {monitorError !== null && <div className="browse-sub error-text">{monitorError}</div>}

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
            const chip = badgeFor(album);
            const owned = album.state === "owned" && album.albumId && album.serverId;
            return (
              <GridCard
                key={`${album.providerId}:${album.providerRef}`}
                thumb={album.imageUrl}
                title={album.title}
                subtitle={album.year != null ? String(album.year) : undefined}
                badge={chip?.badge}
                badgeVariant={chip?.variant}
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
