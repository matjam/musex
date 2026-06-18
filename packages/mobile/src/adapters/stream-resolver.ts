import type { StreamRef, StreamResolver, Track } from "@musex/core";
import { decideStreamRef } from "../logic/stream-ref";

/** Resolves a Track to a playable URL. `baseUrlFor` comes from the gateway
 *  (the reachable PMS connection); `token` is a GETTER so one long-lived
 *  PlaybackSession can outlive a sign-in (the token isn't known at construction).
 *
 *  `localUriFor` (optional) is called first; if it returns a non-null file URI
 *  the track plays from local storage (offline + zero bandwidth), bypassing the
 *  network decision entirely. The store provides this by looking up the
 *  DownloadIndex. */
export class PlexStreamResolver implements StreamResolver {
  constructor(
    private readonly baseUrlFor: (serverId: string) => string,
    private readonly token: () => string,
    private readonly clientId: string,
    private readonly localUriFor?: (track: Track) => string | null,
  ) {}

  resolve(track: Track): Promise<StreamRef> {
    const local = this.localUriFor ? this.localUriFor(track) : null;
    if (local) {
      return Promise.resolve({ kind: "direct", url: local });
    }
    return Promise.resolve(
      decideStreamRef(track, this.baseUrlFor(track.serverId), this.token(), this.clientId),
    );
  }
}
