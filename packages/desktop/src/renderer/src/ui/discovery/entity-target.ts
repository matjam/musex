import type { EntityRef } from "@musex/core";
import { externalAlbumRef, resolveEntity } from "@musex/core";
import type { View } from "../../state/app";

/** Pure: map a core `EntityRef` (via `resolveEntity`) to a navigation `View`.
 *  Every entity navigates to its own page — owned (Plex) and external alike;
 *  source no longer branches the destination. Tracks have no page, so a track
 *  ref resolves to its album (external album ref when the album id is unknown). */
export function viewForEntity(ref: EntityRef): View {
  const { nav } = resolveEntity(ref);
  switch (nav.kind) {
    case "artist":
      return { name: "artist", ref: nav.ref };
    case "album":
      return { name: "album", ref: nav.ref };
    case "track": {
      // Tracks have no page — navigate to the album. Owned tracks carry no
      // album id on the ref, so fall back to an external album ref built from
      // the track's album/artist names (the unified AlbumView resolves it).
      const albumRef = externalAlbumRef(
        nav.ref.albumTitle ?? nav.ref.name,
        nav.ref.artistName ?? "",
      );
      return { name: "album", ref: albumRef };
    }
  }
}
