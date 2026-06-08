import type { StreamKind } from "@musex/core";

/** Audio codecs Chromium decodes natively (so we can direct-play). Everything
 *  else falls back to Plex transcoding (HLS). */
export const CHROMIUM_AUDIO_CODECS: ReadonlySet<string> = new Set([
  "mp3",
  "mp2",
  "aac",
  "flac",
  "opus",
  "vorbis",
  "pcm",
  "wav",
]);

export function chooseStreamKind(audioCodec: string | undefined): StreamKind {
  if (!audioCodec) return "hls";
  return CHROMIUM_AUDIO_CODECS.has(audioCodec.toLowerCase()) ? "direct" : "hls";
}
