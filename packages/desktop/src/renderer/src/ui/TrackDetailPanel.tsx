import { Play, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import { smartTrackKey } from "../../../logic/smart-playlists";
import type { TrackDetailDto, TrackStatDto } from "../../../shared/ipc-contract";
import { useApp } from "../state/app";
import { toTrackInfo, usePlayer } from "../state/player";
import { useRatings } from "../state/ratings";
import { useSelection } from "../state/selection";
import { formatDuration, relativeTime } from "../util/format";
import { AlbumArt } from "./AlbumArt";
import { StarRating } from "./StarRating";

/** Right-hand panel: details for the currently selected track, with links to its
 *  artist and album. Renders nothing when no track is selected. */
export function TrackDetailPanel() {
  const { selectedTrack: track, clear } = useSelection();
  const { dispatch, library } = useApp();
  const { ratingFor, rate } = useRatings();
  const { playTrackNext } = usePlayer();
  const [pluginDetails, setPluginDetails] = useState<TrackDetailDto[]>([]);
  const [listenStat, setListenStat] = useState<TrackStatDto | null>(null);

  // Plugin-contributed detail sections; refetched per selection. The cancelled
  // flag guards against a stale (slower) response landing after the selection
  // already changed.
  useEffect(() => {
    setPluginDetails([]);
    if (!track) return;
    let cancelled = false;
    window.musex
      .trackDetailGet(toTrackInfo(track))
      .then((details) => {
        if (!cancelled) setPluginDetails(details);
      })
      .catch((err) => console.error("[plugins] trackDetailGet failed:", err));
    return () => {
      cancelled = true;
    };
  }, [track]);

  // Listening stats from the taste profile, joined by artist+title key.
  // Point-in-time per selection is fine — it's a local IPC, no live updates.
  useEffect(() => {
    setListenStat(null);
    if (!track) return;
    let cancelled = false;
    const key = smartTrackKey(track);
    window.musex
      .getTasteSnapshot()
      .then((snapshot) => {
        if (!cancelled) setListenStat(snapshot.stats.find((s) => s.key === key) ?? null);
      })
      .catch((err) => console.error("[taste] getTasteSnapshot failed:", err));
    return () => {
      cancelled = true;
    };
  }, [track]);

  if (!track) return null;

  const goArtist = track.artistId
    ? () =>
        dispatch({
          type: "navigate",
          view: {
            name: "artist",
            artist: { id: track.artistId, serverId: track.serverId, name: track.artistName },
          },
        })
    : undefined;

  const goAlbum =
    track.albumId && track.albumTitle
      ? () =>
          dispatch({
            type: "navigate",
            view: {
              name: "album",
              album: {
                id: track.albumId,
                serverId: track.serverId,
                artistId: track.artistId,
                title: track.albumTitle ?? "",
                thumb: track.thumb,
              },
            },
          })
      : undefined;

  const codec = track.media.audioCodec ? track.media.audioCodec.toUpperCase() : null;
  const quality = [codec, track.media.bitrate ? `${Math.round(track.media.bitrate)} kbps` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <aside className="detail-panel">
      <div className="detail-head">
        <span className="detail-head-label">Track</span>
        <button type="button" className="detail-close" title="Close" onClick={clear}>
          <X size={16} />
        </button>
      </div>

      <AlbumArt
        thumb={track.thumb}
        className="detail-art"
        label={track.albumTitle ?? track.title}
        kind="track"
      />

      {/* Hierarchy crumb: Artist › Album › Track */}
      <div className="breadcrumb detail-crumb">
        <button type="button" className="breadcrumb-link" onClick={goArtist} disabled={!goArtist}>
          {track.artistName}
        </button>
        {track.albumTitle && (
          <>
            {" › "}
            <button type="button" className="breadcrumb-link" onClick={goAlbum} disabled={!goAlbum}>
              {track.albumTitle}
            </button>
          </>
        )}
        {" › "}
        <span className="breadcrumb-current">{track.title}</span>
      </div>

      <div className="detail-title">{track.title}</div>

      <StarRating
        value10={ratingFor(track.id, track.userRating)}
        onRate={(stars) =>
          rate({
            serverId: track.serverId,
            itemId: track.id,
            stars,
            albumId: track.albumId || undefined,
            libraryId: library?.id,
            trackInfo: toTrackInfo(track),
          })
        }
        size={15}
        className="detail-stars"
      />

      <button type="button" className="detail-play" onClick={() => playTrackNext(track)}>
        <Play size={16} />
        Play
      </button>

      <button
        type="button"
        className="detail-play detail-secondary"
        onClick={() =>
          dispatch({
            type: "navigate",
            view: {
              name: "similar",
              target: { kind: "track", title: track.title, artist: track.artistName },
            },
          })
        }
      >
        <Sparkles size={16} />
        Similar Songs
      </button>

      <div className="detail-meta">
        {track.trackNumber != null && (
          <div className="detail-meta-row">
            <span>Track</span>
            <span>{track.trackNumber}</span>
          </div>
        )}
        <div className="detail-meta-row">
          <span>Duration</span>
          <span>{formatDuration(track.durationMs)}</span>
        </div>
        {quality && (
          <div className="detail-meta-row">
            <span>Quality</span>
            <span>{quality}</span>
          </div>
        )}
        {track.media.container && (
          <div className="detail-meta-row">
            <span>Container</span>
            <span>{track.media.container.toUpperCase()}</span>
          </div>
        )}
      </div>

      <div className="detail-meta detail-plugin">
        <div className="detail-plugin-title">Listening</div>
        {listenStat ? (
          <>
            <div className="detail-meta-row">
              <span>Plays</span>
              <span>{listenStat.plays}</span>
            </div>
            <div className="detail-meta-row">
              <span>Skips</span>
              <span>{listenStat.skips}</span>
            </div>
            <div className="detail-meta-row">
              <span>Last played</span>
              <span>{relativeTime(listenStat.lastPlayedMs, Date.now())}</span>
            </div>
          </>
        ) : (
          <div className="detail-meta-row">
            <span>Not played yet</span>
          </div>
        )}
      </div>

      {pluginDetails.map((d) => (
        <div key={`${d.pluginId}:${d.title}`} className="detail-meta detail-plugin">
          <div className="detail-plugin-title">{d.title}</div>
          {d.rows.map((r) => (
            <div key={r.label} className="detail-meta-row">
              <span>{r.label}</span>
              <span>{r.value}</span>
            </div>
          ))}
        </div>
      ))}
    </aside>
  );
}
