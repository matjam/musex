/** Builds a loadable Plex artwork URL from a `thumb` path (as parsed from PMS).
 *  Returns null when there is no thumb. Mirrors logic/stream-ref's direct URL. */
export function artUrl(
  serverBaseUrl: string,
  thumb: string | undefined,
  token: string,
): string | null {
  if (!thumb) return null;
  return `${serverBaseUrl}${thumb}?X-Plex-Token=${encodeURIComponent(token)}`;
}
