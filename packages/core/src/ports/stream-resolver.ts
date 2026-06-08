import type { Track } from "../models/index";

export type StreamKind = "direct" | "hls";

export interface StreamRef {
  url: string;
  kind: StreamKind;
}

/** Turns a Track into a playable URL. In the desktop app this returns a
 *  localhost stream-proxy URL so the Plex token never reaches the renderer. */
export interface StreamResolver {
  resolve(track: Track): Promise<StreamRef>;
}
