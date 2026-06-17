/** Bitrates offered in Settings (kbps). VBR ceiling — actual files land at or below. */
export const TRANSCODE_BITRATES = [128, 192, 256, 320] as const;
export type TranscodeBitrate = (typeof TRANSCODE_BITRATES)[number];

export interface TranscodeUrlOpts {
  baseUrl: string;
  token: string;
  clientId: string;
  session: string;
  trackId: string;
  bitrateKbps: number;
}

/** The confirmed single-file MP3 transcode URL (see spec "Transcode — confirmed by spike").
 *  Returns one continuous audio/mpeg body; read to EOF and save. */
export function buildTranscodeUrl(o: TranscodeUrlOpts): string {
  const sp = new URLSearchParams({
    "X-Plex-Token": o.token,
    "X-Plex-Client-Identifier": o.clientId,
    "X-Plex-Session-Identifier": o.session,
    session: o.session,
    "X-Plex-Platform": "Chrome",
    path: `/library/metadata/${o.trackId}`,
    mediaIndex: "0",
    partIndex: "0",
    offset: "0",
    protocol: "http",
    directPlay: "0",
    directStream: "0",
    audioCodec: "mp3",
    musicBitrate: String(o.bitrateKbps),
  });
  return `${o.baseUrl}/audio/:/transcode/universal/start.mp3?${sp.toString()}`;
}

export function stopSessionUrl(o: { baseUrl: string; token: string; clientId: string; session: string }): string {
  const sp = new URLSearchParams({
    session: o.session,
    "X-Plex-Token": o.token,
    "X-Plex-Client-Identifier": o.clientId,
  });
  return `${o.baseUrl}/audio/:/transcode/universal/stop?${sp.toString()}`;
}
