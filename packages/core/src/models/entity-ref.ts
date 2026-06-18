import type { Album, Artist, Track } from "./index.js";

export type EntityKind = "artist" | "album" | "track";
export type EntitySource = "plex" | "external";

/** A source-agnostic reference to an entity (artist/album/track), owned (Plex)
 *  or external (last.fm / unowned). The currency of navigation + follow. */
export interface EntityRef {
  kind: EntityKind;
  source: EntitySource;
  id?: string;
  serverId?: string;
  name: string;
  artistName?: string;
  albumTitle?: string;
  thumb?: string;
}

export function entityRefForArtist(a: Artist): EntityRef {
  return {
    kind: "artist",
    source: "plex",
    id: a.id,
    serverId: a.serverId,
    name: a.name,
    thumb: a.thumb,
  };
}

export function entityRefForAlbum(a: Album): EntityRef {
  return {
    kind: "album",
    source: "plex",
    id: a.id,
    serverId: a.serverId,
    name: a.title,
    albumTitle: a.title,
    thumb: a.thumb,
  };
}

export function entityRefForTrack(t: Track): EntityRef {
  return {
    kind: "track",
    source: "plex",
    id: t.id,
    serverId: t.serverId,
    name: t.title,
    artistName: t.artistName,
    albumTitle: t.albumTitle,
    thumb: t.thumb,
  };
}

export function externalArtistRef(name: string): EntityRef {
  return { kind: "artist", source: "external", name };
}

export function externalAlbumRef(title: string, artistName: string): EntityRef {
  return { kind: "album", source: "external", name: title, artistName };
}
