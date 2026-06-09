import { Play, X } from "lucide-react";
import { useApp } from "../state/app";
import { usePlayer } from "../state/player";
import { useSelection } from "../state/selection";
import { formatDuration } from "../util/format";
import { AlbumArt } from "./AlbumArt";

/** Right-hand panel: details for the currently selected track, with links to its
 *  artist and album. Renders nothing when no track is selected. */
export function TrackDetailPanel() {
  const { selectedTrack: track, clear } = useSelection();
  const { dispatch } = useApp();
  const { playTrackNext } = usePlayer();

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

      <AlbumArt thumb={track.thumb} className="detail-art" />

      <div className="detail-title">{track.title}</div>
      <button type="button" className="detail-link" onClick={goArtist} disabled={!goArtist}>
        {track.artistName}
      </button>
      {track.albumTitle && (
        <button type="button" className="detail-link dim" onClick={goAlbum} disabled={!goAlbum}>
          {track.albumTitle}
        </button>
      )}

      <button type="button" className="detail-play" onClick={() => playTrackNext(track)}>
        <Play size={16} />
        Play
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
    </aside>
  );
}
