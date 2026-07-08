/**
 * Column count for tile grids derived from the CONTENT PANE width (not the
 * window — on iPad the sidebar eats into the window, and window-derived
 * columns would oversize tiles). Minimum 2 columns (the phone baseline).
 */
export function gridColumns(paneWidth: number, minTile = 168): number {
  return Math.max(2, Math.floor(paneWidth / minTile));
}
