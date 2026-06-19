/** Presentational "● Following · N downloading" line shown under an artist's
 *  action bar. The view computes `following`/`downloading`. */
export function MonitorStatusLine({
  following,
  downloading,
}: {
  following: boolean;
  downloading: number;
}) {
  if (!following && downloading === 0) return null;
  const parts: string[] = [];
  if (following) parts.push("Following for new releases");
  if (downloading > 0) parts.push(`${downloading} downloading`);
  return <div className="monitor-status">● {parts.join(" · ")}</div>;
}
