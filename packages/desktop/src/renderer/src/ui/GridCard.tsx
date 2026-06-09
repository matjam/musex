import { Play } from "lucide-react";
import type { KeyboardEvent } from "react";
import { AlbumArt } from "./AlbumArt";

interface Props {
  thumb?: string;
  title: string;
  subtitle?: string;
  /** Round the artwork (artists) vs square (albums). */
  round?: boolean;
  /** Click the card body → open the detail view. */
  onOpen: () => void;
  /** Click the hover play overlay → play the collection. Omit to hide it. */
  onPlay?: () => void;
}

/** A browse-grid card (album/artist) with a Spotify-style hover Play button. */
export function GridCard({ thumb, title, subtitle, round = false, onOpen, onPlay }: Props) {
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onOpen();
    }
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: div needed — it contains the play <button> (button-in-button is invalid)
    <div className="grid-card" role="button" tabIndex={0} onClick={onOpen} onKeyDown={onKey}>
      <div className="grid-card-artwrap">
        <AlbumArt thumb={thumb} className={`grid-card-art${round ? " artist-art" : ""}`} />
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
      </div>
      <div className="grid-card-title">{title}</div>
      {subtitle && <div className="grid-card-sub">{subtitle}</div>}
    </div>
  );
}
