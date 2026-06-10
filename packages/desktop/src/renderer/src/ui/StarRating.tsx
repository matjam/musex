import { Star } from "lucide-react";
import { useState } from "react";

interface Props {
  value10: number | null | undefined; // Plex userRating, 0–10 (one star = 2 points)
  /** Click handler: stars 1–5, or null to clear. Absent = read-only display. */
  onRate?: (stars: number | null) => void;
  size?: number;
  className?: string;
}

const STAR_NUMBERS = [1, 2, 3, 4, 5] as const;

/** Five-star rating control. Hover previews; clicking the current rating clears
 *  it. Clicks never propagate, so it's safe inside clickable rows. */
export function StarRating({ value10, onRate, size = 14, className }: Props) {
  const [hoverStars, setHoverStars] = useState<number | null>(null);
  const currentStars = value10 ? Math.round(value10 / 2) : 0;
  const shownStars = hoverStars ?? currentStars;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: onMouseLeave only resets the visual hover preview; all interactivity lives on the star buttons inside
    <span
      className={`star-rating${currentStars > 0 ? " rated" : ""}${className ? ` ${className}` : ""}`}
      onMouseLeave={onRate ? () => setHoverStars(null) : undefined}
    >
      {STAR_NUMBERS.map((n) => {
        const filled = n <= shownStars;
        const icon = filled ? (
          <Star size={size} fill="currentColor" strokeWidth={0} />
        ) : (
          <Star size={size} />
        );
        if (!onRate) {
          return (
            <span key={n} className={`star${filled ? " filled" : ""}`}>
              {icon}
            </span>
          );
        }
        return (
          <button
            key={n}
            type="button"
            className={`star${filled ? " filled" : ""}`}
            aria-label={`Rate ${n} star${n === 1 ? "" : "s"}`}
            title={n === currentStars ? "Clear rating" : `${n} star${n === 1 ? "" : "s"}`}
            onMouseEnter={() => setHoverStars(n)}
            onClick={(e) => {
              e.stopPropagation();
              onRate(n === currentStars ? null : n);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {icon}
          </button>
        );
      })}
    </span>
  );
}
