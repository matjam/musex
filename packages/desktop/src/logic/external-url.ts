/** Only plain http/https URLs may be handed to shell.openExternal — anything
 *  else (file:, javascript:, app protocols…) is blocked. Shared by the plugin
 *  host's ctx.ui.openExternal and the renderer-facing openExternal IPC. */
export function isHttpUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://");
}
