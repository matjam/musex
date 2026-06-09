import type { Album, Artist } from "@musex/core";
import { useCallback } from "react";
import { listValidator } from "../../../../shared/list-validator";
import { useApp } from "../../state/app";
import { usePlayer } from "../../state/player";

/** Fetch-and-play helpers for whole albums/artists (used by grid play buttons).
 *  An album plays its tracks in order; an artist plays all tracks across albums. */
export function useCollectionPlay() {
  const { library } = useApp();
  const { playTracks } = usePlayer();

  const playAlbum = useCallback(
    async (album: Album) => {
      if (!library) return;
      const tracks = await window.musex.listTracks(
        library.id,
        album.id,
        listValidator(album.updatedAt),
      );
      if (tracks.length > 0) playTracks(tracks, 0);
    },
    [library, playTracks],
  );

  const playArtist = useCallback(
    async (artist: Artist) => {
      if (!library) return;
      const albums = await window.musex.listAlbums(
        library.id,
        artist.id,
        listValidator(artist.updatedAt),
      );
      const arrays = await Promise.all(
        albums.map((a) => window.musex.listTracks(library.id, a.id, listValidator(a.updatedAt))),
      );
      const tracks = arrays.flat();
      if (tracks.length > 0) playTracks(tracks, 0);
    },
    [library, playTracks],
  );

  return { playAlbum, playArtist };
}
