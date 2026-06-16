import { PLEX_DEVICE, PLEX_PLATFORM, PLEX_PRODUCT, PLEX_VERSION } from "../config";

/** Builds the X-Plex-* headers every Plex request needs. `clientId` must be
 *  stable per install so create-pin and poll-pin agree. */
export function plexHeaders(
  clientId: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    Accept: "application/json",
    "X-Plex-Client-Identifier": clientId,
    "X-Plex-Product": PLEX_PRODUCT,
    "X-Plex-Version": PLEX_VERSION,
    "X-Plex-Platform": PLEX_PLATFORM,
    "X-Plex-Device": PLEX_DEVICE,
    ...extra,
  };
}
