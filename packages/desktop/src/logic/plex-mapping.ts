import type { Album, Artist, MediaInfo, Track } from "@musex/core";

interface RawArtist {
  ratingKey: string;
  title: string;
  thumb?: string;
  updatedAt?: number;
  userRating?: number; // 0–10
}
interface RawAlbum {
  ratingKey: string;
  title: string;
  year?: number;
  thumb?: string;
  parentRatingKey?: string;
  updatedAt?: number;
  userRating?: number; // 0–10
}
interface RawPart {
  id: string | number;
  key: string;
  container?: string;
}
interface RawMedia {
  audioCodec?: string;
  container?: string;
  bitrate?: number;
  parts?: RawPart[];
}
interface RawTrack {
  ratingKey: string;
  title: string;
  index?: number;
  duration?: number;
  parentRatingKey?: string;
  parentTitle?: string;
  grandparentRatingKey?: string | number;
  grandparentTitle?: string;
  thumb?: string;
  userRating?: number; // 0–10
  media?: RawMedia[];
}

/**
 * Normalise a Plex thumb value to a server-relative path, stripping any host
 * or token query params that the full Plex URL carries.  Returns undefined when
 * there is nothing usable.
 */
export function thumbPath(thumb: string | undefined): string | undefined {
  if (!thumb) return undefined;
  if (thumb.startsWith("/")) return thumb; // already a path
  try {
    return new URL(thumb).pathname; // drop host + token query
  } catch {
    return undefined;
  }
}

export function toArtist(raw: RawArtist, serverId: string): Artist {
  return {
    id: raw.ratingKey,
    serverId,
    name: raw.title,
    thumb: thumbPath(raw.thumb),
    updatedAt: raw.updatedAt,
    userRating: raw.userRating,
  };
}

export function toAlbum(raw: RawAlbum, serverId: string): Album {
  return {
    id: raw.ratingKey,
    serverId,
    artistId: raw.parentRatingKey ?? "",
    title: raw.title,
    year: raw.year,
    thumb: thumbPath(raw.thumb),
    updatedAt: raw.updatedAt,
    userRating: raw.userRating,
  };
}

export function toTrack(raw: RawTrack, serverId: string): Track {
  const media = raw.media?.[0];
  const part = media?.parts?.[0];
  if (!media || !part) {
    throw new Error(`Track ${raw.ratingKey} ("${raw.title}") has no playable media part`);
  }
  const info: MediaInfo = {
    container: part.container ?? media.container ?? "",
    audioCodec: media.audioCodec ?? "",
    bitrate: media.bitrate,
    partId: String(part.id),
    partKey: part.key,
  };
  return {
    id: raw.ratingKey,
    serverId,
    albumId: raw.parentRatingKey ?? "",
    artistId: raw.grandparentRatingKey != null ? String(raw.grandparentRatingKey) : "",
    albumTitle: raw.parentTitle,
    artistName: raw.grandparentTitle ?? "",
    title: raw.title,
    trackNumber: raw.index,
    durationMs: raw.duration ?? 0,
    thumb: thumbPath(raw.thumb),
    userRating: raw.userRating,
    media: info,
  };
}
