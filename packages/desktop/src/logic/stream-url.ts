const SCHEME = "musex-stream";

/** Build a token-free proxy URL: musex-stream://{serverId}{plexPath}?{query-minus-token}.
 *  `plexPathWithQuery` is a server-relative path, optionally with a query string. */
export function buildProxyUrl(serverId: string, plexPathWithQuery: string): string {
  const [path, query = ""] = plexPathWithQuery.split("?", 2);
  const params = new URLSearchParams(query);
  params.delete("X-Plex-Token");
  const qs = params.toString();
  return `${SCHEME}://${serverId}${path}${qs ? `?${qs}` : ""}`;
}

export interface ParsedProxyUrl {
  serverId: string;
  path: string;
  search: string; // includes leading "?" or is ""
}

export function parseProxyUrl(url: string): ParsedProxyUrl | null {
  if (!url.startsWith(`${SCHEME}://`)) return null;
  const u = new URL(url);
  return { serverId: u.hostname, path: u.pathname, search: u.search };
}
