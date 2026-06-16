import type { Track } from "@musex/core";
import type { View } from "../../state/app";
import type { EntityPanelPayload } from "../../state/panel";

/** While the entity panel is open, its content follows the user's focus.
 *  Precedence (first match wins):
 *   1. an explicit focus override (peeked entity; cleared on navigation),
 *   2. a track selected in a list → song panel,
 *   3. the current view is an artist/album → that artist/album,
 *   4. otherwise the now-playing track → song panel,
 *   5. nothing → null (placeholder). */
export function derivePanelFocus(args: {
  override: EntityPanelPayload | null;
  selectedTrack: Track | null;
  view: View;
  nowPlaying: Track | null;
}): EntityPanelPayload | null {
  const { override, selectedTrack, view, nowPlaying } = args;
  if (override) return override;
  if (selectedTrack) return { kind: "song", track: selectedTrack };
  if (view.name === "artist")
    return {
      kind: "artist",
      artistName: view.artist.name,
      artistId: view.artist.id,
      serverId: view.artist.serverId,
      thumb: view.artist.thumb,
    };
  if (view.name === "album") return { kind: "album", album: view.album };
  if (nowPlaying) return { kind: "song", track: nowPlaying };
  return null;
}
