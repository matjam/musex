import type { StreamRef, StreamResolver, Track } from "@musex/core";
import { decideStreamRef } from "../logic/stream-ref";

/** Resolves a Track to a playable URL. `baseUrlFor` comes from the gateway
 *  (the reachable PMS connection); `token` is a GETTER so one long-lived
 *  PlaybackSession can outlive a sign-in (the token isn't known at construction). */
export class PlexStreamResolver implements StreamResolver {
  constructor(
    private readonly baseUrlFor: (serverId: string) => string,
    private readonly token: () => string,
    private readonly clientId: string,
  ) {}

  resolve(track: Track): Promise<StreamRef> {
    return Promise.resolve(
      decideStreamRef(track, this.baseUrlFor(track.serverId), this.token(), this.clientId),
    );
  }
}
