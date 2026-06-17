import type { LucideIcon } from "lucide-react";
import { Eye, Play } from "lucide-react";
import type { KeyboardEvent } from "react";
import { AlbumArt } from "./AlbumArt";
import { CardCollage } from "./CardCollage";
import { StateBadge } from "./discovery/StateBadge";
import type { AcquisitionBadgeState } from "./discovery/state-badge";

interface Props {
  thumb?: string;
  /** Collage artwork (e.g. playlist fallback art) — wins over `thumb`. */
  collage?: string[];
  title: string;
  subtitle?: string;
  /** Round the artwork (artists) vs square (albums). */
  round?: boolean;
  /** Small chip over the artwork corner (e.g. "external" on Discover items). */
  badge?: string;
  /** Color variant suffix for the badge: `grid-card-badge--<variant>`. */
  badgeVariant?: string;
  /** Unified acquisition-state badge — takes precedence over `badge` when set. */
  state?: AcquisitionBadgeState;
  /** Download percent for `state="downloading"`. */
  statePercent?: number;
  /** Show the watched-for-new-releases corner marker (eye). */
  monitored?: boolean;
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
  collage,
  title,
  subtitle,
  round = false,
  badge,
  badgeVariant,
  state,
  statePercent,
  monitored = false,
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
        {collage && collage.length > 0 ? (
          <CardCollage thumbs={collage} className={`grid-card-art${round ? " artist-art" : ""}`} />
        ) : (
          <AlbumArt
            thumb={thumb}
            className={`grid-card-art${round ? " artist-art" : ""}`}
            label={title}
            kind={round ? "artist" : "album"}
          />
        )}
        {state ? (
          <span className="grid-card-badge grid-card-badge--state">
            <StateBadge state={state} percent={statePercent} />
          </span>
        ) : (
          badge && (
            <span
              className={`grid-card-badge${badgeVariant ? ` grid-card-badge--${badgeVariant}` : ""}`}
            >
              {badge}
            </span>
          )
        )}
        {monitored && (
          <span className="card-monitored" title="Watched for new releases">
            <Eye size={12} />
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
        {onPlay && onAction && ActionIcon && (
          // Secondary corner action alongside the Play overlay (e.g. Remove on a
          // playable downloaded album) — small, top-left, so it doesn't collide
          // with the bottom-right Play button or the top-right badge.
          <button
            type="button"
            className="grid-card-action"
            title={actionTitle}
            onClick={(e) => {
              e.stopPropagation();
              onAction();
            }}
          >
            <ActionIcon size={14} />
          </button>
        )}
      </div>
      <div className="grid-card-title">{title}</div>
      {subtitle && <div className="grid-card-sub">{subtitle}</div>}
    </div>
  );
}
