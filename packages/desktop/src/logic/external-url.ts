/** Only plain http/https URLs may be handed to shell.openExternal — anything
 *  else (file:, javascript:, app protocols…) is blocked. Shared by the plugin
 *  host's ctx.ui.openExternal and the renderer-facing openExternal IPC. */
export function isHttpUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://");
}

/**
 * Validate a remote image URL for the stream proxy's `/ext` endpoint
 * (plugin-supplied artwork, e.g. last.fm album covers). Strictly https-only:
 * the proxy fetches this URL verbatim with no token attached, so http(/file/
 * data/…) and anything that doesn't parse is rejected. Returns the normalized
 * URL string, or undefined when invalid.
 */
export function validExternalImageUrl(raw: string | null | undefined): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined; // not a URL at all
  }
  return parsed.protocol === "https:" ? parsed.toString() : undefined;
}
