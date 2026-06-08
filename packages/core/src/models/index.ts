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
}

export interface Artist {
  id: string;
  serverId: string;
  name: string;
  thumb?: string;
}

export interface Album {
  id: string;
  serverId: string;
  artistId: string;
  title: string;
  year?: number;
  thumb?: string;
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
  artistName: string;
  albumTitle?: string;
  title: string;
  durationMs: number;
  trackNumber?: number;
  thumb?: string;
  media: MediaInfo;
}

export interface Queue {
  tracks: Track[];
  index: number;
}
