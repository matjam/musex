import type { Track } from "@musex/core";
import { formatDuration } from "../util/format";

interface Props {
  track: Track;
  /** What to show in the leading slot when not playing: track number (album view)
   *  or nothing (search). */
  leading?: number | null;
  /** Show artist · album as a subtitle line (search results) vs. title only (album). */
  showSubtitle?: boolean;
  isPlaying: boolean;
  onPlay: () => void;
}

export function TrackRow({ track, leading, showSubtitle = false, isPlaying, onPlay }: Props) {
  const subtitle =
    track.albumTitle != null ? `${track.artistName} · ${track.albumTitle}` : track.artistName;
  return (
    <button type="button" className={`track-row${isPlaying ? " playing" : ""}`} onClick={onPlay}>
      <span className="track-num">{isPlaying ? "▶" : (leading ?? "")}</span>
      <span className="track-main">
        <span className="track-title">{track.title}</span>
        {showSubtitle && <span className="track-rowsub">{subtitle}</span>}
      </span>
      <span className="track-duration">{formatDuration(track.durationMs)}</span>
    </button>
  );
}
