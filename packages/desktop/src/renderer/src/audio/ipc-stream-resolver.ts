import type { StreamRef, StreamResolver, Track } from "@musex/core";

/** Resolves a track to a proxy URL by asking main (which holds the token). */
export class IpcStreamResolver implements StreamResolver {
  async resolve(track: Track): Promise<StreamRef> {
    return window.musex.resolveStream(track);
  }
}
