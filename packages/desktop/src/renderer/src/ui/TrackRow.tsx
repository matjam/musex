import type { Track } from "@musex/core";
import { AudioLines, MoreHorizontal } from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";
import { useApp } from "../state/app";
import { useRatings } from "../state/ratings";
import { formatDuration } from "../util/format";
import { StarRating } from "./StarRating";
import { TrackSubLinks } from "./TrackSubLinks";

interface Props {
  track: Track;
  /** What to show in the leading slot when not playing: track number (album view)
   *  or nothing (search). */
  leading?: number | null;
  /** Show artist · album as a subtitle line (search results) vs. title only (album). */
  showSubtitle?: boolean;
  isPlaying: boolean;
  /** Highlighted (single-click selected) — shown in the detail panel. */
  selected?: boolean;
  /** Single click: select/highlight (no playback). */
  onSelect?: () => void;
  /** Double click / Enter: play. */
  onActivate: () => void;
  /** When provided, the row shows a menu button and opens a menu (also on right-click). */
  onMenu?: (pos: { x: number; y: number }) => void;
}

export function TrackRow({
  track,
  leading,
  showSubtitle = false,
  isPlaying,
  selected = false,
  onSelect,
  onActivate,
  onMenu,
}: Props) {
  const { ratingFor, rate } = useRatings();
  const { library } = useApp();

  function activate(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onActivate();
    }
  }
  function openMenuAt(e: MouseEvent) {
    onMenu?.({ x: e.clientX, y: e.clientY });
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: div needed here because it may contain a <button> (menu); button-in-button is invalid HTML
    <div
      className={`track-row${isPlaying ? " playing" : ""}${selected ? " selected" : ""}${onMenu ? " has-menu" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={onActivate}
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
      <span className="track-num">
        {isPlaying ? <AudioLines size={14} className="track-eq" /> : (leading ?? "")}
      </span>
      <span className="track-main">
        <span className="track-title">{track.title}</span>
        {showSubtitle && (
          <span className="track-rowsub">
            <TrackSubLinks track={track} />
          </span>
        )}
      </span>
      <StarRating
        value10={ratingFor(track.id, track.userRating)}
        onRate={(stars) =>
          rate({
            serverId: track.serverId,
            itemId: track.id,
            stars,
            albumId: track.albumId || undefined,
            libraryId: library?.id,
          })
        }
        size={12}
        className="track-stars"
      />
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
          <MoreHorizontal size={16} />
        </button>
      )}
      <span className="track-duration">{formatDuration(track.durationMs)}</span>
    </div>
  );
}
