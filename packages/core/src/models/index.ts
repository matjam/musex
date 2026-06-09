export interface Connection {
  uri: string;
  local: boolean;
  relay: boolean;
}

export interface Server {
  id: string; // machineIdentifier
  name: string;
  connections: Connection[];
}

export interface Library {
  id: string; // section key
  serverId: string;
  serverName: string;
  title: string;
  type: "music";
  updatedAt?: number; // epoch ms — section scannedAt/updatedAt, for library-wide cache validation
}

export type LibrarySort = "title" | "artist" | "added";

export interface Artist {
  id: string;
  serverId: string;
  name: string;
  thumb?: string;
  updatedAt?: number; // epoch ms, for cache validation
}

export interface Album {
  id: string;
  serverId: string;
  artistId: string;
  title: string;
  year?: number;
  thumb?: string;
  updatedAt?: number; // epoch ms, for cache validation
}

export interface MediaInfo {
  container: string;
  audioCodec: string;
  bitrate?: number;
  partId: string;
  partKey: string; // e.g. /library/parts/12345/file.flac
}

export interface Track {
  id: string;
  serverId: string;
  albumId: string;
  artistId: string;
  artistName: string;
  albumTitle?: string;
  title: string;
  durationMs: number;
  trackNumber?: number;
  thumb?: string;
  media: MediaInfo;
}

export type RepeatMode = "none" | "all" | "one";

export interface Queue {
  tracks: Track[];
  index: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

export interface SearchResults {
  artists: Artist[];
  albums: Album[];
  tracks: Track[];
}

export interface Playlist {
  id: string; // Plex playlist ratingKey
  serverId: string;
  title: string;
  trackCount: number;
  durationMs?: number;
  thumb?: string;
  updatedAt?: number; // epoch ms, for cache validation
}

/** A track as it appears inside a playlist: the track plus its identity within
 *  that playlist (Plex playlistItemID), needed to remove the right row even when
 *  the same track appears more than once. */
export interface PlaylistTrack {
  track: Track;
  playlistItemId: string;
}
