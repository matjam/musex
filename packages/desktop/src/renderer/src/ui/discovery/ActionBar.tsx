import { Heart, Play, Shuffle, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

export interface ActionBarProps {
  onPlay?: () => void; // primary; omit to hide
  onShuffle?: () => void;
  onSimilar?: () => void; // labeled "Similar" pill
  /** Follow pill: omit to hide. `on` lights it green and flips the label.
   *  Defaults to "Follow"/"Following" (artist); pass `labelOff`/`labelOn` for
   *  album/track favorites ("Favorite"/"Favorited"). `disabled` (e.g. offline)
   *  blocks the toggle and shows `title` as a tooltip. */
  follow?: {
    on: boolean;
    busy?: boolean;
    disabled?: boolean;
    title?: string;
    /** Label when not followed/favorited (default "Follow"). */
    labelOff?: string;
    /** Label when followed/favorited (default "Following"). */
    labelOn?: string;
    onToggle: () => void;
  };
  /** Overflow ⋯ menu trigger; render the menu yourself via `overflow`. */
  overflow?: ReactNode; // a <button class="action-icon"> that opens a menu
  /** Extra trailing content (e.g. a Watch bell) rendered after the pills. */
  children?: ReactNode;
}

export function ActionBar({
  onPlay,
  onShuffle,
  onSimilar,
  follow,
  overflow,
  children,
}: ActionBarProps) {
  return (
    <div className="action-bar">
      {onPlay && (
        <button
          type="button"
          className="action-play"
          title="Play"
          aria-label="Play"
          onClick={onPlay}
        >
          <Play size={18} />
        </button>
      )}
      {onShuffle && (
        <button
          type="button"
          className="action-icon"
          title="Shuffle"
          aria-label="Shuffle"
          onClick={onShuffle}
        >
          <Shuffle size={16} />
        </button>
      )}
      {onSimilar && (
        <button type="button" className="action-pill" onClick={onSimilar}>
          <Sparkles size={15} /> Similar
        </button>
      )}
      {follow && (
        <button
          type="button"
          className={`action-pill${follow.on ? " action-pill--on" : ""}`}
          disabled={follow.busy || follow.disabled}
          title={follow.title}
          onClick={follow.onToggle}
        >
          <Heart size={15} />
          {follow.on ? (follow.labelOn ?? "Following") : (follow.labelOff ?? "Follow")}
        </button>
      )}
      {children}
      {overflow}
    </div>
  );
}
