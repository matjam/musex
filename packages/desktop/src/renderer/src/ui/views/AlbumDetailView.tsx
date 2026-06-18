import type { Album, LocalPresence, Track } from "@musex/core";
import { downloadRecordFor, listValidator, trackAvailability } from "@musex/core";
import { Download, ListEnd, ListPlus, MoreHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useApp } from "../../state/app";
import { usePanel } from "../../state/panel";
import { usePlayer } from "../../state/player";
import { useRatings } from "../../state/ratings";
import { useSelection } from "../../state/selection";
import { OFFLINE_ACTION_TOOLTIP } from "../../util/offline";
import { AlbumArt } from "../AlbumArt";
import { ActionBar } from "../discovery/ActionBar";
import { EntityLink } from "../discovery/EntityLink";
import { useDownloadRecords } from "../hooks/useDownloadRecords";
import { NewPlaylistDialog } from "../NewPlaylistDialog";
import { StarRating } from "../StarRating";
import type { TrackMenuTarget } from "../TrackContextMenu";
import { TrackContextMenu } from "../TrackContextMenu";
import { TrackRow } from "../TrackRow";
import { VirtualTrackList } from "../VirtualTrackList";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; tracks: Track[] };

interface Props {
  album: Album;
}

export function AlbumDetailView({ album }: Props) {
  const { library, connectivity, dispatch } = useApp();
  const { state, playTracks, playTracksShuffled, playTrackNext, enqueueNext, enqueueEnd } =
    usePlayer();
  const { selectedTrack, select } = useSelection();
  const { ratingFor, rate, seed } = useRatings();
  const { openEntity } = usePanel();
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });
  // plexPath (media.partKey) → local presence (downloaded / cached on disk).
  const [availability, setAvailability] = useState<Map<string, LocalPresence>>(() => new Map());
  const [menu, setMenu] = useState<TrackMenuTarget | null>(null);
  const [newSeed, setNewSeed] = useState<string[] | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [morePos, setMorePos] = useState({ x: 0, y: 0 });
  const downloadRecords = useDownloadRecords();
  const offline = connectivity === "offline";

  // Albums navigated from cached lists may lack userRating — fetch the
  // authoritative value and seed the overlay. seed() is set-only-if-absent, so
  // a rating the user clicked before this resolves is never clobbered.
  useEffect(() => {
    let cancelled = false;
    window.musex
      .getUserRating(album.serverId, album.id)
      .then((r) => {
        if (!cancelled) seed(album.id, r);
      })
      .catch((err) => console.error("[ratings] getUserRating failed:", err));
    return () => {
      cancelled = true;
    };
  }, [album.id, album.serverId, seed]);

  useEffect(() => {
    if (!library) return;
    const libraryId = library.id;
    setFetch({ status: "loading" });
    window.musex
      .listTracks(libraryId, album.id, listValidator(album.updatedAt))
      .then((tracks) => setFetch({ status: "ok", tracks }))
      .catch((err: unknown) =>
        setFetch({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load tracks",
        }),
      );
  }, [library, album.id, album.updatedAt]);

  // One batched local-availability lookup for the whole loaded track list
  // (downloaded ∪ cached, exact per track). Refreshes on every download
  // progress push so a just-finished download flips the row indicator.
  useEffect(() => {
    if (fetch.status !== "ok" || fetch.tracks.length === 0) {
      setAvailability(new Map());
      return;
    }
    const serverId = album.serverId;
    const partKeys = fetch.tracks.map((t) => t.media.partKey);
    let cancelled = false;
    function refresh() {
      window.musex
        .localAvailability(serverId, partKeys)
        .then((rows) => {
          if (cancelled) return;
          setAvailability(
            new Map(rows.map((r) => [r.plexPath, { downloaded: r.downloaded, cached: r.cached }])),
          );
        })
        .catch((err: unknown) => {
          // Non-fatal: leave the last map; rows just won't show fresh badges.
          console.error("[downloads] availability lookup failed:", err);
        });
    }
    refresh();
    const unsubscribe = window.musex.onDownloadsProgress(() => refresh());
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [fetch, album.serverId]);

  // Determine the currently-playing track id (if any)
  const playingTrackId =
    state.queue != null ? (state.queue.tracks[state.queue.index]?.id ?? null) : null;

  // Compute totals from track list for the header
  const tracks = fetch.status === "ok" ? fetch.tracks : [];
  const totalMs = tracks.reduce((sum, t) => sum + t.durationMs, 0);
  const totalMin = Math.round(totalMs / 60000);

  // Whether every loaded track is already downloaded — drives the header
  // Download button's "Downloaded" done/disabled state. Reuses the per-track
  // availability map already maintained for the row indicators.
  const allDownloaded =
    tracks.length > 0 && tracks.every((t) => availability.get(t.media.partKey)?.downloaded);

  function downloadAlbum() {
    if (!library) return;
    window.musex
      .downloadAlbum(album.id, library.id)
      .catch((err: unknown) => console.error("[downloads] downloadAlbum failed:", err));
  }

  // The hierarchy crumb is Artist › Album. The artist NAME comes from the first
  // loaded track (Album carries only artistId); until tracks load, fall back to
  // the Artists list as the root.
  const crumbArtist = tracks[0];
  function goToArtist() {
    const t = crumbArtist;
    if (t?.artistId) {
      dispatch({
        type: "navigate",
        view: {
          name: "artist",
          artist: { id: t.artistId, serverId: t.serverId, name: t.artistName },
        },
      });
    } else {
      dispatch({ type: "navigate", view: { name: "artists" } });
    }
  }

  return (
    <div className="album-detail">
      <div className="breadcrumb">
        <button type="button" className="breadcrumb-link" onClick={goToArtist}>
          {crumbArtist?.artistName ? crumbArtist.artistName : "Artists"}
        </button>
        {" › "}
        <span className="breadcrumb-current">{album.title}</span>
      </div>

      <div className="album-header">
        <AlbumArt
          thumb={album.thumb}
          className="album-header-art"
          label={album.title}
          kind="album"
        />
        <div className="album-header-meta">
          <div className="album-meta-label">Album</div>
          <h1 className="album-meta-title">{album.title}</h1>
          <div className="album-meta-by">
            {fetch.status === "ok" && fetch.tracks.length > 0 && (
              <>
                {tracks[0] && tracks[0].artistName !== "" && (
                  <>
                    <EntityLink
                      entity={{
                        kind: "artist",
                        name: tracks[0].artistName,
                        artistId: album.artistId || undefined,
                        serverId: album.serverId,
                      }}
                    >
                      {tracks[0].artistName}
                    </EntityLink>
                    <span className="album-meta-muted">{" · "}</span>
                  </>
                )}
                <span className="album-meta-muted">
                  {album.year != null ? `${album.year} · ` : ""}
                  {tracks.length} song{tracks.length !== 1 ? "s" : ""} · {totalMin} min
                </span>
              </>
            )}
          </div>
          <div className="album-actions">
            {fetch.status === "ok" && tracks.length > 0 && (
              <ActionBar
                onPlay={() => playTracks(tracks, 0)}
                onShuffle={() => playTracksShuffled(tracks)}
                onInfo={() => openEntity({ kind: "album", album })}
                overflow={
                  <button
                    type="button"
                    className="action-icon"
                    title="More actions"
                    onClick={(e) => {
                      setMorePos({ x: e.clientX, y: e.clientY });
                      setMoreOpen((o) => !o);
                    }}
                  >
                    <MoreHorizontal size={18} />
                  </button>
                }
              />
            )}
            {fetch.status === "ok" && tracks.length > 0 && (
              <button
                type="button"
                className={`action-pill${allDownloaded ? " action-pill--on" : ""}`}
                disabled={allDownloaded || offline}
                title={
                  allDownloaded
                    ? "All tracks downloaded"
                    : offline
                      ? OFFLINE_ACTION_TOOLTIP
                      : "Download album to this device"
                }
                onClick={downloadAlbum}
              >
                <Download size={15} />
                {allDownloaded ? "Downloaded" : "Download"}
              </button>
            )}
            <StarRating
              value10={ratingFor(album.id, album.userRating)}
              onRate={(stars) =>
                rate({
                  serverId: album.serverId,
                  itemId: album.id,
                  stars,
                  artistId: album.artistId || undefined,
                  libraryId: library?.id,
                })
              }
              size={16}
              className="album-stars"
            />
          </div>
        </div>
      </div>

      {fetch.status === "loading" && <div className="content-placeholder">Loading tracks…</div>}

      {fetch.status === "error" && (
        <div className="content-placeholder error-text">Error: {fetch.message}</div>
      )}

      {fetch.status === "ok" && tracks.length === 0 && (
        <div className="content-placeholder">No tracks found for this album.</div>
      )}

      {fetch.status === "ok" && tracks.length > 0 && (
        <VirtualTrackList
          count={tracks.length}
          renderRow={(index) => {
            const track = tracks[index];
            if (!track) return null;
            const presence = availability.get(track.media.partKey) ?? {
              downloaded: false,
              cached: false,
            };
            const unavailable =
              trackAvailability(presence, connectivity === "online") === "unavailable-offline";
            return (
              <TrackRow
                track={track}
                leading={track.trackNumber ?? index + 1}
                isPlaying={track.id === playingTrackId}
                selected={track.id === selectedTrack?.id}
                downloadState={presence.downloaded ? "downloaded" : undefined}
                unavailable={unavailable}
                onSelect={() => select(track)}
                onActivate={() => playTrackNext(track)}
                onMenu={(pos) =>
                  setMenu({
                    ...pos,
                    trackId: track.id,
                    serverId: track.serverId,
                    track,
                  })
                }
              />
            );
          }}
        />
      )}

      {menu !== null && (
        <TrackContextMenu
          target={menu}
          onClose={() => setMenu(null)}
          onNewPlaylist={(id) => {
            setNewSeed([id]);
            setMenu(null);
          }}
          downloadRecord={downloadRecordFor(downloadRecords, menu.track)}
          libraryId={library?.id ?? null}
        />
      )}

      {newSeed !== null && (
        <NewPlaylistDialog seedTrackIds={newSeed} onClose={() => setNewSeed(null)} />
      )}

      {moreOpen && (
        <AlbumMoreMenu
          x={morePos.x}
          y={morePos.y}
          onClose={() => setMoreOpen(false)}
          onPlayNext={() => {
            enqueueNext(tracks);
            setMoreOpen(false);
          }}
          onAddToQueue={() => {
            enqueueEnd(tracks);
            setMoreOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface MoreMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onPlayNext: () => void;
  onAddToQueue: () => void;
}

/** Tiny fixed-position dropdown for "Play next" / "Add to queue" on an album or artist. */
function AlbumMoreMenu({ x, y, onClose, onPlayNext, onAddToQueue }: MoreMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const MARGIN = 8;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width > vw - MARGIN) left = vw - rect.width - MARGIN;
    if (top + rect.height > vh - MARGIN) top = vh - rect.height - MARGIN;
    left = Math.max(MARGIN, left);
    top = Math.max(MARGIN, top);
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="more-dropdown"
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button type="button" className="ctx-item ctx-item--icon" onClick={onPlayNext}>
        <ListPlus size={14} />
        Play next
      </button>
      <button type="button" className="ctx-item ctx-item--icon" onClick={onAddToQueue}>
        <ListEnd size={14} />
        Add to queue
      </button>
    </div>
  );
}
