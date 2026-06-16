import { Play, Shuffle, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

export interface ActionBarProps {
  onPlay?: () => void; // primary; omit to hide
  onShuffle?: () => void;
  onSimilar?: () => void; // labeled "Similar" pill
  /** Monitor pill: omit to hide. `on` lights it green and flips the label. */
  monitor?: { on: boolean; busy?: boolean; onToggle: () => void };
  /** Overflow ⋯ menu trigger; render the menu yourself via `overflow`. */
  overflow?: ReactNode; // a <button class="action-icon"> that opens a menu
  /** Extra trailing content (e.g. a Watch bell) rendered after the pills. */
  children?: ReactNode;
}

export function ActionBar({
  onPlay,
  onShuffle,
  onSimilar,
  monitor,
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
      {monitor && (
        <button
          type="button"
          className={`action-pill${monitor.on ? " action-pill--on" : ""}`}
          disabled={monitor.busy}
          onClick={monitor.onToggle}
        >
          {monitor.on ? "Monitoring" : "Monitor"}
        </button>
      )}
      {children}
      {overflow}
    </div>
  );
}
