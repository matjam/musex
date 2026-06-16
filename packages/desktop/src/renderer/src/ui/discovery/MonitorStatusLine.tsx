/** Presentational "● Watching for new releases · N downloading" line shown
 *  under an artist's action bar. The view computes `watching`/`downloading`. */
export function MonitorStatusLine({
  watching,
  downloading,
}: {
  watching: boolean;
  downloading: number;
}) {
  if (!watching && downloading === 0) return null;
  const parts: string[] = [];
  if (watching) parts.push("Watching for new releases");
  if (downloading > 0) parts.push(`${downloading} downloading`);
  return <div className="monitor-status">● {parts.join(" · ")}</div>;
}
