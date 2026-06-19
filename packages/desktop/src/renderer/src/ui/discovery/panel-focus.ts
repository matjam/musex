import type { Track } from "@musex/core";
import type { EntityPanelPayload } from "../../state/panel";

/** While the context panel is open, its content follows the user's focus.
 *  The panel is now-playing / track-detail context ONLY (entity navigation goes
 *  to the unified pages, never the panel), so the focus is a track:
 *  Precedence (first match wins):
 *   1. a track selected in a list → song panel,
 *   2. otherwise the now-playing track → song panel,
 *   3. nothing → null (placeholder). */
export function derivePanelFocus(args: {
  selectedTrack: Track | null;
  nowPlaying: Track | null;
}): EntityPanelPayload | null {
  const { selectedTrack, nowPlaying } = args;
  if (selectedTrack) return { kind: "song", track: selectedTrack };
  if (nowPlaying) return { kind: "song", track: nowPlaying };
  return null;
}
