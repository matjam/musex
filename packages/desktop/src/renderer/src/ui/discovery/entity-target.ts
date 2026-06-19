import type { EntityRef } from "@musex/core";
import { externalAlbumRef, externalArtistRef, resolveEntity } from "@musex/core";
import type { View } from "../../state/app";

/** Pure: map a core `EntityRef` (via `resolveEntity`) to a navigation `View`.
 *  Every entity navigates to its own page — owned (Plex) and external alike;
 *  source no longer branches the destination.
 *
 *  IMPORTANT: `viewForEntity` should only ever receive an ARTIST or ALBUM ref.
 *  Tracks have no page, and an `EntityRef` carries no `albumId`, so there is no
 *  reliable way to navigate from a track to its OWNED album here. Callers must
 *  resolve a track to its album ref themselves (e.g. via `goAlbum` /
 *  `entityRefForAlbum`) BEFORE calling this. The `track` case below is a safe
 *  fallback only: an external track → its external album placeholder; an owned
 *  track (no album id) → the artist page rather than a wrong external-album
 *  placeholder. */
export function viewForEntity(ref: EntityRef): View {
  const { nav } = resolveEntity(ref);
  switch (nav.kind) {
    case "artist":
      return { name: "artist", ref: nav.ref };
    case "album":
      return { name: "album", ref: nav.ref };
    case "track": {
      // Tracks have no page. An external track carries only names, so its
      // album placeholder is the best target. An OWNED track carries no album
      // id, so sending it to an external album placeholder would land on the
      // wrong (unowned) page — fall back to the artist page instead.
      if (nav.ref.source === "external") {
        return {
          name: "album",
          ref: externalAlbumRef(nav.ref.albumTitle ?? nav.ref.name, nav.ref.artistName ?? ""),
        };
      }
      return { name: "artist", ref: externalArtistRef(nav.ref.artistName ?? nav.ref.name) };
    }
  }
}
