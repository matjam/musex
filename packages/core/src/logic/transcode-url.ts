/** Bitrates offered in Settings (kbps). VBR ceiling — actual files land at or below. */
export const TRANSCODE_BITRATES = [128, 192, 256, 320] as const;
export type TranscodeBitrate = (typeof TRANSCODE_BITRATES)[number];

/**
 * Required request header for HLS AAC transcoding.
 * The `container=mpegts` clause is essential — without it Plex returns 4005
 * "no conversion profile found".
 */
export const TRANSCODE_PROFILE_EXTRA =
  "add-transcode-target(type=musicProfile&context=streaming&protocol=hls&container=mpegts&audioCodec=aac)";

export interface HlsStartUrlOpts {
  baseUrl: string;
  token: string;
  clientId: string;
  session: string;
  trackId: string;
  bitrateKbps: number;
}

/**
 * Builds the HLS master-playlist URL for a music transcode session.
 * The caller must also set the `X-Plex-Client-Profile-Extra` request header
 * to `TRANSCODE_PROFILE_EXTRA` — Plex uses it to select the mpegts/AAC profile.
 *
 * The response is an HLS MASTER playlist; resolve the variant URI with
 * `parseHlsMaster`, fetch it, and parse the segments with `parseHlsMedia`.
 */
export function buildHlsStartUrl(o: HlsStartUrlOpts): string {
  const sp = new URLSearchParams({
    protocol: "hls",
    audioCodec: "aac",
    musicBitrate: String(o.bitrateKbps),
    directPlay: "0",
    directStream: "0",
    path: `/library/metadata/${o.trackId}`,
    mediaIndex: "0",
    partIndex: "0",
    offset: "0",
    session: o.session,
    "X-Plex-Session-Identifier": o.session,
    "X-Plex-Client-Identifier": o.clientId,
    "X-Plex-Platform": "Chrome",
    "X-Plex-Token": o.token,
  });
  return `${o.baseUrl}/music/:/transcode/universal/start.m3u8?${sp.toString()}`;
}

export interface HlsSegment {
  uri: string;
  durationSec: number;
}

/**
 * Parses an HLS MASTER playlist and returns the first variant URI, or null if
 * the text is already a media playlist (no `#EXT-X-STREAM-INF` line).
 * The returned URI is relative and must be resolved against the master URL.
 */
export function parseHlsMaster(text: string): string | null {
  const lines = text.split("\n");
  let takeNext = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (takeNext) {
      if (line && !line.startsWith("#")) return line;
      // skip blank/comment lines after the STREAM-INF tag
      continue;
    }
    if (line.startsWith("#EXT-X-STREAM-INF")) {
      takeNext = true;
    }
  }
  return null;
}

/**
 * Parses an HLS MEDIA playlist and returns all segments with their durations
 * and whether the playlist is complete (`#EXT-X-ENDLIST` present).
 * Segment URIs are returned as-is (relative); the host resolves them with
 * `new URL(segmentUri, mediaPlaylistUrl)`.
 */
export function parseHlsMedia(text: string): { segments: HlsSegment[]; ended: boolean } {
  const segments: HlsSegment[] = [];
  let pendingDuration = 0;
  let ended = false;

  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line === "#EXT-X-ENDLIST") {
      ended = true;
    } else if (line.startsWith("#EXTINF:")) {
      // #EXTINF:<duration>,<optional title>
      const afterColon = line.slice("#EXTINF:".length);
      const commaIdx = afterColon.indexOf(",");
      const durStr = commaIdx >= 0 ? afterColon.slice(0, commaIdx) : afterColon;
      pendingDuration = Number.parseFloat(durStr) || 0;
    } else if (!line.startsWith("#")) {
      segments.push({ uri: line, durationSec: pendingDuration });
      pendingDuration = 0;
    }
  }

  return { segments, ended };
}

export function stopSessionUrl(o: {
  baseUrl: string;
  token: string;
  clientId: string;
  session: string;
}): string {
  const sp = new URLSearchParams({
    session: o.session,
    "X-Plex-Token": o.token,
    "X-Plex-Client-Identifier": o.clientId,
  });
  return `${o.baseUrl}/audio/:/transcode/universal/stop?${sp.toString()}`;
}
