import type { StreamRef, Track } from "@musex/core";

/** Audio codecs Apple AVPlayer (the engine behind expo-audio on iOS) can
 *  direct-play. Everything else falls back to a Plex HLS transcode. */
export const AVPLAYER_CODECS = ["aac", "mp3", "alac", "flac", "pcm", "aiff", "wav"] as const;

export function isDirectPlayable(audioCodec: string): boolean {
  return (AVPLAYER_CODECS as readonly string[]).includes(audioCodec.toLowerCase());
}

function directUrl(serverBaseUrl: string, partKey: string, token: string): string {
  return `${serverBaseUrl}${partKey}?X-Plex-Token=${encodeURIComponent(token)}`;
}

function transcodeUrl(
  serverBaseUrl: string,
  trackId: string,
  token: string,
  clientId: string,
): string {
  const params = new URLSearchParams({
    path: `/library/metadata/${trackId}`,
    mediaIndex: "0",
    partIndex: "0",
    protocol: "hls",
    fastSeek: "1",
    copyts: "1",
    offset: "0",
    "X-Plex-Platform": "Chrome",
    "X-Plex-Client-Identifier": clientId,
    "X-Plex-Token": token,
  });
  return `${serverBaseUrl}/audio/:/transcode/universal/start.m3u8?${params.toString()}`;
}

/** Pure decision: direct-play when AVPlayer supports the codec, else HLS transcode. */
export function decideStreamRef(
  track: Track,
  serverBaseUrl: string,
  token: string,
  clientId: string,
): StreamRef {
  if (isDirectPlayable(track.media.audioCodec)) {
    return { kind: "direct", url: directUrl(serverBaseUrl, track.media.partKey, token) };
  }
  return { kind: "hls", url: transcodeUrl(serverBaseUrl, track.id, token, clientId) };
}
