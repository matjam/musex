import { useState } from "react";
import { artUrl } from "../util/art";

interface Props {
  serverId: string;
  thumb?: string;
  /** CSS class(es) applied to both the img and the fallback div. */
  className?: string;
}

/**
 * Renders album/artist art via the musex-stream proxy (token-safe).
 * Falls back to the gradient placeholder div if thumb is absent or fails to load.
 */
export function AlbumArt({ serverId, thumb, className }: Props) {
  const [failed, setFailed] = useState(false);
  const url = artUrl(serverId, thumb);

  if (!url || failed) {
    return <div className={className} />;
  }

  return (
    <img
      className={className}
      src={url}
      alt=""
      onError={() => setFailed(true)}
      // Decorative art — screen readers don't need it
      aria-hidden
    />
  );
}
