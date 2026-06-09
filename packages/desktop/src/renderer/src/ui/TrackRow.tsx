import type { Track } from "@musex/core";
import type { KeyboardEvent, MouseEvent } from "react";
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
  /** When provided, the row shows a ⋯ button and opens a menu (also on right-click). */
  onMenu?: (pos: { x: number; y: number }) => void;
}

export function TrackRow({
  track,
  leading,
  showSubtitle = false,
  isPlaying,
  onPlay,
  onMenu,
}: Props) {
  const subtitle =
    track.albumTitle != null ? `${track.artistName} · ${track.albumTitle}` : track.artistName;

  function activate(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onPlay();
    }
  }
  function openMenuAt(e: MouseEvent) {
    onMenu?.({ x: e.clientX, y: e.clientY });
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: div needed here because it may contain a <button> (⋯ menu); button-in-button is invalid HTML
    <div
      className={`track-row${isPlaying ? " playing" : ""}${onMenu ? " has-menu" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={activate}
      onContextMenu={
        onMenu
          ? (e) => {
              e.preventDefault();
              openMenuAt(e);
            }
          : undefined
      }
    >
      <span className="track-num">{isPlaying ? "▶" : (leading ?? "")}</span>
      <span className="track-main">
        <span className="track-title">{track.title}</span>
        {showSubtitle && <span className="track-rowsub">{subtitle}</span>}
      </span>
      {onMenu && (
        <button
          type="button"
          className="track-menu-btn"
          title="More"
          onClick={(e) => {
            e.stopPropagation();
            openMenuAt(e);
          }}
        >
          ⋯
        </button>
      )}
      <span className="track-duration">{formatDuration(track.durationMs)}</span>
    </div>
  );
}
