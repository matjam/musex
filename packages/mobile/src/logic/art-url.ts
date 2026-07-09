/** Builds a loadable Plex artwork URL from a `thumb` path (as parsed from PMS).
 *  Returns null when there is no thumb. Mirrors logic/stream-ref's direct URL.
 *  An already-absolute thumb (a full URL from a legacy download record baked
 *  before the raw-path convention) is returned as-is — never double-baked. */
export function artUrl(
  serverBaseUrl: string,
  thumb: string | undefined,
  token: string,
): string | null {
  if (!thumb) return null;
  if (thumb.startsWith("http")) return thumb;
  return `${serverBaseUrl}${thumb}?X-Plex-Token=${encodeURIComponent(token)}`;
}
