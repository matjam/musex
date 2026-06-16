import type { Album, Track } from "@musex/core";
import { listValidator } from "@musex/core";
import { ListEnd, ListPlus, MoreHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useApp } from "../../state/app";
import { usePlayer } from "../../state/player";
import { useRatings } from "../../state/ratings";
import { useSelection } from "../../state/selection";
import { AlbumArt } from "../AlbumArt";
import { ActionBar } from "../discovery/ActionBar";
import { EntityLink } from "../discovery/EntityLink";
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
  const { library, dispatch } = useApp();
  const { state, playTracks, playTracksShuffled, playTrackNext, enqueueNext, enqueueEnd } =
    usePlayer();
  const { selectedTrack, select } = useSelection();
  const { ratingFor, rate, seed } = useRatings();
  const [fetch, setFetch] = useState<FetchState>({ status: "loading" });
  const [menu, setMenu] = useState<TrackMenuTarget | null>(null);
  const [newSeed, setNewSeed] = useState<string[] | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [morePos, setMorePos] = useState({ x: 0, y: 0 });

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

  // Determine the currently-playing track id (if any)
  const playingTrackId =
    state.queue != null ? (state.queue.tracks[state.queue.index]?.id ?? null) : null;

  // Compute totals from track list for the header
  const tracks = fetch.status === "ok" ? fetch.tracks : [];
  const totalMs = tracks.reduce((sum, t) => sum + t.durationMs, 0);
  const totalMin = Math.round(totalMs / 60000);

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
            return (
              <TrackRow
                track={track}
                leading={track.trackNumber ?? index + 1}
                isPlaying={track.id === playingTrackId}
                selected={track.id === selectedTrack?.id}
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
