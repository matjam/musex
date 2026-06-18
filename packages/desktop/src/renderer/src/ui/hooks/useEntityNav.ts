import type { EntityRef } from "@musex/core";
import { entityRefForAlbum, entityRefForArtist } from "@musex/core";
import { useApp } from "../../state/app";
import { viewForEntity } from "../discovery/entity-target";

/** Navigate to an entity's page via core `resolveEntity`. `goRef` takes a core
 *  `EntityRef`; `goArtist`/`goAlbum` are convenience wrappers building an owned
 *  Plex ref from the minimal fields a Track carries (each is a no-op when the
 *  required id is missing — caller renders plain text / disabled instead). */
export function useEntityNav() {
  const { dispatch } = useApp();

  function goRef(ref: EntityRef): void {
    dispatch({ type: "navigate", view: viewForEntity(ref) });
  }

  function goArtist(t: { artistId: string; serverId: string; artistName: string }): void {
    if (!t.artistId) return;
    goRef(entityRefForArtist({ id: t.artistId, serverId: t.serverId, name: t.artistName }));
  }

  function goAlbum(t: {
    albumId: string;
    serverId: string;
    artistId: string;
    albumTitle?: string;
    thumb?: string;
  }): void {
    if (!t.albumId) return;
    goRef(
      entityRefForAlbum({
        id: t.albumId,
        serverId: t.serverId,
        artistId: t.artistId,
        title: t.albumTitle ?? "",
        thumb: t.thumb,
      }),
    );
  }

  return { goRef, goArtist, goAlbum };
}
