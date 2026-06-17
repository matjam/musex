import type { Album, Artist, Library, Playlist, PlaylistTrack, Server, Track } from "@musex/core";

type Json = Record<string, unknown>;
const container = (j: unknown): Json => ((j as Json)?.MediaContainer as Json) ?? {};
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);
const tags = (v: unknown): string[] | undefined => {
  const list = arr(v)
    .map((t) => str(t.tag))
    .filter((t): t is string => !!t);
  return list.length ? list : undefined;
};

export function parseArtists(json: unknown, serverId: string): Artist[] {
  return arr(container(json).Metadata).map((m) => ({
    id: String(m.ratingKey),
    serverId,
    name: str(m.title) ?? "",
    thumb: str(m.thumb),
    updatedAt: num(m.updatedAt) ? (num(m.updatedAt) as number) * 1000 : undefined,
    userRating: num(m.userRating),
    genres: tags(m.Genre),
    moods: tags(m.Mood),
  }));
}

export function parseAlbums(json: unknown, serverId: string): Album[] {
  return arr(container(json).Metadata).map((m) => ({
    id: String(m.ratingKey),
    serverId,
    artistId: String(m.parentRatingKey ?? ""),
    title: str(m.title) ?? "",
    year: num(m.year),
    thumb: str(m.thumb),
    updatedAt: num(m.updatedAt) ? (num(m.updatedAt) as number) * 1000 : undefined,
    userRating: num(m.userRating),
    genres: tags(m.Genre),
    moods: tags(m.Mood),
  }));
}

/** Parse a single Plex track Metadata node, or null if it has no playable part. */
function parseTrack(m: Json, serverId: string): Track | null {
  const media = arr(m.Media)[0];
  const part = media ? arr(media.Part)[0] : undefined;
  if (!media || !part) return null;
  return {
    id: String(m.ratingKey),
    serverId,
    albumId: String(m.parentRatingKey ?? ""),
    artistId: String(m.grandparentRatingKey ?? ""),
    artistName: str(m.grandparentTitle) ?? "",
    albumTitle: str(m.parentTitle),
    title: str(m.title) ?? "",
    durationMs: num(m.duration) ?? 0,
    trackNumber: num(m.index),
    thumb: str(m.thumb),
    userRating: num(m.userRating),
    genres: tags(m.Genre),
    moods: tags(m.Mood),
    media: {
      container: str(media.container) ?? "",
      audioCodec: str(media.audioCodec) ?? "",
      bitrate: num(media.bitrate),
      partId: String(part.id),
      partKey: str(part.key) ?? "",
    },
  };
}

export function parseTracks(json: unknown, serverId: string): Track[] {
  const out: Track[] = [];
  for (const m of arr(container(json).Metadata)) {
    const t = parseTrack(m, serverId);
    if (t) out.push(t);
  }
  return out;
}

export function parsePlaylists(json: unknown, serverId: string): Playlist[] {
  return arr(container(json).Metadata).map((m) => ({
    id: String(m.ratingKey),
    serverId,
    title: str(m.title) ?? "",
    trackCount: num(m.leafCount) ?? 0,
    durationMs: num(m.duration),
    thumb: str(m.composite) ?? str(m.thumb),
    updatedAt: num(m.updatedAt) ? (num(m.updatedAt) as number) * 1000 : undefined,
  }));
}

export function parsePlaylistTracks(json: unknown, serverId: string): PlaylistTrack[] {
  const out: PlaylistTrack[] = [];
  for (const m of arr(container(json).Metadata)) {
    const track = parseTrack(m, serverId);
    if (track) out.push({ track, playlistItemId: String(m.playlistItemID ?? "") });
  }
  return out;
}

export function parseLibraries(json: unknown, serverId: string, serverName: string): Library[] {
  return arr(container(json).Directory)
    .filter((d) => d.type === "artist")
    .map((d) => {
      const updated = Math.max(num(d.updatedAt) ?? 0, num(d.scannedAt) ?? 0);
      return {
        id: String(d.key),
        serverId,
        serverName,
        title: str(d.title) ?? "",
        type: "music" as const,
        updatedAt: updated ? updated * 1000 : undefined,
      };
    });
}

/** plex.tv /api/v2/resources response (array of resources). */
export function parseServers(json: unknown): Server[] {
  return arr(json)
    .filter((r) => r.provides && String(r.provides).includes("server"))
    .map((r) => ({
      id: String(r.clientIdentifier),
      name: str(r.name) ?? "",
      connections: arr(r.connections).map((c) => ({
        uri: str(c.uri) ?? "",
        local: Boolean(c.local),
        relay: Boolean(c.relay),
      })),
    }));
}
