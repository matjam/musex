import type { EntityRef } from "@musex/core";
import { entityRefForAlbum } from "@musex/core";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import type { AcquirableAlbumDto } from "../../../../shared/ipc-contract";
import { useApp } from "../../state/app";
import { useFollow } from "../../state/follow";
import { OFFLINE_ACTION_TOOLTIP, OFFLINE_VIEW_MESSAGE } from "../../util/offline";
import { ActionBar } from "../discovery/ActionBar";
import { useFollowAction } from "../discovery/FollowButton";
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
export function ExternalArtistView({ entity }: { entity: EntityRef }) {
  const artistName = entity.name;
  const { dispatch, connectivity } = useApp();
  const offline = connectivity === "offline";
  const { isFollowed } = useFollow();
  // Follow = acquire the discography + watch for new releases (one action).
  const follow = useFollowAction(entity);
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });

  useEffect(() => {
    // The discography lookup is an online-only acquisition call; skip it
    // offline (the view renders the offline message instead).
    if (offline) return;
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
  }, [artistName, offline]);

  function openOwned(album: AcquirableAlbumDto) {
    if (!album.albumId || !album.serverId) return;
    dispatch({
      type: "navigate",
      view: {
        name: "album",
        ref: entityRefForAlbum({
          id: album.albumId,
          serverId: album.serverId,
          artistId: album.artistId ?? "",
          title: album.title,
        }),
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

  // The whole view is online-only (discography lookup + acquire/monitor). When
  // offline, show the artist name and the friendly offline message — no actions.
  if (offline) {
    return (
      <div className="browse-section external-artist-view">
        <div className="artist-header">
          <h3 className="browse-title">{artistName}</h3>
        </div>
        <div className="content-placeholder">{OFFLINE_VIEW_MESSAGE}</div>
      </div>
    );
  }

  return (
    <div className="browse-section external-artist-view">
      <div className="artist-header">
        <h3 className="browse-title">{artistName}</h3>
        {/* Follow = acquire the full discography + watch for new releases. */}
        <ActionBar
          follow={{
            on: follow.on,
            busy: follow.busy,
            disabled: offline,
            title: offline ? OFFLINE_ACTION_TOOLTIP : undefined,
            onToggle: () => void follow.onToggle(),
          }}
        />
      </div>
      <MonitorStatusLine watching={isFollowed(entity)} downloading={0} />
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
