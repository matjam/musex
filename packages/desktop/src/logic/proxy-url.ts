/** Reverse of StreamProxy.mediaUrl: parse a baked proxy URL
 *  `http://127.0.0.1:<port>/<secret>/<serverId><plexPath>` back to its parts.
 *  Works regardless of which (now-stale) secret/port baked it — it only splits
 *  the path. Returns null if the string isn't a recognizable proxy URL. */
export function parseProxyPath(bakedUrl: string): { serverId: string; plexPath: string } | null {
  let u: URL;
  try {
    u = new URL(bakedUrl);
  } catch {
    return null;
  }
  const segs = u.pathname.replace(/^\//, "").split("/"); // [secret, serverId, ...plexPath]
  if (segs.length < 3) return null;
  const serverId = segs[1];
  if (!serverId) return null;
  const plexPath = `/${segs.slice(2).join("/")}${u.search}`;
  return { serverId, plexPath };
}
