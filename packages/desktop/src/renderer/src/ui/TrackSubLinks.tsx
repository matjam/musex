import type { Track } from "@musex/core";
import { useEntityNav } from "./hooks/useEntityNav";

/** "Artist · Album" subtitle as navigation links. Clicks never propagate, so
 *  it's safe inside clickable rows (select/jump/double-click-to-play). */
export function TrackSubLinks({ track }: { track: Track }) {
  const { goArtist, goAlbum } = useEntityNav();

  return (
    <>
      <button
        type="button"
        className="link-quiet"
        disabled={!track.artistId}
        onClick={(e) => {
          e.stopPropagation();
          goArtist(track);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {track.artistName}
      </button>
      {track.albumTitle != null && (
        <>
          {" · "}
          <button
            type="button"
            className="link-quiet"
            disabled={!track.albumId}
            onClick={(e) => {
              e.stopPropagation();
              goAlbum(track);
            }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            {track.albumTitle}
          </button>
        </>
      )}
    </>
  );
}
