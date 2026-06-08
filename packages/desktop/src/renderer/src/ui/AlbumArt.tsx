import { useState } from "react";

interface Props {
  thumb?: string;
  /** CSS class(es) applied to both the img and the fallback div. */
  className?: string;
}

/**
 * Renders album/artist art via the musex stream proxy.
 * `thumb` is already a full http://127.0.0.1:PORT/… URL baked by the main process.
 * Falls back to the gradient placeholder div if thumb is absent or fails to load.
 */
export function AlbumArt({ thumb, className }: Props) {
  const [failed, setFailed] = useState(false);

  if (!thumb || failed) {
    return <div className={className} />;
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
