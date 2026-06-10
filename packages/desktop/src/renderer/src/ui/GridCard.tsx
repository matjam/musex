import type { LucideIcon } from "lucide-react";
import { Play } from "lucide-react";
import type { KeyboardEvent } from "react";
import { AlbumArt } from "./AlbumArt";

interface Props {
  thumb?: string;
  title: string;
  subtitle?: string;
  /** Round the artwork (artists) vs square (albums). */
  round?: boolean;
  /** Small chip over the artwork corner (e.g. "external" on Discover items). */
  badge?: string;
  /** Color variant suffix for the badge: `grid-card-badge--<variant>`. */
  badgeVariant?: string;
  /** Dim the whole card (e.g. unavailable acquisition albums). */
  dim?: boolean;
  /** Click the card body → open the detail view. */
  onOpen: () => void;
  /** Click the hover play overlay → play the collection. Omit to hide it. */
  onPlay?: () => void;
  /** Generic hover action overlay (same look as Play, custom icon —
   *  e.g. Download to acquire an album). Omit to hide it. */
  actionIcon?: LucideIcon;
  actionTitle?: string;
  onAction?: () => void;
}

/** A browse-grid card (album/artist) with a Spotify-style hover Play button. */
export function GridCard({
  thumb,
  title,
  subtitle,
  round = false,
  badge,
  badgeVariant,
  dim = false,
  onOpen,
  onPlay,
  actionIcon: ActionIcon,
  actionTitle,
  onAction,
}: Props) {
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: div needed — it contains the play <button> (button-in-button is invalid)
    <div
      className={`grid-card${dim ? " grid-card--dim" : ""}`}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={onKey}
    >
      <div className="grid-card-artwrap">
        <AlbumArt
          thumb={thumb}
          className={`grid-card-art${round ? " artist-art" : ""}`}
          label={title}
          kind={round ? "artist" : "album"}
        />
        {badge && (
          <span
            className={`grid-card-badge${badgeVariant ? ` grid-card-badge--${badgeVariant}` : ""}`}
          >
            {badge}
          </span>
        )}
        {onPlay && (
          <button
            type="button"
            className="grid-card-play"
            title="Play"
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
          >
            <Play size={18} />
          </button>
        )}
        {!onPlay && onAction && ActionIcon && (
          <button
            type="button"
            className="grid-card-play"
            title={actionTitle}
            onClick={(e) => {
              e.stopPropagation();
              onAction();
            }}
          >
            <ActionIcon size={18} />
          </button>
        )}
      </div>
      <div className="grid-card-title">{title}</div>
      {subtitle && <div className="grid-card-sub">{subtitle}</div>}
    </div>
  );
}
