import type { Track } from "@musex/core";
import {
  entityRefForAlbum,
  entityRefForArtist,
  externalAlbumRef,
  externalArtistRef,
} from "@musex/core";
import { EntityLink } from "./discovery/EntityLink";

/** "Artist · Album" subtitle as navigable names. EntityLink stops click
 *  propagation, so it's safe inside clickable rows (select/double-click-to-play).
 *  Owned ids build a Plex ref; otherwise an external ref (every entity still
 *  navigates to its unified page). */
export function TrackSubLinks({ track }: { track: Track }) {
  return (
    <>
      <EntityLink
        entity={
          track.artistId
            ? entityRefForArtist({
                id: track.artistId,
                serverId: track.serverId,
                name: track.artistName,
              })
            : externalArtistRef(track.artistName)
        }
      >
        {track.artistName}
      </EntityLink>
      {track.albumTitle != null && (
        <>
          {" · "}
          <EntityLink
            entity={
              track.albumId
                ? entityRefForAlbum({
                    id: track.albumId,
                    serverId: track.serverId,
                    artistId: track.artistId,
                    title: track.albumTitle,
                    thumb: track.thumb,
                  })
                : externalAlbumRef(track.albumTitle, track.artistName)
            }
          >
            {track.albumTitle}
          </EntityLink>
        </>
      )}
    </>
  );
}
