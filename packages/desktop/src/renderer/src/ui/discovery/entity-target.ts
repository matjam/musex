import type { View } from "../../state/app";

export type EntityRef =
  | { kind: "artist"; name: string; artistId?: string; serverId?: string; hasProvider?: boolean }
  | {
      kind: "album";
      albumId?: string;
      serverId?: string;
      artistId?: string;
      title?: string;
      thumb?: string;
    };

/** Pure: resolve an entity reference to a navigation View, or null when it
 *  isn't navigable in-app (caller opens an external URL or renders plain text). */
export function resolveEntityTarget(ref: EntityRef): View | null {
  if (ref.kind === "artist") {
    if (ref.artistId && ref.serverId) {
      return {
        name: "artist",
        artist: { id: ref.artistId, serverId: ref.serverId, name: ref.name },
      };
    }
    if (ref.hasProvider) return { name: "external-artist", artistName: ref.name };
    return null;
  }
  // Album navigation only needs albumId + serverId (AlbumDetailView fetches by
  // library + album id). artistId is NOT required — compilations / various-
  // artist albums often have an empty grandparent id, and gating on it would
  // wrongly render their names as dead text.
  if (ref.albumId && ref.serverId) {
    return {
      name: "album",
      album: {
        id: ref.albumId,
        serverId: ref.serverId,
        artistId: ref.artistId ?? "",
        title: ref.title ?? "",
        thumb: ref.thumb,
      },
    };
  }
  return null;
}
