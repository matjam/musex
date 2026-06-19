import type { Album, EntityRef, LocalPresence, Track } from "@musex/core";
import {
  downloadRecordFor,
  entityRefForArtist,
  externalArtistRef,
  listValidator,
  trackAvailability,
} from "@musex/core";
import { Download, ListEnd, ListPlus, MoreHorizontal } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AcquirableAlbumDto } from "../../../../shared/ipc-contract";
import { useApp } from "../../state/app";
import { usePlayer } from "../../state/player";
import { useRatings } from "../../state/ratings";
import { useSelection } from "../../state/selection";
import { OFFLINE_ACTION_TOOLTIP, OFFLINE_VIEW_MESSAGE } from "../../util/offline";
import { AlbumArt } from "../AlbumArt";
import { ActionBar } from "../discovery/ActionBar";
import { EntityLink } from "../discovery/EntityLink";
import { NO_ACQUISITION_FOLLOW_TOOLTIP, useFollowAction } from "../discovery/FollowButton";
import { useAcquisitionAvailable } from "../hooks/useAcquisitionAvailable";
import { useDownloadRecords } from "../hooks/useDownloadRecords";
import { useEntityNav } from "../hooks/useEntityNav";
import { NewPlaylistDialog } from "../NewPlaylistDialog";
import { StarRating } from "../StarRating";
import type { TrackMenuTarget } from "../TrackContextMenu";
import { TrackContextMenu } from "../TrackContextMenu";
import { TrackRow } from "../TrackRow";
import { VirtualTrackList } from "../VirtualTrackList";

interface Props {
  /** The album to render — owned (Plex, playable) or external (last.fm-only).
   *  Ownership is read from `ref.source`. */
  ref: EntityRef;
}

/** The one album page: owned (playable track list + favorite + download) and
 *  unowned (Follow the artist + a quiet Get-just-this-album). Reached
 *  identically from everywhere via `resolveEntity`. */
export function AlbumView({ ref }: Props) {
  if (ref.source === "external") return <ExternalAlbumView entityRef={ref} />;
  return <OwnedAlbumView entityRef={ref} />;
}

// ---------------------------------------------------------------------------
// Owned (Plex) — the playable album page.
// ---------------------------------------------------------------------------

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; tracks: Track[] };

function OwnedAlbumView({ entityRef }: { entityRef: EntityRef }) {
  const album: Album = {
    id: entityRef.id ?? "",
    serverId: entityRef.serverId ?? "",
    artistId: "",
    title: entityRef.albumTitle ?? entityRef.name,
    thumb: entityRef.thumb,
  };
  const { library, connectivity, dispatch } = useApp();
  const { state, playTracks, playTracksShuffled, playTrackNext, enqueueNext, enqueueEnd } =
    usePlayer();
  const { selectedTrack, select } = useSelection();
  const { ratingFor, rate, seed } = useRatings();
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

  // The album favorite (♥) is a follow on the album ref itself.
  const favorite = useFollowAction(entityRef);

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
          ref: entityRefForArtist({ id: t.artistId, serverId: t.serverId, name: t.artistName }),
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
                      entity={
                        tracks[0].artistId
                          ? entityRefForArtist({
                              id: tracks[0].artistId,
                              serverId: tracks[0].serverId,
                              name: tracks[0].artistName,
                            })
                          : externalArtistRef(tracks[0].artistName)
                      }
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
                follow={{
                  on: favorite.on,
                  busy: favorite.busy,
                  title: favorite.on ? "Favorited — click to remove" : "Favorite this album",
                  onToggle: () => void favorite.onToggle(),
                }}
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
// Unowned (external / last.fm-only) — Follow the artist + Get just this album.
// ---------------------------------------------------------------------------

function ExternalAlbumView({ entityRef }: { entityRef: EntityRef }) {
  const { dispatch, connectivity } = useApp();
  const offline = connectivity === "offline";
  const acquisitionAvailable = useAcquisitionAvailable();
  const { goRef } = useEntityNav();
  const artistName = entityRef.artistName ?? "";
  const albumTitle = entityRef.albumTitle ?? entityRef.name;
  // Follow [artist] is the primary action: acquire the discography + watch.
  const artistRefForFollow = externalArtistRef(artistName);
  const follow = useFollowAction(artistRefForFollow);
  // Get just this album: resolve the album's providerRef from the artist's
  // discography (the only place the opaque ref lives), then acquire that one.
  const [match, setMatch] = useState<AcquirableAlbumDto | null>(null);
  const [getting, setGetting] = useState(false);

  useEffect(() => {
    if (offline || !acquisitionAvailable || !artistName) {
      setMatch(null);
      return;
    }
    let cancelled = false;
    const want = albumTitle.trim().toLowerCase();
    window.musex
      .acquisitionDiscography(artistName)
      .then((albums) => {
        if (cancelled) return;
        setMatch(albums.find((a) => a.title.trim().toLowerCase() === want) ?? null);
      })
      .catch((err: unknown) => {
        console.error("[acquisition] acquisitionDiscography failed:", err);
        if (!cancelled) setMatch(null);
      });
    return () => {
      cancelled = true;
    };
  }, [artistName, albumTitle, offline, acquisitionAvailable]);

  function getThisAlbum() {
    if (!match || match.state !== "available") return;
    const args = { providerId: match.providerId, providerRef: match.providerRef };
    setGetting(true);
    window.musex.acquisitionAcquire(args).catch((err: unknown) => {
      console.error("[acquisition] acquire failed:", err);
      setGetting(false);
    });
  }

  const canGet = !offline && acquisitionAvailable && match?.state === "available" && !getting;
  const getLabel = getting || match?.state === "requested" ? "Requested" : "Get just this album";

  return (
    <div className="album-detail">
      <div className="breadcrumb">
        <button
          type="button"
          className="breadcrumb-link"
          onClick={() => {
            if (artistName) goRef(artistRefForFollow);
            else dispatch({ type: "navigate", view: { name: "artists" } });
          }}
        >
          {artistName || "Artists"}
        </button>
        {" › "}
        <span className="breadcrumb-current">{albumTitle}</span>
      </div>

      <div className="album-header">
        <AlbumArt
          thumb={entityRef.thumb}
          className="album-header-art"
          label={albumTitle}
          kind="album"
        />
        <div className="album-header-meta">
          <div className="album-meta-label">Album · Not in your library</div>
          <h1 className="album-meta-title">{albumTitle}</h1>
          <div className="album-meta-by">
            {artistName && <EntityLink entity={artistRefForFollow}>{artistName}</EntityLink>}
          </div>
          <div className="album-actions">
            {/* Primary: Follow the artist (acquire discography + watch). */}
            <ActionBar
              follow={{
                on: follow.on,
                busy: follow.busy,
                // Following acquires this (unowned) artist — needs a provider.
                disabled: offline || (!follow.on && !acquisitionAvailable),
                title: offline
                  ? OFFLINE_ACTION_TOOLTIP
                  : !follow.on && !acquisitionAvailable
                    ? NO_ACQUISITION_FOLLOW_TOOLTIP
                    : follow.on
                      ? "Following — click to unfollow"
                      : "Follow — acquire this artist and follow their new releases",
                onToggle: () => void follow.onToggle(),
              }}
            />
            {/* Quiet secondary: acquire just this one album. */}
            <button
              type="button"
              className="action-pill"
              disabled={!canGet}
              title={
                offline
                  ? OFFLINE_ACTION_TOOLTIP
                  : !acquisitionAvailable
                    ? "Needs an acquisition plugin"
                    : match?.state === "available"
                      ? "Download just this album"
                      : "This album isn't available to fetch"
              }
              onClick={getThisAlbum}
            >
              <Download size={15} />
              {getLabel}
            </button>
          </div>
        </div>
      </div>

      {offline ? (
        <div className="content-placeholder">{OFFLINE_VIEW_MESSAGE}</div>
      ) : (
        <div className="content-placeholder">
          {acquisitionAvailable
            ? "This album isn't in your library. Follow the artist to acquire their discography, or get just this album."
            : "This album isn't in your library. Connect an acquisition plugin to fetch it."}
        </div>
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

/** Tiny fixed-position dropdown for "Play next" / "Add to queue" on an album. */
function AlbumMoreMenu({ x, y, onClose, onPlayNext, onAddToQueue }: MoreMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const MARGIN = 8;

  useLayoutEffect(() => {
    const el = menuRef.current;
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
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
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
      ref={menuRef}
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
