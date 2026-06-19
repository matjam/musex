import type { EntityRef } from "@musex/core";
import { entityState, resolveEntity } from "@musex/core";
import type { LucideIcon } from "lucide-react";
import { ListPlus, MoreHorizontal, Play } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { useFollow } from "../state/follow";
import { AlbumArt } from "./AlbumArt";
import { CardCollage } from "./CardCollage";
import { EntityBadge } from "./discovery/EntityBadge";
import { FollowButton } from "./discovery/FollowButton";
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
  /** Unified entity ref. When set, the card renders the SP0 entity-state badge
   *  (non-default states only) + the Follow hover/menu for unowned entities. */
  entity?: EntityRef;
  /** Live flags feeding `entityState(resolveEntity(entity), flags)`. */
  downloaded?: boolean;
  downloading?: boolean;
  acquiring?: boolean;
  /** ⋯ menu: "Get just this album" (albums) → acquire just this album. */
  onGetAlbum?: () => void;
  /** ⋯ menu: "Play next" → enqueue this collection next. */
  onPlayNext?: () => void;
  // ── Non-entity collection-tile props (playlists, smart-mix tiles, on-device
  //    albums — tiles that aren't a single library entity). Prefer `entity` +
  //    flags for entity cards. ──
  /** Acquisition-state badge for non-entity tiles (e.g. on-device "downloaded"). */
  state?: AcquisitionBadgeState;
  /** Download percent for `state="downloading"`. */
  statePercent?: number;
  /** Dim the whole card (e.g. unavailable acquisition albums). */
  dim?: boolean;
  /** Click the card body → open the detail view. */
  onOpen: () => void;
  /** Click the hover play overlay → play the collection. Omit to hide it. */
  onPlay?: () => void;
  /** Generic hover action overlay (same look as Play, custom icon —
   *  e.g. Download to acquire an album, or Remove). Omit to hide it. */
  actionIcon?: LucideIcon;
  actionTitle?: string;
  onAction?: () => void;
}

/** A browse-grid card (album/artist/playlist) with a Spotify-style hover Play
 *  button. When given an `entity`, it speaks the SP0 entity-state vocabulary:
 *  a badge for non-default states, Play (owned) / Follow (unowned) hover, and a
 *  ⋯ menu (Follow, Get just this album, Play next). */
export function GridCard({
  thumb,
  collage,
  title,
  subtitle,
  round = false,
  entity,
  downloaded,
  downloading,
  acquiring,
  onGetAlbum,
  onPlayNext,
  state,
  statePercent,
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

  // Entity-aware derivations (only when an `entity` ref is supplied).
  const follow = useFollow();
  const resolved = entity ? resolveEntity(entity) : null;
  const computedState =
    entity && resolved
      ? entityState(resolved, {
          downloaded,
          downloading,
          acquiring,
          following: follow.isFollowed(entity),
        })
      : null;
  // Owned/in-library is the default — no badge. Everything else renders one.
  const showEntityBadge = computedState != null && computedState !== "owned";
  const unowned = entity?.source === "external";

  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

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
        {showEntityBadge && computedState ? (
          <span className="grid-card-badge grid-card-badge--state">
            <EntityBadge state={computedState} />
          </span>
        ) : (
          state && (
            <span className="grid-card-badge grid-card-badge--state">
              <StateBadge state={state} percent={statePercent} />
            </span>
          )
        )}
        {/* Hover primary action: Play when owned/playable, Follow when unowned. */}
        {onPlay ? (
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
        ) : entity && unowned ? (
          // biome-ignore lint/a11y/noStaticElementInteractions: wrapper only stops the card-open click from firing; the inner FollowButton is the real control
          // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard activates the FollowButton itself, not this wrapper
          <span className="grid-card-follow" onClick={(e) => e.stopPropagation()}>
            <FollowButton entity={entity} />
          </span>
        ) : (
          ActionIcon &&
          onAction && (
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
          )
        )}
        {/* Secondary corner action (e.g. Remove on a playable downloaded album). */}
        {onPlay && ActionIcon && onAction && (
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
        {/* ⋯ secondary menu for entity cards: Follow / Get just this album / Play next. */}
        {entity && (
          <div className="grid-card-menu" ref={menuRef}>
            <button
              type="button"
              className="grid-card-action"
              title="More actions"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((o) => !o);
              }}
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <div
                className="more-dropdown grid-card-dropdown"
                role="menu"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  className="ctx-item"
                  onClick={() => {
                    void follow.setFollowed(entity, !follow.isFollowed(entity));
                    setMenuOpen(false);
                  }}
                >
                  {follow.isFollowed(entity) ? "Unfollow" : "Follow"}
                </button>
                {entity.kind === "album" && onGetAlbum && (
                  <button
                    type="button"
                    className="ctx-item"
                    onClick={() => {
                      onGetAlbum();
                      setMenuOpen(false);
                    }}
                  >
                    Get just this album
                  </button>
                )}
                {onPlayNext && (
                  <button
                    type="button"
                    className="ctx-item ctx-item--icon"
                    onClick={() => {
                      onPlayNext();
                      setMenuOpen(false);
                    }}
                  >
                    <ListPlus size={14} />
                    Play next
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="grid-card-title">{title}</div>
      {subtitle && <div className="grid-card-sub">{subtitle}</div>}
    </div>
  );
}
