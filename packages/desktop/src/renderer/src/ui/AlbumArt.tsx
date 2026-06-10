import { Disc3, Mic2, Music } from "lucide-react";
import { useState } from "react";

interface Props {
  thumb?: string;
  /** CSS class(es) applied to both the img and the fallback div. */
  className?: string;
  /** Name/title of the item — drives the deterministic placeholder gradient. */
  label?: string;
  /** What the art represents — picks the placeholder icon. */
  kind?: "artist" | "album" | "track";
}

/** Small deterministic string hash (djb2). */
function hashLabel(label: string): number {
  let hash = 5381;
  for (let i = 0; i < label.length; i++) {
    hash = (hash * 33) ^ label.charCodeAt(i);
  }
  return hash >>> 0;
}

/** Dark, muted gradient derived from the label; undefined keeps the CSS fallback. */
function gradientFor(label?: string): string | undefined {
  if (!label) return undefined;
  const h1 = hashLabel(label) % 360;
  const h2 = (h1 + 45) % 360;
  return `linear-gradient(135deg, hsl(${h1} 35% 20%), hsl(${h2} 45% 30%))`;
}

const KIND_ICONS = {
  artist: Mic2,
  album: Disc3,
  track: Music,
} as const;

/**
 * Renders album/artist art via the musex stream proxy.
 * `thumb` is already a full http://127.0.0.1:PORT/… URL baked by the main process.
 * Falls back to a deterministic gradient + icon placeholder if thumb is absent
 * or fails to load.
 */
export function AlbumArt({ thumb, className, label, kind }: Props) {
  const [failed, setFailed] = useState(false);

  if (!thumb || failed) {
    const Icon = KIND_ICONS[kind ?? "track"];
    return (
      <div
        className={`${className ?? ""} art-placeholder`}
        style={{ background: gradientFor(label) }}
        aria-hidden
      >
        <Icon size="42%" />
      </div>
    );
  }

  return (
    <img
      className={className}
      src={thumb}
      alt=""
      onError={() => setFailed(true)}
      // Decorative art — screen readers don't need it
      aria-hidden
    />
  );
}
