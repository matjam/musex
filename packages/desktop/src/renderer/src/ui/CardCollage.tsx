import { Music } from "lucide-react";

interface Props {
  /** Full proxy-art URLs (Album.thumb), already sampled/deduped upstream. */
  thumbs: string[];
  className?: string;
}

/**
 * Square album-art collage for genre/mix tiles (Spotify-style mosaic).
 * Deterministic layouts: 0 thumbs -> icon placeholder, 1 -> single full
 * image, 2 or 3 -> two vertical halves (first two), 4+ -> 2x2 grid.
 */
export function CardCollage({ thumbs, className }: Props) {
  // Distinct albums can share an art URL; dedupe so keys are unique and the
  // mosaic never shows the same tile twice.
  const unique = [...new Set(thumbs)];
  const shown = unique.length >= 4 ? unique.slice(0, 4) : unique.slice(0, 2);
  const suffix = className ? ` ${className}` : "";

  if (shown.length === 0) {
    return (
      <div className={`card-collage art-placeholder${suffix}`} aria-hidden>
        <Music size="42%" />
      </div>
    );
  }

  const layout = shown.length === 4 ? " cols-2 rows-2" : shown.length === 2 ? " cols-2" : "";
  return (
    <div className={`card-collage${layout}${suffix}`} aria-hidden>
      {shown.map((src) => (
        <img key={src} src={src} alt="" />
      ))}
    </div>
  );
}
