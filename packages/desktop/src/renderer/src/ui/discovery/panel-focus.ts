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
      artistName: view.ref.name,
      artistId: view.ref.id,
      serverId: view.ref.serverId,
      thumb: view.ref.thumb,
    };
  if (view.name === "album")
    return {
      kind: "album",
      album: {
        id: view.ref.id ?? "",
        serverId: view.ref.serverId ?? "",
        artistId: "",
        title: view.ref.albumTitle ?? view.ref.name,
        thumb: view.ref.thumb,
      },
    };
  if (nowPlaying) return { kind: "song", track: nowPlaying };
  return null;
}
