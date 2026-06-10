import { useApp } from "../../state/app";

/** Navigate to an artist/album page from the minimal fields a Track carries.
 *  Each returns undefined when the id is missing (caller renders plain text /
 *  disabled instead). */
export function useEntityNav() {
  const { dispatch } = useApp();

  function goArtist(t: { artistId: string; serverId: string; artistName: string }): void {
    if (!t.artistId) return;
    dispatch({
      type: "navigate",
      view: {
        name: "artist",
        artist: { id: t.artistId, serverId: t.serverId, name: t.artistName },
      },
    });
  }

  function goAlbum(t: {
    albumId: string;
    serverId: string;
    artistId: string;
    albumTitle?: string;
    thumb?: string;
  }): void {
    if (!t.albumId) return;
    dispatch({
      type: "navigate",
      view: {
        name: "album",
        album: {
          id: t.albumId,
          serverId: t.serverId,
          artistId: t.artistId,
          title: t.albumTitle ?? "",
          thumb: t.thumb,
        },
      },
    });
  }

  return { goArtist, goAlbum };
}
