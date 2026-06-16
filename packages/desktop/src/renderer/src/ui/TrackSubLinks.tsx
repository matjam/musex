import type { Track } from "@musex/core";
import { EntityLink } from "./discovery/EntityLink";

/** "Artist · Album" subtitle as navigable names. EntityLink stops click
 *  propagation, so it's safe inside clickable rows (select/double-click-to-play);
 *  missing ids render as plain text rather than dead links. */
export function TrackSubLinks({ track }: { track: Track }) {
  return (
    <>
      <EntityLink
        entity={{
          kind: "artist",
          name: track.artistName,
          artistId: track.artistId,
          serverId: track.serverId,
        }}
      >
        {track.artistName}
      </EntityLink>
      {track.albumTitle != null && (
        <>
          {" · "}
          <EntityLink
            entity={{
              kind: "album",
              albumId: track.albumId,
              serverId: track.serverId,
              artistId: track.artistId,
              title: track.albumTitle,
              thumb: track.thumb,
            }}
          >
            {track.albumTitle}
          </EntityLink>
        </>
      )}
    </>
  );
}
